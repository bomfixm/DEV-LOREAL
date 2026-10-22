import { API_PREFIXO, ReconferenciaPaleteSchema, RegistrarReconferenciaSchema, type ReconferenciaPalete } from '@praca-reversa/contracts';
import { useId, useState } from 'react';
import { useChaves } from '../../api/chaves';
import { enviarJson, mensagemDeFalha } from '../../api/cliente';
import { MensagemAcao } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import { PrazoReconferencia } from '../paletes/PrazoReconferencia';

type Resultado = 'SEM_DIFERENCA' | 'COM_DIFERENCA';

/**
 * Reconferência COMPLETA do palete na conferência de volumes (prazo de 20
 * dias): quem registra confirma que conferiu o palete inteiro; sem diferença
 * também vale. Parcial não renova o prazo. Não muda conferência por SKU,
 * liberação, reserva nem saldo.
 */
export function ReconferenciaCompleta({ paleteId, prazo, conteudos, aoRegistrado }: { paleteId: string; prazo: ReconferenciaPalete; conteudos: number; aoRegistrado: () => void }) {
  const ids = useId();
  const chaves = useChaves();
  const conectado = useConectado();
  const [atual, setAtual] = useState(prazo);
  const [inteiro, setInteiro] = useState(false);
  const [resultado, setResultado] = useState<Resultado>('SEM_DIFERENCA');
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null>(null);

  async function registrar() {
    if (enviando) return;
    if (!conectado) {
      setMensagem({ tipo: 'erro', texto: 'Sem conexão: nada é registrado. Tente quando a rede voltar.' });
      return;
    }
    const corpo = { wholePallet: inteiro, result: resultado, notes: observacao.trim() === '' ? null : observacao.trim() };
    const validacao = RegistrarReconferenciaSchema.safeParse(corpo);
    if (!validacao.success) {
      setMensagem({ tipo: 'erro', texto: validacao.error.issues[0]?.message ?? 'Confira os dados da reconferência.' });
      return;
    }
    const assinatura = `reconferencia:${paleteId}:${JSON.stringify(corpo)}`;
    setEnviando(true);
    setMensagem(null);
    try {
      const novo = await enviarJson('POST', `${API_PREFIXO}/paletes/${paleteId}/reconferencias`, ReconferenciaPaleteSchema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      setAtual(novo);
      setInteiro(false);
      setObservacao('');
      setMensagem({ tipo: 'ok', texto: 'Reconferência completa registrada: novo prazo de 20 dias.' });
      aoRegistrado();
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="cartao reconferencia-completa" aria-labelledby={`${ids}-titulo`} data-testid="reconferencia-completa">
      <h3 id={`${ids}-titulo`}>Reconferência completa do palete</h3>
      <PrazoReconferencia r={atual} aoConferir={null} />
      <p className="campo-ajuda">
        Registre quando o palete inteiro foi conferido (conteúdos e volumes acima). Conferido sem diferença também vale. Conferir só uma parte não renova o prazo; nada muda
        na conferência por SKU, na liberação, na reserva ou no saldo.
      </p>
      <label className="opcao">
        <input
          type="checkbox"
          checked={inteiro}
          onChange={(e) => {
            setInteiro(e.target.checked);
          }}
          data-testid="reconferencia-inteiro"
        />
        Conferi o palete inteiro ({String(conteudos)} {conteudos === 1 ? 'conteúdo' : 'conteúdos'})
      </label>
      <fieldset className="campo">
        <legend className="campo-rotulo">Resultado</legend>
        <label className="opcao">
          <input type="radio" name={`${ids}-resultado`} checked={resultado === 'SEM_DIFERENCA'} onChange={() => { setResultado('SEM_DIFERENCA'); }} data-testid="reconferencia-sem-diferenca" />
          Sem diferença
        </label>
        <label className="opcao">
          <input type="radio" name={`${ids}-resultado`} checked={resultado === 'COM_DIFERENCA'} onChange={() => { setResultado('COM_DIFERENCA'); }} data-testid="reconferencia-com-diferenca" />
          Com diferença (registrada nas contagens acima)
        </label>
      </fieldset>
      <label className="campo">
        <span className="campo-rotulo">Observação (opcional)</span>
        <textarea rows={2} maxLength={500} value={observacao} onChange={(e) => { setObservacao(e.target.value); }} data-testid="reconferencia-observacao" />
      </label>
      <MensagemAcao mensagem={mensagem} testId="mensagem-reconferencia" />
      <button type="button" className="botao-primario" disabled={!inteiro || enviando || !conectado} aria-busy={enviando} onClick={() => void registrar()} data-testid="registrar-reconferencia">
        {enviando ? 'Registrando…' : 'Concluir reconferência completa'}
      </button>
    </section>
  );
}
