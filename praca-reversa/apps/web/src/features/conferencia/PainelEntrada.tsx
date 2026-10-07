import {
  API_PREFIXO,
  CONDICOES_MATERIAL,
  IdentificacaoCodigoSchema,
  TIPOS_ORIGEM_DOCUMENTO,
  UNIDADE_PECA,
  interpretarLeitura,
  multiplicarExato,
  type CondicaoMaterial,
  type IdentificacaoCodigo,
  type ModoEntrada,
  type NovaObservacao,
  type TipoOrigemDocumento,
} from '@praca-reversa/contracts';
import { useId, useRef, useState } from 'react';
import { FalhaRequisicao, mensagemDeFalha, obterJson } from '../../api/cliente';
import { useContextoLeitura } from '../camera/contexto';
import { FORMATOS_PRODUTO } from '../camera/deteccao';
import { LeitorCamera } from '../camera/LeitorCamera';
import { ROTULOS_CONDICAO } from '../paletes/estados';
import { ROTULOS_ORIGEM_DOCUMENTO } from '../paletes/conteudo';
import { formatarQuantidade } from '../../utils/numeros';
import { ROTULOS_MODO, textoOrigem } from './rotulos';

export type ResultadoEnvio = { ok: true } | { ok: false; codigo: string | null; mensagem: string; rede: boolean; incerta?: boolean };

export interface OrigemDeclarada {
  tipo: TipoOrigemDocumento;
  referencia: string | null;
}

interface Props {
  /** Pode registrar agora (sessão em andamento, permissão, conexão). */
  habilitado: boolean;
  motivoBloqueio: string | null;
  origens: readonly OrigemDeclarada[];
  aoRegistrar: (corpo: NovaObservacao, resumo: string) => Promise<ResultadoEnvio>;
}

type Estado =
  | { tipo: 'vazio' }
  | { tipo: 'identificando'; codigo: string }
  | { tipo: 'identificado'; codigo: string; ident: IdentificacaoCodigo }
  | { tipo: 'nao-cadastrado'; codigo: string }
  /** Lido sem acesso à API: nada identificado, nada registrado (etapa 09). */
  | { tipo: 'pendente-consulta'; codigo: string; motivo: string }
  | { tipo: 'erro'; mensagem: string };

interface Confirmado {
  codigo: string;
  contexto: string;
  sku: string;
  descricao: string;
  unidade: string;
  leituras: number;
}

type Retorno = { tipo: 'ok' | 'erro'; texto: string } | null;

const SEM_ORIGEM = '';
const OUTRA_ORIGEM = '__outra__';

const MODOS: readonly ModoEntrada[] = ['LEITURA_UNIDADE', 'LEITURA_EMBALAGEM', 'MANUAL'];

function decimal(texto: string): string {
  return texto.trim().replace(',', '.');
}

/**
 * Entrada de observações. O modo fica sempre visível; o produto e a unidade
 * são confirmados antes da primeira soma; depois, nas leituras, cada leitura
 * do mesmo código soma uma peça/embalagem (não há deduplicação pelo código).
 * O campo do código mantém o foco para o leitor que digita como teclado.
 */
export function PainelEntrada({ habilitado, motivoBloqueio, origens, aoRegistrar }: Props) {
  const ids = useId();
  const codigoRef = useRef<HTMLInputElement>(null);
  const confirmarRef = useRef<HTMLButtonElement>(null);
  const quantidadeRef = useRef<HTMLInputElement>(null);
  const [modo, setModo] = useState<ModoEntrada | null>(null);
  const [condicao, setCondicao] = useState<CondicaoMaterial | ''>('');
  const [lote, setLote] = useState('');
  const [origem, setOrigem] = useState(SEM_ORIGEM);
  const [outraTipo, setOutraTipo] = useState<TipoOrigemDocumento>('DEVOLUCAO');
  const [outraReferencia, setOutraReferencia] = useState('');
  const [codigo, setCodigo] = useState('');
  const [estado, setEstado] = useState<Estado>({ tipo: 'vazio' });
  const [confirmado, setConfirmado] = useState<Confirmado | null>(null);
  const [quantidade, setQuantidade] = useState('');
  const [embalagem, setEmbalagem] = useState('');
  const [comoPendencia, setComoPendencia] = useState(false);
  const [unidadePendencia, setUnidadePendencia] = useState('UN');
  const [descricaoPendencia, setDescricaoPendencia] = useState('');
  const [nota, setNota] = useState('');
  const [evidencia, setEvidencia] = useState('');
  const [retorno, setRetorno] = useState<Retorno>(null);
  const [enviando, setEnviando] = useState(false);
  const [cameraAberta, setCameraAberta] = useState(false);
  const contextoLeitura = useContextoLeitura();

  const origemEscolhida: { tipo: TipoOrigemDocumento | null; referencia: string | null } =
    origem === SEM_ORIGEM
      ? { tipo: null, referencia: null }
      : origem === OUTRA_ORIGEM
        ? { tipo: outraTipo, referencia: outraReferencia.trim() || null }
        : (() => {
            const [tipo, ...resto] = origem.split('|');
            const referencia = resto.join('|');
            return { tipo: (tipo ?? 'OUTRO') as TipoOrigemDocumento, referencia: referencia === '' ? null : referencia };
          })();
  const loteEscolhido = lote.trim() || null;
  const contexto = JSON.stringify([modo, condicao, loteEscolhido, origemEscolhida.tipo, origemEscolhida.referencia]);
  const pronto = habilitado && modo !== null && condicao !== '';

  function focarCodigo() {
    requestAnimationFrame(() => codigoRef.current?.focus());
  }

  function limparLeitura() {
    setCodigo('');
    setEstado({ tipo: 'vazio' });
    setQuantidade('');
    setEmbalagem('');
    setComoPendencia(false);
    setDescricaoPendencia('');
    setNota('');
    setEvidencia('');
  }

  function corpoBase(m: ModoEntrada, codigoLido: string | null): NovaObservacao {
    return {
      mode: m,
      code: codigoLido,
      productId: null,
      packagingCode: null,
      quantity: null,
      unit: null,
      description: null,
      registerAsPending: false,
      lot: loteEscolhido,
      originType: origemEscolhida.tipo,
      originReference: origemEscolhida.referencia,
      condition: condicao === '' ? 'EM_AVALIACAO' : condicao,
      note: nota.trim() || null,
      evidence: evidencia.trim() || null,
    };
  }

  async function registrar(corpo: NovaObservacao, resumo: string, aoConfirmar?: () => void): Promise<boolean> {
    setEnviando(true);
    try {
      const resultado = await aoRegistrar(corpo, resumo);
      if (resultado.ok) {
        setRetorno({ tipo: 'ok', texto: `Registrado no rascunho: ${resumo}.` });
        aoConfirmar?.();
        return true;
      }
      setRetorno({
        tipo: 'erro',
        texto: resultado.incerta
          ? 'Sem resposta do servidor: a entrada pode já estar no rascunho. Ela ficou em “não confirmadas” para verificar ou reenviar com a mesma chave (sem somar duas vezes).'
          : resultado.rede
            ? `Não enviada (${resultado.mensagem}). A leitura ficou em “não confirmadas” para enviar depois.`
            : resultado.mensagem,
      });
      const lido = corpo.code;
      if (resultado.codigo === 'CODIGO_NAO_CADASTRADO' && typeof lido === 'string') setEstado({ tipo: 'nao-cadastrado', codigo: lido });
      return false;
    } finally {
      setEnviando(false);
      focarCodigo();
    }
  }

  async function identificar(texto: string) {
    const lido = texto.trim();
    if (lido === '' || modo === null) return;
    // Mesmo código, mesmo contexto, já confirmado: cada leitura soma (nada é deduplicado).
    if (confirmado !== null && confirmado.codigo === lido && confirmado.contexto === contexto && modo !== 'MANUAL') {
      setCodigo('');
      const ok = await registrar(corpoBase(modo, lido), `1 ${confirmado.unidade} de ${confirmado.sku}`);
      if (ok) setConfirmado((atual) => (atual?.codigo === lido ? { ...atual, leituras: atual.leituras + 1 } : atual));
      return;
    }
    setConfirmado(null);
    setRetorno(null);
    setEstado({ tipo: 'identificando', codigo: lido });
    try {
      const ident = await obterJson(`${API_PREFIXO}/produtos/identificar?codigo=${encodeURIComponent(lido)}`, IdentificacaoCodigoSchema);
      setEstado({ tipo: 'identificado', codigo: lido, ident });
      setEmbalagem(ident.match === 'SKU' ? '' : ident.code);
      setQuantidade('');
      setComoPendencia(false);
      requestAnimationFrame(() => {
        if (modo === 'MANUAL') quantidadeRef.current?.focus();
        else confirmarRef.current?.focus();
      });
    } catch (erro) {
      if (erro instanceof FalhaRequisicao && erro.status === 404) setEstado({ tipo: 'nao-cadastrado', codigo: lido });
      else if (erro instanceof FalhaRequisicao && erro.tipo === 'rede') {
        setEstado({ tipo: 'pendente-consulta', codigo: lido, motivo: navigator.onLine ? 'servidor sem resposta' : 'sem conexão' });
      } else setEstado({ tipo: 'erro', mensagem: mensagemDeFalha(erro) });
      focarCodigo();
    }
  }

  const ident = estado.tipo === 'identificado' ? estado.ident : null;
  const embalagemEscolhida = ident === null || embalagem === '' ? null : (ident.packagings.find((p) => p.code === embalagem) ?? null);
  const unidadeManual = ident === null ? null : (embalagemEscolhida?.packaging ?? ident.canonicalUnit);
  const fatorManual = ident === null ? null : embalagemEscolhida === null ? '1' : embalagemEscolhida.factor;
  const quantidadeManual = decimal(quantidade);
  const quantidadeValida = /^\d{1,15}(\.\d{1,3})?$/.test(quantidadeManual) && Number(quantidadeManual) > 0;
  const conversao = quantidadeValida && fatorManual !== null ? multiplicarExato(quantidadeManual, fatorManual) : null;
  const compativelUnidade = ident !== null && ident.packaging === ident.canonicalUnit && ident.factor === '1';

  function confirmarLeitura() {
    if (!ident || modo === null || modo === 'MANUAL') return;
    const pendente = modo === 'LEITURA_EMBALAGEM' && ident.factor === null;
    const corpo = { ...corpoBase(modo, estado.tipo === 'identificado' ? estado.codigo : null), registerAsPending: pendente };
    const unidade = modo === 'LEITURA_UNIDADE' ? ident.canonicalUnit : ident.packaging;
    const resumo = pendente
      ? `1 ${unidade} de ${ident.sku} sem conversão (fator pendente)`
      : modo === 'LEITURA_UNIDADE'
        ? `1 ${unidade} de ${ident.sku}`
        : `1 ${unidade} de ${ident.sku} (${formatarQuantidade(ident.factor ?? '0')} ${ident.canonicalUnit})`;
    void registrar(corpo, resumo, () => {
      setConfirmado(
        pendente
          ? null
          : { codigo: estado.tipo === 'identificado' ? estado.codigo : '', contexto, sku: ident.sku, descricao: ident.description, unidade, leituras: 1 },
      );
      limparLeitura();
    });
  }

  function registrarManual() {
    if (!ident || unidadeManual === null || !quantidadeValida) return;
    const pendente = fatorManual === null;
    const corpo: NovaObservacao = {
      ...corpoBase('MANUAL', estado.tipo === 'identificado' ? estado.codigo : null),
      quantity: quantidadeManual,
      unit: unidadeManual,
      packagingCode: embalagemEscolhida?.code ?? null,
      registerAsPending: pendente,
    };
    const resumo = pendente
      ? `${formatarQuantidade(quantidadeManual)} ${unidadeManual} de ${ident.sku} sem conversão (fator pendente)`
      : `${formatarQuantidade(quantidadeManual)} ${unidadeManual} de ${ident.sku}${unidadeManual === ident.canonicalUnit ? '' : ` (= ${formatarQuantidade(conversao ?? '0')} ${ident.canonicalUnit})`}`;
    void registrar(corpo, resumo, limparLeitura);
  }

  function registrarNaoCadastrado() {
    if (estado.tipo !== 'nao-cadastrado' || !quantidadeValida) return;
    const unidade = unidadePendencia.trim().toUpperCase();
    const corpo: NovaObservacao = {
      ...corpoBase('MANUAL', estado.codigo),
      quantity: quantidadeManual,
      unit: unidade,
      description: descricaoPendencia.trim() || null,
      registerAsPending: true,
    };
    void registrar(corpo, `pendência: ${formatarQuantidade(quantidadeManual)} ${unidade} do código ${estado.codigo} (não cadastrado)`, limparLeitura);
  }

  const bloqueioManualInteiro = ident !== null && unidadeManual !== null && unidadeManual !== ident.canonicalUnit && quantidadeValida && !/^\d+$/.test(quantidadeManual);
  const bloqueioPeca = unidadeManual === UNIDADE_PECA && quantidadeValida && !/^\d+$/.test(quantidadeManual);

  return (
    <section className="cartao painel-entrada" aria-labelledby={`${ids}-titulo`} data-testid="painel-entrada">
      <h3 id={`${ids}-titulo`}>Registrar o que foi observado</h3>
      {motivoBloqueio !== null && (
        <p className="mensagem-conflito" role="status" data-testid="entrada-bloqueada">
          {motivoBloqueio}
        </p>
      )}

      <fieldset className="modos-entrada" disabled={!habilitado}>
        <legend>Modo de entrada</legend>
        <div className="modos-opcoes" role="radiogroup" aria-label="Modo de entrada">
          {MODOS.map((m) => (
            <label key={m} className={`modo-opcao${modo === m ? ' modo-opcao--ativo' : ''}`}>
              <input
                type="radio"
                name={`${ids}-modo`}
                value={m}
                checked={modo === m}
                onChange={() => {
                  setModo(m);
                  setConfirmado(null);
                  limparLeitura();
                  setRetorno(null);
                  focarCodigo();
                }}
              />
              {ROTULOS_MODO[m].texto}
            </label>
          ))}
        </div>
        <p className="campo-ajuda" data-testid="explicacao-modo">
          {modo === null ? 'Escolha como as quantidades serão informadas.' : ROTULOS_MODO[modo].explicacao}
        </p>
      </fieldset>

      <div className="formulario-grade contexto-entrada">
        <label className="campo">
          <span className="campo-rotulo">Condição (obrigatória)</span>
          <select
            value={condicao}
            disabled={!habilitado}
            onChange={(e) => {
              setCondicao(e.target.value as CondicaoMaterial | '');
              setConfirmado(null);
            }}
          >
            <option value="">Escolha…</option>
            {CONDICOES_MATERIAL.map((c) => (
              <option key={c} value={c}>
                {ROTULOS_CONDICAO[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Lote (vazio = pendente)</span>
          <input
            value={lote}
            maxLength={64}
            spellCheck={false}
            autoComplete="off"
            disabled={!habilitado}
            onChange={(e) => {
              setLote(e.target.value);
              setConfirmado(null);
            }}
          />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Origem (vazio = pendente)</span>
          <select
            value={origem}
            disabled={!habilitado}
            onChange={(e) => {
              setOrigem(e.target.value);
              setConfirmado(null);
            }}
          >
            <option value={SEM_ORIGEM}>Origem pendente</option>
            {origens.map((o) => (
              <option key={`${o.tipo}|${o.referencia ?? ''}`} value={`${o.tipo}|${o.referencia ?? ''}`}>
                {textoOrigem(o.tipo, o.referencia)} (declarada)
              </option>
            ))}
            <option value={OUTRA_ORIGEM}>Outra origem…</option>
          </select>
        </label>
        {origem === OUTRA_ORIGEM && (
          <>
            <label className="campo">
              <span className="campo-rotulo">Tipo do documento</span>
              <select value={outraTipo} disabled={!habilitado} onChange={(e) => { setOutraTipo(e.target.value as TipoOrigemDocumento); setConfirmado(null); }}>
                {TIPOS_ORIGEM_DOCUMENTO.map((t) => (
                  <option key={t} value={t}>
                    {ROTULOS_ORIGEM_DOCUMENTO[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span className="campo-rotulo">Referência (vazio = pendente)</span>
              <input value={outraReferencia} maxLength={64} spellCheck={false} disabled={!habilitado} onChange={(e) => { setOutraReferencia(e.target.value); setConfirmado(null); }} />
            </label>
          </>
        )}
      </div>

      <form
        className="leitura-codigo"
        onSubmit={(e) => {
          e.preventDefault();
          void identificar(codigo);
        }}
      >
        <label className="campo campo--leitura">
          <span className="campo-rotulo">Código lido ou digitado (SKU ou código de barras)</span>
          <input
            ref={codigoRef}
            value={codigo}
            maxLength={64}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            enterKeyHint="go"
            disabled={!pronto}
            data-testid="campo-codigo"
            onChange={(e) => {
              setCodigo(e.target.value);
            }}
          />
          {!pronto && habilitado && <span className="campo-ajuda">Escolha o modo de entrada e a condição antes da primeira leitura.</span>}
        </label>
        <button type="submit" className="botao-secundario" disabled={!pronto || codigo.trim() === '' || estado.tipo === 'identificando'}>
          {estado.tipo === 'identificando' ? 'Identificando…' : 'Identificar'}
        </button>
        <button
          type="button"
          className="botao-secundario"
          disabled={!pronto || enviando}
          onClick={() => {
            setCameraAberta(true);
          }}
          data-testid="ler-codigo-conferencia"
        >
          Ler código (câmera)
        </button>
      </form>

      {cameraAberta && (
        <LeitorCamera
          titulo="Ler código de produto ou embalagem"
          formatos={FORMATOS_PRODUTO}
          aoFechar={() => {
            setCameraAberta(false);
            focarCodigo();
          }}
          renderizarResultado={(leitura, acoes) => {
            const lida = interpretarLeitura(leitura.valor, contextoLeitura);
            if (lida.tipo === 'palete' || lida.tipo === 'palete-outra-origem') {
              return <p className="mensagem-conflito">QR de palete: não é código de produto. Nada foi registrado.</p>;
            }
            if (lida.tipo !== 'codigo') {
              return <p className="mensagem-conflito">Leitura não reconhecida como código de produto: nada foi aberto nem registrado.</p>;
            }
            const soma = confirmado !== null && confirmado.codigo === lida.codigo && confirmado.contexto === contexto && modo !== 'MANUAL';
            return (
              <div className="acoes-linha">
                <button
                  type="button"
                  className="botao-primario"
                  onClick={() => {
                    acoes.fechar();
                    setCodigo(lida.codigo);
                    void identificar(lida.codigo);
                  }}
                  data-testid="usar-codigo-lido"
                >
                  {soma ? `Somar 1 ${confirmado.unidade} de ${confirmado.sku}` : 'Usar este código'}
                </button>
                <span className="campo-ajuda">
                  {soma ? 'Mesmo item confirmado: cada toque soma uma vez.' : 'Produto, unidade e quantidade são confirmados no painel antes de somar.'}
                </span>
              </div>
            );
          }}
        />
      )}

      {confirmado !== null && (
        <p className="item-atual" data-testid="item-atual">
          <strong>Item confirmado:</strong> {confirmado.sku} — {confirmado.descricao}. Cada leitura de <code>{confirmado.codigo}</code> soma 1 {confirmado.unidade}.{' '}
          {confirmado.leituras} leitura(s) nesta sequência.{' '}
          <button
            type="button"
            className="botao-link"
            onClick={() => {
              setConfirmado(null);
              focarCodigo();
            }}
          >
            Trocar item
          </button>
        </p>
      )}

      {estado.tipo === 'erro' && (
        <p className="estado-erro" role="alert">
          {estado.mensagem}
        </p>
      )}

      {estado.tipo === 'pendente-consulta' && (
        <div className="mensagem-conflito" role="alert" data-testid="pendente-consulta">
          <p>
            Código <code>{estado.codigo}</code> lido e pendente de consulta ({estado.motivo}). Nada foi identificado nem registrado; o produto não é presumido.
          </p>
          <button
            type="button"
            className="botao-secundario botao-compacto"
            onClick={() => {
              void identificar(estado.codigo);
            }}
          >
            Consultar de novo
          </button>
        </div>
      )}

      {estado.tipo === 'nao-cadastrado' && (
        <div className="cartao-confirmacao cartao-confirmacao--pendente" data-testid="codigo-nao-cadastrado">
          <p>
            <strong>Código {estado.codigo} não cadastrado neste escopo.</strong> Nenhum SKU foi associado. Registre como pendência (a quantidade fica sem
            conversão e não entra no saldo) ou cadastre o produto/código e leia de novo.
          </p>
          <div className="formulario-grade">
            <label className="campo">
              <span className="campo-rotulo">Quantidade observada</span>
              <input value={quantidade} inputMode="decimal" onChange={(e) => { setQuantidade(e.target.value); }} />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Unidade observada</span>
              <input value={unidadePendencia} maxLength={10} list={`${ids}-unidades`} autoCapitalize="characters" onChange={(e) => { setUnidadePendencia(e.target.value.toUpperCase()); }} />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Descrição (opcional)</span>
              <input value={descricaoPendencia} maxLength={200} onChange={(e) => { setDescricaoPendencia(e.target.value); }} />
            </label>
          </div>
          <datalist id={`${ids}-unidades`}>
            {['UN', 'CX', 'PCT', 'KG', 'L'].map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <div className="acoes-linha">
            <button type="button" className="botao-primario" disabled={!quantidadeValida || enviando || unidadePendencia.trim() === ''} onClick={registrarNaoCadastrado}>
              Registrar pendência
            </button>
            <button type="button" className="botao-link" onClick={() => { limparLeitura(); focarCodigo(); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {ident !== null && modo !== null && (
        <div className="cartao-confirmacao" data-testid="confirmacao-item">
          <p className="confirmacao-produto">
            <strong>{ident.sku}</strong> — {ident.description}
            {!ident.active && <span className="campo-erro"> (inativo no cadastro)</span>}
          </p>
          <dl className="situacao">
            <div>
              <dt>Código lido</dt>
              <dd>
                <code>{estado.tipo === 'identificado' ? estado.codigo : ''}</code> ({ident.match === 'SKU' ? 'SKU' : 'código de barras'})
              </dd>
            </div>
            <div>
              <dt>Embalagem do código</dt>
              <dd>
                {ident.packaging}
                {ident.factor === null ? ' — fator desconhecido' : ident.packaging === ident.canonicalUnit ? '' : ` = ${formatarQuantidade(ident.factor)} ${ident.canonicalUnit}`}
              </dd>
            </div>
            <div>
              <dt>Lote · origem · condição</dt>
              <dd>
                {loteEscolhido ?? 'Lote pendente'} · {textoOrigem(origemEscolhida.tipo, origemEscolhida.referencia)} · {condicao === '' ? '—' : ROTULOS_CONDICAO[condicao]}
              </dd>
            </div>
          </dl>

          {modo === 'LEITURA_UNIDADE' &&
            (compativelUnidade ? (
              <div className="acoes-linha">
                <button ref={confirmarRef} type="button" className="botao-primario" disabled={enviando} onClick={confirmarLeitura} data-testid="confirmar-item">
                  Confirmar e somar 1 {ident.canonicalUnit}
                </button>
                <button type="button" className="botao-link" onClick={() => { limparLeitura(); focarCodigo(); }}>
                  Cancelar
                </button>
              </div>
            ) : (
              <p className="estado-erro" role="alert" data-testid="modo-incompativel">
                Este código é da embalagem {ident.packaging}. No modo “uma unidade por leitura”, leia o código da unidade ou troque para “uma embalagem por leitura”.
              </p>
            ))}

          {modo === 'LEITURA_EMBALAGEM' && (
            <div className="acoes-linha">
              {ident.factor === null ? (
                <p className="mensagem-conflito" data-testid="fator-desconhecido">
                  Fator de {ident.packaging} não aprovado: a conversão está bloqueada. A leitura pode ser registrada como pendência, sem conversão.
                </p>
              ) : null}
              <button ref={confirmarRef} type="button" className={ident.factor === null ? 'botao-secundario' : 'botao-primario'} disabled={enviando} onClick={confirmarLeitura} data-testid="confirmar-item">
                {ident.factor === null
                  ? `Registrar pendência (1 ${ident.packaging} sem conversão)`
                  : `Confirmar e somar 1 ${ident.packaging} (= ${formatarQuantidade(ident.factor)} ${ident.canonicalUnit})`}
              </button>
              <button type="button" className="botao-link" onClick={() => { limparLeitura(); focarCodigo(); }}>
                Cancelar
              </button>
            </div>
          )}

          {modo === 'MANUAL' && (
            <form
              className="formulario-coluna"
              onSubmit={(e) => {
                e.preventDefault();
                registrarManual();
              }}
            >
              <div className="formulario-grade">
                <label className="campo">
                  <span className="campo-rotulo">Quantidade observada</span>
                  <input ref={quantidadeRef} value={quantidade} inputMode="decimal" autoComplete="off" onChange={(e) => { setQuantidade(e.target.value); }} data-testid="campo-quantidade" />
                </label>
                <label className="campo">
                  <span className="campo-rotulo">Unidade</span>
                  <select value={embalagem} onChange={(e) => { setEmbalagem(e.target.value); setComoPendencia(false); }}>
                    <option value="">{ident.canonicalUnit} (unidade canônica)</option>
                    {ident.packagings
                      .filter((p) => p.packaging !== ident.canonicalUnit)
                      .map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.packaging} — {p.factor === null ? 'fator pendente' : `${formatarQuantidade(p.factor)} ${ident.canonicalUnit}`} ({p.code})
                        </option>
                      ))}
                  </select>
                </label>
                <label className="campo">
                  <span className="campo-rotulo">Observação (opcional)</span>
                  <input value={nota} maxLength={300} onChange={(e) => { setNota(e.target.value); }} />
                </label>
                <label className="campo">
                  <span className="campo-rotulo">Evidência (referência, opcional)</span>
                  <input value={evidencia} maxLength={200} placeholder="ex.: foto 12 do turno" onChange={(e) => { setEvidencia(e.target.value); }} />
                </label>
              </div>
              <p className="conversao" data-testid="previa-conversao" aria-live="polite">
                {!quantidadeValida
                  ? 'Informe a quantidade (até 3 casas decimais).'
                  : bloqueioPeca
                    ? 'Peças (UN) precisam ser inteiras.'
                    : bloqueioManualInteiro
                      ? `Embalagens (${unidadeManual}) são contadas inteiras; embalagem aberta: conte na unidade ${ident.canonicalUnit}.`
                      : fatorManual === null
                        ? `Sem fator aprovado para ${unidadeManual ?? ''}: conversão bloqueada.`
                        : unidadeManual === ident.canonicalUnit
                          ? `${formatarQuantidade(quantidadeManual)} ${ident.canonicalUnit}`
                          : conversao === null
                            ? 'Conversão sem resultado exato em 3 casas: não é arredondada.'
                            : `${formatarQuantidade(quantidadeManual)} ${unidadeManual ?? ''} × ${formatarQuantidade(fatorManual)} = ${formatarQuantidade(conversao)} ${ident.canonicalUnit}`}
              </p>
              {fatorManual === null && (
                <label className="opcao">
                  <input type="checkbox" checked={comoPendencia} onChange={(e) => { setComoPendencia(e.target.checked); }} />
                  Registrar como pendência, sem conversão
                </label>
              )}
              <div className="acoes-linha">
                <button
                  type="submit"
                  className="botao-primario"
                  disabled={enviando || !quantidadeValida || bloqueioPeca || bloqueioManualInteiro || (fatorManual === null ? !comoPendencia : conversao === null)}
                >
                  Registrar quantidade
                </button>
                <button type="button" className="botao-link" onClick={() => { limparLeitura(); focarCodigo(); }}>
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <p className={retorno?.tipo === 'erro' ? 'retorno-entrada retorno-entrada--erro' : 'retorno-entrada'} role="status" aria-live="polite" data-testid="retorno-entrada">
        {retorno === null ? '' : `${retorno.tipo === 'ok' ? '✓' : '✕'} ${retorno.texto}`}
      </p>
    </section>
  );
}
