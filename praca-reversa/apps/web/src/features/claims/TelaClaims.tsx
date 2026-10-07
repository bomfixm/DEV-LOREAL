import {
  API_PREFIXO,
  MOTIVOS_CLAIM,
  PRIORIDADES_CLAIM,
  PaginaClaimsSchema,
  ResponsaveisClaimSchema,
  ResumoClaimsSchema,
  SITUACOES_CLAIM,
  type FiltroPendencia,
  type MotivoClaim,
  type OrdemClaims,
  type Permissao,
} from '@praca-reversa/contracts';
import { useId, useState } from 'react';
import { baixarArquivo, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeArquivo, IconeAtualizar, IconeMais } from '../../components/Icones';
import { Pagina } from '../../components/Moldura';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import {
  ROTULOS_FILTRO_PENDENCIA,
  ROTULOS_MOTIVO,
  ROTULOS_ORDEM,
  ROTULOS_PRIORIDADE,
  ROTULOS_SITUACAO,
  formatarDataInformada,
  formatarValor,
  textoUnidades,
  textoValores,
} from './rotulos';
import { ABERTOS, VAZIOS, memoria, type Filtros } from './memoria';

const TAMANHO = 20;

function parametros(f: Filtros, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams(extra);
  if (f.texto.trim()) p.set('texto', f.texto.trim());
  if (f.motivo) p.set('motivo', f.motivo);
  if (f.situacao === 'ABERTOS') p.set('situacao', ABERTOS.join(','));
  else if (f.situacao) p.set('situacao', f.situacao);
  if (f.responsavel) p.set('responsavel', f.responsavel);
  if (f.prazo) p.set('prazo', f.prazo);
  if (f.pendencia) p.set('pendencia', f.pendencia);
  if (f.prioridade) p.set('prioridade', f.prioridade);
  if (f.ordem) p.set('ordem', f.ordem);
  return p.toString();
}

/**
 * Lista de claims do escopo ativo: filtros, ordenação e paginação no
 * servidor; resumo do módulo com as bases separadas (estimado em análise não
 * é valor evitado). No celular a lista vira cartões.
 */
export function TelaClaims({ permissoes, chaveMemoria, aoNavegar }: { permissoes: readonly Permissao[]; chaveMemoria: string; aoNavegar: Navegar }) {
  const ids = useId();
  const [f, setF] = useState<Filtros>(() => memoria.get(chaveMemoria) ?? VAZIOS);
  const [texto, setTexto] = useState(f.texto);
  const [erroExportar, setErroExportar] = useState<string | null>(null);
  const atualizar = (parcial: Partial<Filtros>) => {
    const novo = { ...f, pagina: 1, ...parcial };
    memoria.set(chaveMemoria, novo);
    setF(novo);
  };
  const consulta = parametros(f);
  const lista = useRecurso(`${API_PREFIXO}/claims?${parametros(f, { pagina: String(f.pagina), tamanho: String(TAMANHO) })}`, PaginaClaimsSchema);
  const resumo = useRecurso(`${API_PREFIXO}/claims/resumo?${consulta}`, ResumoClaimsSchema);
  const responsaveis = useRecurso(`${API_PREFIXO}/claims/responsaveis`, ResponsaveisClaimSchema);
  const dados = lista.carga?.estado === 'pronto' ? lista.carga.dados : null;
  const r = resumo.carga?.estado === 'pronto' ? resumo.carga.dados : null;
  const paginas = dados ? Math.max(1, Math.ceil(dados.total / TAMANHO)) : 1;
  const podeTratar = permissoes.includes('claim.tratar');
  const filtrado = consulta !== '';

  return (
    <Pagina ajuda="claim"
      titulo="Claims"
      testId="tela-claims"
      aoVoltar={() => {
        aoNavegar({ tipo: 'praca' });
      }}
      descricao={
        <p>
          Casos de falta, avaria e divergência documental. Coincidência de SKU é pista, não prova; recuperação física validada e resultado financeiro são registros
          separados.
        </p>
      }
    >
      <div className="acoes-linha">
        {podeTratar && (
          <button
            type="button"
            className="botao-primario"
            onClick={() => {
              aoNavegar({ tipo: 'novo-claim' });
            }}
            data-testid="novo-claim"
          >
            <IconeMais />
            Novo claim
          </button>
        )}
        {podeTratar && (
          <button
            type="button"
            className="botao-secundario"
            onClick={() => {
              aoNavegar({ tipo: 'nova-importacao' });
            }}
            data-testid="importar-claims"
          >
            <IconeArquivo />
            Importar lista (CSV/XLSX)
          </button>
        )}
        {podeTratar && (
          <button
            type="button"
            className="botao-secundario"
            onClick={() => {
              setErroExportar(null);
              baixarArquivo(`${API_PREFIXO}/claims/exportar?${consulta}`, 'claims.csv').catch((e: unknown) => {
                setErroExportar(mensagemDeFalha(e));
              });
            }}
            data-testid="exportar-claims"
          >
            <IconeArquivo />
            Exportar CSV {filtrado ? '(filtros aplicados)' : ''}
          </button>
        )}
      </div>
      {erroExportar && (
        <p className="estado-erro" role="alert">
          {erroExportar}
        </p>
      )}

      <section className="cartao resumo-claims" aria-labelledby={`${ids}-resumo`} data-testid="resumo-claims">
        <h3 id={`${ids}-resumo`}>Resumo {filtrado ? 'dos casos filtrados' : 'do escopo'}</h3>
        {resumo.carga?.estado === 'erro' && <p className="estado-erro">Resumo indisponível. {resumo.carga.mensagem}</p>}
        {r && (
          <>
            <dl className="resumo-claims-numeros">
              <div>
                <dt>Casos</dt>
                <dd>{r.cases}</dd>
              </div>
              <div>
                <dt>Recuperação física validada</dt>
                <dd>{textoUnidades(r.validatedRecovery.map((v) => ({ unit: v.unit, quantity: v.quantity })))}</dd>
              </div>
              <div>
                <dt>Estimado em análise</dt>
                <dd>{textoValores(r.estimated)}</dd>
              </div>
              <div>
                <dt>Valor evitado confirmado</dt>
                <dd>{textoValores(r.avoidedConfirmed)}</dd>
              </div>
              <div>
                <dt>Perda confirmada</dt>
                <dd>{textoValores(r.lossConfirmed)}</dd>
              </div>
            </dl>
            <p className="resumo-claims-situacoes">
              {r.byState.map((s) => `${ROTULOS_SITUACAO[s.state]}: ${String(s.count)}`).join(' · ') || 'Nenhum caso.'}
            </p>
            <p className="resumo-claims-situacoes">
              Pendências: {r.pendencies.filter((p) => p.count > 0).map((p) => `${ROTULOS_FILTRO_PENDENCIA[p.code]} (${String(p.count)})`).join(' · ') || 'nenhuma'}
            </p>
            <details className="campo-ajuda">
              <summary>Base dos números</summary>
              <ul>
                {r.basis.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </details>
          </>
        )}
      </section>

      <form
        className="formulario-grade formulario-grade--compacta filtros-claims"
        onSubmit={(e) => {
          e.preventDefault();
          atualizar({ texto });
        }}
        aria-label="Filtros dos claims"
      >
        <label className="campo">
          <span className="campo-rotulo">Código, referência, SKU ou origem</span>
          <input
            value={texto}
            maxLength={80}
            onChange={(e) => {
              setTexto(e.target.value);
            }}
            onBlur={() => {
              if (texto !== f.texto) atualizar({ texto });
            }}
            data-testid="filtro-texto-claims"
          />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Motivo</span>
          <select value={f.motivo} onChange={(e) => { atualizar({ motivo: e.target.value as MotivoClaim | '' }); }}>
            <option value="">Todos</option>
            {MOTIVOS_CLAIM.map((m) => (
              <option key={m} value={m}>
                {ROTULOS_MOTIVO[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Situação</span>
          <select value={f.situacao} onChange={(e) => { atualizar({ situacao: e.target.value as Filtros['situacao'] }); }} data-testid="filtro-situacao-claims">
            <option value="">Todas</option>
            <option value="ABERTOS">Em aberto (não encerrados)</option>
            {SITUACOES_CLAIM.map((s) => (
              <option key={s} value={s}>
                {ROTULOS_SITUACAO[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Responsável</span>
          <select value={f.responsavel} onChange={(e) => { atualizar({ responsavel: e.target.value }); }}>
            <option value="">Todos</option>
            <option value="NENHUM">Sem responsável</option>
            {responsaveis.carga?.estado === 'pronto' &&
              responsaveis.carga.dados.items.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Prazo</span>
          <select value={f.prazo} onChange={(e) => { atualizar({ prazo: e.target.value as Filtros['prazo'] }); }} data-testid="filtro-prazo-claims">
            <option value="">Qualquer</option>
            <option value="VENCIDO">Vencido (em aberto)</option>
            <option value="PROXIMOS_7_DIAS">Próximos 7 dias</option>
            <option value="COM_PRAZO">Com prazo informado</option>
            <option value="SEM_PRAZO">Prazo não informado</option>
          </select>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Pendência</span>
          <select value={f.pendencia} onChange={(e) => { atualizar({ pendencia: e.target.value as FiltroPendencia | '' }); }} data-testid="filtro-pendencia-claims">
            <option value="">Qualquer</option>
            {(Object.keys(ROTULOS_FILTRO_PENDENCIA) as FiltroPendencia[]).map((p) => (
              <option key={p} value={p}>
                {ROTULOS_FILTRO_PENDENCIA[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Prioridade manual</span>
          <select value={f.prioridade} onChange={(e) => { atualizar({ prioridade: e.target.value as Filtros['prioridade'] }); }}>
            <option value="">Qualquer</option>
            {PRIORIDADES_CLAIM.map((p) => (
              <option key={p} value={p}>
                {ROTULOS_PRIORIDADE[p]}
              </option>
            ))}
            <option value="NENHUMA">Não definida</option>
          </select>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Ordenar por</span>
          <select value={f.ordem} onChange={(e) => { atualizar({ ordem: e.target.value as OrdemClaims | '' }); }} data-testid="ordem-claims">
            <option value="">Padrão configurado{dados ? ` (${ROTULOS_ORDEM[dados.defaultSort].toLowerCase()})` : ''}</option>
            {(Object.keys(ROTULOS_ORDEM) as OrdemClaims[]).map((o) => (
              <option key={o} value={o}>
                {ROTULOS_ORDEM[o]}
              </option>
            ))}
          </select>
        </label>
        <div className="acoes-linha filtros-claims-acoes">
          <button type="submit" className="botao-secundario">
            Aplicar
          </button>
          {filtrado && (
            <button
              type="button"
              className="botao-link"
              onClick={() => {
                setTexto('');
                atualizar(VAZIOS);
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>
      </form>

      {lista.carga?.estado === 'erro' && (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar os claims. {lista.carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={lista.recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {lista.carga?.estado === 'carregando' && <p className="estado-carregando">Carregando claims…</p>}
      {dados?.total === 0 && <p className="estado-vazio">Nenhum claim{filtrado ? ' com estes filtros' : ' registrado neste escopo'}.</p>}
      {dados && dados.total > 0 && (
        <>
          <div className="lista-claims-cabecalho" aria-hidden="true">
            <span>Caso</span>
            <span>Motivo</span>
            <span>Produto(s)</span>
            <span>Em análise</span>
            <span>Recuperação validada</span>
            <span>Prazo</span>
            <span>Responsável</span>
            <span>Situação</span>
            <span>Prioridade</span>
            <span>Valor estimado</span>
          </div>
          <ul className="lista-claims" data-testid="lista-claims">
            {dados.items.map((c) => {
              const vencido = c.deadline !== null && c.deadline < dados.today && !['REGULARIZADO', 'PERDA_CONFIRMADA', 'ENCERRADO'].includes(c.state);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className="item-claim"
                    onClick={() => {
                      aoNavegar({ tipo: 'claim', id: c.id, linha: null, aba: null });
                    }}
                    data-testid="item-claim"
                    data-situacao={c.state}
                  >
                    <span className="item-claim-caso">
                      <strong>{c.code}</strong>
                      <span>{c.externalReference ?? 'referência não informada'}</span>
                      {c.triage && <span className="selo selo-alerta">Triagem</span>}
                      {c.pendingValidations > 0 && <span className="selo selo-alerta">{c.pendingValidations} validação(ões)</span>}
                    </span>
                    <span data-rotulo="Motivo">{ROTULOS_MOTIVO[c.reason]}</span>
                    <span data-rotulo="Produto(s)">
                      {c.firstSku}
                      {c.lineCount > 1 ? ` +${String(c.lineCount - 1)}` : ''}
                    </span>
                    <span data-rotulo="Em análise">{textoUnidades(c.inAnalysis)}</span>
                    <span data-rotulo="Recuperação validada">{textoUnidades(c.validatedRecovery)}</span>
                    <span data-rotulo="Prazo" className={vencido ? 'texto-vencido' : undefined}>
                      {formatarDataInformada(c.deadline)}
                      {vencido ? ' (vencido)' : ''}
                    </span>
                    <span data-rotulo="Responsável">{c.responsible?.name ?? 'sem responsável'}</span>
                    <span data-rotulo="Situação">
                      <span className={`selo selo-claim selo-claim--${c.state}`}>{ROTULOS_SITUACAO[c.state]}</span>
                    </span>
                    <span data-rotulo="Prioridade">{c.priority ? ROTULOS_PRIORIDADE[c.priority] : 'não definida'}</span>
                    <span data-rotulo="Valor estimado">
                      {c.estimated === null ? 'não informado' : `${formatarValor(c.estimated, c.currency)}${c.estimatePartial ? ' (parcial)' : ''}`}
                      {c.chargeFinalized ? ' · cobrança finalizada' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <nav className="paginacao" aria-label="Páginas dos claims">
            <button type="button" className="botao-secundario botao-compacto" disabled={f.pagina <= 1} onClick={() => { atualizar({ pagina: f.pagina - 1 }); }}>
              Anterior
            </button>
            <span>
              Página {f.pagina} de {paginas} ({dados.total} caso(s)) · consultado em {formatarDataHora(dados.consultedAt)}
            </span>
            <button type="button" className="botao-secundario botao-compacto" disabled={f.pagina >= paginas} onClick={() => { atualizar({ pagina: f.pagina + 1 }); }}>
              Próxima
            </button>
          </nav>
        </>
      )}
    </Pagina>
  );
}
