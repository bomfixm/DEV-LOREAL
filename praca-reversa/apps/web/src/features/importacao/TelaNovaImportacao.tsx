import {
  API_PREFIXO,
  ARQUIVOS_MODELO,
  CAMPOS_IMPORTACAO,
  LimitesImportacaoSchema,
  ResultadoEnvioSchema,
  TIPOS_IMPORTACAO_GERAL,
  tiposImportacaoPermitidos,
  type ArquivoModelo,
  type Permissao,
  type ResultadoEnvio,
  type TipoImportacao,
} from '@praca-reversa/contracts';
import { useId, useRef, useState } from 'react';
import { useChaves } from '../../api/chaves';
import { FalhaRequisicao, baixarArquivo, enviarArquivo, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeArquivo } from '../../components/Icones';
import { Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { ALCANCE_TIPO, ROTULOS_TIPO } from './rotulos';

const MB = 1_048_576;

/** Tipo de cada arquivo de modelo (prefixo do nome). */
function tipoDoModelo(m: ArquivoModelo): TipoImportacao {
  if (m.startsWith('produtos')) return 'PRODUTOS';
  if (m.startsWith('claims')) return 'CLAIMS';
  if (m.startsWith('inventario')) return 'INVENTARIO';
  if (m.startsWith('selecao')) return 'SELECAO_CLIENTE';
  if (m.startsWith('bipagem')) return 'BIPAGEM';
  return 'DEVOLUCOES';
}

/**
 * Passos 1 e 2: escolher o tipo e enviar o arquivo. O arquivo vai inteiro para
 * o servidor, que confere formato e limites antes de criar o lote. A tela só
 * mostra "recebido" depois da resposta da API (sem barra de progresso que
 * pareça gravação).
 */
export function TelaNovaImportacao({ permissoes, inicial, aoNavegar }: { permissoes: readonly Permissao[]; inicial?: TipoImportacao | undefined; aoNavegar: Navegar }) {
  const ids = useId();
  const conectado = useConectado();
  const chaves = useChaves();
  const arquivoRef = useRef<HTMLInputElement>(null);
  // Só os tipos permitidos ao perfil (o servidor confere de novo).
  // A bipagem começa pelo palete, no mapa.
  const permitidos = tiposImportacaoPermitidos(permissoes, 'executar').filter((t) => TIPOS_IMPORTACAO_GERAL.includes(t));
  const [tipo, setTipo] = useState<TipoImportacao | null>(inicial !== undefined && permitidos.includes(inicial) ? inicial : null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<{ texto: string; incerto: boolean } | null>(null);
  const [resultado, setResultado] = useState<ResultadoEnvio | null>(null);
  const [erroModelo, setErroModelo] = useState<string | null>(null);
  // Planilhas operacionais (inventário e seleção) têm limites próprios.
  const limites = useRecurso(`${API_PREFIXO}/importacoes/limites${tipo ? `?tipo=${tipo}` : ''}`, LimitesImportacaoSchema);
  const l = limites.carga?.estado === 'pronto' ? limites.carga.dados : null;

  async function enviar() {
    if (!tipo || !arquivo) return;
    const assinatura = `envio:${tipo}:${arquivo.name}:${String(arquivo.size)}:${String(arquivo.lastModified)}`;
    setEnviando(true);
    setErro(null);
    setResultado(null);
    try {
      const r = await enviarArquivo(`${API_PREFIXO}/importacoes?tipo=${tipo}`, arquivo, arquivo.name, ResultadoEnvioSchema, chaves.para(assinatura));
      chaves.concluir(assinatura);
      if (r.batch && r.openDuplicates.length === 0) {
        aoNavegar({ tipo: 'importacao', id: r.batch.id }, { substituir: true });
        return;
      }
      setResultado(r);
    } catch (e) {
      chaves.concluir(assinatura, e);
      setErro({ texto: mensagemDeFalha(e), incerto: e instanceof FalhaRequisicao && e.tipo === 'rede' });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Pagina
      titulo="Nova importação"
      testId="tela-nova-importacao"
      aoVoltar={() => {
        aoNavegar({ tipo: 'praca' });
      }}
      descricao={<p>1. Escolha o tipo → 2. envie o arquivo → 3. confira planilha e colunas → 4. revise a prévia → 5. confirme → 6. consulte o resultado.</p>}
    >
      <button
        type="button"
        className="botao-link"
        onClick={() => {
          aoNavegar({ tipo: 'importacoes' });
        }}
      >
        Ver histórico de importações
      </button>
      <fieldset className="cartao">
        <legend className="campo-rotulo">1. O que será importado</legend>
        {TIPOS_IMPORTACAO_GERAL.map((t) => (
          <label key={t} className="opcao opcao--bloco">
            <input
              type="radio"
              name={`${ids}-tipo`}
              value={t}
              checked={tipo === t}
              disabled={!permitidos.includes(t)}
              onChange={() => {
                setTipo(t);
                setResultado(null);
                setErro(null);
              }}
              data-testid={`tipo-${t}`}
            />
            <span>
              <strong>{ROTULOS_TIPO[t]}</strong>
              <span className="campo-ajuda">
                Campos: {CAMPOS_IMPORTACAO[t].map((c) => `${c.rotulo}${c.obrigatorio ? '*' : ''}`).join(', ')}. {ALCANCE_TIPO[t]}
              </span>
            </span>
          </label>
        ))}
        <p className="campo-ajuda">* obrigatório. Identificadores (SKU, códigos, lote, NF, referências) são texto: zeros à esquerda contam.</p>
      </fieldset>

      <section className="cartao" aria-labelledby={`${ids}-modelos`}>
        <h3 id={`${ids}-modelos`}>Modelos (dados fictícios)</h3>
        <p className="campo-ajuda">
          No XLSX as colunas de identificadores já estão formatadas como Texto. Importe primeiro os produtos do modelo e depois as devoluções (que exigem os SKUs cadastrados). Os
          modelos de inventário e de seleção mostram a estrutura com dados fictícios; o inventário definitivo é o arquivo que a operação identificar.
        </p>
        <div className="acoes-linha">
          {ARQUIVOS_MODELO.filter((m) => permitidos.includes(tipoDoModelo(m)) && (tipo === null || tipoDoModelo(m) === tipo)).map((m: ArquivoModelo) => (
            <button
              key={m}
              type="button"
              className="botao-secundario botao-compacto"
              onClick={() => {
                setErroModelo(null);
                baixarArquivo(`${API_PREFIXO}/importacoes/modelos/${m}`, `modelo-${m}`).catch((e: unknown) => {
                  setErroModelo(mensagemDeFalha(e));
                });
              }}
            >
              <IconeArquivo />
              {m}
            </button>
          ))}
        </div>
        {erroModelo && (
          <p className="estado-erro" role="alert">
            {erroModelo}
          </p>
        )}
      </section>

      <section className="cartao" aria-labelledby={`${ids}-arquivo`}>
        <h3 id={`${ids}-arquivo`}>2. Arquivo</h3>
        <label className="campo">
          <span className="campo-rotulo">Arquivo CSV ou XLSX</span>
          <input
            ref={arquivoRef}
            type="file"
            accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setArquivo(e.target.files?.[0] ?? null);
              setResultado(null);
              setErro(null);
            }}
            data-testid="arquivo-importacao"
          />
        </label>
        <p className="campo-ajuda">
          {l
            ? `Limites: até ${String(Math.round(l.maxBytes / MB))} MB, ${String(l.maxRows)} linhas de dados e ${String(l.maxColumns)} colunas; XLSX até ${String(Math.round(l.maxUncompressedBytes / MB))} MB descompactado. `
            : ''}
          Macros, fórmulas e vínculos externos não são executados; .xls antigo e .xlsm não são aceitos.
        </p>
        {arquivo && arquivo.size > (l?.maxBytes ?? Number.POSITIVE_INFINITY) && (
          <p className="mensagem-conflito" role="alert">
            O arquivo tem {(arquivo.size / MB).toFixed(1)} MB, acima do limite; o servidor vai recusar. Divida o arquivo.
          </p>
        )}
        <button
          type="button"
          className="botao-primario"
          disabled={!tipo || !arquivo || enviando || !conectado}
          onClick={() => {
            void enviar();
          }}
          data-testid="enviar-arquivo"
        >
          {enviando ? 'Enviando e lendo no servidor…' : 'Enviar e ler o arquivo'}
        </button>
        {!conectado && (
          <p className="mensagem-conflito" role="alert">
            Sem conexão: o arquivo só é lido no servidor.
          </p>
        )}
        {enviando && (
          <p className="estado-carregando" role="status" aria-live="polite">
            O servidor está recebendo e conferindo o arquivo. Nada é gravado nesta etapa além do registro do lote.
          </p>
        )}
        {erro && (
          <div className={erro.incerto ? 'mensagem-conflito' : 'estado-erro'} role="alert" data-testid="erro-envio">
            <p>{erro.texto}</p>
            {erro.incerto && (
              <button type="button" className="botao-secundario" onClick={() => { void enviar(); }}>
                Reenviar com a mesma chave
              </button>
            )}
          </div>
        )}
        {resultado?.alreadyImported && (
          <div className="mensagem-conflito" role="status" data-testid="arquivo-ja-importado">
            <p>
              <strong>Este mesmo arquivo já foi importado</strong> ({ROTULOS_TIPO[resultado.alreadyImported.type]}, lote confirmado em{' '}
              {resultado.alreadyImported.confirmedAt ? formatarDataHora(resultado.alreadyImported.confirmedAt) : '—'}). Nada foi importado de novo.
            </p>
            <button
              type="button"
              className="botao-secundario"
              onClick={() => {
                if (resultado.alreadyImported) aoNavegar({ tipo: 'importacao', id: resultado.alreadyImported.id });
              }}
            >
              Ver o resultado existente
            </button>
          </div>
        )}
        {resultado?.batch && resultado.openDuplicates.length > 0 && (
          <div className="mensagem-conflito" role="status">
            <p>Arquivo recebido. Há outra prévia aberta do mesmo arquivo; só uma poderá ser confirmada.</p>
            <button
              type="button"
              className="botao-primario"
              onClick={() => {
                if (resultado.batch) aoNavegar({ tipo: 'importacao', id: resultado.batch.id }, { substituir: true });
              }}
            >
              Continuar para planilha e colunas
            </button>
          </div>
        )}
      </section>
    </Pagina>
  );
}
