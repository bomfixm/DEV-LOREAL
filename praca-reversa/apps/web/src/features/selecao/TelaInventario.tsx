import {
  API_PREFIXO,
  InventarioResumoSchema,
  PaginaLinhasInventarioSchema,
  ROTULOS_ACAO_INVENTARIO,
  type FiltroLinhasInventario,
  type Permissao,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { useChaves } from '../../api/chaves';
import { FalhaRequisicao, enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar } from '../../components/Icones';
import { MensagemAcao, Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import type { Navegar } from '../../rotas';
import { formatarData, formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';

const TAMANHO = 50;
type Situacao = FiltroLinhasInventario['situacao'];
const ROTULOS_FILTRO: Record<Situacao, string> = { TODAS: 'Todas', APLICADAS: 'Aplicadas', PENDENTES: 'Requerem resolução', HISTORICAS: 'Históricas / endereço livre' };

/** Reconhecer a conferência externa: evidência separada da importação documental (não muda saldo). */
function ConferenciaExterna({ id, versao, aoGravado }: { id: string; versao: number; aoGravado: () => void }) {
  const chaves = useChaves();
  const conectado = useConectado();
  const [referencia, setReferencia] = useState('');
  const [data, setData] = useState('');
  const [fonte, setFonte] = useState('');
  const [obs, setObs] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null>(null);
  async function gravar() {
    const corpo = { expectedVersion: versao, reference: referencia.trim(), date: data === '' ? null : data, source: fonte.trim(), notes: obs.trim() === '' ? null : obs.trim() };
    const assinatura = `conferencia-externa:${id}:${JSON.stringify(corpo)}`;
    setEnviando(true);
    try {
      await enviarJson('POST', `${API_PREFIXO}/inventarios/${id}/conferencia-externa`, InventarioResumoSchema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      setMensagem({ tipo: 'ok', texto: 'Conferência externa reconhecida no nível documental. Saldo validado, liberação e reservas não mudaram.' });
      aoGravado();
    } catch (e) {
      chaves.concluir(assinatura, e);
      setMensagem({ tipo: e instanceof FalhaRequisicao && e.codigo === 'CONFLITO_VERSAO' ? 'conflito' : 'erro', texto: mensagemDeFalha(e) });
    } finally {
      setEnviando(false);
    }
  }
  return (
    <fieldset className="cartao" data-testid="form-conferencia-externa">
      <legend className="campo-rotulo">Reconhecer a conferência externa</legend>
      <p className="campo-ajuda">
        Registra a evidência (referência, data, fonte, responsável) e marca os vínculos deste inventário como conferidos no nível que o arquivo comprova (NF, palete, endereço,
        volumes). Não cria saldo por produto, não libera material e não exige nova contagem.
      </p>
      <div className="formulario-grade formulario-grade--compacta">
        <label className="campo">
          <span className="campo-rotulo">Referência *</span>
          <input value={referencia} maxLength={120} onChange={(e) => { setReferencia(e.target.value); }} />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Data (se conhecida)</span>
          <input type="date" value={data} onChange={(e) => { setData(e.target.value); }} />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Fonte *</span>
          <input value={fonte} maxLength={200} onChange={(e) => { setFonte(e.target.value); }} placeholder="ex.: planilha conferida pela equipe do turno" />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Observação</span>
          <input value={obs} maxLength={500} onChange={(e) => { setObs(e.target.value); }} />
        </label>
      </div>
      <MensagemAcao mensagem={mensagem} testId="mensagem-conferencia-externa" />
      <button type="button" className="botao-primario" disabled={referencia.trim() === '' || fonte.trim().length < 3 || enviando || !conectado} onClick={() => { void gravar(); }}>
        {enviando ? 'Registrando…' : 'Reconhecer conferência externa'}
      </button>
    </fieldset>
  );
}

/** Detalhe do inventário de referência: fotografia, linhas aplicadas/pendentes/históricas e conferência externa. */
export function TelaInventario({ id, permissoes, aoNavegar, aoGravar }: { id: string; permissoes: readonly Permissao[]; aoNavegar: Navegar; aoGravar: () => void }) {
  const [versao, setVersao] = useState(0);
  const [situacao, setSituacao] = useState<Situacao>('TODAS');
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const inventario = useRecurso(`${API_PREFIXO}/inventarios/${id}`, InventarioResumoSchema, versao);
  const p = new URLSearchParams({ situacao, pagina: String(pagina), tamanho: String(TAMANHO) });
  if (busca.trim()) p.set('texto', busca.trim());
  const linhas = useRecurso(`${API_PREFIXO}/inventarios/${id}/linhas?${p.toString()}`, PaginaLinhasInventarioSchema, versao);
  const i = inventario.carga?.estado === 'pronto' ? inventario.carga.dados : null;
  const pagLinhas = linhas.carga?.estado === 'pronto' ? linhas.carga.dados : null;
  const podeReconhecer = permissoes.includes('conferencia.reconciliar');
  return (
    <Pagina
      titulo={i ? `Inventário ${i.code}` : 'Inventário de referência'}
      testId="tela-inventario"
      ajuda="selecao"
      rotuloVoltar="Voltar aos inventários"
      aoVoltar={() => {
        aoNavegar({ tipo: 'inventarios' });
      }}
    >
      {inventario.carga?.estado === 'erro' && (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar o inventário. {inventario.carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={inventario.recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {i === null && inventario.carga?.estado !== 'erro' && <p className="estado-carregando">Carregando inventário…</p>}
      {i && (
        <>
          <section className="cartao" data-testid="resumo-inventario">
            <h3>{i.description}</h3>
            <dl className="situacao">
              <div>
                <dt>Situação</dt>
                <dd>{i.state === 'ATIVO' ? 'Vigente' : 'Substituído por versão nova'}</dd>
              </div>
              <div>
                <dt>Conferência</dt>
                <dd>
                  {i.countReference}
                  {i.countDate ? `, ${formatarData(`${i.countDate}T12:00:00Z`)}` : ', data não informada'}
                  {i.countSource ? ` · ${i.countSource}` : ''}
                </dd>
              </div>
              <div>
                <dt>Arquivo</dt>
                <dd>
                  {i.fileName ?? '—'}
                  {i.sheet ? ` · aba "${i.sheet}"` : ''}
                  {i.fileHash ? ` · SHA-256 ${i.fileHash.slice(0, 12)}…` : ''}{' '}
                  {i.batchId && (
                    <button type="button" className="botao-link" onClick={() => { if (i.batchId) aoNavegar({ tipo: 'importacao', id: i.batchId }); }}>
                      ver lote
                    </button>
                  )}
                </dd>
              </div>
              <div>
                <dt>N° Pallet</dt>
                <dd>{i.palletNumberMeaning === 'IDENTIFICADOR_PALETE' ? 'identifica o palete' : i.palletNumberMeaning === 'REFERENCIA_EXTERNA' ? 'referência externa (não identifica o palete; o mesmo número pode estar em outro endereço)' : 'numera a posição'}</dd>
              </div>
              <div>
                <dt>Linhas</dt>
                <dd data-testid="totais-inventario">
                  {i.totals.lines}: {i.totals.applied} aplicada(s), {i.totals.pending} pendente(s), {i.totals.historical} histórica(s)
                </dd>
              </div>
              <div>
                <dt>Importado</dt>
                <dd>
                  {formatarDataHora(i.createdAt)}
                  {i.createdBy ? ` por ${i.createdBy.name}` : ''}
                </dd>
              </div>
              <div>
                <dt>Conferência externa</dt>
                <dd data-testid="conferencia-externa">
                  {i.externalCount.state === 'RECONHECIDA'
                    ? `Reconhecida: ${i.externalCount.reference ?? ''}${i.externalCount.date ? `, ${formatarData(`${i.externalCount.date}T12:00:00Z`)}` : ''} · ${i.externalCount.source ?? ''}${i.externalCount.by ? ` · por ${i.externalCount.by.name}` : ''}`
                    : 'Não registrada (vínculos documentais sem evidência de conferência externa)'}
                </dd>
              </div>
            </dl>
          </section>
          {podeReconhecer && i.externalCount.state === 'NAO_REGISTRADA' && i.state === 'ATIVO' && (
            <ConferenciaExterna
              id={i.id}
              versao={i.version}
              aoGravado={() => {
                setVersao((v) => v + 1);
                aoGravar();
              }}
            />
          )}
          <section className="cartao" aria-label="Linhas do inventário" data-testid="linhas-inventario">
            <div className="abas-classificacao" role="group" aria-label="Filtrar linhas">
              {(Object.keys(ROTULOS_FILTRO) as Situacao[]).map((x) => (
                <button key={x} type="button" aria-pressed={situacao === x} onClick={() => { setSituacao(x); setPagina(1); }}>
                  {ROTULOS_FILTRO[x]}
                </button>
              ))}
            </div>
            <form
              className="acoes-linha"
              onSubmit={(e) => {
                e.preventDefault();
                setBusca(texto);
                setPagina(1);
              }}
            >
              <label className="campo">
                <span className="campo-rotulo">NF, N° Pallet, endereço ou DELIVERY</span>
                <input value={texto} maxLength={64} onChange={(e) => { setTexto(e.target.value); }} />
              </label>
              <button type="submit" className="botao-secundario">
                Procurar
              </button>
            </form>
            {linhas.carga?.estado === 'erro' && <p className="estado-erro">{linhas.carga.mensagem}</p>}
            {pagLinhas?.total === 0 && <p className="estado-vazio">Nenhuma linha com este filtro.</p>}
            {pagLinhas && pagLinhas.total > 0 && (
              <div className="tabela-rolagem">
                <table className="tabela-comparacao">
                  <thead>
                    <tr>
                      <th scope="col">Linha</th>
                      <th scope="col">Documento</th>
                      <th scope="col">N° Pallet → palete</th>
                      <th scope="col">Endereço informado → posição</th>
                      <th scope="col">Volumes</th>
                      <th scope="col">Documentação</th>
                      <th scope="col">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagLinhas.items.map((l) => (
                      <tr key={l.id} data-testid="linha-inventario">
                        <td>{l.row}</td>
                        <td>
                          {l.documentType ?? '?'} {l.documentNumber ?? '—'}
                          {l.delivery ? <span className="tabela-nota"> · DELIVERY {l.delivery}</span> : null}
                        </td>
                        <td>
                          {l.palletNumber ?? '—'} →{' '}
                          {l.pallet ? (
                            <button type="button" className="botao-link" onClick={() => { if (l.pallet) aoNavegar({ tipo: 'palete', id: l.pallet.id }); }}>
                              {l.pallet.code}
                            </button>
                          ) : (
                            <span className="pendente">sem palete</span>
                          )}
                        </td>
                        <td>
                          {l.addressRead ?? '—'}
                          {l.freeAddress ? ' (livre)' : ''} → {l.position ? l.position.code : <span className="pendente">posição visual pendente</span>}
                        </td>
                        <td>{l.volumes === null ? (l.volumesRead ?? '—') : `${formatarQuantidade(l.volumes)} volumes`}</td>
                        <td>{l.documentation ?? '—'}</td>
                        <td>
                          {ROTULOS_ACAO_INVENTARIO[l.action]}
                          {!l.applied && l.reasons.length > 0 && <span className="tabela-nota"> · {l.reasons[0]?.message}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pagLinhas && pagLinhas.total > TAMANHO && (
              <nav className="paginacao" aria-label="Páginas das linhas">
                <button type="button" className="botao-secundario botao-compacto" disabled={pagina <= 1} onClick={() => { setPagina((x) => x - 1); }}>
                  Anterior
                </button>
                <span>
                  Página {pagina} de {Math.ceil(pagLinhas.total / TAMANHO)}
                </span>
                <button type="button" className="botao-secundario botao-compacto" disabled={pagina * TAMANHO >= pagLinhas.total} onClick={() => { setPagina((x) => x + 1); }}>
                  Próxima
                </button>
              </nav>
            )}
          </section>
        </>
      )}
    </Pagina>
  );
}
