import { ListaAgendasTesteSchema, SolicitacaoTesteSchema, TEXTO_AMBIENTE_TESTE, type SolicitacaoTeste } from '@praca-reversa/contracts';
import { useState } from 'react';
import { useChaves } from '../../api/chaves';
import { enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import type { Navegar } from '../../rotas';
import { API_TESTE } from './textos';
import './selecao-teste.css';

/** Identificação discreta e permanente da área de teste. */
export function SeloAmbienteTeste() {
  return (
    <p className="st-selo-teste" role="note" data-testid="st-ambiente-teste">
      {TEXTO_AMBIENTE_TESTE}
    </p>
  );
}

export type Passo = 'escolher' | 'revisar' | 'acompanhar';

/** Etapas da área: consultar e escolher → revisar o carrinho → enviar e acompanhar. */
export function PassosTeste({ ativo, solicitacaoId, aoNavegar }: { ativo: Passo; solicitacaoId: string | null; aoNavegar: Navegar }) {
  const passos: { id: Passo; rotulo: string; ir: (() => void) | null }[] = [
    { id: 'escolher', rotulo: 'Consultar e escolher', ir: () => { aoNavegar({ tipo: 'selecao-teste', solicitacao: solicitacaoId }); } },
    { id: 'revisar', rotulo: 'Revisar o carrinho', ir: solicitacaoId === null ? null : () => { aoNavegar({ tipo: 'selecao-teste-solicitacao', id: solicitacaoId }); } },
    { id: 'acompanhar', rotulo: 'Enviar e acompanhar', ir: () => { aoNavegar({ tipo: 'selecao-teste-solicitacoes' }); } },
  ];
  return (
    <nav className="st-passos" aria-label="Etapas da seleção">
      <ol>
        {passos.map((p, i) => (
          <li key={p.id} className={p.id === ativo ? 'st-passo st-passo--ativo' : 'st-passo'}>
            {p.id === ativo || p.ir === null ? (
              <span aria-current={p.id === ativo ? 'step' : undefined}>
                <b>{i + 1}</b> {p.rotulo}
              </span>
            ) : (
              <button type="button" className="botao-link" onClick={p.ir}>
                <b>{i + 1}</b> {p.rotulo}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * Escolha da agenda de referência: uma janela existente (só referência; nada
 * dela é alterado) ou uma agenda identificada só no teste, com referência e
 * data. Continua o carrinho da mesma agenda quando já existir.
 */
export function EscolhaAgenda({ aoEscolher, adicional = false, rotuloAcao = 'Começar a seleção' }: { aoEscolher: (s: SolicitacaoTeste) => void; adicional?: boolean; rotuloAcao?: string }) {
  const { carga } = useRecurso(`${API_TESTE}/agendas`, ListaAgendasTesteSchema);
  const [escolha, setEscolha] = useState('');
  const [referencia, setReferencia] = useState('');
  const [data, setData] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const chaves = useChaves();
  const agendas = carga?.estado === 'pronto' ? carga.dados : null;
  const teste = escolha === 'nova';
  const propria = escolha.startsWith('teste:') ? agendas?.testAgendas[Number(escolha.slice(6))] ?? null : null;

  async function comecar() {
    const agenda = escolha.startsWith('janela:')
      ? { windowId: escolha.slice(7) }
      : propria !== null
        ? { reference: propria.reference, date: propria.date }
        : { reference: referencia.trim(), date: data === '' ? null : data };
    const corpo = { agenda, ...(adicional ? { additional: true } : {}) };
    const assinatura = `agenda:${JSON.stringify(corpo)}`;
    setEnviando(true);
    setErro(null);
    try {
      const s = await enviarJson('POST', `${API_TESTE}/solicitacoes`, SolicitacaoTesteSchema, { corpo, idempotencia: chaves.para(assinatura), descricao: 'Começar seleção (teste)' });
      chaves.concluir(assinatura);
      aoEscolher(s);
    } catch (falha) {
      chaves.concluir(assinatura, falha);
      setErro(mensagemDeFalha(falha));
    } finally {
      setEnviando(false);
    }
  }

  const pronto = escolha.startsWith('janela:') || propria !== null || (teste && referencia.trim().length >= 2);
  return (
    <div className="st-agenda-escolha" data-testid="st-escolha-agenda">
      <label className="campo">
        <span className="campo-rotulo">Agenda de saída</span>
        <select
          value={escolha}
          onChange={(ev) => {
            setEscolha(ev.target.value);
          }}
          data-testid="st-agenda"
        >
          <option value="">Escolha a agenda…</option>
          {(agendas?.windows ?? []).map((w) => (
            <option key={w.id} value={`janela:${w.id}`}>
              {w.code} · {w.name}
              {w.date === null ? '' : ` · ${w.date.split('-').reverse().join('/')}`}
            </option>
          ))}
          {(agendas?.testAgendas ?? []).map((a, i) => (
            <option key={`${a.reference}|${a.date ?? ''}`} value={`teste:${String(i)}`}>
              {a.reference}
              {a.date === null ? '' : ` · ${a.date.split('-').reverse().join('/')}`} (agenda de teste)
            </option>
          ))}
          <option value="nova">Outra agenda (só para este teste)…</option>
        </select>
      </label>
      {teste && (
        <>
          <label className="campo">
            <span className="campo-rotulo">Referência da agenda</span>
            <input type="text" maxLength={120} value={referencia} placeholder="Ex.: Agenda de novembro" onChange={(ev) => { setReferencia(ev.target.value); }} data-testid="st-agenda-referencia" />
          </label>
          <label className="campo">
            <span className="campo-rotulo">Data (opcional)</span>
            <input type="date" value={data} onChange={(ev) => { setData(ev.target.value); }} data-testid="st-agenda-data" />
          </label>
        </>
      )}
      <button type="button" className="botao-primario" disabled={!pronto || enviando} onClick={() => void comecar()} data-testid="st-comecar">
        {enviando ? 'Abrindo…' : rotuloAcao}
      </button>
      {agendas !== null && agendas.windows.length === 0 && <p className="st-nota">Nenhuma janela de devolução aberta neste escopo: use uma agenda de teste (sem ligação com o fluxo real).</p>}
      {erro !== null && (
        <p className="estado-erro" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
