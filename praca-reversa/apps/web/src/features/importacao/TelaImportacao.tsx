import {
  tiposImportacaoPermitidos,
  API_PREFIXO,
  CAMPOS_IMPORTACAO,
  CLASSIFICACOES_LINHA,
  CodificacaoCsvSchema,
  DelimitadorCsvSchema,
  EstruturaArquivoSchema,
  LoteImportacaoSchema,
  PaginaLinhasSchema,
  ROTULOS_ACAO_LINHA,
  ResultadoConfirmacaoSchema,
  verificarMapeamento,
  type ClassificacaoLinha,
  type CodificacaoCsv,
  type DelimitadorCsv,
  type EstruturaArquivo,
  type LinhaImportacao,
  type LoteImportacao,
  type Permissao,
  type SeparadorDecimal,
} from '@praca-reversa/contracts';
import { useId, useState } from 'react';
import { ehConflitoDeVersao, useChaves } from '../../api/chaves';
import { FalhaRequisicao, baixarArquivo, enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeArquivo, IconeAtualizar } from '../../components/Icones';
import { Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';
import { ParametrosTipo } from './ParametrosTipo';
import { faltasParametros, parametrosIniciais, type ParametrosPlanilha } from './parametros';
import { ALCANCE_TIPO, ROTULOS_CELULA, ROTULOS_CLASSIFICACAO, ROTULOS_CODIFICACAO, ROTULOS_DELIMITADOR, ROTULOS_SITUACAO, ROTULOS_TIPO, ROTULOS_VALOR_EXTRA } from './rotulos';

const TAMANHO_LINHAS = 50;
type Aviso = { tipo: 'ok' | 'erro' | 'conflito'; texto: string; incerto?: boolean } | null;

interface Leitura {
  sheet: string | null;
  headerRow: number;
  encoding: CodificacaoCsv | null;
  delimiter: DelimitadorCsv | null;
}

function urlEstrutura(id: string, l: Leitura | null): string {
  const p = new URLSearchParams();
  if (l?.sheet) p.set('sheet', l.sheet);
  if (l && l.headerRow !== 1) p.set('headerRow', String(l.headerRow));
  if (l?.encoding) p.set('encoding', l.encoding);
  if (l?.delimiter) p.set('delimiter', l.delimiter);
  const q = p.toString();
  return `${API_PREFIXO}/importacoes/${id}/estrutura${q ? `?${q}` : ''}`;
}

function MensagemAviso({ aviso, aoReenviar, testId }: { aviso: Aviso; aoReenviar?: () => void; testId: string }) {
  if (aviso === null) return null;
  return (
    <div className={aviso.tipo === 'ok' ? 'mensagem-ok' : aviso.tipo === 'conflito' ? 'mensagem-conflito' : 'estado-erro'} role={aviso.tipo === 'ok' ? 'status' : 'alert'} data-testid={testId}>
      <p>{aviso.texto}</p>
      {aviso.incerto && aoReenviar && (
        <button type="button" className="botao-secundario" onClick={aoReenviar}>
          Reenviar com a mesma chave
        </button>
      )}
    </div>
  );
}

/** Passo 3: planilha, cabeçalho, codificação/delimitador, decimal e colunas. Gera nova prévia no servidor. */
function Mapeamento({ lote, aoGerado }: { lote: LoteImportacao; aoGerado: () => void }) {
  const ids = useId();
  const chaves = useChaves();
  const conectado = useConectado();
  const [leitura, setLeitura] = useState<Leitura | null>(lote.options);
  const [decimal, setDecimal] = useState<SeparadorDecimal>(lote.decimalSeparator ?? 'VIRGULA');
  const [colunas, setColunas] = useState<Record<string, number | null> | null>(lote.columns);
  const [colunasDe, setColunasDe] = useState<string | null>(lote.columns ? urlEstrutura(lote.id, lote.options) : null);
  const [parametros, setParametros] = useState<ParametrosPlanilha | null>(() => parametrosIniciais(lote.type, lote.parameters));
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);
  const url = urlEstrutura(lote.id, leitura);
  const { carga, recarregar } = useRecurso(url, EstruturaArquivoSchema);
  const estrutura: EstruturaArquivo | null = carga?.estado === 'pronto' ? carga.dados : null;
  // Colunas sugeridas para cada nova leitura (outra aba, cabeçalho ou delimitador muda os títulos).
  if (estrutura && colunasDe !== url) {
    setColunasDe(url);
    setColunas(estrutura.suggestedColumns);
  }
  const definicoes = CAMPOS_IMPORTACAO[lote.type];
  const problemas = colunas ? [...verificarMapeamento(lote.type, colunas), ...faltasParametros(lote.type, parametros, colunas)] : [];
  const mudarLeitura = (parcial: Partial<Leitura>) => {
    setLeitura({ ...(estrutura?.options ?? { sheet: null, headerRow: 1, encoding: null, delimiter: null }), ...parcial });
  };

  async function gerar(assinaturaExtra = '') {
    if (!estrutura || !colunas) return;
    const corpo = { expectedVersion: lote.version, options: estrutura.options, decimalSeparator: decimal, columns: colunas, parameters: parametros };
    const assinatura = `mapear:${lote.id}:${JSON.stringify(corpo)}${assinaturaExtra}`;
    setEnviando(true);
    setAviso(null);
    try {
      await enviarJson('PUT', `${API_PREFIXO}/importacoes/${lote.id}/mapeamento`, LoteImportacaoSchema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      aoGerado();
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      if (ehConflitoDeVersao(erro)) {
        setAviso({ tipo: 'conflito', texto: mensagemDeFalha(erro) });
        aoGerado();
      } else {
        setAviso({ tipo: erro instanceof FalhaRequisicao && erro.tipo === 'rede' ? 'conflito' : 'erro', texto: mensagemDeFalha(erro), incerto: erro instanceof FalhaRequisicao && erro.tipo === 'rede' });
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="cartao" aria-labelledby={`${ids}-titulo`} data-testid="secao-mapeamento">
      <h3 id={`${ids}-titulo`}>3. Planilha e colunas</h3>
      {carga?.estado === 'erro' && (
        <div className="estado-erro" role="alert">
          <p>Não foi possível ler o arquivo com estas opções. {carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {carga?.estado === 'carregando' && <p className="estado-carregando">Lendo o arquivo no servidor…</p>}
      {estrutura && colunas && (
        <>
          <div className="formulario-grade formulario-grade--compacta">
            {estrutura.format === 'XLSX' ? (
              <label className="campo">
                <span className="campo-rotulo">Planilha (aba)</span>
                <select value={estrutura.options.sheet ?? ''} onChange={(e) => { mudarLeitura({ sheet: e.target.value }); }} data-testid="escolher-planilha">
                  {estrutura.sheets.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                      {s.hidden ? ' (oculta)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label className="campo">
                  <span className="campo-rotulo">Codificação</span>
                  <select value={estrutura.options.encoding ?? 'UTF-8'} onChange={(e) => { mudarLeitura({ encoding: CodificacaoCsvSchema.parse(e.target.value) }); }} data-testid="escolher-codificacao">
                    {CodificacaoCsvSchema.options.map((c) => (
                      <option key={c} value={c}>
                        {ROTULOS_CODIFICACAO[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="campo">
                  <span className="campo-rotulo">Delimitador</span>
                  <select value={estrutura.options.delimiter ?? 'PONTO_E_VIRGULA'} onChange={(e) => { mudarLeitura({ delimiter: DelimitadorCsvSchema.parse(e.target.value) }); }}>
                    {DelimitadorCsvSchema.options.map((d) => (
                      <option key={d} value={d}>
                        {ROTULOS_DELIMITADOR[d]}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label className="campo">
              <span className="campo-rotulo">Linha do cabeçalho</span>
              <input type="number" min={1} max={50} value={estrutura.options.headerRow} onChange={(e) => { mudarLeitura({ headerRow: Math.min(50, Math.max(1, Number(e.target.value) || 1)) }); }} />
            </label>
            <fieldset className="campo">
              <legend className="campo-rotulo">Separador decimal em textos</legend>
              <label className="opcao">
                <input type="radio" name={`${ids}-decimal`} checked={decimal === 'VIRGULA'} onChange={() => { setDecimal('VIRGULA'); }} />
                Vírgula (1,5)
              </label>
              <label className="opcao">
                <input type="radio" name={`${ids}-decimal`} checked={decimal === 'PONTO'} onChange={() => { setDecimal('PONTO'); }} data-testid="decimal-ponto" />
                Ponto (1.5)
              </label>
            </fieldset>
          </div>
          <ul className="interpretacao" data-testid="interpretacao">
            {estrutura.interpretation.map((t) => (
              <li key={t}>{t}</li>
            ))}
            <li>Quantidades: separador decimal {decimal === 'VIRGULA' ? 'vírgula' : 'ponto'}; sem separador de milhar; até 3 casas, sem arredondar.</li>
          </ul>
          {estrutura.warnings.map((w) => (
            <p key={w} className="mensagem-conflito" role="note">
              {w}
            </p>
          ))}
          <div className="mapa-colunas">
            {definicoes.map((d) => (
              <label key={d.campo} className="campo">
                <span className="campo-rotulo">
                  {d.rotulo}
                  {d.obrigatorio ? ' *' : ' (opcional)'}
                </span>
                <select
                  value={colunas[d.campo] === null || colunas[d.campo] === undefined ? '' : String(colunas[d.campo])}
                  onChange={(e) => {
                    setColunas({ ...colunas, [d.campo]: e.target.value === '' ? null : Number(e.target.value) });
                  }}
                  data-testid={`coluna-${d.campo}`}
                >
                  <option value="">{d.obrigatorio ? 'Escolha a coluna…' : 'Não usar'}</option>
                  {estrutura.headers.map((h) => (
                    <option key={h.index} value={h.index}>
                      {h.letter} — {h.text || '(sem título)'}
                    </option>
                  ))}
                </select>
                <span className="campo-ajuda">{d.ajuda}</span>
              </label>
            ))}
          </div>
          <ParametrosTipo tipo={lote.type} valor={parametros} aoMudar={setParametros} estrutura={estrutura} colunas={colunas} />
          <div className="amostra" role="region" aria-label="Amostra das primeiras linhas" tabIndex={0}>
            <table>
              <caption>
                Amostra ({estrutura.sample.length} de {estrutura.dataRows} linha(s) de dados{estrutura.emptyRows > 0 ? `; ${String(estrutura.emptyRows)} vazia(s) ignorada(s)` : ''})
              </caption>
              <thead>
                <tr>
                  <th scope="col">Linha</th>
                  {estrutura.headers.map((h) => (
                    <th key={h.index} scope="col">
                      {h.letter}: {h.text || '—'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {estrutura.sample.map((s) => (
                  <tr key={s.row}>
                    <th scope="row">{s.row}</th>
                    {s.cells.map((c, i) => (
                      <td key={i} className={`celula-amostra celula-amostra--${c.kind}`}>
                        {c.text ?? ''}
                        {c.kind !== 'TEXTO' && c.kind !== 'VAZIO' && <span className="tipo-celula"> ({ROTULOS_CELULA[c.kind]})</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {problemas.length > 0 && (
            <ul className="mensagem-conflito" role="alert">
              {problemas.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <MensagemAviso aviso={aviso} aoReenviar={() => { void gerar(); }} testId="aviso-mapeamento" />
          <button type="button" className="botao-primario" disabled={problemas.length > 0 || enviando || !conectado} onClick={() => { void gerar(); }} data-testid="gerar-previa">
            {enviando ? 'Lendo e validando todas as linhas no servidor…' : lote.previewVersion > 0 ? 'Gerar nova prévia (a atual deixa de valer)' : 'Gerar prévia'}
          </button>
        </>
      )}
    </section>
  );
}

function valorCampo(l: LinhaImportacao, campo: string): { valor: string | null; lido: string | null } {
  const valor = l.values[campo] ?? null;
  const lido = l.read[campo] ?? null;
  return { valor, lido };
}

function LinhaPrevia({ linha, lote }: { linha: LinhaImportacao; lote: LoteImportacao }) {
  const rotulo = ROTULOS_CLASSIFICACAO[linha.classification];
  const v = linha.values;
  const conversao =
    lote.type === 'DEVOLUCOES' && v.canonicalQuantity && v.unit !== v.canonicalUnit
      ? `${formatarQuantidade(v.quantity ?? '0')} ${v.unit ?? ''} × ${formatarQuantidade(v.factor ?? '1')} = ${formatarQuantidade(v.canonicalQuantity)} ${v.canonicalUnit ?? ''}`
      : null;
  return (
    <li className={`linha-importacao linha-importacao--${linha.classification}`} data-testid="linha-importacao" data-linha={linha.row} data-classificacao={linha.classification}>
      <div className="linha-importacao-topo">
        <span className="linha-numero">Linha {linha.row}</span>
        <span className={`selo-classificacao selo-classificacao--${linha.classification}`}>
          <span aria-hidden="true">{rotulo.marcador}</span> {rotulo.texto}
        </span>
        {linha.action && (
          <span className={`selo-acao selo-acao--${linha.action}`} data-testid="acao-linha">
            {ROTULOS_ACAO_LINHA[linha.action] ?? linha.action}
          </span>
        )}
        {linha.result && <span className="linha-resultado">{linha.result === 'GRAVADA' ? 'Gravada' : 'Ignorada (duplicada)'}</span>}
        {linha.key && <span className="linha-chave">{linha.key}</span>}
      </div>
      <dl className="linha-importacao-dados">
        {CAMPOS_IMPORTACAO[lote.type].map((d) => {
          const { valor, lido } = valorCampo(linha, d.campo);
          const exibido = valor ?? lido;
          if (exibido === null) return null;
          return (
            <div key={d.campo}>
              <dt>{d.rotulo}</dt>
              <dd>
                {exibido}
                {valor !== null && lido !== null && lido !== valor && <span className="linha-lido"> (lido: {lido})</span>}
              </dd>
            </div>
          );
        })}
        {Object.entries(ROTULOS_VALOR_EXTRA).map(([campo, rotulo]) => {
          const valor = v[campo] ?? null;
          if (valor === null) return null;
          return (
            <div key={campo}>
              <dt>{rotulo}</dt>
              <dd>{valor}</dd>
            </div>
          );
        })}
        {conversao && (
          <div>
            <dt>Conversão</dt>
            <dd>{conversao}</dd>
          </div>
        )}
      </dl>
      {linha.reasons.length > 0 && (
        <ul className="linha-motivos">
          {linha.reasons.map((m, i) => (
            <li key={i} data-codigo={m.code}>
              {m.message}
            </li>
          ))}
        </ul>
      )}
      {linha.notices.length > 0 && (
        <ul className="linha-avisos">
          {linha.notices.map((m, i) => (
            <li key={i} data-codigo={m.code}>
              Aviso: {m.message}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Passos 4 a 6: prévia classificada, confirmação revalidada no servidor e resultado do lote. */
export function TelaImportacao({ id, permissoes, aoNavegar, aoGravar }: { id: string; permissoes: readonly Permissao[]; aoNavegar: Navegar; aoGravar: () => void }) {
  const ids = useId();
  const chaves = useChaves();
  const conectado = useConectado();
  const [versao, setVersao] = useState(0);
  const [filtro, setFiltro] = useState<ClassificacaoLinha | null>(null);
  const [pagina, setPagina] = useState(1);
  const [editarColunas, setEditarColunas] = useState(false);
  const [revisado, setRevisado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [descartando, setDescartando] = useState(false);
  const [erroDownload, setErroDownload] = useState<string | null>(null);
  /** Inventário conferido: linhas aplicáveis que quem confirma deixa de fora agora (ficam registradas como não aplicadas). */
  const [foraTexto, setForaTexto] = useState('');
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/importacoes/${id}`, LoteImportacaoSchema, versao);
  const lote = carga?.estado === 'pronto' ? carga.dados : null;
  const comPrevia = lote !== null && lote.state !== 'AGUARDANDO_MAPEAMENTO';
  const parametros = new URLSearchParams({ pagina: String(pagina), tamanho: String(TAMANHO_LINHAS) });
  if (filtro) parametros.set('classificacao', filtro);
  const linhas = useRecurso(comPrevia ? `${API_PREFIXO}/importacoes/${id}/linhas?${parametros.toString()}` : null, PaginaLinhasSchema, versao);
  const paginaLinhas = linhas.carga?.estado === 'pronto' ? linhas.carga.dados : null;
  // Conjunto aplicável do inventário (vincular, criar cadastro, atualizar): contagem explícita na confirmação.
  const inventarioEmPrevia = lote !== null && lote.type === 'INVENTARIO' && lote.state === 'PREVIA';
  const aplicaveis = useRecurso(inventarioEmPrevia ? `${API_PREFIXO}/importacoes/${id}/linhas?aplicaveis=true&tamanho=200` : null, PaginaLinhasSchema, versao);
  const paginaAplicaveis = aplicaveis.carga?.estado === 'pronto' ? aplicaveis.carga.dados : null;
  const fora = [...new Set(foraTexto.split(/[\s,;]+/).filter(Boolean).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
  const foraInvalidas = paginaAplicaveis && paginaAplicaveis.total <= paginaAplicaveis.items.length ? fora.filter((n) => !paginaAplicaveis.items.some((l) => l.row === n)) : [];
  const totalAplicaveis = paginaAplicaveis?.total ?? null;
  const aAplicar = totalAplicaveis === null ? null : totalAplicaveis - fora.length;
  const atualizar = () => {
    setVersao((v) => v + 1);
  };
  // Permissões do tipo deste lote (lista de claims: analista; produtos e devoluções: supervisor).
  const podeExecutar = lote !== null && tiposImportacaoPermitidos(permissoes, 'executar').includes(lote.type);
  // Bipagem: prévia, decisões e confirmação ficam na página do palete (destino sempre visível).
  const bipagem = lote?.type === 'BIPAGEM';
  const editavel = lote !== null && (lote.state === 'AGUARDANDO_MAPEAMENTO' || lote.state === 'PREVIA') && podeExecutar && !bipagem;

  async function confirmar() {
    if (!lote) return;
    const corpo =
      lote.type === 'INVENTARIO'
        ? { previewVersion: lote.previewVersion, reviewed: true as const, expectedApplicable: aAplicar ?? 0, excludedRows: fora }
        : { previewVersion: lote.previewVersion, reviewed: true as const };
    const assinatura = `confirmar:${lote.id}:${String(lote.previewVersion)}:${fora.join(',')}`;
    setEnviando(true);
    setAviso(null);
    try {
      const r = await enviarJson('POST', `${API_PREFIXO}/importacoes/${lote.id}/confirmar`, ResultadoConfirmacaoSchema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      setAviso({
        tipo: 'ok',
        texto: r.alreadyConfirmed
          ? 'Este lote já estava confirmado: o resultado existente foi mantido, nada foi importado de novo.'
          : `Importação confirmada pelo servidor: ${String(r.batch.counters.written)} linha(s) gravada(s), ${String(r.batch.counters.ignored)} duplicada(s) ignorada(s).`,
      });
      aoGravar();
      atualizar();
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      const incerto = erro instanceof FalhaRequisicao && erro.tipo === 'rede';
      const codigo = erro instanceof FalhaRequisicao ? erro.codigo : null;
      if (incerto) {
        setAviso({ tipo: 'conflito', texto: 'Sem resposta do servidor: não se sabe se a importação foi gravada. Reenvie com a mesma chave (não duplica).', incerto: true });
      } else if (codigo === 'PREVIA_DESATUALIZADA' || codigo === 'IMPORTACAO_BLOQUEADA') {
        setAviso({ tipo: 'conflito', texto: `${mensagemDeFalha(erro)} A prévia foi recarregada: revise antes de confirmar.` });
        setRevisado(false);
        atualizar();
      } else if (erro instanceof FalhaRequisicao && erro.status !== null && erro.status >= 500) {
        setAviso({ tipo: 'erro', texto: 'A gravação falhou e foi desfeita: nada deste lote foi importado. O histórico registra a falha; tente de novo.' });
        atualizar();
      } else {
        setAviso({ tipo: 'erro', texto: mensagemDeFalha(erro) });
        atualizar();
      }
    } finally {
      setEnviando(false);
    }
  }

  async function descartar() {
    if (!lote) return;
    const assinatura = `descartar:${lote.id}:${String(lote.version)}`;
    setEnviando(true);
    try {
      await enviarJson('POST', `${API_PREFIXO}/importacoes/${lote.id}/descartar`, LoteImportacaoSchema, { corpo: { expectedVersion: lote.version }, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      setAviso({ tipo: 'ok', texto: 'Lote descartado: nada foi gravado.' });
      setDescartando(false);
      atualizar();
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      setAviso({ tipo: ehConflitoDeVersao(erro) ? 'conflito' : 'erro', texto: mensagemDeFalha(erro) });
      atualizar();
    } finally {
      setEnviando(false);
    }
  }

  const baixarRelatorio = () => {
    setErroDownload(null);
    baixarArquivo(`${API_PREFIXO}/importacoes/${id}/relatorio.csv`, 'relatorio-importacao.csv').catch((e: unknown) => {
      setErroDownload(mensagemDeFalha(e));
    });
  };

  return (
    <Pagina
      titulo="Lote de importação"
      testId="tela-importacao"
      aoVoltar={() => {
        aoNavegar({ tipo: 'praca' });
      }}
    >
      <button
        type="button"
        className="botao-link"
        onClick={() => {
          aoNavegar({ tipo: 'importacoes' });
        }}
      >
        Histórico de importações
      </button>
      {carga?.estado === 'erro' && lote === null && (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar o lote. {carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {lote === null && carga?.estado !== 'erro' && <p className="estado-carregando">Carregando lote…</p>}
      {lote && (
        <>
          <section className="cartao" aria-labelledby={`${ids}-lote`} data-testid="resumo-lote" data-situacao={lote.state}>
            <h3 id={`${ids}-lote`}>
              {ROTULOS_TIPO[lote.type]} · <span className={`selo-situacao-lote selo-situacao-lote--${lote.state}`}>{ROTULOS_SITUACAO[lote.state]}</span>
            </h3>
            <dl className="situacao">
              <div>
                <dt>Arquivo</dt>
                <dd>
                  {lote.fileName} ({lote.format}, {(lote.fileSize / 1024).toFixed(1)} KB)
                </dd>
              </div>
              <div>
                <dt>SHA-256</dt>
                <dd className="texto-tecnico">{lote.fileHash.slice(0, 16)}…</dd>
              </div>
              <div>
                <dt>Enviado</dt>
                <dd>
                  {formatarDataHora(lote.createdAt)}
                  {lote.createdBy ? ` por ${lote.createdBy.name}` : ''}
                </dd>
              </div>
              {lote.previewVersion > 0 && (
                <div>
                  <dt>Prévia</dt>
                  <dd data-testid="versao-previa">
                    versão {lote.previewVersion}
                    {lote.previewGeneratedAt ? `, ${formatarDataHora(lote.previewGeneratedAt)}` : ''}
                  </dd>
                </div>
              )}
              {lote.confirmedAt && (
                <div>
                  <dt>Confirmado</dt>
                  <dd>
                    {formatarDataHora(lote.confirmedAt)}
                    {lote.confirmedBy ? ` por ${lote.confirmedBy.name}` : ''}
                  </dd>
                </div>
              )}
            </dl>
            {lote.lastFailure && (
              <p className="estado-erro" role="alert" data-testid="ultima-falha">
                {formatarDataHora(lote.lastFailure.at)}: {lote.lastFailure.message}
              </p>
            )}
          </section>

          {bipagem && lote.palletId !== null && (
            <div className="acoes-linha">
              {(lote.state === 'AGUARDANDO_MAPEAMENTO' || lote.state === 'PREVIA') && podeExecutar && (
                <button
                  type="button"
                  className="botao-primario"
                  onClick={() => {
                    if (lote.palletId !== null) aoNavegar({ tipo: 'bipagem', id: lote.palletId });
                  }}
                  data-testid="continuar-bipagem"
                >
                  Continuar a importação no palete
                </button>
              )}
              <button
                type="button"
                className="botao-secundario"
                onClick={() => {
                  if (lote.palletId !== null) aoNavegar({ tipo: 'palete', id: lote.palletId });
                }}
              >
                Abrir o palete de destino
              </button>
            </div>
          )}
          {editavel && (lote.state === 'AGUARDANDO_MAPEAMENTO' || editarColunas) && (
            <Mapeamento
              key={`${lote.id}:${String(lote.version)}`}
              lote={lote}
              aoGerado={() => {
                setEditarColunas(false);
                setRevisado(false);
                setPagina(1);
                setFiltro(null);
                atualizar();
              }}
            />
          )}
          {editavel && lote.state === 'PREVIA' && !editarColunas && (
            <button type="button" className="botao-link" onClick={() => { setEditarColunas(true); }} data-testid="alterar-colunas">
              Alterar planilha, decimal ou colunas (gera nova prévia)
            </button>
          )}

          {comPrevia && (
            <section className="cartao" aria-labelledby={`${ids}-previa`} data-testid="secao-previa">
              <h3 id={`${ids}-previa`}>{lote.state === 'CONFIRMADO' ? '6. Resultado do lote' : '4. Prévia'}</h3>
              <p className="contadores-lote" data-testid="contadores-lote">
                {lote.state === 'CONFIRMADO' ? (
                  <>
                    <strong>{lote.counters.written}</strong> gravada(s) · <strong>{lote.counters.ignored}</strong> duplicada(s) ignorada(s) · {lote.counters.total} linha(s) de dados
                  </>
                ) : lote.type === 'INVENTARIO' ? (
                  <>
                    Válidas (aplicar ou referência histórica): <strong>{lote.counters.validNew}</strong> · já importadas/repetidas: <strong>{lote.counters.duplicate}</strong> · requerem
                    resolução (ficam registradas sem aplicar): <strong>{lote.counters.invalid + lote.counters.conflicting}</strong>
                  </>
                ) : (
                  <>
                    Serão gravadas: <strong>{lote.counters.validNew}</strong> · ignoradas por duplicidade: <strong>{lote.counters.duplicate}</strong> · precisam de correção:{' '}
                    <strong>{lote.counters.invalid + lote.counters.conflicting}</strong> ({lote.counters.invalid} inválida(s), {lote.counters.conflicting} conflitante(s))
                  </>
                )}
                {lote.counters.excluded > 0 && ` · ${String(lote.counters.excluded)} fora da seleção (marcação)`}
                {lote.counters.empty > 0 && ` · ${String(lote.counters.empty)} linha(s) vazia(s) ignorada(s)`}
              </p>
              {lote.previewSummary.length > 0 && (
                <ul className="resumo-previa" data-testid="resumo-previa">
                  {lote.previewSummary.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
              {lote.result && (
                <p data-testid="resultado-gravacao">
                  {lote.type === 'BIPAGEM'
                    ? lote.result.documentLinksCreated > 0
                      ? `${String(lote.result.documentsWritten)} nota(s) adicionada(s) ao palete (${String(lote.result.documentLinksCreated)} vínculo(s) NF × palete${lote.result.documentLinksEnded > 0 ? `; ${String(lote.result.documentLinksEnded)} registro(s) anterior(es) substituído(s), com histórico` : ''}). Nada mudou no saldo por produto nem na conferência física.`
                      : `${String(lote.result.contentsCreated)} conteúdo(s) novo(s) e ${String(lote.result.countsRegistered)} contagem(ns) registrada(s) no palete (${String(lote.result.volumesRead)} volume(s) lido(s); ${String(lote.result.recordsWithoutReads)} registro(s) sem leitura só no lote). Nada mudou no saldo por produto.`
                    : lote.type === 'PRODUTOS'
                    ? `${String(lote.result.productsCreated)} produto(s) criado(s) e ${String(lote.result.barcodesAdded)} código(s) de barras acrescentado(s).`
                    : lote.type === 'INVENTARIO'
                      ? `Inventário registrado: ${String(lote.result.inventoryLines)} linha(s) na fotografia, ${String(lote.result.inventoryLinesApplied)} aplicada(s) (${String(lote.result.documentLinksCreated)} vínculo(s) NF × palete, ${String(lote.result.palletsCreated)} palete(s) cadastrado(s), ${String(lote.result.palletsLocated)} localização(ões) registrada(s)) e ${String(lote.result.inventoryLinesPending)} não aplicada(s). Saldo validado por produto não mudou.`
                      : lote.type === 'SELECAO_CLIENTE'
                        ? `Seleção registrada com ${String(lote.result.selectionLines)} solicitação(ões). Nada foi reservado nem alterado no estoque.`
                        : lote.type === 'CLAIMS'
                      ? `${String(lote.result.claimsCreated)} caso(s) novo(s) e ${String(lote.result.claimLinesCreated)} linha(s) de claim. Só investigação: nada mudou no estoque nem no cliente.`
                      : `${String(lote.result.documentsCreated)} documento(s) novo(s) e ${String(lote.result.documentLinesCreated)} linha(s) documental(is). Nenhum saldo físico foi criado.`}
                </p>
              )}
              {lote.blockReason && lote.state === 'PREVIA' && (
                <p className="mensagem-conflito" role="alert" data-testid="bloqueio-confirmacao">
                  <strong>Confirmação bloqueada.</strong> {lote.blockReason}
                </p>
              )}
              <div className="abas-classificacao" role="group" aria-label="Filtrar linhas">
                <button type="button" aria-pressed={filtro === null} onClick={() => { setFiltro(null); setPagina(1); }}>
                  Todas ({lote.counters.total})
                </button>
                {CLASSIFICACOES_LINHA.map((c) => {
                  const n = { VALIDA_NOVA: lote.counters.validNew, DUPLICADA: lote.counters.duplicate, INVALIDA: lote.counters.invalid, CONFLITANTE: lote.counters.conflicting, EXCLUIDA: lote.counters.excluded }[c];
                  if (c === 'EXCLUIDA' && n === 0) return null;
                  return (
                    <button key={c} type="button" aria-pressed={filtro === c} disabled={n === 0} onClick={() => { setFiltro(c); setPagina(1); }} data-testid={`filtro-${c}`}>
                      {ROTULOS_CLASSIFICACAO[c].texto} ({n})
                    </button>
                  );
                })}
              </div>
              {linhas.carga?.estado === 'erro' && (
                <div className="estado-erro" role="alert">
                  <p>Não foi possível carregar as linhas. {linhas.carga.mensagem}</p>
                  <button type="button" className="botao-secundario" onClick={linhas.recarregar}>
                    Tentar novamente
                  </button>
                </div>
              )}
              {paginaLinhas && paginaLinhas.previewVersion !== lote.previewVersion && <p className="estado-carregando">Atualizando para a prévia atual…</p>}
              {paginaLinhas && (
                <>
                  <ol className="linhas-importacao" aria-busy={linhas.carga?.estado === 'carregando'}>
                    {paginaLinhas.items.map((l) => (
                      <LinhaPrevia key={l.row} linha={l} lote={lote} />
                    ))}
                  </ol>
                  {paginaLinhas.total > TAMANHO_LINHAS && (
                    <nav className="paginacao" aria-label="Páginas das linhas">
                      <button type="button" className="botao-secundario botao-compacto" disabled={pagina <= 1} onClick={() => { setPagina((p) => p - 1); }}>
                        Anterior
                      </button>
                      <span>
                        Página {pagina} de {Math.ceil(paginaLinhas.total / TAMANHO_LINHAS)}
                      </span>
                      <button type="button" className="botao-secundario botao-compacto" disabled={pagina * TAMANHO_LINHAS >= paginaLinhas.total} onClick={() => { setPagina((p) => p + 1); }}>
                        Próxima
                      </button>
                    </nav>
                  )}
                </>
              )}
              {lote.counters.invalid + lote.counters.conflicting + lote.counters.duplicate > 0 && tiposImportacaoPermitidos(permissoes, 'consultar').includes(lote.type) && (
                <div>
                  <button type="button" className="botao-secundario botao-compacto" onClick={baixarRelatorio} data-testid="baixar-relatorio">
                    <IconeArquivo />
                    Relatório de erros e duplicidades (CSV)
                  </button>
                  {erroDownload && (
                    <p className="estado-erro" role="alert">
                      {erroDownload}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          {lote.state === 'PREVIA' && podeExecutar && !bipagem && (
            <section className="cartao" aria-labelledby={`${ids}-confirmar`} data-testid="secao-confirmar">
              <h3 id={`${ids}-confirmar`}>5. Confirmação</h3>
              <p>{ALCANCE_TIPO[lote.type]}</p>
              <p className="campo-ajuda">
                Ao confirmar, o servidor relê o arquivo guardado com este mapeamento e revalida tudo contra os dados atuais. Se algo mudou desde a revisão, nada é gravado e
                uma nova prévia é gerada para revisão.
              </p>
              {lote.type === 'INVENTARIO' && (
                <div className="conjunto-inventario" data-testid="conjunto-inventario">
                  <p>
                    Linhas aplicáveis (vincular, criar cadastro, atualizar): <strong data-testid="total-aplicaveis">{totalAplicaveis ?? '…'}</strong>. As que requerem resolução, já
                    importadas, repetidas e de endereço livre ficam registradas na fotografia sem aplicar.
                  </p>
                  <label className="campo">
                    <span className="campo-rotulo">Deixar de fora agora (números das linhas, separados por vírgula)</span>
                    <input
                      value={foraTexto}
                      onChange={(e) => {
                        setForaTexto(e.target.value);
                        setRevisado(false);
                      }}
                      inputMode="numeric"
                      placeholder="ex.: 14, 27"
                      data-testid="linhas-fora"
                    />
                    <span className="campo-ajuda">Ficam registradas como não aplicadas e podem ser reapresentadas depois (importação com “Reapresentar pendências corrigidas”).</span>
                  </label>
                  {foraInvalidas.length > 0 && (
                    <p className="mensagem-conflito" role="alert">
                      Linha(s) {foraInvalidas.join(', ')} não são aplicáveis nesta prévia.
                    </p>
                  )}
                </div>
              )}
              <label className="opcao">
                <input type="checkbox" checked={revisado} onChange={(e) => { setRevisado(e.target.checked); }} data-testid="confirmar-revisao" />
                {lote.type === 'INVENTARIO'
                  ? `Revisei a prévia versão ${String(lote.previewVersion)}: aplicar ${aAplicar === null ? '…' : String(aAplicar)} linha(s)${fora.length > 0 ? ` (${String(fora.length)} deixada(s) de fora)` : ''}; o restante fica registrado como não aplicado.`
                  : `Revisei a prévia versão ${String(lote.previewVersion)}: gravar ${String(lote.counters.validNew)} linha(s) e ignorar ${String(lote.counters.duplicate)} duplicada(s).`}
              </label>
              <MensagemAviso aviso={aviso} aoReenviar={() => { void confirmar(); }} testId="aviso-confirmacao" />
              <div className="acoes-linha">
                <button
                  type="button"
                  className="botao-primario"
                  disabled={!lote.canConfirm || !revisado || enviando || !conectado || (lote.type === 'INVENTARIO' && (aAplicar === null || foraInvalidas.length > 0))}
                  onClick={() => { void confirmar(); }}
                  data-testid="confirmar-importacao"
                >
                  {enviando ? 'Gravando no servidor…' : 'Confirmar importação'}
                </button>
                {!descartando ? (
                  <button type="button" className="botao-link" onClick={() => { setDescartando(true); }}>
                    Descartar lote…
                  </button>
                ) : (
                  <>
                    <button type="button" className="botao-perigo" disabled={enviando} onClick={() => { void descartar(); }}>
                      Confirmar descarte (nada será gravado)
                    </button>
                    <button type="button" className="botao-link" onClick={() => { setDescartando(false); }}>
                      Manter
                    </button>
                  </>
                )}
              </div>
              {!conectado && (
                <p className="mensagem-conflito" role="alert">
                  Sem conexão: a confirmação só acontece com resposta do servidor.
                </p>
              )}
            </section>
          )}
          {lote.state !== 'PREVIA' && <MensagemAviso aviso={aviso} testId="aviso-confirmacao" />}
          {lote.state === 'DESCARTADO' && <p className="mensagem-conflito">Lote descartado em {lote.discardedAt ? formatarDataHora(lote.discardedAt) : '—'}: nada foi gravado.</p>}
          {lote.state === 'CONFIRMADO' && lote.type === 'DEVOLUCOES' && (
            <p className="campo-ajuda">Os documentos aparecem na busca (Buscar conteúdo) pela referência, NF, SKU ou lote, como declaração documental sem palete.</p>
          )}
          {lote.state === 'CONFIRMADO' && lote.type === 'INVENTARIO' && lote.result?.inventoryId && (
            <button
              type="button"
              className="botao-secundario"
              onClick={() => {
                if (lote.result?.inventoryId) aoNavegar({ tipo: 'inventario', id: lote.result.inventoryId });
              }}
              data-testid="ver-inventario"
            >
              Abrir o inventário de referência
            </button>
          )}
          {lote.state === 'CONFIRMADO' && lote.type === 'SELECAO_CLIENTE' && lote.result?.selectionId && (
            <button
              type="button"
              className="botao-primario"
              onClick={() => {
                if (lote.result?.selectionId) aoNavegar({ tipo: 'selecao', id: lote.result.selectionId, situacao: null });
              }}
              data-testid="ver-selecao"
            >
              Ver a conciliação da seleção
            </button>
          )}
          {lote.state === 'CONFIRMADO' && lote.type === 'CLAIMS' && (
            <button
              type="button"
              className="botao-secundario"
              onClick={() => {
                aoNavegar({ tipo: 'claims' });
              }}
              data-testid="ver-claims"
            >
              Ver claims
            </button>
          )}
        </>
      )}
    </Pagina>
  );
}
