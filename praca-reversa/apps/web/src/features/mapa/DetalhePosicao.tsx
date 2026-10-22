import { API_PREFIXO, ResultadoPosicaoLivreSchema, type OrigemPosicaoLivre, type Posicao } from '@praca-reversa/contracts';
import { useState, type Ref } from 'react';
import { useChaves } from '../../api/chaves';
import { FalhaRequisicao, enviarJson, mensagemDeFalha } from '../../api/cliente';
import { IconeVoltar } from '../../components/Icones';
import { MensagemAcao } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import { formatarDataHora } from '../../utils/datas';
import { ocupacaoSemPalete } from './controlador-mapa';

const ORIGEM: Readonly<Record<OrigemPosicaoLivre, string>> = {
  CONFIRMACAO: 'conferida vazia no local',
  MOVIMENTO: 'palete movido para outra posição',
  EXPEDICAO: 'palete expedido',
  RETIRADA_VAZIO: 'palete vazio retirado',
};

interface Props {
  posicao: Posicao;
  /** Fileira e bloco/zona da posição, para orientação. */
  local: string | null;
  compacto: boolean;
  podeRegistrar: boolean;
  /** Cadastro de palete com esta posição já escolhida; `null` sem permissão de cadastro. */
  aoReceberPalete: (() => void) | null;
  tituloRef: Ref<HTMLHeadingElement>;
  aoFechar: () => void;
  /** Depois da gravação confirmada: mapa e lista consultam de novo. */
  aoAlterado: () => void;
}

/**
 * Posição escolhida no mapa sem palete por cima. "Palete livre" só com a
 * desocupação confirmada (no local, ou por movimento/saída/retirada
 * registrados): sem palete registrado não basta, pois pode haver palete ainda
 * sem endereço informado.
 */
export function DetalhePosicao({ posicao, local, compacto, podeRegistrar, aoReceberPalete, tituloRef, aoFechar, aoAlterado }: Props) {
  const chaves = useChaves();
  const conectado = useConectado();
  const [conferida, setConferida] = useState(false);
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null>(null);
  const ocupacao = ocupacaoSemPalete(posicao);
  const endereco = posicao.address?.state === 'CONFIRMADO' ? posicao.address.text : null;
  const podeMarcar = podeRegistrar && ocupacao !== 'livre' && ocupacao !== 'desativada' && ocupacao !== 'indisponivel';

  async function registrar() {
    const corpo = { confirmedEmpty: true as const, note: observacao.trim() === '' ? null : observacao.trim() };
    const assinatura = `livre:${posicao.id}:${corpo.note ?? ''}`;
    setEnviando(true);
    setMensagem(null);
    try {
      await enviarJson('POST', `${API_PREFIXO}/posicoes/${posicao.id}/livre`, ResultadoPosicaoLivreSchema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      setMensagem({ tipo: 'ok', texto: 'Posição registrada como palete livre.' });
      aoAlterado();
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      setMensagem({ tipo: erro instanceof FalhaRequisicao && erro.status === 409 ? 'conflito' : 'erro', texto: mensagemDeFalha(erro) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <article className="detalhe" aria-labelledby="posicao-titulo" data-testid="detalhe-posicao" data-posicao={posicao.code}>
      <header className="detalhe-topo">
        {compacto && (
          <button type="button" className="botao-voltar" onClick={aoFechar}>
            <IconeVoltar />
            Voltar ao mapa
          </button>
        )}
        <p className="detalhe-sobretitulo">Posição</p>
        <h2 id="posicao-titulo" ref={tituloRef} tabIndex={-1}>
          {endereco ?? posicao.code}
        </h2>
        <p className="detalhe-local">
          {endereco !== null && <>Posição {posicao.code}</>}
          {local !== null && <>{endereco !== null ? ' · ' : ''}{local}</>}
        </p>
        {!compacto && (
          <div className="detalhe-acoes">
            <button type="button" className="botao-link" onClick={aoFechar}>
              Fechar
            </button>
          </div>
        )}
      </header>
      <section className="detalhe-secao">
        {ocupacao === 'livre' && posicao.freeConfirmed ? (
          <div className="aviso-posicao-livre" data-testid="posicao-livre">
            <p>
              <strong>PALETE LIVRE</strong> — pronta para receber um palete.
            </p>
            <p className="tabela-nota">
              Desocupação confirmada em {formatarDataHora(posicao.freeConfirmed.at)} ({ORIGEM[posicao.freeConfirmed.origin]}). Deixa de ser livre assim que um palete for
              registrado aqui.
            </p>
            {aoReceberPalete !== null && (
              <button type="button" className="botao-primario" onClick={aoReceberPalete} data-testid="receber-palete">
                Receber palete aqui
              </button>
            )}
          </div>
        ) : ocupacao === 'desativada' ? (
          <p>Área desativada: fora das posições livres até ser ativada na configuração do layout.</p>
        ) : ocupacao === 'indisponivel' ? (
          <p>Indisponível{posicao.unavailableReason ? `: ${posicao.unavailableReason}` : ''}. Não recebe paletes.</p>
        ) : (
          <p data-testid="posicao-sem-confirmacao">
            {ocupacao === 'sem-registro' ? 'Sem palete registrado' : 'Ocupação desconhecida (sem levantamento)'}: isso não comprova que a posição está vazia — pode haver
            palete ainda sem endereço informado.
          </p>
        )}
        {podeMarcar && (
          <form
            className="formulario-coluna"
            onSubmit={(e) => {
              e.preventDefault();
              void registrar();
            }}
          >
            <label className="opcao">
              <input type="checkbox" checked={conferida} onChange={(e) => { setConferida(e.target.checked); }} data-testid="posicao-conferida" />
              Conferi no local: a posição está vazia
            </label>
            <label className="campo">
              <span className="campo-rotulo">Observação (opcional)</span>
              <input value={observacao} maxLength={300} onChange={(e) => { setObservacao(e.target.value); }} />
            </label>
            <button type="submit" className="botao-primario" disabled={!conferida || enviando || !conectado} data-testid="registrar-livre">
              {enviando ? 'Gravando…' : 'Registrar como palete livre'}
            </button>
            <p className="campo-ajuda">Se houver um palete aqui, registre-o na posição (Mover palete) em vez de marcar como livre.</p>
          </form>
        )}
        <MensagemAcao mensagem={mensagem} testId="mensagem-posicao" />
      </section>
    </article>
  );
}
