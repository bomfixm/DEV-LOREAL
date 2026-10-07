import {
  API_PREFIXO,
  HistoricoPaleteSchema,
  PaleteDetalheSchema,
  PracaSchema,
  ResultadoMovimentoSchema,
  ResultadoTransferenciaSchema,
  compararQuantidades,
  type HistoricoPalete,
  type Sessao,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { enviarJson } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar, IconeVoltar } from '../../components/Icones';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';
import { ROTULOS_ESCOPO, ROTULOS_MOTIVO, ROTULOS_SITUACAO, formatarDiferenca, textoOrigem } from '../conferencia/rotulos';
import { ROTULOS_CONDICAO } from '../paletes/estados';
import { AvisoMovimento, EscolhaPosicao, SemConexaoMovimento } from './comum';
import { useEnvio, useUltimo } from './use-envio';
import { ROTULOS_EVENTO_ESTOQUE, disponivel, normalizarDigitado, previaSaldo, problemaQuantidade, type Aviso, type PosicaoLivre } from './regras';

interface Props {
  id: string;
  sessao: Sessao;
  aoNavegar: Navegar;
  aoGravar: () => void;
}

type EventoLocal = HistoricoPalete['locationEvents'][number];
type EventoEstoque = HistoricoPalete['stockEvents'][number];

const ROTULOS_LOCALIZACAO = {
  MOVIMENTO: 'Mudança de localização',
  CORRECAO: 'Correção de localização',
  SAIDA_EXPEDICAO: 'Saída na expedição (posição liberada)',
  RETIRADA_VAZIO: 'Palete vazio retirado da posição (consolidação; sem baixa de estoque)',
} as const;
const quando = (iso: string) => `${formatarDataHora(iso)} (Brasília)`;

/** Correção do último movimento: destino validado contra a posição atual e a ocupação (nunca restauração cega). */
function CorrecaoLocalizacao({ evento, versaoPalete, aoCorrigido, aoCancelar }: { evento: EventoLocal; versaoPalete: number; aoCorrigido: (texto: string) => void; aoCancelar: () => void }) {
  const [versao, setVersao] = useState(0);
  const praca = useUltimo(useRecurso(`${API_PREFIXO}/praca`, PracaSchema, versao).carga);
  const [destino, setDestino] = useState<PosicaoLivre | null>(null);
  const [pendente, setPendente] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const envio = useEnvio();
  if (praca === null) return <p className="estado-carregando">Carregando posições…</p>;
  const anteriorLivre =
    evento.from !== null && praca.layout?.positions.some((p) => p.id === evento.from?.id && p.available) && !praca.pallets.some((p) => p.positionId === evento.from?.id);
  const pronto = (destino !== null || pendente) && motivo.trim().length >= 3 && confirmado && envio.conectado && !envio.enviando;
  const mudou = () => {
    setConfirmado(false);
    envio.descartar();
  };

  function confirmar() {
    const corpo = {
      destinationPositionId: pendente ? null : (destino?.id ?? null),
      confirmedPositionCode: pendente ? null : (destino?.codigo ?? null),
      expectedVersion: versaoPalete,
      reason: motivo.trim(),
    };
    setAviso(null);
    void envio.enviar(
      `corrigir-local:${evento.id}:${JSON.stringify(corpo)}`,
      (chave) => enviarJson('POST', `${API_PREFIXO}/movimentos/${evento.id}/correcao`, ResultadoMovimentoSchema, { corpo, idempotencia: chave }),
      (r) => {
        if (r.ok) {
          aoCorrigido(`Correção registrada: palete agora em ${r.dados.event.to?.code ?? 'localização pendente'}. O movimento original continua no histórico.`);
          return;
        }
        setAviso(r.aviso);
        if (!r.aviso.incerto) {
          setConfirmado(false);
          setVersao((v) => v + 1);
          if (r.aviso.tipo === 'destino') setDestino(null);
        }
      },
    );
  }

  return (
    <div className="painel-acao formulario-coluna" data-testid="correcao-localizacao">
      <h4>Corrigir movimentação</h4>
      <p>
        O palete está em <strong>{evento.to?.code ?? 'localização pendente'}</strong> por este movimento. Escolha a posição correta: ela é conferida
        contra a ocupação atual (a posição anterior{evento.from ? `, ${evento.from.code},` : ''} só é sugerida se estiver livre).
      </p>
      {evento.from !== null && anteriorLivre && destino?.id !== evento.from.id && (
        <button
          type="button"
          className="botao-secundario"
          onClick={() => {
            if (evento.from) setDestino({ id: evento.from.id, codigo: evento.from.code, fileira: 'posição anterior' });
            setPendente(false);
            mudou();
          }}
        >
          Usar a posição anterior ({evento.from.code}), que está livre
        </button>
      )}
      {evento.from !== null && !anteriorLivre && <p className="bloco-nota">A posição anterior ({evento.from.code}) não está livre agora: escolha outra.</p>}
      {evento.from === null && (
        <label className="opcao">
          <input
            type="checkbox"
            checked={pendente}
            onChange={(e) => {
              setPendente(e.target.checked);
              setDestino(null);
              mudou();
            }}
          />
          Voltar à localização pendente (como antes do movimento)
        </label>
      )}
      {!pendente && (
        <EscolhaPosicao
          layout={praca.layout}
          paletes={praca.pallets}
          atualId={evento.to?.id ?? null}
          escolhida={destino}
          aoEscolher={(p) => {
            setDestino(p);
            mudou();
          }}
          rotulo="Posição correta"
        />
      )}
      <label className="campo">
        <span className="campo-rotulo">Motivo da correção</span>
        <input value={motivo} maxLength={500} onChange={(e) => { setMotivo(e.target.value); mudou(); }} data-testid="motivo-correcao-local" />
      </label>
      {(destino !== null || pendente) && (
        <label className="opcao opcao--destaque">
          <input type="checkbox" checked={confirmado} onChange={(e) => { setConfirmado(e.target.checked); }} data-testid="confirmar-correcao-local" />
          Confirmo: de {evento.to?.code ?? 'localização pendente'} para {pendente ? 'localização pendente' : destino?.codigo}. Será registrado um novo
          evento vinculado ao original.
        </label>
      )}
      {!envio.conectado && <SemConexaoMovimento />}
      <div className="acoes-linha">
        <button type="button" className="botao-primario" disabled={!pronto} onClick={confirmar} data-testid="enviar-correcao-local">
          {envio.enviando ? 'Enviando…' : 'Registrar correção'}
        </button>
        <button type="button" className="botao-link" onClick={aoCancelar}>
          Cancelar
        </button>
      </div>
      <AvisoMovimento aviso={aviso} podeReenviar={envio.temPendente && envio.conectado} enviando={envio.enviando} aoReenviar={envio.reenviar} testId="aviso-correcao-local" />
    </div>
  );
}

/**
 * Correção de transferência: evento compensatório no sentido inverso, até o
 * que ainda não foi compensado e o disponível atual de quem recebeu. Se o
 * material já foi consumido, reservado ou transferido, nada é restaurado.
 */
function CorrecaoTransferencia({ evento, aoCorrigido, aoCancelar }: { evento: EventoEstoque; aoCorrigido: (texto: string) => void; aoCancelar: () => void }) {
  const [versao, setVersao] = useState(0);
  const recebeu = evento.destination;
  const origem = useUltimo(useRecurso(`${API_PREFIXO}/paletes/${evento.pallet.id}`, PaleteDetalheSchema, versao).carga);
  const quemRecebeu = useUltimo(useRecurso(recebeu ? `${API_PREFIXO}/paletes/${recebeu.id}` : null, PaleteDetalheSchema, versao).carga);
  const [quantidade, setQuantidade] = useState('');
  const [motivo, setMotivo] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const envio = useEnvio();
  const linha = evento.lines.find((l) => l.pallet.id === recebeu?.id);
  if (recebeu === null || linha === undefined) return null;
  if (origem === null || quemRecebeu === null) return <p className="estado-carregando">Carregando saldos atuais…</p>;
  const restante = evento.remainingCompensable ?? '0';
  const atual = quemRecebeu.currentItems?.find((i) => i.segmentId === linha.segmentId) ?? null;
  const livre = atual === null ? '0' : disponivel(atual);
  const limite = compararQuantidades(livre, restante) < 0 ? livre : restante;
  const problema = problemaQuantidade(quantidade, linha.unit, limite, compararQuantidades(livre, restante) < 0 ? 'disponível atual no palete que recebeu' : 'ainda não compensado');
  const previa =
    problema === null ? previaSaldo(linha.segmentId, quantidade, { codigo: recebeu.code, itens: quemRecebeu.currentItems }, { codigo: evento.pallet.code, itens: origem.currentItems }) : null;
  const pronto = previa !== null && motivo.trim().length >= 3 && confirmado && envio.conectado && !envio.enviando;
  const mudou = () => {
    setConfirmado(false);
    envio.descartar();
  };

  function confirmar() {
    if (origem === null || quemRecebeu === null) return;
    const corpo = {
      quantity: normalizarDigitado(quantidade),
      expectedSourceVersion: quemRecebeu.version,
      expectedDestinationVersion: origem.version,
      reason: motivo.trim(),
    };
    setAviso(null);
    void envio.enviar(
      `corrigir-transf:${evento.id}:${JSON.stringify(corpo)}`,
      (chave) => enviarJson('POST', `${API_PREFIXO}/transferencias/${evento.id}/correcao`, ResultadoTransferenciaSchema, { corpo, idempotencia: chave }),
      (r) => {
        if (r.ok) {
          aoCorrigido(`Correção registrada: ${formatarQuantidade(corpo.quantity)} ${linha?.unit ?? ''} voltaram de ${recebeu?.code ?? ''} para ${evento.pallet.code}. A transferência original continua no histórico.`);
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
    <div className="painel-acao formulario-coluna" data-testid="correcao-transferencia">
      <h4>Corrigir transferência</h4>
      <p>
        Devolve quantidade de <strong>{recebeu.code}</strong> (que recebeu) para <strong>{evento.pallet.code}</strong>. Ainda compensável:{' '}
        <strong>
          {formatarQuantidade(restante)} {linha.unit}
        </strong>
        ; disponível hoje em {recebeu.code}: {formatarQuantidade(livre)} {linha.unit}
        {atual !== null && compararQuantidades(atual.reserved, '0') > 0 ? ` (${formatarQuantidade(atual.reserved)} reservado)` : ''}.
      </p>
      {compararQuantidades(livre, '0') <= 0 && (
        <p className="mensagem-conflito" role="note">
          O palete {recebeu.code} não tem mais este material disponível (consumido, reservado ou transferido adiante): a correção não restaura saldos antigos.
        </p>
      )}
      <label className="campo campo--curto">
        <span className="campo-rotulo">Quantidade a devolver ({linha.unit})</span>
        <input value={quantidade} inputMode="decimal" onChange={(e) => { setQuantidade(e.target.value); mudou(); }} data-testid="quantidade-correcao" />
      </label>
      {problema !== null && quantidade.trim() !== '' && (
        <p className="campo-erro" role="alert">
          {problema}
        </p>
      )}
      {previa !== null && (
        <ul className="lista-historico" data-testid="previa-correcao">
          {previa.map((l) => (
            <li key={l.papel}>
              <strong>{l.paleteCodigo}</strong> ({l.papel === 'sai' ? 'devolve' : 'recebe de volta'}): {formatarQuantidade(l.antes)} → {formatarQuantidade(l.depois)} {linha.unit}
            </li>
          ))}
        </ul>
      )}
      <label className="campo">
        <span className="campo-rotulo">Motivo da correção</span>
        <input value={motivo} maxLength={500} onChange={(e) => { setMotivo(e.target.value); mudou(); }} data-testid="motivo-correcao-transf" />
      </label>
      {previa !== null && (
        <label className="opcao opcao--destaque">
          <input type="checkbox" checked={confirmado} onChange={(e) => { setConfirmado(e.target.checked); }} data-testid="confirmar-correcao-transf" />
          Confirmo a correção vinculada à transferência de {quando(evento.at)}.
        </label>
      )}
      {!envio.conectado && <SemConexaoMovimento />}
      <div className="acoes-linha">
        <button type="button" className="botao-primario" disabled={!pronto} onClick={confirmar} data-testid="enviar-correcao-transf">
          {envio.enviando ? 'Enviando…' : 'Registrar correção'}
        </button>
        <button type="button" className="botao-link" onClick={aoCancelar}>
          Cancelar
        </button>
      </div>
      <AvisoMovimento aviso={aviso} podeReenviar={envio.temPendente && envio.conectado} enviando={envio.enviando} aoReenviar={envio.reenviar} testId="aviso-correcao-transf" />
    </div>
  );
}

/**
 * Histórico do palete: localização e conteúdo, com autor, horário (gravado em
 * UTC, exibido no fuso da operação), motivo, origem/destino e correções
 * vinculadas. Nada é apagado nem editado; correção é um novo evento.
 */
export function TelaHistorico({ id, sessao, aoNavegar, aoGravar }: Props) {
  const [versao, setVersao] = useState(0);
  const { carga } = useRecurso(`${API_PREFIXO}/paletes/${id}/historico`, HistoricoPaleteSchema, versao);
  const historico = useUltimo(carga);
  const [corrigindo, setCorrigindo] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const podeCorrigir = sessao.permissions.includes('movimento.corrigir');
  const corrigido = (texto: string) => {
    setCorrigindo(null);
    setMensagem(texto);
    setVersao((v) => v + 1);
    aoGravar();
  };

  if (historico?.pallet.id !== id) {
    return (
      <main className="principal principal--pagina" data-testid="tela-historico">
        <div className="pagina-conteudo">
          {carga?.estado === 'erro' ? (
            <div className="estado-erro estado-tela" role="alert">
              <h2>{carga.status === 404 ? 'Palete não encontrado' : 'Não foi possível carregar o histórico'}</h2>
              <p>{carga.status === 404 ? 'Ele não existe no escopo ativo ou você não tem acesso a ele.' : carga.mensagem}</p>
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
              Carregando histórico…
            </p>
          )}
        </div>
      </main>
    );
  }

  const p = historico.pallet;
  return (
    <main className="principal principal--pagina" data-testid="tela-historico">
      <div className="pagina-conteudo tela-movimento">
        <header className="pagina-topo">
          <button type="button" className="botao-voltar" onClick={() => { aoNavegar({ tipo: 'palete', id }); }}>
            <IconeVoltar />
            Palete {p.code}
          </button>
          <h2>Histórico do palete {p.code}</h2>
          <dl className="situacao">
            <div>
              <dt>ID permanente</dt>
              <dd>
                <code>{p.id}</code>
              </dd>
            </div>
            <div>
              <dt>Cadastro</dt>
              <dd>
                {quando(p.createdAt)} · {p.createdBy?.name ?? 'carga de demonstração'}
              </dd>
            </div>
            <div>
              <dt>Posição no cadastro</dt>
              <dd>{p.initialPosition?.code ?? 'Localização pendente'}</dd>
            </div>
            <div>
              <dt>Posição atual</dt>
              <dd data-testid="historico-posicao-atual">{p.currentPosition?.code ?? 'Localização pendente'}</dd>
            </div>
          </dl>
          <p className="bloco-nota">Horários gravados em UTC e exibidos no horário de Brasília. Movimentações não são apagadas nem editadas: correções aparecem como novos eventos vinculados.</p>
        </header>

        {mensagem !== null && (
          <p className="mensagem-ok" role="status" data-testid="mensagem-historico">
            {mensagem}
          </p>
        )}

        <section className="cartao" aria-labelledby="hist-localizacao" data-testid="historico-localizacao">
          <h3 id="hist-localizacao">Localização ({historico.locationEvents.length})</h3>
          {historico.locationEvents.length === 0 ? (
            <p className="sem-itens">Nenhuma mudança de localização desde o cadastro.</p>
          ) : (
            <ol className="historico-eventos">
              {historico.locationEvents.map((e) => (
                <li key={e.id} className="evento-mov" data-testid="evento-localizacao">
                  <p className="evento-mov-topo">
                    <strong>{ROTULOS_LOCALIZACAO[e.type]}</strong> · {quando(e.at)} · {e.author?.name ?? '—'}
                  </p>
                  <p>
                    {e.from?.code ?? 'Localização pendente'} → <strong>{e.to?.code ?? 'Localização pendente'}</strong> — {e.reason}
                  </p>
                  {e.correctedEventId !== null && <p className="bloco-nota">Corrige um movimento anterior (vínculo preservado).</p>}
                  {e.correctedBy.length > 0 && <p className="bloco-nota">Corrigido em {e.correctedBy.map((c) => quando(c.at)).join(', ')}.</p>}
                  {podeCorrigir && e.latest && corrigindo !== e.id && (
                    <button type="button" className="botao-secundario" onClick={() => { setCorrigindo(e.id); setMensagem(null); }} data-testid="corrigir-localizacao">
                      Corrigir movimentação…
                    </button>
                  )}
                  {corrigindo === e.id && <CorrecaoLocalizacao evento={e} versaoPalete={p.version} aoCorrigido={corrigido} aoCancelar={() => { setCorrigindo(null); }} />}
                </li>
              ))}
            </ol>
          )}
          {!podeCorrigir && historico.locationEvents.length > 0 && <p className="bloco-nota">Correções exigem permissão própria (supervisor de estoque).</p>}
        </section>

        <section className="cartao" aria-labelledby="hist-conteudo" data-testid="historico-conteudo">
          <h3 id="hist-conteudo">Conteúdo ({historico.stockEvents.length})</h3>
          {historico.stockEvents.length === 0 ? (
            <p className="sem-itens">Nenhum evento de saldo validado neste palete.</p>
          ) : (
            <ol className="historico-eventos">
              {historico.stockEvents.map((e) => (
                <li key={e.id} className="evento-mov" data-testid="evento-estoque" data-tipo={e.type}>
                  <p className="evento-mov-topo">
                    <strong>{ROTULOS_EVENTO_ESTOQUE[e.type]}</strong> · {quando(e.at)} · {e.author?.name ?? 'carga de demonstração'}
                    {e.session ? ` · conferência nº ${String(e.session.number)}` : ''}
                  </p>
                  {e.destination !== null && (
                    <p>
                      De{' '}
                      <button type="button" className="botao-link" onClick={() => { aoNavegar({ tipo: 'palete', id: e.pallet.id }); }}>
                        {e.pallet.code}
                      </button>{' '}
                      para{' '}
                      <button type="button" className="botao-link" onClick={() => { if (e.destination) aoNavegar({ tipo: 'palete', id: e.destination.id }); }}>
                        {e.destination.code}
                      </button>
                    </p>
                  )}
                  <p>Motivo: {e.reason}</p>
                  <ul className="lista-historico">
                    {e.lines.map((l) => (
                      <li key={`${l.pallet.id}:${l.segmentId}`}>
                        {e.destination !== null && <strong>{l.pallet.code}: </strong>}
                        {l.sku} · lote {l.lot ?? 'pendente'} · {textoOrigem(l.originType, l.originReference)} · {ROTULOS_CONDICAO[l.condition]} —{' '}
                        {formatarQuantidade(l.before)} → {formatarQuantidade(l.after)} {l.unit} ({formatarDiferenca(l.delta)})
                      </li>
                    ))}
                  </ul>
                  {e.correctedEventId !== null && <p className="bloco-nota">Compensa uma transferência anterior (vínculo preservado).</p>}
                  {e.type === 'TRANSFERENCIA' && e.remainingCompensable !== null && (
                    <p className="bloco-nota" data-testid="restante-compensavel">
                      Ainda compensável por correção: {formatarQuantidade(e.remainingCompensable)} {e.lines[0]?.unit ?? ''}
                      {e.correctedBy.length > 0 ? ` · ${String(e.correctedBy.length)} correção(ões)` : ''}.
                    </p>
                  )}
                  {podeCorrigir && e.type === 'TRANSFERENCIA' && e.remainingCompensable !== null && compararQuantidades(e.remainingCompensable, '0') > 0 && corrigindo !== e.id && (
                    <button type="button" className="botao-secundario" onClick={() => { setCorrigindo(e.id); setMensagem(null); }} data-testid="corrigir-transferencia">
                      Corrigir transferência…
                    </button>
                  )}
                  {corrigindo === e.id && <CorrecaoTransferencia evento={e} aoCorrigido={corrigido} aoCancelar={() => { setCorrigindo(null); }} />}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="cartao" aria-labelledby="hist-conferencias">
          <h3 id="hist-conferencias">Conferências ({historico.sessions.length})</h3>
          {historico.sessions.length === 0 ? (
            <p className="sem-itens">Nenhuma conferência registrada.</p>
          ) : (
            <ul className="lista-historico">
              {historico.sessions.map((s) => (
                <li key={s.id}>
                  <button type="button" className="botao-link" onClick={() => { aoNavegar({ tipo: 'conferencia', id: s.id }); }}>
                    Nº {s.number}
                  </button>{' '}
                  {ROTULOS_MOTIVO[s.kind]} {ROTULOS_ESCOPO[s.scope].texto.toLowerCase()} · {ROTULOS_SITUACAO[s.state].texto} · {quando(s.startedAt)}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
