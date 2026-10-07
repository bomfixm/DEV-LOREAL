import { API_PREFIXO, PaleteDetalheSchema, PracaSchema, ResultadoMovimentoSchema, type PaleteDetalhe, type Praca, type ResultadoMovimento, type Sessao } from '@praca-reversa/contracts';
import { useState } from 'react';
import { enviarJson } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar, IconeVoltar } from '../../components/Icones';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { ROTULOS_CONFERENCIA } from '../paletes/estados';
import { AvisoMovimento, EscolhaPosicao, SemConexaoMovimento } from './comum';
import { useEnvio, useUltimo } from './use-envio';
import { MOTIVOS_SUGERIDOS, type Aviso, type PosicaoLivre } from './regras';
import { AjudaTarefa } from '../ajuda/AjudaTarefa';

interface Props {
  id: string;
  sessao: Sessao;
  aoNavegar: Navegar;
  /** Depois de uma gravação confirmada: mapa e lista consultam de novo. */
  aoGravar: () => void;
}

/**
 * Mover palete: muda só o endereço. ID, código, QR, conteúdo e conferência
 * continuam os mesmos. Prévia explícita e confirmação da posição atribuída;
 * o servidor valida escopo, disponibilidade, ocupação, versão e conferência.
 */
export function TelaMover({ id, sessao, aoNavegar, aoGravar }: Props) {
  const [versao, setVersao] = useState(0);
  const cargaPalete = useRecurso(`${API_PREFIXO}/paletes/${id}`, PaleteDetalheSchema, versao);
  const cargaPraca = useRecurso(`${API_PREFIXO}/praca`, PracaSchema, versao);
  const palete: PaleteDetalhe | null = useUltimo(cargaPalete.carga);
  const praca: Praca | null = useUltimo(cargaPraca.carga);
  const [destino, setDestino] = useState<PosicaoLivre | null>(null);
  const [motivo, setMotivo] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [resultado, setResultado] = useState<ResultadoMovimento | null>(null);
  const envio = useEnvio();

  const voltar = () => {
    aoNavegar({ tipo: 'palete', id });
  };

  if (palete === null || praca === null) {
    const erro = cargaPalete.carga?.estado === 'erro' ? cargaPalete.carga : cargaPraca.carga?.estado === 'erro' ? cargaPraca.carga : null;
    return (
      <main className="principal principal--pagina" data-testid="tela-mover">
        <div className="pagina-conteudo">
          {erro ? (
            <div className="estado-erro estado-tela" role="alert">
              <h2>{erro.status === 404 ? 'Palete não encontrado' : 'Não foi possível carregar os dados'}</h2>
              <p>{erro.status === 404 ? 'Ele não existe no escopo ativo ou você não tem acesso a ele.' : erro.mensagem}</p>
              <div className="acoes-linha">
                <button type="button" className="botao-primario" onClick={() => { setVersao((v) => v + 1); }}>
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
              Carregando palete e posições…
            </p>
          )}
        </div>
      </main>
    );
  }

  const bloqueio =
    palete.archived !== null
      ? 'Cadastro arquivado: não é movido.'
      : palete.activeCountId !== null
        ? 'Há conferência em andamento neste palete: a localização fica bloqueada até ela ser concluída ou cancelada.'
        : null;
  const motivoValido = motivo.trim().length >= 3;
  const pronto = bloqueio === null && destino !== null && motivoValido && confirmado && envio.conectado && !envio.enviando;

  function confirmar() {
    if (palete === null || destino === null) return;
    const corpo = { destinationPositionId: destino.id, confirmedPositionCode: destino.codigo, expectedVersion: palete.version, reason: motivo.trim() };
    setAviso(null);
    void envio.enviar(
      `mover:${id}:${JSON.stringify(corpo)}`,
      (chave) => enviarJson('POST', `${API_PREFIXO}/paletes/${id}/movimentos`, ResultadoMovimentoSchema, { corpo, idempotencia: chave }),
      (r) => {
        if (r.ok) {
          setResultado(r.dados);
          aoGravar();
          return;
        }
        setAviso(r.aviso);
        if (r.aviso.tipo === 'destino') setDestino(null);
        if (!r.aviso.incerto) {
          setConfirmado(false);
          setVersao((v) => v + 1);
        }
      },
    );
  }

  if (resultado !== null) {
    const e = resultado.event;
    return (
      <main className="principal principal--pagina" data-testid="tela-mover">
        <div className="pagina-conteudo">
          <section className="cartao cartao-sucesso" role="status" data-testid="movimento-confirmado">
            <h2>Movimentação registrada</h2>
            <p>
              Palete <strong>{resultado.pallet.code}</strong> agora em <strong>{e.to?.code ?? 'localização pendente'}</strong> (antes:{' '}
              {e.from?.code ?? 'localização pendente'}). Registrado em {formatarDataHora(e.at)} (horário de Brasília) por {e.author?.name ?? '—'}.
            </p>
            <p className="bloco-nota">
              O ID permanente, o código e o QR não mudaram; conteúdo e conferência continuam os mesmos. A posição anterior ficou sem o vínculo
              deste palete — isso não confirma que a área física esteja vazia.
            </p>
            <div className="acoes-linha">
              <button type="button" className="botao-primario" onClick={voltar}>
                Ver o palete no mapa
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

  const estado = ROTULOS_CONFERENCIA[palete.countState];
  return (
    <main className="principal principal--pagina" data-testid="tela-mover">
      <div className="pagina-conteudo tela-movimento">
        <header className="pagina-topo">
          <button type="button" className="botao-voltar" onClick={voltar}>
            <IconeVoltar />
            Palete {palete.code}
          </button>
          <h2>Mover palete {palete.code}</h2>
          <p className="bloco-nota">Muda só o endereço. Arrastar o mapa continua mexendo apenas na visão; a movimentação é esta ação, com confirmação.</p>
        </header>
        <AjudaTarefa tarefa="mover" />

        <section className="cartao" aria-labelledby="mover-atual">
          <h3 id="mover-atual">Palete</h3>
          <dl className="situacao">
            <div>
              <dt>Código permanente</dt>
              <dd>
                <strong>{palete.code}</strong>
              </dd>
            </div>
            <div>
              <dt>ID permanente (QR)</dt>
              <dd>
                <code>{palete.id}</code>
              </dd>
            </div>
            <div>
              <dt>Endereço atual</dt>
              <dd data-testid="endereco-atual">{palete.positionCode ?? 'Localização pendente'}</dd>
            </div>
            <div>
              <dt>Conferência</dt>
              <dd>{estado.texto}</dd>
            </div>
          </dl>
          {bloqueio !== null && (
            <p className="mensagem-conflito" role="alert" data-testid="mover-bloqueado">
              {bloqueio}{' '}
              {palete.activeCountId !== null && (
                <button type="button" className="botao-link" onClick={() => { if (palete.activeCountId) aoNavegar({ tipo: 'conferencia', id: palete.activeCountId }); }}>
                  Abrir a conferência
                </button>
              )}
            </p>
          )}
        </section>

        {bloqueio === null && (
          <section className="cartao" aria-labelledby="mover-destino">
            <h3 id="mover-destino">Destino e motivo</h3>
            <EscolhaPosicao
              layout={praca.layout}
              paletes={praca.pallets}
              atualId={palete.positionId}
              escolhida={destino}
              aoEscolher={(p) => {
                setDestino(p);
                setConfirmado(false);
                envio.descartar();
              }}
              rotulo="Posição de destino (digite ou leia o código, ou toque numa posição livre)"
            />
            <label className="campo">
              <span className="campo-rotulo">Motivo da movimentação</span>
              <input
                value={motivo}
                maxLength={500}
                list="motivos-mover"
                onChange={(e) => {
                  setMotivo(e.target.value);
                  setConfirmado(false);
                  envio.descartar();
                }}
                data-testid="motivo-mover"
              />
              <datalist id="motivos-mover">
                {MOTIVOS_SUGERIDOS.mover.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          </section>
        )}

        {bloqueio === null && destino !== null && (
          <section className="cartao previa-movimento" aria-labelledby="mover-previa" data-testid="previa-movimento">
            <h3 id="mover-previa">Revise antes de confirmar</h3>
            <dl className="situacao">
              <div>
                <dt>Palete</dt>
                <dd>{palete.code}</dd>
              </div>
              <div>
                <dt>De</dt>
                <dd>{palete.positionCode ?? 'Localização pendente'}</dd>
              </div>
              <div>
                <dt>Para</dt>
                <dd data-testid="previa-destino">
                  <strong>{destino.codigo}</strong> · {destino.fileira}
                </dd>
              </div>
              <div>
                <dt>Responsável</dt>
                <dd>{sessao.user.name}</dd>
              </div>
              <div>
                <dt>Motivo</dt>
                <dd>{motivoValido ? motivo.trim() : 'Informe o motivo (3 a 500 caracteres).'}</dd>
              </div>
            </dl>
            <label className="opcao opcao--destaque">
              <input type="checkbox" checked={confirmado} onChange={(e) => { setConfirmado(e.target.checked); }} data-testid="confirmar-posicao" />
              Confirmo que o palete {palete.code} está (ou ficará agora) fisicamente na posição {destino.codigo}.
            </label>
            {!envio.conectado && <SemConexaoMovimento />}
            <div className="acoes-linha">
              <button type="button" className="botao-primario" disabled={!pronto} onClick={confirmar} data-testid="confirmar-movimento">
                {envio.enviando ? 'Enviando…' : 'Confirmar movimentação'}
              </button>
              <button type="button" className="botao-link" onClick={voltar}>
                Cancelar
              </button>
            </div>
          </section>
        )}

        <AvisoMovimento aviso={aviso} podeReenviar={envio.temPendente && envio.conectado} enviando={envio.enviando} aoReenviar={envio.reenviar} testId="aviso-mover" />
      </div>
    </main>
  );
}
