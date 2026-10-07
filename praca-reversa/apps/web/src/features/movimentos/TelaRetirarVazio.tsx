import { API_PREFIXO, PaleteDetalheSchema, ResultadoMovimentoSchema, compararQuantidades, type ResultadoMovimento, type Sessao } from '@praca-reversa/contracts';
import { useState } from 'react';
import { enviarJson } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar, IconeVoltar } from '../../components/Icones';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { AjudaTarefa } from '../ajuda/AjudaTarefa';
import { ROTULOS_CONFERENCIA } from '../paletes/estados';
import { AvisoMovimento, SemConexaoMovimento } from './comum';
import { useEnvio, useUltimo } from './use-envio';
import type { Aviso } from './regras';

interface Props {
  id: string;
  sessao: Sessao;
  aoNavegar: Navegar;
  aoGravar: () => void;
}

/**
 * Retirar palete vazio (etapa 10; consolidação, T29): depois de transferir
 * todo o conteúdo para outro palete, o palete físico vazio sai da posição.
 * Nenhuma unidade sai do estoque; o ID e o código ficam arquivados. A tela
 * mostra as condições, mas quem decide é o servidor (saldo zero, sem reserva
 * nem vínculo, conferência completa reconciliada, sem conferência em andamento).
 */
export function TelaRetirarVazio({ id, sessao, aoNavegar, aoGravar }: Props) {
  const [versao, setVersao] = useState(0);
  const carga = useRecurso(`${API_PREFIXO}/paletes/${id}`, PaleteDetalheSchema, versao);
  const palete = useUltimo(carga.carga);
  const [motivo, setMotivo] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [resultado, setResultado] = useState<ResultadoMovimento | null>(null);
  const envio = useEnvio();
  const voltar = () => {
    aoNavegar({ tipo: 'palete', id });
  };

  if (palete === null) {
    const erro = carga.carga?.estado === 'erro' ? carga.carga : null;
    return (
      <main className="principal principal--pagina" data-testid="tela-retirar">
        <div className="pagina-conteudo">
          {erro ? (
            <div className="estado-erro estado-tela" role="alert">
              <h2>{erro.status === 404 ? 'Palete não encontrado' : 'Não foi possível carregar o palete'}</h2>
              <p>{erro.status === 404 ? 'Ele não existe no escopo ativo ou você não tem acesso a ele.' : erro.mensagem}</p>
              <button type="button" className="botao-primario" onClick={() => { setVersao((v) => v + 1); }}>
                <IconeAtualizar />
                Tentar novamente
              </button>
            </div>
          ) : (
            <p className="estado-carregando" aria-busy="true">
              Carregando palete…
            </p>
          )}
        </div>
      </main>
    );
  }

  if (resultado !== null) {
    return (
      <main className="principal principal--pagina" data-testid="tela-retirar">
        <div className="pagina-conteudo">
          <section className="cartao cartao-sucesso" role="status" data-testid="retirada-confirmada">
            <h2>Palete vazio retirado</h2>
            <p>
              O palete <strong>{resultado.pallet.code}</strong> saiu da posição <strong>{resultado.event.from?.code ?? '—'}</strong> em {formatarDataHora(resultado.event.at)} (horário
              de Brasília). A posição ficou livre no mapa; nenhuma unidade saiu do estoque.
            </p>
            <p className="bloco-nota">O ID e o código ficam arquivados e não são reutilizados. O histórico do palete continua consultável pelo ID.</p>
            <div className="acoes-linha">
              <button type="button" className="botao-primario" onClick={() => { aoNavegar({ tipo: 'praca' }); }}>
                Voltar ao mapa
              </button>
              <button type="button" className="botao-secundario" onClick={() => { aoNavegar({ tipo: 'historico', id }); }}>
                Ver histórico
              </button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const itens = palete.currentItems ?? [];
  const comSaldo = itens.filter((i) => compararQuantidades(i.quantity, '0') > 0 || compararQuantidades(i.reserved, '0') > 0 || compararQuantidades(i.claimLinked, '0') > 0);
  const impedimentos: string[] = [];
  if (palete.archived !== null) impedimentos.push('Cadastro arquivado: já está fora da praça.');
  if (palete.flowState === 'EXPEDIDO') impedimentos.push('Palete expedido: já saiu da praça.');
  if (palete.activeCountId !== null) impedimentos.push('Há conferência em andamento neste palete.');
  if (palete.positionId === null && palete.archived === null) impedimentos.push('O palete não ocupa posição: não há endereço a liberar.');
  if (comSaldo.length > 0) {
    impedimentos.push(`Ainda há saldo validado, reserva ou vínculo em ${String(comSaldo.length)} item(ns): transfira o conteúdo para outro palete antes ("Transferir produtos").`);
  }
  if (palete.countState !== 'RECONCILIADO') {
    impedimentos.push(`Conteúdo não totalmente conhecido (${ROTULOS_CONFERENCIA[palete.countState].texto}): faça e reconcilie uma conferência completa que registre o palete vazio. Conteúdo desconhecido nunca é presumido vazio.`);
  }
  const motivoValido = motivo.trim().length >= 3;
  const pronto = impedimentos.length === 0 && motivoValido && confirmado && envio.conectado && !envio.enviando;

  function confirmar() {
    if (palete === null) return;
    const corpo = { expectedVersion: palete.version, reason: motivo.trim(), confirmEmpty: true as const };
    setAviso(null);
    void envio.enviar(
      `retirar:${id}:${JSON.stringify(corpo)}`,
      (chave) => enviarJson('POST', `${API_PREFIXO}/paletes/${id}/retirada-vazio`, ResultadoMovimentoSchema, { corpo, idempotencia: chave, descricao: `Retirar palete vazio ${palete.code}` }),
      (r) => {
        if (r.ok) {
          setResultado(r.dados);
          aoGravar();
          return;
        }
        setAviso(r.aviso);
        if (!r.aviso.incerto) {
          setConfirmado(false);
          setVersao((v) => v + 1);
        }
      },
    );
  }

  return (
    <main className="principal principal--pagina" data-testid="tela-retirar">
      <div className="pagina-conteudo tela-movimento">
        <header className="pagina-topo">
          <button type="button" className="botao-voltar" onClick={voltar}>
            <IconeVoltar />
            Palete {palete.code}
          </button>
          <h2>Retirar palete vazio {palete.code}</h2>
          <p className="bloco-nota">
            Use depois de uma consolidação, quando todo o conteúdo já foi transferido para outro palete e o palete físico ficou vazio. Não é saída de estoque:
            nenhuma quantidade muda.
          </p>
        </header>
        <AjudaTarefa tarefa="mover" />
        <section className="cartao" aria-labelledby="retirar-palete">
          <h3 id="retirar-palete">Palete</h3>
          <dl className="situacao">
            <div>
              <dt>Endereço atual</dt>
              <dd data-testid="retirar-endereco">{palete.positionCode ?? 'Localização pendente'}</dd>
            </div>
            <div>
              <dt>Conferência</dt>
              <dd>{ROTULOS_CONFERENCIA[palete.countState].texto}</dd>
            </div>
            <div>
              <dt>Saldo validado</dt>
              <dd>{comSaldo.length === 0 ? 'Nenhum item com saldo' : `${String(comSaldo.length)} item(ns) com saldo, reserva ou vínculo`}</dd>
            </div>
          </dl>
          {impedimentos.length > 0 ? (
            <ul className="mensagem-conflito lista-impedimentos" role="alert" data-testid="retirar-impedimentos">
              {impedimentos.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          ) : (
            <p className="mensagem-ok">O palete atende às condições. Confirme fisicamente que ele está vazio antes de retirar.</p>
          )}
        </section>

        {impedimentos.length === 0 && (
          <section className="cartao previa-movimento" aria-labelledby="retirar-confirmar">
            <h3 id="retirar-confirmar">Motivo e confirmação</h3>
            <label className="campo">
              <span className="campo-rotulo">Motivo da retirada</span>
              <input
                value={motivo}
                maxLength={500}
                onChange={(e) => {
                  setMotivo(e.target.value);
                  setConfirmado(false);
                  envio.descartar();
                }}
                placeholder="Ex.: conteúdo consolidado no palete PAL-…"
                data-testid="motivo-retirar"
              />
            </label>
            <dl className="situacao">
              <div>
                <dt>Responsável</dt>
                <dd>{sessao.user.name}</dd>
              </div>
              <div>
                <dt>Posição que fica livre</dt>
                <dd>{palete.positionCode ?? '—'}</dd>
              </div>
            </dl>
            <label className="opcao opcao--destaque">
              <input type="checkbox" checked={confirmado} onChange={(e) => { setConfirmado(e.target.checked); }} data-testid="confirmar-vazio" />
              Confirmo que o palete físico {palete.code} está vazio e foi retirado da posição {palete.positionCode ?? ''}.
            </label>
            {!envio.conectado && <SemConexaoMovimento />}
            <div className="acoes-linha">
              <button type="button" className="botao-primario" disabled={!pronto} onClick={confirmar} data-testid="confirmar-retirada">
                {envio.enviando ? 'Enviando…' : 'Retirar palete vazio'}
              </button>
              <button type="button" className="botao-link" onClick={voltar}>
                Cancelar
              </button>
            </div>
          </section>
        )}
        <AvisoMovimento aviso={aviso} podeReenviar={envio.temPendente && envio.conectado} enviando={envio.enviando} aoReenviar={envio.reenviar} testId="aviso-retirar" />
      </div>
    </main>
  );
}
