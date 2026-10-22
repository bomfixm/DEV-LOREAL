import { API_PREFIXO, AcaoConteudosSchema, ResultadoAcaoConteudosSchema, ResolverValidacaoSchema, type ResultadoAcaoConteudos } from '@praca-reversa/contracts';
import { useId, useState } from 'react';
import { useChaves } from '../../api/chaves';
import { FalhaRequisicao, enviarJson, mensagemDeFalha } from '../../api/cliente';
import { MensagemAcao } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import { EscolherNoMapa, type DestinoEscolhido } from '../mapa/EscolherNoMapa';
import './correcoes.css';

export interface OcorrenciaSelecionada {
  kind: 'REGISTRADO' | 'IMPORTADO';
  id: string;
  documento: string;
  volumes: number | null;
}

type Acao = 'MOVER' | 'VALIDACAO' | 'CANCELAR';
type Mensagem = { tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null;

const ROTULO: Readonly<Record<Acao, string>> = {
  MOVER: 'Mover para outro palete/posição',
  VALIDACAO: 'Enviar para validação (sem endereço)',
  CANCELAR: 'Cancelar registro incorreto',
};

/**
 * Ações sobre os conteúdos selecionados (perfis internos com conteudo.corrigir):
 * uma confirmação cobre o conjunto; nada muda antes da resposta do servidor.
 * `paleteId` nulo = resolver pendências da validação (só o destino).
 */
export function AcoesConteudo({
  paleteId,
  selecionados,
  aoConcluido,
  apenasResolver = false,
}: {
  paleteId: string | null;
  selecionados: readonly OcorrenciaSelecionada[];
  aoConcluido: (r: ResultadoAcaoConteudos) => void;
  apenasResolver?: boolean;
}) {
  const ids = useId();
  const chaves = useChaves();
  const conectado = useConectado();
  const [acao, setAcao] = useState<Acao | null>(apenasResolver ? 'MOVER' : null);
  const [destino, setDestino] = useState<DestinoEscolhido | null>(null);
  const [motivo, setMotivo] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [confirmarOcupado, setConfirmarOcupado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const volumes = selecionados.reduce((t, s) => t + (s.volumes ?? 0), 0);
  const semVolumes = selecionados.filter((s) => s.volumes === null).length;
  const itens = selecionados.map((s) => ({ kind: s.kind, id: s.id }));

  const reiniciar = (nova: Acao | null) => {
    setAcao(nova);
    setDestino(null);
    setMotivo('');
    setConfirmado(false);
    setConfirmarOcupado(null);
    setMensagem(null);
  };

  async function enviar(confirmOccupied: boolean) {
    if (acao === null) return;
    if (!conectado) {
      setMensagem({ tipo: 'erro', texto: 'Sem conexão: nada foi alterado.' });
      return;
    }
    const razao = motivo.trim() === '' ? null : motivo.trim();
    const corpo = apenasResolver
      ? { items: itens, destination: destino?.destino, confirmOccupied, reason: razao }
      : acao === 'MOVER'
        ? { action: 'MOVER', items: itens, destination: destino?.destino, confirmOccupied, reason: razao }
        : acao === 'VALIDACAO'
          ? { action: 'VALIDACAO', items: itens, reason: motivo }
          : { action: 'CANCELAR', items: itens, reason: motivo, confirm: confirmado };
    const valido = (apenasResolver ? ResolverValidacaoSchema : AcaoConteudosSchema).safeParse(corpo);
    if (!valido.success) {
      setMensagem({ tipo: 'erro', texto: valido.error.issues[0]?.message ?? 'Revise a ação.' });
      return;
    }
    const url = apenasResolver || paleteId === null ? `${API_PREFIXO}/validacao/resolver` : `${API_PREFIXO}/paletes/${paleteId}/conteudos/acoes`;
    const assinatura = `${url}:${JSON.stringify(corpo)}`;
    setOcupado(true);
    setMensagem(null);
    try {
      const r = await enviarJson('POST', url, ResultadoAcaoConteudosSchema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      reiniciar(apenasResolver ? 'MOVER' : null);
      aoConcluido(r);
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      if (erro instanceof FalhaRequisicao && erro.codigo === 'CONFIRMAR_DESTINO') {
        setConfirmarOcupado(erro.message);
        return;
      }
      setMensagem({ tipo: erro instanceof FalhaRequisicao && (erro.codigo === 'CONJUNTO_ALTERADO' || erro.codigo === 'JANELA_VINCULADA') ? 'conflito' : 'erro', texto: mensagemDeFalha(erro) });
    } finally {
      setOcupado(false);
    }
  }

  if (selecionados.length === 0) return null;
  const resumo = `${String(selecionados.length)} conteúdo(s) selecionado(s) · ${String(volumes)} volume(s)${semVolumes > 0 ? ` + ${String(semVolumes)} sem quantidade` : ''}`;

  return (
    <section className="acoes-conteudo" aria-labelledby={`${ids}-titulo`} data-testid="acoes-conteudo">
      <h3 id={`${ids}-titulo`} className="acoes-conteudo-titulo" data-testid="acoes-resumo">
        {resumo}
      </h3>
      {!apenasResolver && (
        <div className="acoes-linha">
          {(['MOVER', 'VALIDACAO', 'CANCELAR'] as const).map((a) => (
            <button
              key={a}
              type="button"
              className={acao === a ? 'botao-primario' : 'botao-secundario'}
              aria-pressed={acao === a}
              onClick={() => {
                reiniciar(acao === a ? null : a);
              }}
              data-testid={`acao-${a.toLowerCase()}`}
            >
              {ROTULO[a]}
            </button>
          ))}
        </div>
      )}

      {acao === 'MOVER' && (
        <div className="acoes-conteudo-painel">
          {destino === null ? (
            <EscolherNoMapa
              excluirPaleteId={paleteId}
              aoEscolher={(d) => {
                setDestino(d);
                setConfirmarOcupado(null);
              }}
            />
          ) : (
            <p data-testid="acao-destino">
              Destino: <strong>{destino.descricao}</strong>{' '}
              <button
                type="button"
                className="botao-link"
                onClick={() => {
                  setDestino(null);
                  setConfirmarOcupado(null);
                }}
              >
                Trocar
              </button>
            </p>
          )}
          <label className="campo">
            <span className="campo-rotulo">Motivo (opcional)</span>
            <input value={motivo} maxLength={300} onChange={(e) => { setMotivo(e.target.value); }} placeholder="Ex.: estava no palete errado" />
          </label>
          {confirmarOcupado !== null && (
            <p className="mensagem-conflito" role="alert" data-testid="acao-confirmar-ocupado">
              {confirmarOcupado}
            </p>
          )}
          <div className="acoes-linha">
            {confirmarOcupado === null ? (
              <button type="button" className="botao-primario" disabled={ocupado || destino === null} onClick={() => void enviar(false)} data-testid="acao-mover-confirmar">
                {apenasResolver ? `Alocar ${String(selecionados.length)} no destino` : `Mover ${String(selecionados.length)} conteúdo(s)`}
              </button>
            ) : (
              <button type="button" className="botao-primario" disabled={ocupado} onClick={() => void enviar(true)} data-testid="acao-acrescentar">
                Acrescentar ao palete de destino
              </button>
            )}
          </div>
        </div>
      )}

      {acao === 'VALIDACAO' && (
        <div className="acoes-conteudo-painel">
          <p className="campo-ajuda">Os conteúdos saem do estoque físico deste palete e vão para a fila interna “Validação urgente — sem endereço”, com a quantidade e o histórico. Nada é expedido nem baixado.</p>
          <label className="campo">
            <span className="campo-rotulo">Motivo</span>
            <input value={motivo} maxLength={300} required onChange={(e) => { setMotivo(e.target.value); }} placeholder="Ex.: não encontrado no palete na conferência" data-testid="acao-motivo" />
          </label>
          <button type="button" className="botao-primario" disabled={ocupado || motivo.trim().length < 3} onClick={() => void enviar(false)} data-testid="acao-validacao-confirmar">
            Enviar {selecionados.length} para a validação
          </button>
        </div>
      )}

      {acao === 'CANCELAR' && (
        <div className="acoes-conteudo-painel">
          <p className="campo-ajuda">Use só para registro errado (cadastro ou importação). Se o material existe mas o local é desconhecido, envie para a validação. O registro fica no histórico com o motivo e quem cancelou; outras ocorrências da mesma nota não mudam.</p>
          <label className="campo">
            <span className="campo-rotulo">Motivo</span>
            <input value={motivo} maxLength={300} required onChange={(e) => { setMotivo(e.target.value); }} placeholder="Ex.: lançado em duplicidade" data-testid="acao-motivo" />
          </label>
          <label className="conf-check">
            <input type="checkbox" checked={confirmado} onChange={(e) => { setConfirmado(e.target.checked); }} data-testid="acao-cancelar-confirmo" />
            Confirmo que {selecionados.length === 1 ? 'este registro está' : `estes ${String(selecionados.length)} registros estão`} incorreto{selecionados.length === 1 ? '' : 's'} ({volumes} volume(s) saem do estoque ativo).
          </label>
          <button type="button" className="botao-perigo" disabled={ocupado || motivo.trim().length < 3 || !confirmado} onClick={() => void enviar(false)} data-testid="acao-cancelar-confirmar">
            Cancelar {selecionados.length} registro(s)
          </button>
        </div>
      )}
      <MensagemAcao mensagem={mensagem} testId="acoes-mensagem" />
      {ocupado && (
        <p className="estado-carregando" role="status">
          Gravando…
        </p>
      )}
    </section>
  );
}
