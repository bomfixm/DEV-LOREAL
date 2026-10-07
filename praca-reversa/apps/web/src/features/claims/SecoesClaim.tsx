import {
  API_PREFIXO,
  AnexoSchema,
  PaginaHistoricoClaimSchema,
  RespostaCandidatosSchema,
  situacaoFinal,
  subtrairQuantidades,
  type Anexo,
  type Candidato,
  type ClaimDetalhe,
  type Compatibilidade,
  type LinhaClaim,
  type RespostaCandidatos,
  type TipoResultado,
} from '@praca-reversa/contracts';
import { useId, useState, type ReactNode } from 'react';
import { useChaves } from '../../api/chaves';
import { baixarArquivo, enviarArquivo, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeArquivo, IconeAtualizar } from '../../components/Icones';
import { formatarDataHora } from '../../utils/datas';
import { ROTULOS_CONDICAO } from '../paletes/estados';
import { formatarQuantidade } from '../../utils/numeros';
import {
  ROTULOS_BASE,
  ROTULOS_COMPAT,
  ROTULOS_EVENTO,
  ROTULOS_ORIGEM,
  ROTULOS_SITUACAO_EVIDENCIA,
  ROTULOS_TIPO_EVIDENCIA,
  ROTULOS_TIPO_RESULTADO,
  formatarDataInformada,
  formatarValor,
} from './rotulos';
import type { PropsSecao } from './TelaClaim';

const q = (v: string | null, unidade: string | null = null) => (v === null ? '—' : `${formatarQuantidade(v)}${unidade ? ` ${unidade}` : ''}`);
const decimal = (t: string) => t.trim().replace(',', '.');

function origemTexto(tipo: keyof typeof ROTULOS_ORIGEM | null, ref: string | null, linha: string | null = null): string {
  if (ref === null) return 'origem pendente';
  return `${tipo ? ROTULOS_ORIGEM[tipo] : 'Origem'} ${ref}${linha ? ` · linha ${linha}` : ''}`;
}

/** Botão que abre um pequeno formulário de ação (texto e campos extras). */
function AcaoInline({
  rotulo,
  testId,
  desativado,
  children,
  aoConfirmar,
  rotuloConfirmar = 'Confirmar',
}: {
  rotulo: string;
  testId: string;
  desativado: boolean;
  children: (fechar: () => void) => ReactNode;
  aoConfirmar: () => Promise<boolean>;
  rotuloConfirmar?: string;
}) {
  const [aberto, setAberto] = useState(false);
  if (!aberto) {
    return (
      <button type="button" className="botao-secundario botao-compacto" disabled={desativado} onClick={() => { setAberto(true); }} data-testid={testId}>
        {rotulo}
      </button>
    );
  }
  return (
    <form
      className="painel-acao"
      onSubmit={(e) => {
        e.preventDefault();
        void aoConfirmar().then((ok) => {
          if (ok) setAberto(false);
        });
      }}
      data-testid={`${testId}-form`}
    >
      {children(() => {
        setAberto(false);
      })}
      <div className="acoes-linha">
        <button type="submit" className="botao-primario botao-compacto" disabled={desativado} data-testid={`${testId}-confirmar`}>
          {rotuloConfirmar}
        </button>
        <button type="button" className="botao-link" onClick={() => { setAberto(false); }}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Selo({ c, rotulo }: { c: Compatibilidade; rotulo: string }) {
  return (
    <span className={`selo selo-compat selo-compat--${c}`}>
      <span aria-hidden="true">{ROTULOS_COMPAT[c].marcador}</span> {rotulo} {ROTULOS_COMPAT[c].texto}
    </span>
  );
}

function SeletorLinha({ caso, linhaId, aoEscolherLinha }: Pick<PropsSecao, 'caso' | 'linhaId' | 'aoEscolherLinha'>) {
  if (caso.lines.length <= 1) return null;
  return (
    <label className="campo campo--compacto">
      <span className="campo-rotulo">Linha do caso</span>
      <select value={linhaId ?? ''} onChange={(e) => { aoEscolherLinha(e.target.value); }} data-testid="seletor-linha">
        {caso.lines.map((l) => (
          <option key={l.id} value={l.id}>
            Linha {l.lineRef} · {l.sku} · {q(l.quantity, l.unit)}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---------- Linhas ----------

function CartaoLinha({ l, children }: { l: LinhaClaim; children?: ReactNode }) {
  return (
    <li className="cartao-linha-claim" data-testid="linha-claim" data-linha={l.lineRef}>
      <p className="cartao-linha-claim-topo">
        <strong>Linha {l.lineRef}</strong> · SKU {l.sku}
        {l.description ? ` · ${l.description}` : ''}
      </p>
      <dl className="claim-dados">
        <div>
          <dt>Em análise</dt>
          <dd>{q(l.quantity, l.unit)}</dd>
        </div>
        <div>
          <dt>Recuperação física validada</dt>
          <dd data-testid="linha-recuperada">{q(l.recovered, l.unit)}</dd>
        </div>
        <div>
          <dt>Sem recuperação validada</dt>
          <dd data-testid="linha-restante">{q(l.remaining, l.unit)}</dd>
        </div>
        <div>
          <dt>Com resultado</dt>
          <dd>
            {q(l.covered, l.unit)} (regularizado {q(l.coveredRegularized)}, perda {q(l.coveredLoss)})
          </dd>
        </div>
        <div>
          <dt>Lote</dt>
          <dd>
            {l.lot ?? 'não informado'}
            {l.lotRequired ? ' (exigido)' : ''}
          </dd>
        </div>
        <div>
          <dt>Origem</dt>
          <dd>{origemTexto(l.originType, l.originReference, l.originLine)}</dd>
        </div>
        <div>
          <dt>Valor estimado</dt>
          <dd>
            {l.estimatedValue === null
              ? 'não informado'
              : `${formatarValor(l.estimatedValue, null)} ${l.valueBase === 'UNITARIO' ? 'por unidade' : 'total da linha'} → ${formatarValor(l.estimateTotal ?? '0', null)}`}
          </dd>
        </div>
      </dl>
      {l.pendencies.length > 0 && (
        <ul className="lista-pendencias-claim">
          {l.pendencies.map((p) => (
            <li key={p.code} className={p.blocksValidation ? 'pendencia-bloqueio' : undefined}>
              {p.message}
            </li>
          ))}
        </ul>
      )}
      {children}
    </li>
  );
}

export function SecaoLinhas({ caso, aoEscolherLinha }: PropsSecao) {
  return (
    <ul className="lista-linhas-claim">
      {caso.lines.map((l) => (
        <CartaoLinha key={l.id} l={l}>
          <div className="acoes-linha">
            <button type="button" className="botao-secundario botao-compacto" onClick={() => { aoEscolherLinha(l.id, 'candidatos'); }} data-testid="ver-candidatos">
              Ver candidatos
            </button>
            <button type="button" className="botao-secundario botao-compacto" onClick={() => { aoEscolherLinha(l.id, 'evidencias'); }}>
              Evidências
            </button>
          </div>
        </CartaoLinha>
      ))}
    </ul>
  );
}

// ---------- Candidatos ----------

function CartaoCandidato({ c, props, linha }: { c: Candidato; props: PropsSecao; linha: LinhaClaim }) {
  const { caso, acoes, conectado, permissoes, aoNavegar } = props;
  const [quantidade, setQuantidade] = useState(c.eligible && c.eligible !== '0' ? c.eligible : '');
  const [descricao, setDescricao] = useState('');
  const podeTratar = permissoes.includes('claim.tratar') && !situacaoFinal(caso.state);
  const desativado = !conectado || acoes.enviando !== null;
  const base = `${API_PREFIXO}/claims/${caso.id}`;
  return (
    <li className={`cartao-candidato${c.validatable ? ' cartao-candidato--validavel' : ''}`} data-testid="candidato" data-base={c.base} data-palete={c.pallet?.code ?? ''}>
      <p className="cartao-candidato-topo">
        <span className="selo selo-base-claim">{ROTULOS_BASE[c.base]}</span>{' '}
        {c.pallet ? (
          <>
            <strong>Palete {c.pallet.code}</strong> · {c.pallet.positionCode ?? 'localização pendente'}
            {c.pallet.archived ? ' · arquivado' : ''}
          </>
        ) : c.document ? (
          <>
            <strong>
              Documento {c.document.reference} · linha {c.document.lineReference}
            </strong>{' '}
            (sem palete)
          </>
        ) : null}
        {c.investigationId && <span className="selo selo-alerta"> em investigação</span>}
      </p>
      <p className="cartao-candidato-dados">
        {c.product ? `${c.product.sku} · ${c.product.description}` : ''} · {q(c.quantity, c.unit)}
        {c.base === 'SALDO_VALIDADO' && ` · elegível ${q(c.eligible)} (vinculado ${q(c.linked)}, reservado ${q(c.reserved)})`} · lote {c.lot ?? 'pendente'} ·{' '}
        {origemTexto(c.originType, c.originReference)} · condição {c.condition ? ROTULOS_CONDICAO[c.condition].toLowerCase() : 'não informada'}
        {c.evidenceAt ? ` · registro de ${formatarDataHora(c.evidenceAt)}` : ''}
      </p>
      <p className="selos-compat" aria-label="Compatibilidade com a linha">
        <Selo c={c.checks.product} rotulo="produto" /> <Selo c={c.checks.lot} rotulo="lote" /> <Selo c={c.checks.origin} rotulo="origem" />{' '}
        <Selo c={c.checks.condition} rotulo="condição" />
      </p>
      {c.clues.length > 0 && (
        <ul className="lista-pistas">
          {c.clues.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {c.blockers.length > 0 && (
        <ul className="lista-bloqueios-claim" data-testid="bloqueios-candidato">
          {c.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      <div className="acoes-linha">
        {c.pallet && (
          <button
            type="button"
            className="botao-secundario botao-compacto"
            onClick={() => {
              if (c.pallet) aoNavegar({ tipo: 'palete', id: c.pallet.id, claim: { id: caso.id, linha: linha.id } });
            }}
            data-testid="ver-no-mapa"
          >
            {c.pallet.positionId ? 'Ver no mapa' : 'Abrir palete (sem posição no mapa)'}
          </button>
        )}
        {podeTratar && c.investigationId === null && c.base !== 'HISTORICO' && (
          <button
            type="button"
            className="botao-secundario botao-compacto"
            disabled={desativado}
            onClick={() => {
              void acoes.executar(
                `candidato:${c.key}`,
                'POST',
                `${base}/candidatos`,
                {
                  lineId: linha.id,
                  base: c.base,
                  palletId: c.pallet?.id ?? null,
                  segmentId: c.segmentId,
                  sessionId: c.session?.id ?? null,
                  documentLineId: c.document?.id ?? null,
                },
                'Candidato registrado na investigação.',
              );
            }}
            data-testid="investigar-candidato"
          >
            Investigar
          </button>
        )}
        {podeTratar && c.base === 'SALDO_VALIDADO' && c.pallet && c.segmentId && (
          <AcaoInline
            rotulo="Registrar evidência (material conferido)"
            testId="evidencia-material"
            desativado={desativado}
            aoConfirmar={async () =>
              (await acoes.executar(
                `evidencia:${c.key}:${quantidade}:${descricao}`,
                'POST',
                `${base}/evidencias`,
                {
                  lineId: linha.id,
                  type: 'MATERIAL_CONFERIDO',
                  candidateId: c.investigationId,
                  palletId: c.pallet?.id,
                  segmentId: c.segmentId,
                  quantity: decimal(quantidade),
                  description: descricao,
                },
                'Evidência registrada. Solicite a validação na aba de evidências.',
              )) !== null
            }
          >
            {() => (
              <>
                <label className="campo campo--compacto">
                  <span className="campo-rotulo">Quantidade conferida ({c.unit})</span>
                  <input value={quantidade} inputMode="decimal" onChange={(e) => { setQuantidade(e.target.value); }} data-testid="evidencia-quantidade" />
                </label>
                <label className="campo">
                  <span className="campo-rotulo">O que foi conferido (mín. 10 caracteres)</span>
                  <textarea value={descricao} rows={2} maxLength={2000} onChange={(e) => { setDescricao(e.target.value); }} data-testid="evidencia-descricao" />
                </label>
              </>
            )}
          </AcaoInline>
        )}
        {podeTratar && c.base === 'DOCUMENTO' && c.document && (
          <AcaoInline
            rotulo="Registrar como evidência documental"
            testId="evidencia-documento"
            desativado={desativado}
            aoConfirmar={async () =>
              (await acoes.executar(
                `evidencia-doc:${c.key}:${descricao}`,
                'POST',
                `${base}/evidencias`,
                { lineId: linha.id, type: 'DOCUMENTO', documentLineId: c.document?.id, description: descricao },
                'Evidência documental registrada (não comprova presença física).',
              )) !== null
            }
          >
            {() => (
              <label className="campo">
                <span className="campo-rotulo">Descrição (mín. 10 caracteres)</span>
                <textarea value={descricao} rows={2} maxLength={2000} onChange={(e) => { setDescricao(e.target.value); }} />
              </label>
            )}
          </AcaoInline>
        )}
      </div>
    </li>
  );
}

export function SecaoCandidatos(props: PropsSecao) {
  const { caso, linhaId, acoes, conectado, permissoes, versao } = props;
  const [pagina, setPagina] = useState(1);
  const [nota, setNota] = useState('');
  const linha = caso.lines.find((l) => l.id === linhaId);
  const { carga, recarregar } = useRecurso(
    linha ? `${API_PREFIXO}/claims/${caso.id}/linhas/${linha.id}/candidatos?pagina=${String(pagina)}&tamanho=10` : null,
    RespostaCandidatosSchema,
    versao + caso.version,
  );
  // Enquanto recarrega (depois de uma ação), a lista anterior da mesma linha continua visível.
  const [ultimo, setUltimo] = useState<{ linha: string; dados: RespostaCandidatos } | null>(null);
  if (carga?.estado === 'pronto' && ultimo?.dados !== carga.dados) setUltimo({ linha: carga.dados.lineId, dados: carga.dados });
  const dados = carga?.estado === 'pronto' ? carga.dados : ultimo !== null && ultimo.linha === linha?.id ? ultimo.dados : null;
  if (!linha) return <p className="estado-vazio">Caso sem linhas.</p>;
  const registrados = caso.candidates.filter((c) => c.lineId === linha.id);
  const podeTratar = permissoes.includes('claim.tratar') && !situacaoFinal(caso.state);
  const paginas = dados ? Math.max(1, Math.ceil(dados.total / dados.pageSize)) : 1;
  return (
    <section className="secao-claim" data-testid="secao-candidatos">
      <SeletorLinha caso={caso} linhaId={linhaId} aoEscolherLinha={props.aoEscolherLinha} />
      <p className="campo-ajuda">
        Linha {linha.lineRef}: SKU {linha.sku}, lote {linha.lot ?? 'não informado'}
        {linha.lotRequired ? ' (exigido)' : ''}, {origemTexto(linha.originType, linha.originReference, linha.originLine)}.
      </p>
      {registrados.length > 0 && (
        <div className="cartao">
          <h3>Em investigação nesta linha</h3>
          <ul className="lista-candidatos">
            {registrados.map((r) => (
              <li key={r.id} className="cartao-candidato" data-testid="candidato-registrado">
                <p>
                  <strong>{ROTULOS_BASE[r.base]}</strong>
                  {r.pallet ? ` · palete ${r.pallet.code}` : ''} · {r.state === 'DESCARTADO' ? `descartado: ${r.discardedReason ?? ''}` : 'em investigação'} · por {r.registeredBy.name} em{' '}
                  {formatarDataHora(r.registeredAt)}
                </p>
                {r.conference && (
                  <p className="campo-ajuda">
                    Conferência solicitada por {r.conference.requestedBy.name} ({formatarDataHora(r.conference.requestedAt)}): {r.conference.note}
                    {r.conference.session ? ` · vinculada à conferência nº ${String(r.conference.session.number)} (${r.conference.session.state})` : ''}
                  </p>
                )}
                {podeTratar && r.state === 'EM_INVESTIGACAO' && (
                  <div className="acoes-linha">
                    {r.pallet && (
                      <AcaoInline
                        rotulo="Solicitar conferência/recontagem"
                        testId="solicitar-conferencia"
                        desativado={!conectado || acoes.enviando !== null}
                        aoConfirmar={async () =>
                          (await acoes.executar(
                            `conferencia:${r.id}:${nota}`,
                            'POST',
                            `${API_PREFIXO}/claims/${caso.id}/candidatos/${r.id}/conferencia`,
                            { expectedVersion: r.version, sessionId: null, note: nota },
                            'Solicitação registrada. A conferência segue o fluxo normal do palete.',
                          )) !== null
                        }
                      >
                        {() => (
                          <label className="campo">
                            <span className="campo-rotulo">O que conferir</span>
                            <input value={nota} maxLength={1000} onChange={(e) => { setNota(e.target.value); }} />
                          </label>
                        )}
                      </AcaoInline>
                    )}
                    <AcaoInline
                      rotulo="Descartar"
                      testId="descartar-candidato"
                      desativado={!conectado || acoes.enviando !== null}
                      aoConfirmar={async () =>
                        (await acoes.executar(
                          `descartar:${r.id}:${nota}`,
                          'POST',
                          `${API_PREFIXO}/claims/${caso.id}/candidatos/${r.id}/descartar`,
                          { expectedVersion: r.version, reason: nota },
                          'Candidato descartado (o registro fica no histórico).',
                        )) !== null
                      }
                    >
                      {() => (
                        <label className="campo">
                          <span className="campo-rotulo">Motivo do descarte</span>
                          <input value={nota} maxLength={1000} onChange={(e) => { setNota(e.target.value); }} />
                        </label>
                      )}
                    </AcaoInline>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {carga?.estado === 'erro' && (
        <div className="estado-erro" role="alert">
          <p>Candidatos indisponíveis. {carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {carga?.estado === 'carregando' && dados === null && <p className="estado-carregando">Procurando pistas…</p>}
      {dados && (
        <>
          {dados.notes.map((n) => (
            <p key={n} className="campo-ajuda">
              {n}
            </p>
          ))}
          {dados.items.length > 0 && (
            <ul className="lista-candidatos" data-testid="lista-candidatos">
              {dados.items.map((c) => (
                <CartaoCandidato key={c.key} c={c} props={props} linha={linha} />
              ))}
            </ul>
          )}
          {dados.total > dados.pageSize && (
            <nav className="paginacao" aria-label="Páginas de candidatos">
              <button type="button" className="botao-secundario botao-compacto" disabled={pagina <= 1} onClick={() => { setPagina((p) => p - 1); }}>
                Anterior
              </button>
              <span>
                Página {pagina} de {paginas} ({dados.total} pista(s))
              </span>
              <button type="button" className="botao-secundario botao-compacto" disabled={pagina >= paginas} onClick={() => { setPagina((p) => p + 1); }}>
                Próxima
              </button>
            </nav>
          )}
          {dados.history.length > 0 && (
            <details className="cartao" data-testid="historico-candidatos">
              <summary>Histórico: paletes que tiveram este material ({dados.history.length}) — não prova presença atual</summary>
              <ul className="lista-candidatos">
                {dados.history.map((c) => (
                  <CartaoCandidato key={c.key} c={c} props={props} linha={linha} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}

// ---------- Anexos ----------

function ListaAnexos({ caso, anexos }: { caso: ClaimDetalhe; anexos: readonly Anexo[] }) {
  const [erro, setErro] = useState<string | null>(null);
  if (anexos.length === 0) return null;
  return (
    <>
      <ul className="lista-anexos">
        {anexos.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              className="botao-link"
              onClick={() => {
                setErro(null);
                baixarArquivo(`${API_PREFIXO}/claims/${caso.id}/anexos/${a.id}`, a.name).catch((e: unknown) => {
                  setErro(mensagemDeFalha(e));
                });
              }}
            >
              <IconeArquivo />
              {a.name} ({a.contentType === 'application/pdf' ? 'PDF' : 'imagem'}, {Math.ceil(a.size / 1024)} KB)
            </button>
          </li>
        ))}
      </ul>
      {erro && <p className="estado-erro">{erro}</p>}
    </>
  );
}

/** Envio de foto/PDF privado do caso (o servidor confere tipo pelo conteúdo e tamanho). */
function EnvioAnexo({ caso, aoEnviar, desativado }: { caso: ClaimDetalhe; aoEnviar: (a: Anexo) => void; desativado: boolean }) {
  const chaves = useChaves();
  const ids = useId();
  const [estado, setEstado] = useState<{ tipo: 'enviando' } | { tipo: 'erro'; texto: string } | null>(null);
  return (
    <div className="campo">
      <label className="campo-rotulo" htmlFor={`${ids}-anexo`}>
        Anexar foto ou PDF (privado do caso)
      </label>
      <input
        id={`${ids}-anexo`}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        disabled={desativado || estado?.tipo === 'enviando'}
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          e.target.value = '';
          if (!arquivo) return;
          const assinatura = `anexo:${caso.id}:${arquivo.name}:${String(arquivo.size)}:${String(arquivo.lastModified)}`;
          setEstado({ tipo: 'enviando' });
          enviarArquivo(`${API_PREFIXO}/claims/${caso.id}/anexos`, arquivo, arquivo.name, AnexoSchema, chaves.para(assinatura)).then(
            (a) => {
              chaves.concluir(assinatura);
              setEstado(null);
              aoEnviar(a);
            },
            (erro: unknown) => {
              chaves.concluir(assinatura, erro);
              setEstado({ tipo: 'erro', texto: mensagemDeFalha(erro) });
            },
          );
        }}
        data-testid="enviar-anexo"
      />
      {estado?.tipo === 'enviando' && <span className="campo-ajuda">Enviando…</span>}
      {estado?.tipo === 'erro' && (
        <span className="campo-erro" role="alert">
          {estado.texto}
        </span>
      )}
    </div>
  );
}

// ---------- Evidências e recuperações ----------

export function SecaoEvidencias(props: PropsSecao) {
  const { caso, linhaId, acoes, conectado, permissoes, aoNavegar } = props;
  const [descricao, setDescricao] = useState('');
  const [referencia, setReferencia] = useState('');
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [qtd, setQtd] = useState<Record<string, string>>({});
  const [texto, setTexto] = useState<Record<string, string>>({});
  const [lote, setLote] = useState<Record<string, string>>({});
  const final = situacaoFinal(caso.state);
  const podeTratar = permissoes.includes('claim.tratar') && !final;
  const podeValidar = permissoes.includes('claim.validar') && !final;
  const desativado = !conectado || acoes.enviando !== null;
  const base = `${API_PREFIXO}/claims/${caso.id}`;
  const linha = caso.lines.find((l) => l.id === linhaId);
  const soltos = caso.attachments.filter((a) => a.evidenceId === null && a.resultId === null);

  return (
    <section className="secao-claim" data-testid="secao-evidencias">
      <p className="campo-ajuda">
        Fluxo: investigar candidato → conferir material → registrar evidência → solicitar validação → validar ou rejeitar com justificativa. Só material conferido
        (saldo validado do palete) sustenta recuperação física; documento ou descrição apoiam a investigação.
      </p>
      {podeTratar && linha && (
        <details className="cartao">
          <summary>Registrar evidência descritiva (linha {linha.lineRef})</summary>
          <SeletorLinha caso={caso} linhaId={linhaId} aoEscolherLinha={props.aoEscolherLinha} />
          <label className="campo">
            <span className="campo-rotulo">Descrição fundamentada (mín. 10 caracteres)</span>
            <textarea value={descricao} rows={3} maxLength={2000} onChange={(e) => { setDescricao(e.target.value); }} data-testid="evidencia-desc-texto" />
          </label>
          <label className="campo">
            <span className="campo-rotulo">Referência verificável (ou anexe o comprovante)</span>
            <input value={referencia} maxLength={200} onChange={(e) => { setReferencia(e.target.value); }} data-testid="evidencia-desc-referencia" />
          </label>
          <EnvioAnexo
            caso={caso}
            desativado={desativado}
            aoEnviar={(a) => {
              setAnexos((l) => [...l.filter((x) => x.id !== a.id), a]);
            }}
          />
          {anexos.length > 0 && <p className="campo-ajuda">Anexos desta evidência: {anexos.map((a) => a.name).join(', ')}</p>}
          <button
            type="button"
            className="botao-primario botao-compacto"
            disabled={desativado}
            onClick={() => {
              void acoes
                .executar(
                  `evidencia-desc:${linha.id}:${descricao}:${referencia}:${anexos.map((a) => a.id).join(',')}`,
                  'POST',
                  `${base}/evidencias`,
                  { lineId: linha.id, type: 'DESCRICAO', description: descricao, verifiableReference: referencia.trim() === '' ? null : referencia, attachmentIds: anexos.map((a) => a.id) },
                  'Evidência registrada.',
                )
                .then((ok) => {
                  if (ok) {
                    setDescricao('');
                    setReferencia('');
                    setAnexos([]);
                  }
                });
            }}
            data-testid="registrar-evidencia-desc"
          >
            Registrar evidência
          </button>
        </details>
      )}
      {caso.evidences.length === 0 && <p className="estado-vazio">Nenhuma evidência registrada.</p>}
      <ul className="lista-evidencias" data-testid="lista-evidencias">
        {caso.evidences.map((e) => (
          <li key={e.id} className={`cartao-evidencia cartao-evidencia--${e.state}`} data-testid="evidencia" data-situacao={e.state}>
            <p>
              <strong>E{e.number}</strong> · linha {e.lineRef} · {ROTULOS_TIPO_EVIDENCIA[e.type]} · <span className="selo">{ROTULOS_SITUACAO_EVIDENCIA[e.state]}</span>
            </p>
            {e.material && (
              <p className="campo-ajuda">
                {e.material.sku} · lote {e.material.lot ?? 'pendente'} · {origemTexto(e.material.originType, e.material.originReference)} · condição {ROTULOS_CONDICAO[e.material.condition].toLowerCase()} ·{' '}
                {q(e.quantity, e.unit)} · palete {e.pallet?.code ?? '—'} no endereço da época {e.positionCodeAtTime ?? 'pendente'}
              </p>
            )}
            {e.documentLine && (
              <p className="campo-ajuda">
                Documento {e.documentLine.reference}, linha {e.documentLine.lineReference} (declaração: não comprova recebimento físico)
              </p>
            )}
            <p>{e.description}</p>
            {e.verifiableReference && <p className="campo-ajuda">Referência: {e.verifiableReference}</p>}
            <ListaAnexos caso={caso} anexos={e.attachments} />
            <p className="campo-ajuda">
              Registrada por {e.author.name} em {formatarDataHora(e.registeredAt)}
              {e.request ? ` · validação de ${q(e.request.quantity)} solicitada por ${e.request.by.name} em ${formatarDataHora(e.request.at)}` : ''}
              {e.decision ? ` · decidida por ${e.decision.by.name} em ${formatarDataHora(e.decision.at)}: ${e.decision.justification}` : ''}
            </p>
            <div className="acoes-linha">
              {podeTratar && e.state === 'REGISTRADA' && e.type === 'MATERIAL_CONFERIDO' && (
                <AcaoInline
                  rotulo="Solicitar validação"
                  testId="solicitar-validacao"
                  desativado={desativado}
                  aoConfirmar={async () =>
                    (await acoes.executar(
                      `solicitar:${e.id}:${qtd[e.id] ?? ''}`,
                      'POST',
                      `${base}/evidencias/${e.id}/solicitar-validacao`,
                      { expectedVersion: e.version, quantity: decimal(qtd[e.id] ?? e.quantity ?? '') },
                      'Validação solicitada.',
                    )) !== null
                  }
                >
                  {() => (
                    <label className="campo campo--compacto">
                      <span className="campo-rotulo">Quantidade ({e.unit})</span>
                      <input value={qtd[e.id] ?? e.quantity ?? ''} inputMode="decimal" onChange={(ev) => { setQtd({ ...qtd, [e.id]: ev.target.value }); }} data-testid="solicitar-quantidade" />
                    </label>
                  )}
                </AcaoInline>
              )}
              {podeValidar && e.state === 'VALIDACAO_SOLICITADA' && (
                <>
                  <AcaoInline
                    rotulo="Validar recuperação física"
                    testId="validar-recuperacao"
                    desativado={desativado}
                    aoConfirmar={async () =>
                      (await acoes.executar(
                        `validar:${e.id}:${qtd[e.id] ?? ''}:${texto[e.id] ?? ''}:${lote[e.id] ?? ''}`,
                        'POST',
                        `${base}/evidencias/${e.id}/validar`,
                        {
                          expectedVersion: e.version,
                          quantity: decimal(qtd[e.id] ?? e.request?.quantity ?? ''),
                          justification: texto[e.id] ?? '',
                          lotTreatment: (lote[e.id] ?? '').trim() === '' ? null : lote[e.id],
                        },
                        'Recuperação física validada (não é valor evitado).',
                      )) !== null
                    }
                  >
                    {() => (
                      <>
                        <label className="campo campo--compacto">
                          <span className="campo-rotulo">Quantidade validada ({e.unit})</span>
                          <input value={qtd[e.id] ?? e.request?.quantity ?? ''} inputMode="decimal" onChange={(ev) => { setQtd({ ...qtd, [e.id]: ev.target.value }); }} data-testid="validar-quantidade" />
                        </label>
                        <label className="campo">
                          <span className="campo-rotulo">Justificativa (mín. 10 caracteres)</span>
                          <textarea value={texto[e.id] ?? ''} rows={2} onChange={(ev) => { setTexto({ ...texto, [e.id]: ev.target.value }); }} data-testid="validar-justificativa" />
                        </label>
                        <label className="campo">
                          <span className="campo-rotulo">Tratativa documentada de lote (só se o lote exigido divergir ou estiver pendente)</span>
                          <input value={lote[e.id] ?? ''} maxLength={1000} onChange={(ev) => { setLote({ ...lote, [e.id]: ev.target.value }); }} />
                        </label>
                      </>
                    )}
                  </AcaoInline>
                  <AcaoInline
                    rotulo="Rejeitar"
                    testId="rejeitar-validacao"
                    desativado={desativado}
                    aoConfirmar={async () =>
                      (await acoes.executar(
                        `rejeitar:${e.id}:${texto[e.id] ?? ''}`,
                        'POST',
                        `${base}/evidencias/${e.id}/rejeitar`,
                        { expectedVersion: e.version, justification: texto[e.id] ?? '' },
                        'Validação rejeitada com justificativa.',
                      )) !== null
                    }
                  >
                    {() => (
                      <label className="campo">
                        <span className="campo-rotulo">Justificativa (mín. 10 caracteres)</span>
                        <textarea value={texto[e.id] ?? ''} rows={2} onChange={(ev) => { setTexto({ ...texto, [e.id]: ev.target.value }); }} />
                      </label>
                    )}
                  </AcaoInline>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      <h3>Recuperações físicas validadas</h3>
      {caso.recoveries.length === 0 && <p className="estado-vazio">Nenhuma recuperação validada.</p>}
      <ul className="lista-evidencias" data-testid="lista-recuperacoes">
        {caso.recoveries.map((r) => (
          <li key={r.id} className={`cartao-evidencia cartao-evidencia--${r.state}`} data-testid="recuperacao">
            <p>
              <strong>{q(r.quantity, r.unit)}</strong> · linha {r.lineRef} · {r.material.sku} lote {r.material.lot ?? 'pendente'} ·{' '}
              {origemTexto(r.material.originType, r.material.originReference)} · {r.state === 'ATIVA' ? 'ativa' : 'estornada'}
            </p>
            <p className="campo-ajuda">
              Validada por {r.validatedBy.name} em {formatarDataHora(r.validatedAt)} no palete {r.palletAtValidation.code} ({r.palletAtValidation.positionCode ?? 'sem posição'}):{' '}
              {r.justification}
              {r.lotTreatment ? ` · tratativa de lote: ${r.lotTreatment}` : ''}
            </p>
            {r.currentLocations.length > 0 && (
              <div className="acoes-linha">
                <span className="campo-ajuda">Material vinculado agora em:</span>
                {r.currentLocations.map((l) => (
                  <button
                    key={l.palletId}
                    type="button"
                    className="botao-link"
                    onClick={() => {
                      aoNavegar({ tipo: 'palete', id: l.palletId, claim: { id: caso.id, linha: r.lineId } });
                    }}
                  >
                    {l.palletCode} · {l.positionCode ?? 'localização pendente'} · {q(l.quantity)}
                  </button>
                ))}
              </div>
            )}
            {r.reversal && (
              <p className="mensagem-conflito">
                Estornada por {r.reversal.by.name} em {formatarDataHora(r.reversal.at)}: {r.reversal.reason}
              </p>
            )}
            {podeValidar && r.state === 'ATIVA' && (
              <AcaoInline
                rotulo="Estornar (corrigir)"
                testId="estornar-recuperacao"
                desativado={desativado}
                aoConfirmar={async () =>
                  (await acoes.executar(`estornar:${r.id}:${texto[r.id] ?? ''}`, 'POST', `${base}/recuperacoes/${r.id}/estornar`, { expectedVersion: r.version, reason: texto[r.id] ?? '' }, 'Recuperação estornada; o registro original fica no histórico.')) !== null
                }
              >
                {() => (
                  <label className="campo">
                    <span className="campo-rotulo">Motivo do estorno (mín. 10 caracteres)</span>
                    <textarea value={texto[r.id] ?? ''} rows={2} onChange={(ev) => { setTexto({ ...texto, [r.id]: ev.target.value }); }} />
                  </label>
                )}
              </AcaoInline>
            )}
          </li>
        ))}
      </ul>
      {soltos.length > 0 && (
        <div className="cartao">
          <h3>Anexos ainda sem evidência ou resultado</h3>
          <ListaAnexos caso={caso} anexos={soltos} />
        </div>
      )}
    </section>
  );
}

// ---------- Resultados ----------

export function SecaoResultados(props: PropsSecao) {
  const { caso, acoes, conectado, permissoes } = props;
  const [tipo, setTipo] = useState<TipoResultado>('REGULARIZACAO');
  const [data, setData] = useState('');
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [valor, setValor] = useState('');
  const [moeda, setMoeda] = useState(caso.currency ?? '');
  const [fonte, setFonte] = useState('');
  const [referencia, setReferencia] = useState('');
  const [externa, setExterna] = useState('');
  const [justificativa, setJustificativa] = useState('');
  const [evidencias, setEvidencias] = useState<string[]>([]);
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [corrige, setCorrige] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const final = situacaoFinal(caso.state);
  const podeAprovar = permissoes.includes('claim.aprovar_financeiro') && !final;
  const desativado = !conectado || acoes.enviando !== null;
  const base = `${API_PREFIXO}/claims/${caso.id}`;
  const disponiveis = caso.evidences.filter((e) => e.state !== 'REJEITADA');

  async function registrar() {
    const linhas = caso.lines.flatMap((l) => ((quantidades[l.id] ?? '').trim() === '' ? [] : [{ lineId: l.id, quantity: decimal(quantidades[l.id] ?? '') }]));
    const corpo = {
      type: tipo,
      decisionDate: data,
      lines: linhas,
      value: valor.trim() === '' ? null : decimal(valor),
      currency: valor.trim() === '' ? null : moeda.trim().toUpperCase(),
      source: fonte,
      reference: referencia,
      externalResultReference: externa.trim() === '' ? null : externa,
      valueJustification: justificativa.trim() === '' ? null : justificativa,
      evidenceIds: evidencias,
      attachmentIds: anexos.map((a) => a.id),
      correctsResultId: corrige,
      correctionReason: corrige ? motivo : null,
    };
    const ok = await acoes.executar(`resultado:${JSON.stringify(corpo)}`, 'POST', `${base}/resultados`, corpo, corrige ? 'Resultado corrigido (o original fica registrado).' : 'Resultado registrado.');
    if (ok) {
      setQuantidades({});
      setValor('');
      setFonte('');
      setReferencia('');
      setExterna('');
      setJustificativa('');
      setEvidencias([]);
      setAnexos([]);
      setCorrige(null);
      setMotivo('');
    }
  }

  return (
    <section className="secao-claim" data-testid="secao-resultados">
      <p className="campo-ajuda">
        O resultado da regularização é decisão financeira registrada por perfil com aprovação explícita, separada da recuperação física. O aplicativo não cancela, estorna
        nem abre cobranças.
      </p>
      {caso.results.length === 0 && <p className="estado-vazio">Nenhum resultado registrado.</p>}
      <ul className="lista-evidencias" data-testid="lista-resultados">
        {caso.results.map((r) => (
          <li key={r.id} className={`cartao-evidencia cartao-evidencia--${r.state}`} data-testid="resultado" data-situacao={r.state}>
            <p>
              <strong>R{r.number}</strong> · {ROTULOS_TIPO_RESULTADO[r.type]} · {r.state.toLowerCase()} · decisão de {formatarDataInformada(r.decisionDate)} ·{' '}
              {r.value === null ? 'sem valor' : formatarValor(r.value, r.currency)}
            </p>
            <p className="campo-ajuda">
              Cobre: {r.lines.map((l) => `linha ${l.lineRef}: ${q(l.quantity, l.unit)}`).join('; ')} · fonte {r.source} · referência {r.reference}
              {r.externalResultReference ? ` · resultado externo ${r.externalResultReference}` : ''}
            </p>
            <p className="campo-ajuda">
              Estimativa na decisão: {r.estimateSnapshot.total === null ? 'não derivável sem presumir regra contratual' : formatarValor(r.estimateSnapshot.total, r.estimateSnapshot.currency)}
              {r.valueJustification ? ` · justificativa: ${r.valueJustification}` : ''}
            </p>
            <ListaAnexos caso={caso} anexos={r.attachments} />
            <p className="campo-ajuda">
              Registrado por {r.author.name} em {formatarDataHora(r.registeredAt)}
              {r.correctionReason ? ` · corrige R anterior: ${r.correctionReason}` : ''}
              {r.closure ? ` · encerrado por ${r.closure.by.name} em ${formatarDataHora(r.closure.at)}: ${r.closure.reason}` : ''}
            </p>
            {podeAprovar && r.state === 'VIGENTE' && (
              <div className="acoes-linha">
                <button
                  type="button"
                  className="botao-secundario botao-compacto"
                  onClick={() => {
                    setCorrige(r.id);
                    setTipo(r.type);
                    setQuantidades(Object.fromEntries(r.lines.map((l) => [l.lineId, l.quantity])));
                  }}
                >
                  Corrigir
                </button>
                <AcaoInline
                  rotulo="Anular"
                  testId="anular-resultado"
                  desativado={desativado}
                  aoConfirmar={async () =>
                    (await acoes.executar(`anular:${r.id}:${motivo}`, 'POST', `${base}/resultados/${r.id}/anular`, { expectedVersion: r.version, reason: motivo }, 'Resultado anulado (nada é apagado).')) !== null
                  }
                >
                  {() => (
                    <label className="campo">
                      <span className="campo-rotulo">Motivo da anulação (mín. 10 caracteres)</span>
                      <textarea value={motivo} rows={2} onChange={(e) => { setMotivo(e.target.value); }} />
                    </label>
                  )}
                </AcaoInline>
              </div>
            )}
          </li>
        ))}
      </ul>
      {podeAprovar && (
        <form
          className="cartao"
          onSubmit={(e) => {
            e.preventDefault();
            void registrar();
          }}
          data-testid="form-resultado"
        >
          <h3>{corrige ? 'Corrigir resultado' : 'Registrar resultado da regularização'}</h3>
          {caso.chargeFinalized && (
            <p className="mensagem-conflito">Cobrança já finalizada no cliente: a regularização exige a prova do resultado externo (área responsável).</p>
          )}
          <div className="formulario-grade">
            <label className="campo">
              <span className="campo-rotulo">Tipo</span>
              <select value={tipo} onChange={(e) => { setTipo(e.target.value as TipoResultado); }} data-testid="resultado-tipo">
                <option value="REGULARIZACAO">{ROTULOS_TIPO_RESULTADO.REGULARIZACAO}</option>
                <option value="PERDA_CONFIRMADA">{ROTULOS_TIPO_RESULTADO.PERDA_CONFIRMADA}</option>
              </select>
            </label>
            <label className="campo">
              <span className="campo-rotulo">Data da decisão</span>
              <input type="date" value={data} onChange={(e) => { setData(e.target.value); }} data-testid="resultado-data" />
            </label>
            {caso.lines.map((l) => (
              <label key={l.id} className="campo">
                <span className="campo-rotulo">
                  Linha {l.lineRef}: quantidade coberta ({l.unit}; sem resultado {formatarQuantidade(subtrairQuantidades(l.quantity, l.covered))})
                </span>
                <input value={quantidades[l.id] ?? ''} inputMode="decimal" onChange={(e) => { setQuantidades({ ...quantidades, [l.id]: e.target.value }); }} data-testid="resultado-quantidade" />
              </label>
            ))}
            <label className="campo">
              <span className="campo-rotulo">Valor confirmado</span>
              <input value={valor} inputMode="decimal" onChange={(e) => { setValor(e.target.value); }} data-testid="resultado-valor" />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Moeda</span>
              <input value={moeda} maxLength={3} onChange={(e) => { setMoeda(e.target.value.toUpperCase()); }} />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Fonte</span>
              <input value={fonte} maxLength={200} onChange={(e) => { setFonte(e.target.value); }} data-testid="resultado-fonte" />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Referência verificável</span>
              <input value={referencia} maxLength={200} onChange={(e) => { setReferencia(e.target.value); }} data-testid="resultado-referencia" />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Prova do resultado externo</span>
              <input value={externa} maxLength={200} onChange={(e) => { setExterna(e.target.value); }} />
            </label>
          </div>
          <label className="campo">
            <span className="campo-rotulo">Justificativa (obrigatória quando o valor difere da estimativa ou ela não é derivável)</span>
            <textarea value={justificativa} rows={2} maxLength={2000} onChange={(e) => { setJustificativa(e.target.value); }} data-testid="resultado-justificativa" />
          </label>
          {corrige && (
            <label className="campo">
              <span className="campo-rotulo">Motivo da correção</span>
              <input value={motivo} maxLength={1000} onChange={(e) => { setMotivo(e.target.value); }} />
            </label>
          )}
          <fieldset className="campo">
            <legend className="campo-rotulo">Evidências que sustentam a decisão</legend>
            {disponiveis.length === 0 && <span className="campo-ajuda">Nenhuma evidência registrada: anexe o comprovante.</span>}
            {disponiveis.map((e) => (
              <label key={e.id} className="opcao">
                <input
                  type="checkbox"
                  checked={evidencias.includes(e.id)}
                  onChange={(ev) => {
                    setEvidencias(ev.target.checked ? [...evidencias, e.id] : evidencias.filter((x) => x !== e.id));
                  }}
                  data-testid="resultado-evidencia"
                />
                <span>
                  E{e.number} · {ROTULOS_TIPO_EVIDENCIA[e.type]} · {ROTULOS_SITUACAO_EVIDENCIA[e.state]}
                </span>
              </label>
            ))}
          </fieldset>
          <EnvioAnexo
            caso={caso}
            desativado={desativado}
            aoEnviar={(a) => {
              setAnexos((l) => [...l.filter((x) => x.id !== a.id), a]);
            }}
          />
          {anexos.length > 0 && <p className="campo-ajuda">Anexos deste resultado: {anexos.map((a) => a.name).join(', ')}</p>}
          <div className="acoes-linha">
            <button type="submit" className="botao-primario" disabled={desativado} data-testid="registrar-resultado">
              {acoes.enviando ? 'Gravando…' : corrige ? 'Registrar correção' : 'Registrar resultado'}
            </button>
            {corrige && (
              <button type="button" className="botao-link" onClick={() => { setCorrige(null); }}>
                Cancelar correção
              </button>
            )}
          </div>
        </form>
      )}
      {!permissoes.includes('claim.aprovar_financeiro') && <p className="campo-ajuda">Seu acesso não inclui a aprovação financeira de claims (concessão explícita do administrador).</p>}
    </section>
  );
}

// ---------- Histórico ----------

export function SecaoHistorico({ caso, versao }: PropsSecao) {
  const [pagina, setPagina] = useState(1);
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/claims/${caso.id}/historico?pagina=${String(pagina)}&tamanho=30`, PaginaHistoricoClaimSchema, versao + caso.version);
  const dados = carga?.estado === 'pronto' ? carga.dados : null;
  const paginas = dados ? Math.max(1, Math.ceil(dados.total / dados.pageSize)) : 1;
  return (
    <section className="secao-claim" data-testid="secao-historico">
      {carga?.estado === 'erro' && (
        <div className="estado-erro" role="alert">
          <p>{carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            Tentar novamente
          </button>
        </div>
      )}
      {dados && (
        <>
          <ol className="lista-historico-claim" data-testid="lista-historico-claim">
            {dados.items.map((e) => (
              <li key={e.id}>
                <p>
                  <strong>{ROTULOS_EVENTO[e.type]}</strong> · {formatarDataHora(e.at)} · {e.author?.name ?? 'sistema'}
                  {e.lineRef ? ` · linha ${e.lineRef}` : ''}
                </p>
                <p>{e.summary}</p>
              </li>
            ))}
          </ol>
          {dados.total > dados.pageSize && (
            <nav className="paginacao" aria-label="Páginas do histórico">
              <button type="button" className="botao-secundario botao-compacto" disabled={pagina <= 1} onClick={() => { setPagina((p) => p - 1); }}>
                Anterior
              </button>
              <span>
                Página {pagina} de {paginas}
              </span>
              <button type="button" className="botao-secundario botao-compacto" disabled={pagina >= paginas} onClick={() => { setPagina((p) => p + 1); }}>
                Próxima
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
