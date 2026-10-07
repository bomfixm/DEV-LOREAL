import {
  API_PREFIXO,
  DocumentosPaleteSchema,
  ROTULOS_ACAO_INVENTARIO,
  ROTULOS_PALETE_FULL,
  type DocumentoPalete,
  type DocumentosPalete,
  type LocalNota,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { ehConflitoDeVersao, useChaves } from '../../api/chaves';
import { enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar } from '../../components/Icones';
import { MensagemAcao } from '../../components/Moldura';
import { formatarData, formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';

/**
 * Notas do palete (inventário conferido / carga em lote): para cada NF, só os
 * campos do operador — NFD, remetente, cidade destino, volumes, palete full,
 * mesma NFD em mais de um palete e produto na caixa. Cidade e produto são
 * editáveis (proteção de versão). Volumes são do inventário, não peças nem
 * saldo validado; fonte e linha ficam no detalhe de origem.
 */
type Mensagem = { tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null;

interface Edicao {
  podeEditar: boolean;
  ocupado: boolean;
  gravar: (assinatura: string, metodo: 'PUT' | 'POST', caminho: string, corpo: unknown, sucesso: string) => Promise<boolean>;
}

const volumesTexto = (d: DocumentoPalete) => (d.volumes === null ? null : `${formatarQuantidade(d.volumes)} ${d.volumesUnit.toLowerCase()}`);

function textoLocal(o: LocalNota): string {
  if (o.kind === 'FORA_DA_PRACA') {
    return `${o.address ?? 'Endereço não informado'} — referência fora da praça${o.palletCode ? ` (palete ${o.palletCode} expedido)` : ' (endereço livre no inventário; local atual não informado)'}`;
  }
  const local = o.positionCode !== null ? `posição ${o.positionCode}${o.address ? ` · ${o.address}` : ''}` : `${o.address ?? 'endereço não informado'}${o.mapPending ? ' (posição no mapa pendente)' : ''}`;
  return `${o.palletCode ?? 'Palete'} · ${local}`;
}

/** Campo de texto livre editável (cidade destino, produto na caixa). */
function CampoEditavel({ rotulo, valor, vazio, maximo, testId, edicao, aoGravar }: { rotulo: string; valor: string; vazio: string; maximo: number; testId: string; edicao: Edicao; aoGravar: (valor: string) => Promise<boolean> }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(valor);
  if (editando) {
    return (
      <form
        className="nota-edicao"
        onSubmit={(e) => {
          e.preventDefault();
          void aoGravar(texto).then((ok) => {
            if (ok) setEditando(false);
          });
        }}
      >
        <label className="campo">
          <span className="campo-rotulo">{rotulo} (vazio limpa)</span>
          <input value={texto} maxLength={maximo} onChange={(e) => { setTexto(e.target.value); }} data-testid={`${testId}-entrada`} />
        </label>
        <div className="acoes-linha">
          <button type="submit" className="botao-primario" disabled={edicao.ocupado}>
            {edicao.ocupado ? 'Gravando…' : 'Gravar'}
          </button>
          <button type="button" className="botao-link" onClick={() => { setEditando(false); setTexto(valor); }}>
            Cancelar
          </button>
        </div>
      </form>
    );
  }
  return (
    <span className="nota-valor-editavel">
      <span className={valor === '' ? 'pendente' : undefined} data-testid={testId}>
        {valor === '' ? vazio : valor}
      </span>
      {edicao.podeEditar && (
        <button type="button" className="botao-link" onClick={() => { setTexto(valor); setEditando(true); }} aria-label={`Editar ${rotulo.toLowerCase()}`}>
          Editar
        </button>
      )}
    </span>
  );
}

/** Descrições por caixa/grupo (acréscimo; nada é exigido para as demais caixas). */
function Caixas({ paleteId, d, edicao }: { paleteId: string; d: DocumentoPalete; edicao: Edicao }) {
  const [abrindo, setAbrindo] = useState(false);
  const [grupo, setGrupo] = useState('');
  const [descricao, setDescricao] = useState('');
  const identidade = d.identity;
  const caixas = d.productInBox.boxes;
  if (identidade === null || (caixas.length === 0 && !edicao.podeEditar)) return null;
  return (
    <div className="nota-caixas">
      {caixas.length > 0 && (
        <ul data-testid="nota-caixas">
          {caixas.map((c) => (
            <li key={c.id}>
              <strong>{c.group}:</strong> {c.description}
              <span className="tabela-nota"> · {c.createdBy?.name ?? '—'}, {formatarDataHora(c.createdAt)}</span>
              {edicao.podeEditar && (
                <button
                  type="button"
                  className="botao-link"
                  onClick={() => {
                    const motivo = window.prompt(`Motivo para retirar a descrição de ${c.group} (fica no histórico):`);
                    if (motivo === null || motivo.trim().length < 3) return;
                    void edicao.gravar(`retirar:${c.id}`, 'POST', `/documentos/caixas/${c.id}/retirar`, { reason: motivo }, 'Descrição de caixa retirada.');
                  }}
                >
                  Retirar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {edicao.podeEditar &&
        (abrindo ? (
          <form
            className="nota-edicao"
            onSubmit={(e) => {
              e.preventDefault();
              void edicao.gravar(`caixa:${paleteId}:${identidade}:${grupo}:${descricao}`, 'POST', '/documentos/caixas', { identity: identidade, group: grupo, description: descricao }, 'Descrição da caixa gravada.').then((ok) => {
                if (ok) {
                  setAbrindo(false);
                  setGrupo('');
                  setDescricao('');
                }
              });
            }}
          >
            <label className="campo">
              <span className="campo-rotulo">Caixa ou grupo (ex.: Caixa 3)</span>
              <input value={grupo} maxLength={60} required onChange={(e) => { setGrupo(e.target.value); }} />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Produto nesta caixa</span>
              <input value={descricao} maxLength={300} required onChange={(e) => { setDescricao(e.target.value); }} />
            </label>
            <div className="acoes-linha">
              <button type="submit" className="botao-primario" disabled={edicao.ocupado || grupo.trim() === '' || descricao.trim() === ''}>
                Gravar descrição
              </button>
              <button type="button" className="botao-link" onClick={() => { setAbrindo(false); }}>
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="botao-link" onClick={() => { setAbrindo(true); }}>
            + Descrever uma caixa ou grupo com conteúdo diferente
          </button>
        ))}
    </div>
  );
}

function Nota({ paleteId, d, full, edicao }: { paleteId: string; d: DocumentoPalete; full: DocumentosPalete['palletFull']; edicao: Edicao }) {
  const identidade = d.identity;
  const mp = d.multiplePallets;
  const atuais = mp.others.filter((o) => o.kind === 'ATUAL');
  const fora = mp.others.filter((o) => o.kind === 'FORA_DA_PRACA');
  const volumes = volumesTexto(d);
  const edicaoNota: Edicao = identidade === null ? { ...edicao, podeEditar: false } : edicao;
  return (
    <li className="nota" data-testid="documento-informado" data-numero={d.documentNumber}>
      <dl className="nota-campos">
        <div>
          <dt>NFD</dt>
          <dd>
            {d.isNfd ? (
              <strong className="nota-numero">{d.documentNumber}</strong>
            ) : (
              <span className="pendente">
                Não é NFD: {d.documentType === null ? 'documento de tipo pendente' : `documento ${d.documentType}`} <strong>{d.documentNumber}</strong>
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Remetente</dt>
          <dd className={d.sender === null ? 'pendente' : undefined}>{d.sender ?? 'Não informado'}</dd>
        </div>
        <div>
          <dt>Cidade destino</dt>
          <dd>
            <CampoEditavel
              rotulo="Cidade destino"
              valor={d.destinationCity.value}
              vazio="Não informada"
              maximo={120}
              testId="nota-cidade"
              edicao={edicaoNota}
              aoGravar={(valor) =>
                edicao.gravar(
                  `cidade:${d.identity ?? ''}:${String(d.destinationCity.version)}:${valor}`,
                  'PUT',
                  '/documentos/cidade-destino',
                  { identity: identidade, expectedVersion: d.destinationCity.version, value: valor },
                  'Cidade destino gravada (vale para esta NF em todos os paletes).',
                )
              }
            />
          </dd>
        </div>
        <div>
          <dt>Volumes</dt>
          <dd>
            <span className={volumes === null ? 'pendente' : undefined} data-testid="nota-volumes">
              {volumes ?? 'Pendente (quantidade desconhecida; não é saldo)'}
            </span>
            {d.volumesByRow.length > 0 && (
              <span className="tabela-nota">
                {' '}
                · na origem: {d.volumesByRow.map((v) => `linha ${String(v.row)}: ${v.text === '' ? 'vazio' : v.text}`).join('; ')} (não somados)
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Palete full</dt>
          <dd data-testid="nota-full">{ROTULOS_PALETE_FULL[full.value]}</dd>
        </div>
        <div>
          <dt>Mesma NFD em mais de um palete</dt>
          <dd data-testid="nota-mais-paletes">
            {mp.indicated ? (
              <>
                <strong>Sim</strong>
                {mp.declaredPallets !== null && <> · {mp.declaredPallets} paletes declarados no inventário</>}
                {mp.partsHere.length > 0 && <> (aqui: parte {mp.partsHere.join(' e ')})</>}
                {atuais.length > 0 && (
                  <>
                    <span className="nota-subtitulo">Outros locais atuais:</span>
                    <ul className="nota-locais">
                      {atuais.map((o) => (
                        <li key={`${o.palletId ?? ''}:${String(o.row)}`}>{textoLocal(o)}</li>
                      ))}
                    </ul>
                  </>
                )}
                {fora.length > 0 && (
                  <>
                    <span className="nota-subtitulo">Fora da praça (referência):</span>
                    <ul className="nota-locais">
                      {fora.map((o) => (
                        <li key={`${o.address ?? ''}:${String(o.row)}`}>{textoLocal(o)}</li>
                      ))}
                    </ul>
                  </>
                )}
                {atuais.length === 0 && fora.length === 0 && <span className="tabela-nota"> · outros endereços não encontrados nos registros</span>}
              </>
            ) : (
              'Não'
            )}
          </dd>
        </div>
        <div>
          <dt>Produto na caixa</dt>
          <dd>
            <CampoEditavel
              rotulo="Produto na caixa"
              valor={d.productInBox.value}
              vazio="Não informado"
              maximo={500}
              testId="nota-produto"
              edicao={edicaoNota}
              aoGravar={(valor) =>
                edicao.gravar(
                  `produto:${paleteId}:${d.identity ?? ''}:${String(d.productInBox.version)}:${valor}`,
                  'PUT',
                  '/documentos/produto',
                  { identity: identidade, expectedVersion: d.productInBox.version, value: valor },
                  'Produto na caixa gravado (descrição livre; não cria saldo por SKU).',
                )
              }
            />
            <Caixas paleteId={paleteId} d={d} edicao={edicaoNota} />
          </dd>
        </div>
      </dl>
      {mp.sameNumberElsewhere.length > 0 && (
        <details className="nota-detalhe">
          <summary>Mesmo número em outro contexto documental ({mp.sameNumberElsewhere.length}) — candidatos, não a mesma nota</summary>
          <ul className="nota-locais">
            {mp.sameNumberElsewhere.map((c, i) => (
              <li key={`${c.palletId ?? ''}:${String(i)}`}>
                {c.documentType ?? 'Tipo pendente'} {c.documentNumber}
                {c.delivery ? ` · DELIVERY ${c.delivery}` : ''}
                {c.sender ? ` · ${c.sender}` : ''} · {c.palletCode ? `${c.palletCode} · ` : ''}
                {c.address ?? 'endereço não informado'}
                {c.kind === 'FORA_DA_PRACA' ? ' (fora da praça)' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
      {d.pending.length > 0 && (
        <ul className="nota-pendencias" aria-label="Pendências desta nota">
          {d.pending.map((p) => (
            <li key={p}>
              <span aria-hidden="true">⚠ </span>
              {p}
            </li>
          ))}
        </ul>
      )}
      <details className="nota-detalhe">
        <summary>Origem</summary>
        <p className="tabela-nota">
          {d.source.inventoryCode}, linha {d.source.row}
          {d.informedAddress ? ` · informado em ${d.informedAddress}` : ''}
          {d.delivery ? ` · DELIVERY ${d.delivery}` : ''}
          {d.documentation ? ` · documentação: ${d.documentation} (não libera saída)` : ''}
          {d.palletFull ? ` · PALLET FULL na planilha: ${d.palletFull}` : ''}
          {d.source.countDate ? ` · conferido em ${formatarData(`${d.source.countDate}T12:00:00Z`)}` : ''}
          {d.externalCount ? ' · conferência externa reconhecida' : ''} · importado em {formatarDataHora(d.source.importedAt)}
        </p>
      </details>
    </li>
  );
}

export function DocumentosInformados({ paleteId, versao, podeEditar = false }: { paleteId: string; versao: number; podeEditar?: boolean }) {
  const url = `${API_PREFIXO}/paletes/${paleteId}/documentos`;
  const { carga, recarregar } = useRecurso(url, DocumentosPaleteSchema, versao);
  const chaves = useChaves();
  const [atualizado, setAtualizado] = useState<DocumentosPalete | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const carregado = carga?.estado === 'pronto' ? carga.dados : null;
  const dados = atualizado ?? carregado;

  async function gravar(assinatura: string, metodo: 'PUT' | 'POST', caminho: string, corpo: unknown, sucesso: string): Promise<boolean> {
    setOcupado(true);
    setMensagem(null);
    try {
      setAtualizado(await enviarJson(metodo, `${url}${caminho.slice('/documentos'.length)}`, DocumentosPaleteSchema, { corpo, idempotencia: chaves.para(assinatura) }));
      chaves.concluir(assinatura);
      setMensagem({ tipo: 'ok', texto: sucesso });
      return true;
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      setMensagem({ tipo: ehConflitoDeVersao(erro) ? 'conflito' : 'erro', texto: mensagemDeFalha(erro) });
      if (ehConflitoDeVersao(erro)) {
        setAtualizado(null);
        recarregar();
      }
      return false;
    } finally {
      setOcupado(false);
    }
  }

  if (dados !== null && dados.items.length === 0 && dados.notApplied.length === 0 && dados.contentWithoutDocument.length === 0 && dados.externalReferences.length === 0) return null;
  const ativos = dados?.items.filter((d) => d.state === 'ATIVO') ?? [];
  const encerrados = dados?.items.filter((d) => d.state === 'ENCERRADO') ?? [];
  const edicao: Edicao = { podeEditar, ocupado, gravar };
  return (
    <section className="detalhe-secao" aria-labelledby="secao-documentos-inventario" data-testid="documentos-inventario">
      <h3 id="secao-documentos-inventario">Notas do palete{ativos.length > 0 ? ` (${String(ativos.length)})` : ''}</h3>
      {carga?.estado === 'erro' && atualizado === null && (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar as notas. {carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {carga?.estado === 'carregando' && atualizado === null && <p className="estado-carregando">Carregando notas…</p>}
      {dados && (
        <>
          <p className="nota-resumo" data-testid="palete-full">
            <strong>Palete full: {ROTULOS_PALETE_FULL[dados.palletFull.value]}</strong> — {dados.palletFull.reason}
            {dados.palletFull.imported !== null && dados.palletFull.imported !== dados.palletFull.value && (
              <span className="tabela-nota"> (no inventário importado: {ROTULOS_PALETE_FULL[dados.palletFull.imported]})</span>
            )}
          </p>
          {dados.externalReferences.length > 0 && (
            <p className="tabela-nota" data-testid="referencia-externa">
              {dados.externalReferences
                .map((r) => `N° Pallet na planilha ${r.value} (${r.inventoryCode}): referência externa, não é o ID${r.otherAddresses.length > 0 ? `; o mesmo número aparece em ${r.otherAddresses.join(', ')} (outro palete)` : ''}`)
                .join(' · ')}
            </p>
          )}
          {ativos.length > 0 ? (
            <ul className="lista-notas">
              {ativos.map((d) => (
                <Nota key={d.id} paleteId={paleteId} d={d} full={dados.palletFull} edicao={edicao} />
              ))}
            </ul>
          ) : (
            <p className="sem-itens">Nenhuma nota vinculada a este palete.</p>
          )}
          <MensagemAcao mensagem={mensagem} testId="mensagem-notas" />
          {dados.contentWithoutDocument.length > 0 && (
            <div className="nota-sem-documento" data-testid="conteudo-sem-documento">
              <p>Conteúdo sem número de documento no inventário (não prova que o palete está vazio):</p>
              <ul className="lista-documentos">
                {dados.contentWithoutDocument.map((c) => (
                  <li key={`${c.inventoryCode}:${String(c.row)}`}>
                    {c.sender ?? 'Remetente não informado'} · {c.volumes === null ? 'volumes não informados' : `${formatarQuantidade(c.volumes)} volumes`}
                    <span className="tabela-nota">
                      {' '}
                      · {c.inventoryCode}, linha {c.row}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="campo-ajuda">Volumes como informados no inventário: não são peças nem saldo validado. SKU, lote e peças continuam desconhecidos até a conferência.</p>
          {encerrados.length > 0 && (
            <details>
              <summary>Vínculos encerrados (histórico, {encerrados.length})</summary>
              <ul className="lista-documentos">
                {encerrados.map((d) => (
                  <li key={d.id}>
                    {d.documentType ?? '?'} {d.documentNumber}
                    {d.volumes !== null ? ` · ${formatarQuantidade(d.volumes)} ${d.volumesUnit.toLowerCase()}` : ''} · {d.source.inventoryCode} linha {d.source.row}
                    {d.endedAt ? ` · encerrado em ${formatarDataHora(d.endedAt)}` : ''}
                    {d.endReason ? `: ${d.endReason}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {dados.notApplied.length > 0 && (
            <div className="mensagem-conflito" role="note">
              <p>Linhas de inventário que citam este palete sem vínculo aplicado:</p>
              <ul>
                {dados.notApplied.map((n) => (
                  <li key={`${n.inventoryCode}:${String(n.row)}`}>
                    {n.inventoryCode} linha {n.row}
                    {n.documentNumber ? ` (${n.documentNumber})` : ''}: {ROTULOS_ACAO_INVENTARIO[n.action]}
                    {n.reason ? ` — ${n.reason}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
