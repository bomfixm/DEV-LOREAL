import {
  API_PREFIXO,
  AnexoJanelaSchema,
  JanelaDetalheSchema,
  PaginaHistoricoJanelaSchema,
  type JanelaDetalhe,
  type Permissao,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { useChaves } from '../../api/chaves';
import { baixarArquivo, enviarArquivo, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar } from '../../components/Icones';
import { MensagemAcao, Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import type { AbaJanela, Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { useAcoes, useUltimoPronto } from './acoes';
import { Capacidade } from './Capacidade';
import { ROTULOS_CONDICAO, ROTULOS_EVENTO_JANELA, ROTULOS_ORIGEM, ROTULOS_PREPARACAO, ROTULOS_SITUACAO_JANELA, ROTULOS_SITUACAO_RESERVA, q } from './rotulos';
import { SelecaoMaterial } from './SelecaoMaterial';

const ABAS: { aba: AbaJanela; rotulo: string }[] = [
  { aba: 'resumo', rotulo: 'Resumo e capacidade' },
  { aba: 'material', rotulo: 'Material elegível e pendente' },
  { aba: 'reservas', rotulo: 'Reservas e expedições' },
  { aba: 'historico', rotulo: 'Histórico' },
];

function Resumo({ j, permissoes, aoNavegar, aoAtualizar, recarregar }: { j: JanelaDetalhe; permissoes: readonly Permissao[]; aoNavegar: Navegar; aoAtualizar: (d: JanelaDetalhe) => void; recarregar: () => void }) {
  const conectado = useConectado();
  const acoes = useAcoes(recarregar);
  const chaves = useChaves();
  const [painel, setPainel] = useState<'encerrar' | 'cancelar' | null>(null);
  const [motivo, setMotivo] = useState('');
  const [liberar, setLiberar] = useState(false);
  const [envioAnexo, setEnvioAnexo] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const pode = (p: Permissao) => permissoes.includes(p);
  const aberta = j.state !== 'ENCERRADA' && j.state !== 'CANCELADA';
  const ocupado = acoes.enviando !== null || !conectado;
  const c = j.criteria;
  return (
    <div className="secao-janela" data-testid="secao-resumo">
      <section className="cartao" aria-label="Capacidade">
        <h3>Capacidade por métrica</h3>
        <Capacidade restricoes={j.restrictions} />
        <p className="campo-ajuda">Restante = limite autorizado − reservas ativas − expedições confirmadas. Consolidar paletes reduz posições ocupadas, mas não é volume expedido.</p>
      </section>
      {j.pendencies.length > 0 && (
        <section className="cartao cartao-confirmacao--pendente" data-testid="pendencias-janela">
          <h3>Pendências para reservar/expedir</h3>
          <ul className="linha-avisos">
            {j.pendencies.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="cartao">
        <h3>Autorização do cliente</h3>
        <dl className="claim-dados">
          <div>
            <dt>Fonte</dt>
            <dd>{j.authorization.source ?? 'pendente'}</dd>
          </div>
          <div>
            <dt>Referência</dt>
            <dd>{j.authorization.reference ?? 'pendente'}</dd>
          </div>
          <div>
            <dt>Data</dt>
            <dd>{j.authorization.date ? j.authorization.date.split('-').reverse().join('/') : 'pendente'}</dd>
          </div>
          <div>
            <dt>Responsável</dt>
            <dd>{j.authorization.responsible ?? 'pendente'}</dd>
          </div>
          <div>
            <dt>Confirmada</dt>
            <dd>{j.confirmed ? `${formatarDataHora(j.confirmed.at)} por ${j.confirmed.by.name}` : 'não'}</dd>
          </div>
        </dl>
        <h4>Anexos privados ({j.attachments.length})</h4>
        {j.attachments.length > 0 && (
          <ul className="lista-anexos">
            {j.attachments.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="botao-link"
                  onClick={() => {
                    void baixarArquivo(`${API_PREFIXO}/janelas/${j.id}/anexos/${a.id}`, a.name).catch((e: unknown) => {
                      setEnvioAnexo({ tipo: 'erro', texto: mensagemDeFalha(e) });
                    });
                  }}
                >
                  {a.name}
                </button>{' '}
                <span className="campo-ajuda">
                  ({Math.ceil(a.size / 1024)} KB · {a.uploadedBy.name} · {formatarDataHora(a.uploadedAt)})
                </span>
              </li>
            ))}
          </ul>
        )}
        {aberta && (pode('janela.gerenciar') || pode('expedicao.preparar') || pode('expedicao.confirmar') || pode('expedicao.retorno')) && (
          <label className="campo">
            <span className="campo-rotulo">Anexar evidência (PDF ou foto)</span>
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              disabled={!conectado}
              data-testid="anexo-janela"
              onChange={(e) => {
                const arquivo = e.target.files?.[0];
                e.target.value = '';
                if (!arquivo) return;
                setEnvioAnexo(null);
                const assinatura = `anexo:${j.id}:${arquivo.name}:${String(arquivo.size)}`;
                enviarArquivo(`${API_PREFIXO}/janelas/${j.id}/anexos`, arquivo, arquivo.name, AnexoJanelaSchema, chaves.para(assinatura)).then(
                  () => {
                    chaves.concluir(assinatura);
                    setEnvioAnexo({ tipo: 'ok', texto: 'Anexo enviado (privado).' });
                    recarregar();
                  },
                  (erro: unknown) => {
                    chaves.concluir(assinatura, erro);
                    setEnvioAnexo({ tipo: 'erro', texto: mensagemDeFalha(erro) });
                  },
                );
              }}
            />
          </label>
        )}
        <MensagemAcao mensagem={envioAnexo} testId="mensagem-anexo-janela" />
      </section>
      <section className="cartao">
        <h3>Critérios de material e documentos (regras v{j.rulesVersion})</h3>
        {c.defined ? (
          <ul className="lista-criterios">
            <li>Condições aceitas: {c.acceptedConditions.map((x) => ROTULOS_CONDICAO[x]).join(', ')}</li>
            <li>Origem: {c.acceptedOriginTypes === null ? 'qualquer tipo' : c.acceptedOriginTypes.map((o) => ROTULOS_ORIGEM[o]).join(', ')}{c.requireOrigin ? ' · origem comprovada exigida' : ''}</li>
            <li>Lote: {c.requireLot ? 'lote conhecido exigido' : 'não exigido'}</li>
            <li>Documentos exigidos: {c.requiredDocuments.length === 0 ? 'nenhum informado' : c.requiredDocuments.join(', ')}</li>
            {c.notes && <li>Outros: {c.notes}</li>}
          </ul>
        ) : (
          <p className="selo selo-alerta">Critérios pendentes</p>
        )}
        {j.ruleVersions.length > 1 && (
          <details className="campo-ajuda">
            <summary>Versões das regras ({j.ruleVersions.length})</summary>
            <ul>
              {j.ruleVersions.map((v) => (
                <li key={v.version}>
                  v{v.version} · {formatarDataHora(v.at)} · {v.by.name}
                  {v.justification ? ` · ${v.justification}` : ''}
                  {v.source ? ` (fonte: ${v.source})` : ''} · limites: {v.snapshot.restrictions.map((r) => `${r.metric} ${r.limit ?? 'pendente'}`).join(', ') || 'nenhum'}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {pode('janela.gerenciar') && aberta && (
        <section className="cartao" aria-label="Ações da janela">
          <div className="acoes-linha">
            <button type="button" className="botao-secundario" onClick={() => { aoNavegar({ tipo: 'editar-janela', id: j.id }); }} data-testid="editar-janela">
              Alterar dados/regras
            </button>
            {j.state === 'RASCUNHO' && (
              <button
                type="button"
                className="botao-primario"
                disabled={ocupado}
                data-testid="confirmar-janela"
                onClick={() => {
                  void acoes
                    .executar(`confirmar:${j.id}`, 'POST', `${API_PREFIXO}/janelas/${j.id}/confirmar`, { expectedVersion: j.version }, JanelaDetalheSchema, 'Janela confirmada (autorização registrada).')
                    .then((d) => {
                      if (d) aoAtualizar(d);
                    });
                }}
              >
                Confirmar janela
              </button>
            )}
            {j.state !== 'RASCUNHO' && (
              <button type="button" className="botao-secundario" onClick={() => { setPainel('encerrar'); }} data-testid="abrir-encerrar">
                Encerrar janela
              </button>
            )}
            {j.expeditions === 0 && (
              <button type="button" className="botao-perigo" onClick={() => { setPainel('cancelar'); }} data-testid="abrir-cancelar-janela">
                Cancelar janela
              </button>
            )}
          </div>
          {painel !== null && (
            <form
              className="painel-acao"
              onSubmit={(e) => {
                e.preventDefault();
                void acoes
                  .executar(
                    `${painel}:${j.id}`,
                    'POST',
                    `${API_PREFIXO}/janelas/${j.id}/${painel}`,
                    { expectedVersion: j.version, reason: motivo, releaseActiveReservations: liberar },
                    JanelaDetalheSchema,
                    painel === 'encerrar' ? 'Janela encerrada.' : 'Janela cancelada.',
                  )
                  .then((d) => {
                    if (d) {
                      setPainel(null);
                      aoAtualizar(d);
                    }
                  });
              }}
            >
              <label className="campo">
                <span className="campo-rotulo">Motivo ({painel === 'encerrar' ? 'encerramento' : 'cancelamento'})</span>
                <input value={motivo} maxLength={500} onChange={(e) => { setMotivo(e.target.value); }} data-testid="motivo-encerrar" />
              </label>
              {j.activeReservations > 0 && (
                <label className="campo--linha">
                  <input type="checkbox" checked={liberar} onChange={(e) => { setLiberar(e.target.checked); }} data-testid="liberar-reservas" />
                  <span>Liberar explicitamente as {j.activeReservations} reserva(s) ativa(s) (estoque e capacidade voltam; reservas ficam no histórico)</span>
                </label>
              )}
              <div className="acoes-linha">
                <button type="submit" className="botao-primario" disabled={ocupado || motivo.trim().length < 3} data-testid="confirmar-encerrar">
                  Confirmar
                </button>
                <button type="button" className="botao-link" onClick={() => { setPainel(null); }}>
                  Voltar
                </button>
              </div>
            </form>
          )}
        </section>
      )}
      <MensagemAcao mensagem={acoes.mensagem} testId="mensagem-acao-janela" />
    </div>
  );
}

function Reservas({ j, aoNavegar }: { j: JanelaDetalhe; aoNavegar: Navegar }) {
  return (
    <div className="secao-janela" data-testid="secao-reservas">
      <section className="cartao">
        <h3>Reservas ({j.reservations.length})</h3>
        {j.reservations.length === 0 && <p className="estado-vazio">Nenhuma reserva nesta janela.</p>}
        <ul className="lista-reservas">
          {j.reservations.map((r) => (
            <li key={r.id}>
              <button type="button" className="item-reserva" onClick={() => { aoNavegar({ tipo: 'reserva', id: r.id }); }} data-testid="item-reserva" data-situacao={r.state}>
                <strong>{r.code}</strong>
                <span className={`selo selo-reserva selo-reserva--${r.state}`}>
                  {ROTULOS_SITUACAO_RESERVA[r.state]}
                  {r.partial ? ' · conclusão parcial' : ''}
                </span>
                <span>{r.state === 'ATIVA' ? ROTULOS_PREPARACAO[r.preparation] : ''}</span>
                <span>
                  {r.lineCount} linha(s) · {r.palletCount} palete(s)
                </span>
                <span>{r.metrics.map((m) => `${q(m.value)} ${m.unit}`).join(' · ')}</span>
                <span className="campo-ajuda">
                  {formatarDataHora(r.createdAt)} · {r.createdBy.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="cartao">
        <h3>Expedições confirmadas ({j.expeditionsList.length})</h3>
        {j.expeditionsList.length === 0 && <p className="estado-vazio">Nenhuma saída confirmada.</p>}
        <ul className="lista-reservas">
          {j.expeditionsList.map((e) => (
            <li key={e.id}>
              <button type="button" className="item-reserva" onClick={() => { aoNavegar({ tipo: 'expedicao', id: e.id }); }} data-testid="item-expedicao">
                <strong>{e.code}</strong>
                <span className="selo selo-ok">Expedida{e.partial ? ' (parcial)' : ''}</span>
                <span>Reserva {e.reservationCode}</span>
                <span>Saída {formatarDataHora(e.shippedAt)}</span>
                <span>{e.returns > 0 ? `${String(e.returns)} retorno(s)` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Historico({ j }: { j: JanelaDetalhe }) {
  const [pagina, setPagina] = useState(1);
  const h = useRecurso(`${API_PREFIXO}/janelas/${j.id}/historico?pagina=${String(pagina)}&tamanho=30`, PaginaHistoricoJanelaSchema);
  const dados = h.carga?.estado === 'pronto' ? h.carga.dados : null;
  return (
    <section className="cartao" data-testid="secao-historico-janela">
      <h3>Histórico</h3>
      {h.carga?.estado === 'erro' && <p className="estado-erro">{h.carga.mensagem}</p>}
      {dados && (
        <>
          <ol className="lista-historico-claim">
            {dados.items.map((e) => (
              <li key={e.id}>
                <strong>{ROTULOS_EVENTO_JANELA[e.type]}</strong> · {formatarDataHora(e.at)} · {e.by.name}
                <p>{e.summary}</p>
              </li>
            ))}
          </ol>
          <nav className="paginacao" aria-label="Páginas do histórico">
            <button type="button" className="botao-secundario botao-compacto" disabled={pagina <= 1} onClick={() => { setPagina(pagina - 1); }}>
              Anterior
            </button>
            <span>
              {dados.total} evento(s)
            </span>
            <button type="button" className="botao-secundario botao-compacto" disabled={pagina * 30 >= dados.total} onClick={() => { setPagina(pagina + 1); }}>
              Próxima
            </button>
          </nav>
        </>
      )}
    </section>
  );
}

/**
 * Detalhe da janela: situação, saída autorizada, capacidade por métrica,
 * pendências, autorização e anexos privados, critérios versionados; fila de
 * material elegível/pendente com seleção e reserva; reservas, expedições e
 * histórico. A seção fica no endereço (/janelas/<id>?aba=…).
 */
export function TelaJanela({ id, aba, permissoes, aoNavegar, aoGravar }: { id: string; aba: AbaJanela | null; permissoes: readonly Permissao[]; aoNavegar: Navegar; aoGravar: () => void }) {
  const [versao, setVersao] = useState(0);
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/janelas/${id}`, JanelaDetalheSchema, versao);
  const [proprio, setProprio] = useState<{ versao: number; j: JanelaDetalhe } | null>(null);
  const carregada = useUltimoPronto(carga);
  const j = proprio?.versao === versao ? proprio.j : carregada;
  const abaAtual = aba ?? 'resumo';
  const voltar = () => {
    aoNavegar({ tipo: 'janelas', mes: j?.referenceMonth ?? null });
  };
  const recarregarTudo = () => {
    setProprio(null);
    setVersao((v) => v + 1);
  };
  if (j === null) {
    return (
      <Pagina titulo="Janela" testId="tela-janela" aoVoltar={voltar} rotuloVoltar="Voltar às janelas">
        {carga?.estado === 'erro' ? (
          <div className="estado-erro" role="alert">
            <p>{carga.mensagem}</p>
            <button type="button" className="botao-secundario" onClick={recarregar}>
              <IconeAtualizar />
              Tentar novamente
            </button>
          </div>
        ) : (
          <p className="estado-carregando">Carregando janela…</p>
        )}
      </Pagina>
    );
  }
  return (
    <Pagina ajuda="janela"
      titulo={`${j.code} · ${j.name}`}
      testId="tela-janela"
      aoVoltar={voltar}
      rotuloVoltar="Voltar às janelas"
      descricao={
        <p>
          <span className={`selo selo-janela selo-janela--${j.state}`} data-testid="situacao-janela">
            {ROTULOS_SITUACAO_JANELA[j.state]}
          </span>{' '}
          Saída autorizada: {j.exitStart === null ? 'pendente' : `${formatarDataHora(j.exitStart)} a ${formatarDataHora(j.exitEnd ?? j.exitStart)}`} ({j.timeZone})
          {j.preparationDeadline ? ` · preparar até ${formatarDataHora(j.preparationDeadline)}` : ''}
          {j.clientReference ? ` · ref. ${j.clientReference}` : ''}
          {j.dataSource === 'DEMONSTRACAO_FICTICIA' ? ' · dados fictícios' : ''}
        </p>
      }
    >
      <div className="abas-claim" role="tablist" aria-label="Seções da janela">
        {ABAS.map((a) => (
          <button
            key={a.aba}
            type="button"
            role="tab"
            aria-selected={abaAtual === a.aba}
            onClick={() => {
              aoNavegar({ tipo: 'janela', id, aba: a.aba }, { substituir: true });
            }}
            data-testid={`aba-janela-${a.aba}`}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {abaAtual === 'resumo' && (
          <Resumo
            j={j}
            permissoes={permissoes}
            aoNavegar={aoNavegar}
            recarregar={recarregarTudo}
            aoAtualizar={(d) => {
              setProprio({ versao, j: d });
              aoGravar();
            }}
          />
        )}
        {abaAtual === 'material' && (
          <SelecaoMaterial
            janela={j}
            permissoes={permissoes}
            aoNavegar={aoNavegar}
            aoReservar={(reservaId) => {
              recarregarTudo();
              aoGravar();
              aoNavegar({ tipo: 'reserva', id: reservaId });
            }}
            aoRecarregarJanela={recarregarTudo}
          />
        )}
        {abaAtual === 'reservas' && <Reservas j={j} aoNavegar={aoNavegar} />}
        {abaAtual === 'historico' && <Historico j={j} />}
      </div>
      <p className="campo-ajuda">
        Consultado em {formatarDataHora(j.consultedAt)} · versão {j.version} · regras v{j.rulesVersion} · criada por {j.createdBy.name} em {formatarDataHora(j.createdAt)}
      </p>
    </Pagina>
  );
}
