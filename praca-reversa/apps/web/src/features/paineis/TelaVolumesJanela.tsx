import {
  API_PREFIXO,
  ConteudoVolumesSchema,
  PaginaSelecoesSchema,
  ROTULO_ETAPA_SELECAO,
  ROTULOS_SITUACAO_JANELA,
  ResultadoVolumesSchema,
  VolumesJanelaSchema,
  type ConteudoVolumes,
  type EventoVolumes,
  type Permissao,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { z } from 'zod';
import { useChaves } from '../../api/chaves';
import { enviarJson, mensagemDeFalha, obterJson } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { EstadoTela, MensagemAcao, Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import type { Navegar } from '../../rotas';
import { formatarData, formatarDataHora } from '../../utils/datas';
import { Atualizacao, ProgressoJanela } from './comum';
import { useConsultaViva } from './consulta-viva';
import { volumes } from './formato';

const BuscaSchema = z.object({ items: z.array(ConteudoVolumesSchema) });
type Mensagem = { tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null;

const ROTULO_EVENTO: Record<EventoVolumes['type'], string> = {
  SEPARACAO: 'Separação',
  ESTORNO_SEPARACAO: 'Estorno de separação',
  EXPEDICAO: 'Expedição',
  ESTORNO_EXPEDICAO: 'Estorno de expedição',
};

const documento = (c: { documentType: string | null; documentNumber: string | null; delivery: string | null }) =>
  `${c.documentNumber === null ? 'Sem NF' : `${c.documentType ?? 'Documento'} ${c.documentNumber}`}${c.delivery !== null ? ` · Delivery ${c.delivery}` : ''}`;

/**
 * Volumes da janela (visão interna): meta informada pelo cliente, separação
 * por NF × palete (sem SKU), confirmação de expedição e estorno com motivo.
 * Tudo é validado de novo no servidor (permissão, base de volumes,
 * sobreposição entre janelas, separado aguardando).
 */
export function TelaVolumesJanela({ id, permissoes, aoNavegar, aoGravar }: { id: string; permissoes: readonly Permissao[]; aoNavegar: Navegar; aoGravar: () => void }) {
  const [versao, setVersao] = useState(0);
  const { dados, carga, recarregar } = useConsultaViva(`${API_PREFIXO}/janelas/${id}/volumes`, VolumesJanelaSchema, versao);
  const chaves = useChaves();
  const conectado = useConectado();
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [enviando, setEnviando] = useState(false);
  const [metaForm, setMetaForm] = useState({ volumes: '', referencia: '', selecao: '' });
  const [texto, setTexto] = useState('');
  const [achados, setAchados] = useState<ConteudoVolumes[] | null>(null);
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  const [linhaDe, setLinhaDe] = useState<Record<string, string>>({});
  const [estorno, setEstorno] = useState<{ evento: string; volumes: string; motivo: string } | null>(null);
  const pode = (p: Permissao) => permissoes.includes(p);
  const selecoes = useRecurso(pode('selecao.consultar') && pode('janela.gerenciar') ? `${API_PREFIXO}/selecoes?tamanho=100` : null, PaginaSelecoesSchema);
  const voltar = () => {
    aoNavegar({ tipo: 'painel', parametros: '' });
  };

  async function enviar(assinatura: string, url: string, corpo: unknown, sucesso: string) {
    if (enviando) return;
    if (!conectado) {
      setMensagem({ tipo: 'erro', texto: 'Sem conexão: nada é registrado. Tente quando a rede voltar.' });
      return;
    }
    setEnviando(true);
    setMensagem(null);
    try {
      await enviarJson('POST', url, ResultadoVolumesSchema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      setMensagem({ tipo: 'ok', texto: sucesso });
      // Campos limpos depois de gravar: um novo envio exige digitar de novo.
      setQuantidades({});
      setLinhaDe({});
      setMetaForm({ volumes: '', referencia: '', selecao: '' });
      setVersao((v) => v + 1);
      aoGravar();
      if (texto.trim() !== '') void buscar();
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
    } finally {
      setEnviando(false);
    }
  }

  async function buscar() {
    if (texto.trim() === '') return;
    try {
      const r = await obterJson(`${API_PREFIXO}/janelas/${id}/volumes/conteudos?texto=${encodeURIComponent(texto.trim())}`, BuscaSchema);
      setAchados(r.items);
    } catch (erro) {
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
    }
  }

  if (dados === null) {
    return (
      <Pagina titulo="Volumes da janela" testId="tela-volumes-janela" aoVoltar={voltar} rotuloVoltar="Voltar ao painel">
        <EstadoTela carga={carga ?? { estado: 'carregando' }} titulo="Não foi possível carregar a janela" aoTentarNovamente={recarregar} />
      </Pagina>
    );
  }
  const v = dados;
  const j = v.window;
  const alvo = (c: { linkId: string | null; contentId: string | null }) => (c.linkId !== null ? { linkId: c.linkId } : { contentId: c.contentId });
  const chaveDe = (c: { linkId: string | null; contentId: string | null }) => c.linkId ?? c.contentId ?? '';
  const linhasSelecao = v.lines;

  return (
    <Pagina
      titulo={`Volumes da janela ${j.code}`}
      testId="tela-volumes-janela"
      aoVoltar={voltar}
      rotuloVoltar="Voltar ao painel"
      descricao={
        <p>
          {j.name} · {ROTULOS_SITUACAO_JANELA[j.situation]}
          {j.exitStart !== null ? ` · saída ${formatarData(j.exitStart)}${j.exitEnd !== null ? ` a ${formatarData(j.exitEnd)}` : ''}` : ''}. Volumes = contagem operacional do inventário/pedido (não é
          m³, caixas nem unidades de produto).
        </p>
      }
    >
      <Atualizacao
        consultadoEm={v.consultedAt}
        carga={carga}
        aoAtualizar={() => {
          setVersao((x) => x + 1);
        }}
      />
      <MensagemAcao mensagem={mensagem} testId="volumes-mensagem" />
      <section className="cartao painel-secao" aria-labelledby="vj-progresso">
        <h3 id="vj-progresso">Andamento</h3>
        <ProgressoJanela p={j.progress} interno />
        {j.goalDifference !== null && (
          <p className="mensagem-conflito" data-testid="diferenca-meta">
            Meta {volumes(j.progress.requested)} × soma das linhas selecionadas {volumes(j.selectedSum)}: diferença de {volumes(Math.abs(j.goalDifference))} volume(s) para revisão (nada é ajustado).
          </p>
        )}
        {v.reviewNotes.map((n) => (
          <p key={n} className="mensagem-conflito">
            {n}
          </p>
        ))}
      </section>

      <section className="cartao painel-secao" aria-labelledby="vj-meta" data-testid="vj-meta">
        <h3 id="vj-meta">Meta do cliente</h3>
        {v.goals.length === 0 ? (
          <p className="estado-vazio">Sem meta informada: sem porcentagem.</p>
        ) : (
          <ul className="painel-lista-simples">
            {v.goals.map((g, i) => (
              <li key={g.at + String(i)}>
                {i === 0 ? <strong>Vigente: </strong> : 'Anterior: '}
                {volumes(g.volumes)} volumes · {formatarDataHora(g.at)}
                {g.reference ? ` · ${g.reference}` : ''}
                {g.selection ? ` · ${g.selection.code} (pedido ${g.selection.orderRef}, versão ${String(g.selection.version)}${g.selection.superseded ? ', substituída' : ''})` : ''}
              </li>
            ))}
          </ul>
        )}
        {pode('janela.gerenciar') && (
          <form
            className="filtro-periodo"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(metaForm.volumes);
              if (!Number.isInteger(n) || n < 0 || metaForm.volumes.trim() === '') {
                setMensagem({ tipo: 'erro', texto: 'Informe a quantidade de volumes (inteiro, 0 ou mais).' });
                return;
              }
              const corpo = { volumes: n, reference: metaForm.referencia.trim() || null, selectionId: metaForm.selecao || null };
              void enviar(`meta:${id}:${JSON.stringify(corpo)}`, `${API_PREFIXO}/janelas/${id}/volumes/meta`, corpo, 'Meta registrada (a anterior fica no histórico).');
            }}
          >
            <label className="campo">
              <span className="campo-rotulo">Volumes solicitados</span>
              <input
                inputMode="numeric"
                value={metaForm.volumes}
                onChange={(e) => {
                  setMetaForm({ ...metaForm, volumes: e.target.value });
                }}
                data-testid="meta-volumes"
              />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Referência (e-mail, pedido)</span>
              <input
                value={metaForm.referencia}
                maxLength={120}
                onChange={(e) => {
                  setMetaForm({ ...metaForm, referencia: e.target.value });
                }}
              />
            </label>
            {selecoes.carga?.estado === 'pronto' && (
              <label className="campo">
                <span className="campo-rotulo">Seleção (versão do pedido)</span>
                <select
                  value={metaForm.selecao}
                  onChange={(e) => {
                    setMetaForm({ ...metaForm, selecao: e.target.value });
                  }}
                >
                  <option value="">Sem seleção importada</option>
                  {selecoes.carga.dados.items
                    .filter((s) => s.state === 'REGISTRADA')
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} · {s.orderReference} (versão {s.orderVersion})
                      </option>
                    ))}
                </select>
              </label>
            )}
            <button type="submit" className="botao-primario botao-compacto" disabled={enviando} data-testid="meta-registrar">
              Registrar meta
            </button>
          </form>
        )}
      </section>

      {linhasSelecao.length > 0 && (
        <section className="cartao painel-secao" aria-labelledby="vj-linhas">
          <h3 id="vj-linhas">Seleção do cliente (versão vigente)</h3>
          <div className="tabela-rolagem">
            <table className="tabela-indicadores tabela-painel" data-testid="vj-linhas">
              <thead>
                <tr>
                  <th scope="col">Linha</th>
                  <th scope="col">Selecionado</th>
                  <th scope="col">Solicitado</th>
                  <th scope="col">Na base</th>
                  <th scope="col">Separado aguardando</th>
                  <th scope="col">Expedido</th>
                  <th scope="col">Etapa</th>
                  <th scope="col">Paletes</th>
                </tr>
              </thead>
              <tbody>
                {linhasSelecao.map((l) => (
                  <tr key={l.lineId}>
                    <td data-rotulo="Linha">{l.row}</td>
                    <td data-rotulo="Selecionado">{l.scope === 'PALETE' ? `Palete ${l.palletRef ?? ''} (full)` : documento(l)}</td>
                    <td data-rotulo="Solicitado">{volumes(l.requested)}</td>
                    <td data-rotulo="Na base">
                      {volumes(l.locatedVolumes)}
                      {l.remainder !== null && <span className="indicador-nota"> (restante fora do pedido: {volumes(l.remainder)})</span>}
                    </td>
                    <td data-rotulo="Separado aguardando">{volumes(l.separatedWaiting)}</td>
                    <td data-rotulo="Expedido">{volumes(l.shipped)}</td>
                    <td data-rotulo="Etapa">{ROTULO_ETAPA_SELECAO[l.stage]}</td>
                    <td data-rotulo="Paletes">{l.pallets.map((p) => `${p.code} (${p.address ?? 'sem endereço'})`).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {pode('expedicao.preparar') && (
        <section className="cartao painel-secao" aria-labelledby="vj-separar" data-testid="vj-separar">
          <h3 id="vj-separar">Registrar separação</h3>
          <p className="campo-ajuda">
            Procure pelo palete, NF/NFD/MI, Delivery, remetente ou endereço. Separe só os volumes efetivamente preparados para esta janela; o restante da NF continua no estoque.
          </p>
          <form
            className="filtro-periodo"
            onSubmit={(e) => {
              e.preventDefault();
              void buscar();
            }}
          >
            <label className="campo">
              <span className="campo-rotulo">Buscar conteúdo</span>
              <input
                value={texto}
                maxLength={80}
                onChange={(e) => {
                  setTexto(e.target.value);
                }}
                data-testid="vj-busca"
              />
            </label>
            <button type="submit" className="botao-secundario botao-compacto" data-testid="vj-buscar">
              Buscar
            </button>
          </form>
          {achados !== null && achados.length === 0 && <p className="estado-vazio">Nada encontrado no estoque atual.</p>}
          {achados !== null && achados.length > 0 && (
            <ul className="painel-lista-conteudos" data-testid="vj-achados">
              {achados.map((c) => (
                <li key={chaveDe(c)} className="painel-conteudo">
                  <span>
                    <strong>{documento(c)}</strong> · palete {c.palletCode} ({c.address ?? 'sem endereço'}){c.sender ? ` · ${c.sender}` : ''}
                  </span>
                  <span className="indicador-nota">
                    Na base: {volumes(c.baseVolumes)}
                    {c.basis !== null ? ` (${c.basis === 'CONTADO' ? 'contado' : 'informado'})` : ''} · comprometido em janelas: {volumes(c.committedAllWindows)} · disponível: {volumes(c.available)}
                  </span>
                  {c.baseVolumes === null ? (
                    <span className="mensagem-conflito">Volumes não informados: registre a contagem na conferência de volumes antes de separar.</span>
                  ) : (
                    <span className="painel-conteudo-acao">
                      <input
                        inputMode="numeric"
                        aria-label="Volumes separados"
                        value={quantidades[chaveDe(c)] ?? ''}
                        onChange={(e) => {
                          setQuantidades({ ...quantidades, [chaveDe(c)]: e.target.value });
                        }}
                        data-testid="vj-qtd-separar"
                      />
                      {linhasSelecao.length > 0 && (
                        <select
                          aria-label="Linha da seleção"
                          value={linhaDe[chaveDe(c)] ?? ''}
                          onChange={(e) => {
                            setLinhaDe({ ...linhaDe, [chaveDe(c)]: e.target.value });
                          }}
                        >
                          <option value="">Sem linha da seleção</option>
                          {linhasSelecao.map((l) => (
                            <option key={l.lineId} value={l.lineId}>
                              Linha {l.row}: {l.scope === 'PALETE' ? `palete ${l.palletRef ?? ''}` : documento(l)}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        className="botao-primario botao-compacto"
                        disabled={enviando}
                        onClick={() => {
                          const n = Number(quantidades[chaveDe(c)] ?? '');
                          if (!Number.isInteger(n) || n < 1) {
                            setMensagem({ tipo: 'erro', texto: 'Informe os volumes separados (inteiro, 1 ou mais).' });
                            return;
                          }
                          const linha = linhaDe[chaveDe(c)] ?? '';
                          const corpo = { ...alvo(c), volumes: n, selectionLineId: linha === '' ? null : linha };
                          void enviar(`separar:${id}:${JSON.stringify(corpo)}`, `${API_PREFIXO}/janelas/${id}/volumes/separacoes`, corpo, `Separação de ${volumes(n)} volume(s) registrada.`);
                        }}
                        data-testid="vj-separar-botao"
                      >
                        Registrar separação
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="cartao painel-secao" aria-labelledby="vj-conteudos" data-testid="vj-conteudos">
        <h3 id="vj-conteudos">Separados nesta janela</h3>
        {v.contents.length === 0 ? (
          <p className="estado-vazio">Nenhuma separação registrada nesta janela.</p>
        ) : (
          <ul className="painel-lista-conteudos">
            {v.contents.map((c) => (
              <li key={chaveDe(c)} className="painel-conteudo">
                <span>
                  <strong>{documento(c)}</strong> · palete {c.palletCode} ({c.address ?? 'sem endereço'})
                </span>
                <span className="indicador-nota">
                  Separado aguardando: <strong>{volumes(c.separatedWaiting)}</strong> · expedido: <strong>{volumes(c.shipped)}</strong> · base {volumes(c.baseVolumes)}
                </span>
                {pode('expedicao.confirmar') && c.separatedWaiting > 0 && (
                  <span className="painel-conteudo-acao">
                    <input
                      inputMode="numeric"
                      aria-label="Volumes expedidos"
                      value={quantidades[`exp:${chaveDe(c)}`] ?? ''}
                      onChange={(e) => {
                        setQuantidades({ ...quantidades, [`exp:${chaveDe(c)}`]: e.target.value });
                      }}
                      data-testid="vj-qtd-expedir"
                    />
                    <button
                      type="button"
                      className="botao-primario botao-compacto"
                      disabled={enviando}
                      onClick={() => {
                        const n = Number(quantidades[`exp:${chaveDe(c)}`] ?? '');
                        if (!Number.isInteger(n) || n < 1) {
                          setMensagem({ tipo: 'erro', texto: 'Informe os volumes expedidos (inteiro, 1 ou mais).' });
                          return;
                        }
                        if (!window.confirm(`Confirmar a saída física de ${volumes(n)} volume(s) de ${documento(c)} (palete ${c.palletCode})?`)) return;
                        const corpo = { items: [{ ...alvo(c), volumes: n }], reference: null };
                        void enviar(`expedir:${id}:${JSON.stringify(corpo)}`, `${API_PREFIXO}/janelas/${id}/volumes/expedicoes`, corpo, `Expedição de ${volumes(n)} volume(s) confirmada.`);
                      }}
                      data-testid="vj-expedir-botao"
                    >
                      Confirmar expedição
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="cartao painel-secao" aria-labelledby="vj-registros" data-testid="vj-registros">
        <h3 id="vj-registros">Registros da janela</h3>
        {v.events.length === 0 ? (
          <p className="estado-vazio">Sem registros.</p>
        ) : (
          <ol className="painel-linha-tempo">
            {v.events.map((e) => {
              const podeEstornar = e.reversible > 0 && ((e.type === 'SEPARACAO' && pode('expedicao.preparar')) || (e.type === 'EXPEDICAO' && pode('expedicao.confirmar')));
              return (
                <li key={e.id} className={e.correctsEventId !== null ? 'painel-evento painel-evento--correcao' : 'painel-evento'}>
                  <time dateTime={e.at}>{formatarDataHora(e.at)}</time>
                  <strong>
                    {ROTULO_EVENTO[e.type]} · {volumes(e.volumes)} volume(s)
                  </strong>
                  <span>
                    {documento(e)} · palete {e.palletCode}
                    {e.selectionLineRow !== null ? ` · linha ${String(e.selectionLineRow)} da seleção` : ''}
                    {e.by ? ` · ${e.by.name}` : ''}
                    {e.reason ? ` · motivo: ${e.reason}` : ''}
                  </span>
                  {podeEstornar && estorno?.evento !== e.id && (
                    <button
                      type="button"
                      className="botao-link"
                      onClick={() => {
                        setEstorno({ evento: e.id, volumes: String(e.reversible), motivo: '' });
                      }}
                    >
                      Estornar (corrigir registro)
                    </button>
                  )}
                  {estorno?.evento === e.id && (
                    <form
                      className="filtro-periodo"
                      onSubmit={(ev) => {
                        ev.preventDefault();
                        const n = Number(estorno.volumes);
                        if (!Number.isInteger(n) || n < 1 || n > e.reversible || estorno.motivo.trim().length < 3) {
                          setMensagem({ tipo: 'erro', texto: `Informe de 1 a ${String(e.reversible)} volume(s) e o motivo (3 a 300 caracteres).` });
                          return;
                        }
                        const corpo = { eventId: e.id, volumes: n, reason: estorno.motivo.trim() };
                        void enviar(
                          `estorno:${id}:${JSON.stringify(corpo)}`,
                          `${API_PREFIXO}/janelas/${id}/volumes/estornos`,
                          corpo,
                          'Estorno registrado (o registro original continua no histórico).',
                        ).then(() => {
                          setEstorno(null);
                        });
                      }}
                    >
                      <label className="campo">
                        <span className="campo-rotulo">Volumes</span>
                        <input
                          inputMode="numeric"
                          value={estorno.volumes}
                          onChange={(ev) => {
                            setEstorno({ ...estorno, volumes: ev.target.value });
                          }}
                        />
                      </label>
                      <label className="campo">
                        <span className="campo-rotulo">Motivo</span>
                        <input
                          value={estorno.motivo}
                          maxLength={300}
                          onChange={(ev) => {
                            setEstorno({ ...estorno, motivo: ev.target.value });
                          }}
                        />
                      </label>
                      <button type="submit" className="botao-primario botao-compacto" disabled={enviando}>
                        Registrar estorno
                      </button>
                      <button
                        type="button"
                        className="botao-link"
                        onClick={() => {
                          setEstorno(null);
                        }}
                      >
                        Cancelar
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </Pagina>
  );
}
