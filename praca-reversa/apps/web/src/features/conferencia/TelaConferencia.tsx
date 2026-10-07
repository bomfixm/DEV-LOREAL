import {
  API_PREFIXO,
  ConferenciaDetalheSchema,
  LIMITE_PROCESSAMENTO_MS,
  PaleteDetalheSchema,
  ResultadoObservacaoSchema,
  type ConferenciaDetalhe,
  type CorrigirObservacao,
  type LinhaObservacao,
  type NovaObservacao,
  type Sessao,
} from '@praca-reversa/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ehConflitoDeVersao, useChaves } from '../../api/chaves';
import { FalhaRequisicao, enviarJson, mensagemDeFalha } from '../../api/cliente';
import { consultarOperacao } from '../../api/recuperacao';
import { useRecurso } from '../../api/use-recurso';
import { useVersao } from '../../api/versao';
import { useProtecao } from '../../pwa/protecoes';
import { IconeAtualizar, IconeVoltar } from '../../components/Icones';
import { MensagemAcao } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import type { Navegar } from '../../rotas';
import { formatarDataHora, formatarHora } from '../../utils/datas';
import { ROTULOS_CONFERENCIA, ROTULOS_LIBERACAO } from '../paletes/estados';
import { AnexosConferencia } from './AnexosConferencia';
import { ComparacaoConferencia } from './ComparacaoConferencia';
import { alterarNaMemoria, gravarNaoEnviadas, lerGravadas, lerNaoEnviadas, type EnvioPendente } from './fila';
import { LinhasConferencia } from './LinhasConferencia';
import { PainelEntrada, type OrigemDeclarada, type ResultadoEnvio } from './PainelEntrada';
import { ReconciliacaoConferencia } from './ReconciliacaoConferencia';
import { ROTULOS_ESCOPO, ROTULOS_EVENTO, ROTULOS_MOTIVO, ROTULOS_SITUACAO } from './rotulos';
import { AjudaTarefa } from '../ajuda/AjudaTarefa';

interface Props {
  id: string;
  sessao: Sessao;
  aoNavegar: Navegar;
  /** Depois de uma gravação confirmada que muda o palete: mapa e lista consultam de novo. */
  aoGravar: () => void;
}

type Mensagem = { tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null;
type Painel = 'concluir' | 'cancelar' | 'recontar' | 'reconciliar' | null;

/** Espera depois da última entrada confirmada antes de reler o rascunho inteiro. */
const ESPERA_ATUALIZACAO_MS = 400;

export function TelaConferencia({ id, sessao, aoNavegar, aoGravar }: Props) {
  const conectado = useConectado();
  const chaves = useChaves();
  const [versao, setVersao] = useState(0);
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/conferencias/${id}`, ConferenciaDetalheSchema, versao);
  // `ultimo` recebe tanto a leitura do servidor quanto a resposta das ações; a
  // leitura só é aplicada quando chega uma nova (não sobrescreve a resposta de uma ação).
  const [ultimo, setUltimo] = useState<ConferenciaDetalhe | null>(null);
  const [aplicada, setAplicada] = useState<ConferenciaDetalhe | null>(null);
  if (carga?.estado === 'pronto' && carga.dados !== aplicada && carga.dados.id === id) {
    setAplicada(carga.dados);
    setUltimo(carga.dados);
  }
  const detalhe = ultimo?.id === id ? ultimo : null;

  // Reconexão: consultar de novo o rascunho e a versão atual antes de permitir concluir/reconciliar.
  const [conectadoAntes, setConectadoAntes] = useState(conectado);
  const [verificando, setVerificando] = useState(false);
  if (conectado !== conectadoAntes) {
    setConectadoAntes(conectado);
    if (conectado) {
      setVerificando(true);
      setVersao((v) => v + 1);
    }
  }
  if (verificando && carga?.estado === 'pronto') setVerificando(false);

  // Palete (somente as origens declaradas, para escolher a origem da observação).
  const paleteUrl = detalhe !== null && detalhe.state === 'EM_ANDAMENTO' ? `${API_PREFIXO}/paletes/${detalhe.palletId}` : null;
  const { carga: cargaPalete } = useRecurso(paleteUrl, PaleteDetalheSchema);
  const origens: OrigemDeclarada[] = [];
  if (cargaPalete?.estado === 'pronto') {
    for (const d of cargaPalete.dados.declaredItems ?? []) {
      if (d.originType !== null && !origens.some((o) => o.tipo === d.originType && o.referencia === d.originReference)) {
        origens.push({ tipo: d.originType, referencia: d.originReference });
      }
    }
  }

  // Entradas não confirmadas pelo servidor (etapa 09): memória da aplicação e,
  // se a política da API permitir, o sessionStorage da aba ("não enviado").
  // Política ainda desconhecida (null): só a memória.
  const politica = useVersao().servidor?.localDrafts ?? null;
  const escopoId = sessao.activeScope?.id ?? '';
  const contexto = useMemo(() => ({ usuarioId: sessao.user.id, escopoId, conferenciaId: id }), [sessao.user.id, escopoId, id]);
  const [fila, setFila] = useState<EnvioPendente[]>(() => lerNaoEnviadas(contexto, politica));
  const [politicaAplicada, setPoliticaAplicada] = useState(politica);
  if (politica !== politicaAplicada) {
    // Política conhecida depois da abertura (reabrir a aplicação): traz as gravadas na aba.
    setPoliticaAplicada(politica);
    if (politica === true) {
      const gravadas = lerGravadas(contexto).filter((g) => !fila.some((f) => f.chave === g.chave));
      if (gravadas.length > 0) setFila([...fila, ...gravadas]);
    }
  }
  const [recentes, setRecentes] = useState<LinhaObservacao[]>([]);
  if (detalhe !== null && recentes.some((r) => detalhe.lines.some((l) => l.id === r.id))) {
    setRecentes(recentes.filter((r) => !detalhe.lines.some((l) => l.id === r.id)));
  }
  useEffect(() => {
    gravarNaoEnviadas(contexto, fila, politica);
  }, [fila, contexto, politica]);
  useEffect(() => {
    if (fila.length === 0) return;
    const avisar = (evento: BeforeUnloadEvent) => {
      evento.preventDefault();
    };
    window.addEventListener('beforeunload', avisar);
    return () => {
      window.removeEventListener('beforeunload', avisar);
    };
  }, [fila.length]);

  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (espera.current !== null) clearTimeout(espera.current);
    },
    [],
  );
  function agendarAtualizacao() {
    if (espera.current !== null) clearTimeout(espera.current);
    espera.current = setTimeout(() => {
      setVersao((v) => v + 1);
    }, ESPERA_ATUALIZACAO_MS);
  }

  const [painel, setPainel] = useState<Painel>(null);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarEscopo, setConfirmarEscopo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [notas, setNotas] = useState<string | null>(null);

  const pode = (p: 'conferencia.registrar' | 'conferencia.reconciliar') => sessao.permissions.includes(p);

  /** Resultado de um envio na tela e na memória da aplicação (a tela pode sair antes da resposta). `null` remove. */
  function mudarEntrada(itemId: string, mudanca: Partial<EnvioPendente> | null) {
    setFila((f) => (mudanca === null ? f.filter((e) => e.id !== itemId) : f.map((e) => (e.id === itemId ? { ...e, ...mudanca } : e))));
    alterarNaMemoria(contexto, itemId, mudanca, politica);
  }

  async function enviar(item: EnvioPendente): Promise<ResultadoEnvio> {
    setFila((f) => f.map((e) => (e.id === item.id ? { ...e, estado: 'enviando', erro: null } : e)));
    try {
      const r = await enviarJson('POST', `${API_PREFIXO}/conferencias/${id}/observacoes`, ResultadoObservacaoSchema, {
        corpo: item.corpo,
        idempotencia: item.chave,
        incerteza: 'tela',
      });
      mudarEntrada(item.id, null);
      setRecentes((rs) => [...rs, r.line]);
      setUltimo((u) => (u === null ? u : { ...u, revision: Math.max(u.revision, r.session.revision), updatedAt: r.session.updatedAt }));
      agendarAtualizacao();
      return { ok: true };
    } catch (erro) {
      const falha = erro instanceof FalhaRequisicao ? erro : null;
      const naoSaiu = falha?.tipo === 'bloqueio';
      const incerta = falha?.tipo === 'rede' || falha?.incerta === true;
      const sessaoPerdida = falha?.status === 401;
      const rede = naoSaiu || incerta || sessaoPerdida;
      const motivo = sessaoPerdida ? 'sessão expirada' : falha?.codigo === 'VERSAO_INCOMPATIVEL' ? 'versão incompatível' : 'sem conexão';
      if (incerta) {
        // A resposta se perdeu: pode já estar no rascunho. Verificada pela chave antes de qualquer reenvio.
        mudarEntrada(item.id, { estado: 'incerta', erro: 'sem resposta do servidor: pode já estar no rascunho' });
      } else if (naoSaiu || sessaoPerdida) {
        // Nada foi registrado: fica para reenviar com a mesma chave.
        mudarEntrada(item.id, { estado: 'nao-enviada', erro: motivo });
      } else {
        // Recusada pelo servidor: não entrou no rascunho; uma nova tentativa é outra ação.
        mudarEntrada(item.id, null);
        if (falha?.status === 409) agendarAtualizacao();
      }
      return { ok: false, codigo: falha?.codigo ?? null, mensagem: naoSaiu || sessaoPerdida ? motivo : mensagemDeFalha(erro), rede, incerta };
    }
  }

  function registrar(corpo: NovaObservacao, resumo: string): Promise<ResultadoEnvio> {
    const item: EnvioPendente = { id: crypto.randomUUID(), chave: crypto.randomUUID(), corpo, resumo, estado: 'enviando', erro: null, criadaEm: Date.now() };
    if (!conectado) {
      setFila((f) => [...f, { ...item, estado: 'nao-enviada', erro: 'sem conexão — nada foi enviado' }]);
      return Promise.resolve({ ok: false, codigo: null, mensagem: 'sem conexão', rede: true });
    }
    setFila((f) => [...f, item]);
    return enviar(item);
  }

  /** Consulta pela chave (somente leitura): registrada → sai da fila sem somar de novo. */
  async function verificarEntrada(item: EnvioPendente): Promise<void> {
    setFila((f) => f.map((e) => (e.id === item.id ? { ...e, estado: 'verificando' } : e)));
    try {
      const r = await consultarOperacao(item.chave);
      if (r.state === 'REGISTRADA') {
        setFila((f) => f.filter((e) => e.id !== item.id));
        agendarAtualizacao();
        setMensagem({ tipo: 'ok', texto: `“${item.resumo}” já estava no rascunho do servidor: nada foi somado de novo.` });
      } else if (Date.now() - item.criadaEm >= LIMITE_PROCESSAMENTO_MS) {
        setFila((f) => f.map((e) => (e.id === item.id ? { ...e, estado: 'nao-enviada', erro: 'o servidor não registrou esta entrada' } : e)));
      } else {
        setFila((f) => f.map((e) => (e.id === item.id ? { ...e, estado: 'incerta', erro: 'ainda sem registro (pode estar em processamento)' } : e)));
      }
    } catch (erro) {
      setFila((f) => f.map((e) => (e.id === item.id ? { ...e, estado: 'incerta', erro: `não foi possível verificar: ${mensagemDeFalha(erro)}` } : e)));
    }
  }

  // Com conexão e rascunho conferido, as incertas são verificadas uma vez (somente leitura).
  const verificadas = useRef(new Set<string>());
  useEffect(() => {
    if (!conectado || verificando || detalhe === null) return;
    for (const e of fila) {
      if (e.estado === 'incerta' && !verificadas.current.has(e.id)) {
        verificadas.current.add(e.id);
        void verificarEntrada(e);
      }
    }
  });
  useEffect(() => {
    if (!conectado) verificadas.current.clear();
  }, [conectado]);

  // Divergência ao reconectar: o rascunho mudou no servidor enquanto esta tela estava sem conexão.
  // A comparação acontece uma vez, quando a releitura feita na reconexão termina.
  const [revisaoNaQueda, setRevisaoNaQueda] = useState<number | null>(null);
  const [mudancaNaQueda, setMudancaNaQueda] = useState<{ antes: number; depois: number } | null>(null);
  if (!conectado && revisaoNaQueda === null && detalhe !== null) setRevisaoNaQueda(detalhe.revision);
  if (conectado && conectado === conectadoAntes && !verificando && revisaoNaQueda !== null && detalhe !== null) {
    setRevisaoNaQueda(null);
    if (detalhe.revision !== revisaoNaQueda) setMudancaNaQueda({ antes: revisaoNaQueda, depois: detalhe.revision });
  }
  const divergencia = mudancaNaQueda !== null && fila.length > 0 ? mudancaNaQueda : null;

  // Protege a atualização da versão (etapa 09): contagem aberta e entradas não confirmadas.
  const emContagem = detalhe?.state === 'EM_ANDAMENTO' && sessao.permissions.includes('conferencia.registrar');
  useProtecao(emContagem ? 'Contagem em andamento (o rascunho confirmado está no servidor).' : null, false);
  const naoConfirmadas = fila.length;
  const emConfirmacao = fila.filter((e) => e.estado !== 'nao-enviada').length;
  const filaSobreviveRecarga = politica === true && emConfirmacao === 0;
  useProtecao(
    naoConfirmadas === 0
      ? null
      : emConfirmacao > 0
        ? `${String(emConfirmacao)} entrada(s) da conferência não confirmada(s) pelo servidor e em verificação: verifique antes de atualizar.`
        : `${String(naoConfirmadas)} entrada(s) da conferência não enviada(s)${filaSobreviveRecarga ? ', guardada(s) nesta aba' : ', só na memória desta aba (a recarga as perderia)'}.`,
    !filaSobreviveRecarga,
  );

  async function acao<T>(assinatura: string, executar: (chave: string) => Promise<T>, sucesso: (r: T) => void): Promise<boolean> {
    setOcupado(true);
    setMensagem(null);
    try {
      const r = await executar(chaves.para(assinatura));
      chaves.concluir(assinatura);
      sucesso(r);
      return true;
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      if (ehConflitoDeVersao(erro) || (erro instanceof FalhaRequisicao && erro.codigo === 'CONFLITO')) {
        setMensagem({ tipo: 'conflito', texto: `${mensagemDeFalha(erro)} Os dados atuais foram recarregados.` });
        setVersao((v) => v + 1);
      } else {
        setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
      }
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function corrigir(linha: LinhaObservacao, corpo: CorrigirObservacao): Promise<string | null> {
    const assinatura = `corrigir:${linha.id}:${JSON.stringify(corpo)}`;
    try {
      await enviarJson('PATCH', `${API_PREFIXO}/conferencias/${id}/observacoes/${linha.id}`, ResultadoObservacaoSchema, {
        corpo,
        idempotencia: chaves.para(assinatura),
      });
      chaves.concluir(assinatura);
      setVersao((v) => v + 1);
      return null;
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      if (ehConflitoDeVersao(erro)) setVersao((v) => v + 1);
      return mensagemDeFalha(erro);
    }
  }

  async function remover(linha: LinhaObservacao, motivoRemocao: string | null): Promise<string | null> {
    const corpo = { expectedRevision: linha.revision, reason: motivoRemocao };
    const assinatura = `remover:${linha.id}:${JSON.stringify(corpo)}`;
    try {
      await enviarJson('POST', `${API_PREFIXO}/conferencias/${id}/observacoes/${linha.id}/remover`, ResultadoObservacaoSchema, {
        corpo,
        idempotencia: chaves.para(assinatura),
      });
      chaves.concluir(assinatura);
      setVersao((v) => v + 1);
      return null;
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      if (ehConflitoDeVersao(erro)) setVersao((v) => v + 1);
      return mensagemDeFalha(erro);
    }
  }

  if (detalhe === null) {
    return (
      <main className="principal principal--pagina" data-testid="tela-conferencia">
        <div className="pagina-conteudo">
          {carga?.estado === 'erro' ? (
            <div className="estado-erro estado-tela" role="alert">
              <h2>{carga.status === 404 ? 'Conferência não encontrada' : 'Não foi possível carregar a conferência'}</h2>
              <p>{carga.status === 404 ? 'Ela não existe no escopo ativo ou você não tem acesso a ela.' : carga.mensagem}</p>
              <div className="acoes-linha">
                <button type="button" className="botao-primario" onClick={recarregar}>
                  <IconeAtualizar />
                  Tentar novamente
                </button>
                <button type="button" className="botao-secundario" onClick={() => { aoNavegar({ tipo: 'praca' }); }}>
                  Voltar ao mapa
                </button>
              </div>
            </div>
          ) : (
            <p className="estado-carregando" aria-busy="true">
              Carregando conferência…
            </p>
          )}
        </div>
      </main>
    );
  }

  const emAndamento = detalhe.state === 'EM_ANDAMENTO';
  const responsavel = detalhe.responsible?.login === sessao.user.login;
  const podeRegistrar = pode('conferencia.registrar');
  const podeValidar = pode('conferencia.reconciliar');
  const situacao = ROTULOS_SITUACAO[detalhe.state];
  const naoEnviadas = fila.length;
  const bloqueioGravacao = !conectado
    ? 'Sem conexão: as leituras ficam como “não enviadas” neste aparelho; concluir, cancelar e reconciliar ficam bloqueados.'
    : verificando
      ? 'Conexão restabelecida: conferindo o rascunho e a versão atuais no servidor…'
      : null;
  const bloqueioConclusao = bloqueioGravacao ?? (naoEnviadas > 0 ? 'Há entradas não confirmadas pelo servidor: verifique, reenvie ou descarte antes de concluir.' : null);
  const notasAtuais = notas ?? detalhe.notes ?? '';

  function voltarAoPalete() {
    aoNavegar({ tipo: 'palete', id: detalhe?.palletId ?? '' });
  }

  return (
    <main className="principal principal--pagina" data-testid="tela-conferencia" data-estado={detalhe.state}>
      <div className="pagina-conteudo tela-conferencia">
        <header className="pagina-topo conferencia-topo">
          <button type="button" className="botao-voltar" onClick={voltarAoPalete}>
            <IconeVoltar />
            Palete {detalhe.pallet.code}
          </button>
          <h2 data-testid="titulo-conferencia">
            Conferência nº {detalhe.number} · {detalhe.pallet.code}
          </h2>
          <p className="conferencia-escopo">
            <span className={`selo selo-situacao selo-situacao--${detalhe.state}`} data-testid="situacao-conferencia">
              <span className="selo-marcador" aria-hidden="true">
                {situacao.marcador}
              </span>
              {situacao.texto}
            </span>{' '}
            <strong>{ROTULOS_ESCOPO[detalhe.scope].texto}</strong>
            {detalhe.scopeDescription !== null && <> — {detalhe.scopeDescription}</>}
            {detalhe.kind === 'RECONTAGEM' && (
              <>
                {' · '}
                {ROTULOS_MOTIVO.RECONTAGEM}
                {detalhe.origin !== null && (
                  <>
                    {' da nº '}
                    <button type="button" className="botao-link" onClick={() => { if (detalhe.origin) aoNavegar({ tipo: 'conferencia', id: detalhe.origin.id }); }}>
                      {detalhe.origin.number}
                    </button>
                  </>
                )}
                {detalhe.justification !== null && <>: {detalhe.justification}</>}
              </>
            )}
          </p>
          <dl className="situacao conferencia-dados">
            <div>
              <dt>Responsável</dt>
              <dd>{detalhe.responsible?.name ?? 'carga de demonstração'}</dd>
            </div>
            <div>
              <dt>Início</dt>
              <dd>{formatarDataHora(detalhe.startedAt)}</dd>
            </div>
            <div>
              <dt>Palete</dt>
              <dd>
                {detalhe.pallet.positionCode ?? 'sem posição'} · {ROTULOS_CONFERENCIA[detalhe.pallet.countState].texto} · {ROTULOS_LIBERACAO[detalhe.pallet.releaseState]}
              </dd>
            </div>
            {detalhe.concludedAt !== null && (
              <div>
                <dt>Concluída</dt>
                <dd>
                  {formatarDataHora(detalhe.concludedAt)}
                  {detalhe.concludedBy ? ` por ${detalhe.concludedBy.name}` : ''}
                  {detalhe.scope === 'COMPLETA' && detalhe.fullScopeConfirmed ? ' · escopo completo confirmado' : ''}
                </dd>
              </div>
            )}
          </dl>
          <p className={`estado-rascunho${naoEnviadas > 0 || !conectado ? ' estado-rascunho--alerta' : ''}`} role="status" data-testid="estado-rascunho">
            {emAndamento ? (
              <>
                Rascunho salvo no servidor em <strong>{formatarHora(detalhe.updatedAt)}</strong> (revisão {detalhe.revision}).{' '}
                {naoEnviadas > 0 ? <strong>{naoEnviadas} entrada(s) não confirmada(s) pelo servidor.</strong> : 'Nenhuma alteração pendente de envio.'}
              </>
            ) : (
              <>Última alteração registrada em {formatarDataHora(detalhe.updatedAt)}.</>
            )}
            {!conectado && <strong> Sem conexão.</strong>}
            {verificando && <strong> Verificando rascunho e versão…</strong>}
          </p>
        </header>
        <AjudaTarefa tarefa="conferir" />
        <AjudaTarefa tarefa="divergencia" />
        <AjudaTarefa tarefa="interrupcao" />

        <MensagemAcao mensagem={mensagem} testId="mensagem-conferencia" />

        {divergencia !== null && (
          <p className="mensagem-conflito" role="alert" data-testid="divergencia-rascunho">
            O rascunho mudou no servidor enquanto esta tela estava sem conexão (revisão {divergencia.antes} → {divergencia.depois}). Revise as linhas atuais e as entradas não
            confirmadas antes de reenviar: nada é enviado sem a sua ação, e o que outra pessoa registrou não é alterado.{' '}
            <button type="button" className="botao-link" onClick={() => { setMudancaNaQueda(null); }}>
              Revisei
            </button>
          </p>
        )}
        {!emAndamento && fila.length > 0 && (
          <p className="mensagem-conflito" role="alert" data-testid="fila-sem-conferencia">
            Esta conferência não está mais em andamento: as {fila.length} entrada(s) não confirmada(s) não podem ser enviadas. Verifique se já constam nas observações e descarte-as.
          </p>
        )}

        {detalhe.outdated && (
          <p className="mensagem-conflito" role="alert" data-testid="contagem-desatualizada">
            O conteúdo validado do palete mudou depois do início desta contagem: ela não pode ser reconciliada. Solicite uma recontagem.
          </p>
        )}
        {detalhe.pendingReconciliation !== null && (
          <p className="mensagem-conflito" role="alert">
            Pendência registrada em {formatarDataHora(detalhe.pendingReconciliation.at)}: {detalhe.pendingReconciliation.reason}
          </p>
        )}
        {detalhe.state === 'CANCELADA' && (
          <p className="aviso-arquivado" role="note">
            Cancelada em {detalhe.cancelledAt === null ? '—' : formatarDataHora(detalhe.cancelledAt)} por {detalhe.cancelledBy?.name ?? '—'}: {detalhe.cancelReason}. As observações
            ficam no histórico e não contam.
          </p>
        )}
        {detalhe.state === 'SUBSTITUIDA' && detalhe.supersededBy !== null && (
          <p className="aviso-arquivado" role="note">
            Substituída pela recontagem nº{' '}
            <button type="button" className="botao-link" onClick={() => { if (detalhe.supersededBy) aoNavegar({ tipo: 'conferencia', id: detalhe.supersededBy.id }); }}>
              {detalhe.supersededBy.number}
            </button>
            . As observações originais continuam preservadas.
          </p>
        )}
        {detalhe.state === 'RECONCILIADA' && (
          <p className="mensagem-ok" role="note" data-testid="reconciliada">
            Reconciliada em {detalhe.reconciledAt === null ? '—' : formatarDataHora(detalhe.reconciledAt)} por {detalhe.reconciledBy?.name ?? '—'}: {detalhe.reconciliationJustification}.
            O saldo validado do palete foi gravado com evento de estoque; a liberação não mudou.
          </p>
        )}

        <div className={emAndamento ? 'conferencia-colunas' : 'conferencia-colunas conferencia-colunas--leitura'}>
          {emAndamento && podeRegistrar && (
            <PainelEntrada
              habilitado={!detalhe.outdated}
              motivoBloqueio={detalhe.outdated ? 'Contagem desatualizada: cancele e conte novamente.' : !conectado ? bloqueioGravacao : null}
              origens={origens}
              aoRegistrar={registrar}
            />
          )}
          <LinhasConferencia
            detalhe={detalhe}
            recentes={recentes}
            naoEnviadas={fila}
            guardadasNaAba={politica === true}
            editavel={emAndamento && podeRegistrar && conectado}
            podeEnviar={conectado && !verificando && divergencia === null && emAndamento}
            aoReenviar={(itemId) => {
              const item = fila.find((e) => e.id === itemId);
              if (item) void enviar(item);
            }}
            aoVerificar={(itemId) => {
              const item = fila.find((e) => e.id === itemId);
              if (item) void verificarEntrada(item);
            }}
            aoDescartar={(itemId) => {
              setFila((f) => f.filter((e) => e.id !== itemId));
            }}
            aoCorrigir={corrigir}
            aoRemover={remover}
          />
        </div>

        {emAndamento && podeRegistrar && (
          <section className="cartao" aria-labelledby="titulo-notas-conferencia">
            <h3 id="titulo-notas-conferencia">Observações gerais da conferência</h3>
            <form
              className="formulario-coluna"
              onSubmit={(e) => {
                e.preventDefault();
                const corpo = { expectedRevision: detalhe.revision, notes: notasAtuais };
                void acao(
                  `notas:${id}:${JSON.stringify(corpo)}`,
                  (chave) => enviarJson('PATCH', `${API_PREFIXO}/conferencias/${id}`, ConferenciaDetalheSchema, { corpo, idempotencia: chave }),
                  (r) => {
                    setUltimo(r);
                    setNotas(null);
                    setMensagem({ tipo: 'ok', texto: 'Observações gravadas no rascunho.' });
                  },
                );
              }}
            >
              <label className="campo">
                <span className="campo-rotulo">Observações e referências de evidência (até 1000 caracteres)</span>
                <textarea value={notasAtuais} rows={2} maxLength={1000} onChange={(e) => { setNotas(e.target.value); }} />
              </label>
              <div className="acoes-linha">
                <button type="submit" className="botao-secundario" disabled={ocupado || bloqueioGravacao !== null || notas === null}>
                  Salvar observações
                </button>
              </div>
            </form>
          </section>
        )}

        <AnexosConferencia
          conferenciaId={id}
          anexos={detalhe.attachments}
          podeEnviar={emAndamento && podeRegistrar}
          conectado={conectado}
          aoEnviado={() => {
            setVersao((v) => v + 1);
          }}
        />

        {detalhe.comparison !== null && <ComparacaoConferencia comparacao={detalhe.comparison} />}

        <section className="cartao" aria-labelledby="titulo-acoes-conferencia" data-testid="acoes-conferencia">
          <h3 id="titulo-acoes-conferencia">Próximo passo</h3>
          <div className="acoes-linha">
            {emAndamento && podeRegistrar && (
              <>
                <button type="button" className="botao-primario" onClick={() => { setPainel('concluir'); setConfirmarEscopo(false); }}>
                  Concluir conferência…
                </button>
                <button
                  type="button"
                  className="botao-secundario"
                  onClick={() => {
                    if (
                      naoEnviadas > 0 &&
                      !window.confirm(
                        `Há ${String(naoEnviadas)} entrada(s) não confirmada(s) pelo servidor, guardadas ${politica === true ? 'nesta aba do navegador' : 'só na memória desta aba'}. Sair mesmo assim?`,
                      )
                    )
                      return;
                    voltarAoPalete();
                  }}
                >
                  Salvar rascunho e sair
                </button>
              </>
            )}
            {((emAndamento && podeRegistrar && (responsavel || podeValidar)) || (detalhe.state === 'CONCLUIDA' && podeValidar)) && (
              <button type="button" className="botao-link" onClick={() => { setPainel('cancelar'); setMotivo(''); }}>
                {emAndamento ? 'Cancelar conferência…' : 'Cancelar contagem…'}
              </button>
            )}
            {(detalhe.state === 'CONCLUIDA' || detalhe.state === 'RECONCILIADA') && podeRegistrar && (
              <button type="button" className="botao-secundario" onClick={() => { setPainel('recontar'); setMotivo(''); }}>
                {detalhe.state === 'RECONCILIADA' ? 'Corrigir por nova contagem…' : 'Solicitar recontagem…'}
              </button>
            )}
            {detalhe.state === 'CONCLUIDA' && detalhe.scope === 'COMPLETA' && podeValidar && (
              <button type="button" className="botao-primario" onClick={() => { setPainel('reconciliar'); }} data-testid="abrir-reconciliacao">
                Reconciliar conferência…
              </button>
            )}
            {!emAndamento && (
              <button type="button" className="botao-secundario" onClick={voltarAoPalete}>
                Voltar ao palete
              </button>
            )}
          </div>
          {detalhe.state === 'CONCLUIDA' && detalhe.scope === 'PARCIAL' && (
            <p className="bloco-nota">Conferência parcial: registra observações e pendências e não substitui o saldo integral do palete (não é reconciliada).</p>
          )}
          {detalhe.state === 'CONCLUIDA' && detalhe.scope === 'COMPLETA' && !podeValidar && (
            <p className="bloco-nota">Contagem aguardando validação por um perfil autorizado. Concluir não cria saldo nem libera o palete.</p>
          )}

          {painel === 'concluir' && emAndamento && (
            <form
              className="formulario-coluna painel-acao"
              onSubmit={(e) => {
                e.preventDefault();
                const corpo = { expectedRevision: detalhe.revision, expectedPalletVersion: detalhe.pallet.version, confirmFullScope: detalhe.scope === 'COMPLETA' && confirmarEscopo };
                void acao(
                  `concluir:${id}:${JSON.stringify(corpo)}`,
                  (chave) => enviarJson('POST', `${API_PREFIXO}/conferencias/${id}/concluir`, ConferenciaDetalheSchema, { corpo, idempotencia: chave }),
                  (r) => {
                    setUltimo(r);
                    setPainel(null);
                    aoGravar();
                    setMensagem({
                      tipo: 'ok',
                      texto:
                        r.scope === 'COMPLETA'
                          ? 'Conferência concluída: contagem aguardando validação. Nenhum saldo foi criado e a liberação não mudou.'
                          : 'Conferência parcial concluída: observações registradas; o restante do palete continua pendente.',
                    });
                  },
                );
              }}
            >
              <h4>Concluir a conferência nº {detalhe.number}</h4>
              <p>
                {detalhe.lines.filter((l) => l.removed === null).length} linha(s) ativa(s), {detalhe.totals.length} segmento(s) convertido(s), {detalhe.pending.length} pendência(s).
                Depois de concluída, as observações não podem mais ser alteradas (correções usam recontagem vinculada).
              </p>
              {detalhe.scope === 'COMPLETA' ? (
                <label className="opcao opcao--destaque">
                  <input type="checkbox" checked={confirmarEscopo} onChange={(e) => { setConfirmarEscopo(e.target.checked); }} data-testid="confirmar-escopo" />
                  Confirmo que todo o conteúdo físico do palete foi conferido. O que não foi registrado será tratado como ausente na validação.
                </label>
              ) : (
                <p className="bloco-nota">Parcial: o que não foi contado continua pendente; nada é declarado ausente.</p>
              )}
              {bloqueioConclusao !== null && <p className="mensagem-conflito">{bloqueioConclusao}</p>}
              <div className="acoes-linha">
                <button
                  type="submit"
                  className="botao-primario"
                  disabled={ocupado || bloqueioConclusao !== null || (detalhe.scope === 'COMPLETA' && !confirmarEscopo)}
                  data-testid="confirmar-conclusao"
                >
                  {ocupado ? 'Concluindo…' : 'Concluir'}
                </button>
                <button type="button" className="botao-link" onClick={() => { setPainel(null); }}>
                  Voltar
                </button>
              </div>
            </form>
          )}

          {painel === 'cancelar' && (
            <form
              className="formulario-coluna painel-acao"
              onSubmit={(e) => {
                e.preventDefault();
                const corpo = { expectedRevision: detalhe.revision, reason: motivo.trim() };
                void acao(
                  `cancelar:${id}:${JSON.stringify(corpo)}`,
                  (chave) => enviarJson('POST', `${API_PREFIXO}/conferencias/${id}/cancelar`, ConferenciaDetalheSchema, { corpo, idempotencia: chave }),
                  (r) => {
                    setUltimo(r);
                    setPainel(null);
                    setFila([]);
                    aoGravar();
                    setMensagem({ tipo: 'ok', texto: 'Conferência cancelada. O histórico foi preservado.' });
                  },
                );
              }}
            >
              <label className="campo">
                <span className="campo-rotulo">Motivo do cancelamento (obrigatório)</span>
                <textarea value={motivo} rows={2} maxLength={500} onChange={(e) => { setMotivo(e.target.value); }} />
              </label>
              {bloqueioGravacao !== null && <p className="mensagem-conflito">{bloqueioGravacao}</p>}
              <div className="acoes-linha">
                <button type="submit" className="botao-perigo" disabled={ocupado || bloqueioGravacao !== null || motivo.trim().length < 3}>
                  Confirmar cancelamento
                </button>
                <button type="button" className="botao-link" onClick={() => { setPainel(null); }}>
                  Voltar
                </button>
              </div>
            </form>
          )}

          {painel === 'recontar' && (
            <form
              className="formulario-coluna painel-acao"
              onSubmit={(e) => {
                e.preventDefault();
                const corpo = { expectedPalletVersion: detalhe.pallet.version, justification: motivo.trim() };
                void acao(
                  `recontar:${id}:${JSON.stringify(corpo)}`,
                  (chave) => enviarJson('POST', `${API_PREFIXO}/conferencias/${id}/recontagem`, ConferenciaDetalheSchema, { corpo, idempotencia: chave }),
                  (r) => {
                    aoGravar();
                    aoNavegar({ tipo: 'conferencia', id: r.id });
                  },
                );
              }}
            >
              <p className="bloco-nota">
                A recontagem é uma nova conferência vinculada a esta, com justificativa. As observações originais ficam preservadas; a quantidade esperada não é mostrada durante a
                contagem.
              </p>
              <label className="campo">
                <span className="campo-rotulo">Justificativa (obrigatória)</span>
                <textarea value={motivo} rows={2} maxLength={500} onChange={(e) => { setMotivo(e.target.value); }} />
              </label>
              {bloqueioGravacao !== null && <p className="mensagem-conflito">{bloqueioGravacao}</p>}
              <div className="acoes-linha">
                <button type="submit" className="botao-primario" disabled={ocupado || bloqueioGravacao !== null || motivo.trim().length < 3}>
                  Iniciar recontagem
                </button>
                <button type="button" className="botao-link" onClick={() => { setPainel(null); }}>
                  Voltar
                </button>
              </div>
            </form>
          )}

          {painel === 'reconciliar' && (
            <ReconciliacaoConferencia
              sessaoId={id}
              conectado={conectado}
              bloqueioTela={bloqueioGravacao}
              aoReconciliado={(r) => {
                setUltimo(r.session);
                setPainel(null);
                aoGravar();
                setMensagem({
                  tipo: 'ok',
                  texto: `${ROTULOS_EVENTO[r.event.type]} gravado em ${formatarDataHora(r.event.at)}: ${String(r.event.lines.length)} segmento(s) ajustado(s). A liberação não mudou.`,
                });
              }}
              aoConflito={() => {
                setVersao((v) => v + 1);
              }}
              aoFechar={() => {
                setPainel(null);
              }}
            />
          )}
        </section>
      </div>
    </main>
  );
}
