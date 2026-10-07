import {
  API_PREFIXO,
  ESTADOS_CONFERENCIA,
  LIMITE_EXPORTACAO_RELATORIO,
  RelatorioSchema,
  ROTULOS_MOTIVO_CLAIM,
  ROTULOS_SITUACAO_CLAIM,
  TIPOS_RELATORIO,
  type Permissao,
  type Relatorio,
  type TipoRelatorio,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { baixarArquivo, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar } from '../../components/Icones';
import { Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import { parametrosRelatorio, type Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { ROTULOS_CONFERENCIA } from '../paletes/estados';
import { formatarCelula, textoPeriodo } from './formato';

const TITULOS: Readonly<Record<TipoRelatorio, string>> = {
  paletes: 'Paletes e pendências',
  estoque: 'Movimento do estoque',
  expedicoes: 'Expedições e retornos',
  claims: 'Claims e valores',
  piloto: 'Grupo do piloto',
};

const PERMISSAO: Readonly<Record<TipoRelatorio, Permissao>> = {
  paletes: 'palete.consultar',
  estoque: 'palete.consultar',
  expedicoes: 'janela.consultar',
  claims: 'claim.consultar',
  piloto: 'palete.consultar',
};

const USA_PERIODO: Readonly<Record<TipoRelatorio, boolean>> = { paletes: false, estoque: true, expedicoes: true, claims: true, piloto: true };

interface Props {
  parametros: string;
  permissoes: readonly Permissao[];
  aoNavegar: Navegar;
}

/**
 * Relatórios da etapa 10. A tela, o CSV e a impressão usam o mesmo cálculo
 * do servidor, os mesmos filtros, base, horário e unidades. Exportar exige
 * permissão própria; o servidor confere também no download.
 */
export function TelaRelatorios({ parametros, permissoes, aoNavegar }: Props) {
  const p = new URLSearchParams(parametros);
  const disponiveis = TIPOS_RELATORIO.filter((t) => permissoes.includes(PERMISSAO[t]));
  const pedido = p.get('tipo') as TipoRelatorio | null;
  const tipo: TipoRelatorio | null = pedido !== null && disponiveis.includes(pedido) ? pedido : (disponiveis[0] ?? null);
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(p.entries()));
  const [exportando, setExportando] = useState(false);
  const [erroExportacao, setErroExportacao] = useState<string | null>(null);
  const conectado = useConectado();
  const consulta = new URLSearchParams(p);
  consulta.delete('tipo');
  const precisaGrupo = tipo === 'piloto' && (p.get('paletes') ?? '').trim() === '';
  const url = tipo === null || precisaGrupo ? null : `${API_PREFIXO}/relatorios/${tipo}${consulta.toString() ? `?${consulta.toString()}` : ''}`;
  const { carga, recarregar } = useRecurso(url, RelatorioSchema);
  const podeExportar = permissoes.includes('relatorio.exportar');

  const ir = (novos: Record<string, string>) => {
    aoNavegar({ tipo: 'relatorios', parametros: parametrosRelatorio(new URLSearchParams(novos)) });
  };
  const aplicar = (extra: Record<string, string> = {}) => {
    const novos: Record<string, string> = { ...form, ...extra, tipo: tipo ?? '' };
    delete novos.pagina;
    if (extra.pagina) novos.pagina = extra.pagina;
    ir(novos);
  };
  const campo = (chave: string) => form[chave] ?? '';
  const mudar = (chave: string, valor: string) => {
    setForm((f) => ({ ...f, [chave]: valor }));
  };

  async function exportar() {
    if (tipo === null) return;
    setExportando(true);
    setErroExportacao(null);
    try {
      const q = new URLSearchParams(consulta);
      q.delete('pagina');
      await baixarArquivo(`${API_PREFIXO}/relatorios/${tipo}/exportar${q.toString() ? `?${q.toString()}` : ''}`, `relatorio-${tipo}.csv`);
    } catch (erro) {
      setErroExportacao(mensagemDeFalha(erro));
    } finally {
      setExportando(false);
    }
  }

  const voltar = () => {
    aoNavegar({ tipo: 'praca' });
  };
  if (tipo === null) {
    return (
      <Pagina titulo="Relatórios" testId="tela-relatorios" aoVoltar={voltar}>
        <p className="estado-vazio">Seu perfil não consulta nenhum relatório neste escopo.</p>
      </Pagina>
    );
  }

  const r: Relatorio | null = carga?.estado === 'pronto' ? carga.dados : null;
  const paginas = r ? Math.max(1, Math.ceil(r.total / r.pageSize)) : 1;

  return (
    <Pagina
      titulo="Relatórios"
      testId="tela-relatorios"
      aoVoltar={voltar}
      descricao={<p>Tela, CSV e impressão mostram os mesmos filtros, base, horário e unidades. Códigos ficam como texto no CSV.</p>}
    >
      <nav className="abas-relatorio" aria-label="Relatórios">
        {disponiveis.map((t) => (
          <button
            key={t}
            type="button"
            className="aba-relatorio"
            aria-pressed={t === tipo}
            onClick={() => {
              const base: Record<string, string> = { tipo: t };
              if (form.inicio) base.inicio = form.inicio;
              if (form.fim) base.fim = form.fim;
              setForm(base);
              ir(base);
            }}
            data-testid={`relatorio-${t}`}
          >
            {TITULOS[t]}
          </button>
        ))}
      </nav>

      <form
        className="filtro-relatorio"
        onSubmit={(e) => {
          e.preventDefault();
          aplicar();
        }}
        aria-label="Filtros do relatório"
      >
        {USA_PERIODO[tipo] && (
          <>
            <label className="campo">
              <span className="campo-rotulo">Data inicial</span>
              <input type="date" value={campo('inicio')} onChange={(e) => { mudar('inicio', e.target.value); }} data-testid="relatorio-inicio" />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Data final</span>
              <input type="date" value={campo('fim')} onChange={(e) => { mudar('fim', e.target.value); }} data-testid="relatorio-fim" />
            </label>
          </>
        )}
        {tipo === 'paletes' && (
          <>
            <label className="campo">
              <span className="campo-rotulo">Conferência</span>
              <select value={campo('conferencia')} onChange={(e) => { mudar('conferencia', e.target.value); }} data-testid="relatorio-conferencia">
                <option value="">Todas</option>
                {ESTADOS_CONFERENCIA.map((s) => (
                  <option key={s} value={s}>
                    {ROTULOS_CONFERENCIA[s].texto}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span className="campo-rotulo">Localização</span>
              <select value={campo('localizacao')} onChange={(e) => { mudar('localizacao', e.target.value); }}>
                <option value="">Todas</option>
                <option value="COM_POSICAO">Com posição</option>
                <option value="PENDENTE">Localização pendente</option>
              </select>
            </label>
            <label className="opcao">
              <input type="checkbox" checked={campo('somentePendencias') === '1'} onChange={(e) => { mudar('somentePendencias', e.target.checked ? '1' : ''); }} />
              Somente com pendência
            </label>
          </>
        )}
        {tipo === 'estoque' && (
          <label className="campo">
            <span className="campo-rotulo">SKU (começa com)</span>
            <input value={campo('sku')} maxLength={60} spellCheck={false} onChange={(e) => { mudar('sku', e.target.value); }} />
          </label>
        )}
        {tipo === 'claims' && (
          <>
            <label className="campo">
              <span className="campo-rotulo">Situação</span>
              <select value={campo('situacao')} onChange={(e) => { mudar('situacao', e.target.value); }}>
                <option value="">Todas</option>
                {Object.entries(ROTULOS_SITUACAO_CLAIM).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span className="campo-rotulo">Motivo</span>
              <select value={campo('motivo')} onChange={(e) => { mudar('motivo', e.target.value); }}>
                <option value="">Todos</option>
                {Object.entries(ROTULOS_MOTIVO_CLAIM).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {tipo === 'piloto' && (
          <label className="campo campo--largo">
            <span className="campo-rotulo">Paletes do grupo (códigos separados por vírgula, espaço ou linha)</span>
            <textarea rows={3} value={campo('paletes')} onChange={(e) => { mudar('paletes', e.target.value); }} data-testid="relatorio-paletes" />
          </label>
        )}
        <button type="submit" className="botao-primario botao-compacto" data-testid="relatorio-aplicar">
          Consultar
        </button>
      </form>

      {precisaGrupo && (
        <p className="estado-vazio" data-testid="relatorio-sem-grupo">
          Informe os códigos dos paletes do grupo do piloto para comparar o início e o fim do período (veja docs/ROTEIRO-DO-PILOTO.md).
        </p>
      )}
      {carga?.estado === 'erro' && (
        <div className="estado-erro" role="alert">
          <p>Não foi possível gerar o relatório. {carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {url !== null && carga?.estado === 'carregando' && <p className="estado-carregando">Calculando no servidor…</p>}
      {r && (
        <article className="relatorio" data-testid="relatorio" data-tipo={r.type}>
          <header className="cartao relatorio-cabecalho">
            <h3>{r.title}</h3>
            <p>
              <strong>Unidade/cliente:</strong> {r.scope.name}
              {r.scope.demo && <span className="selo-demo-inline"> Demonstração · dados fictícios</span>}
            </p>
            {r.period && (
              <p>
                <strong>Período:</strong> {textoPeriodo(r.period)}
              </p>
            )}
            {r.filters.map((f) => (
              <p key={f.label}>
                <strong>{f.label}:</strong> {f.value}
              </p>
            ))}
            <p>
              <strong>Consultado em:</strong> {formatarDataHora(r.consultedAt)} (horário de Brasília)
            </p>
            <details className="relatorio-base" open>
              <summary>Base dos números</summary>
              <ul>
                {r.basis.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </details>
            {r.notes.length > 0 && (
              <ul className="relatorio-notas" data-testid="relatorio-notas">
                {r.notes.map((n) => (
                  <li key={n} className="mensagem-conflito">
                    {n}
                  </li>
                ))}
              </ul>
            )}
            <div className="acoes-linha">
              {podeExportar && (
                <button type="button" className="botao-secundario botao-compacto" disabled={exportando || !conectado} onClick={() => { void exportar(); }} data-testid="relatorio-exportar">
                  {exportando ? 'Gerando CSV no servidor…' : 'Exportar CSV'}
                </button>
              )}
              <button type="button" className="botao-secundario botao-compacto" onClick={() => { window.print(); }}>
                Imprimir
              </button>
            </div>
            {podeExportar && <p className="filtro-nota">CSV com até {LIMITE_EXPORTACAO_RELATORIO.toLocaleString('pt-BR')} linhas, mesmos filtros; campos de texto protegidos contra fórmulas.</p>}
            {erroExportacao && (
              <p className="estado-erro" role="alert">
                {erroExportacao}
              </p>
            )}
          </header>
          {r.summary.length > 0 && (
            <dl className="relatorio-totais" data-testid="relatorio-totais">
              {r.summary.map((s) => (
                <div key={s.label}>
                  <dt>{s.label}</dt>
                  <dd>{formatarCelula({ key: '', label: s.label, kind: s.kind }, s.value)}</dd>
                </div>
              ))}
            </dl>
          )}
          {r.rows.length === 0 ? (
            <p className="estado-vazio" data-testid="relatorio-vazio">
              Nenhuma linha com estes filtros.
            </p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela-relatorio" data-testid="relatorio-tabela">
                <thead>
                  <tr>
                    {r.columns.map((c) => (
                      <th key={c.key} scope="col">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((linha, i) => (
                    <tr key={i}>
                      {r.columns.map((c) => (
                        <td key={c.key} data-rotulo={c.label} className={c.kind === 'quantidade' || c.kind === 'numero' ? 'numero' : undefined}>
                          {formatarCelula(c, linha[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {paginas > 1 && (
            <nav className="paginacao" aria-label="Páginas do relatório">
              <button type="button" className="botao-secundario botao-compacto" disabled={r.page <= 1} onClick={() => { aplicar({ pagina: String(r.page - 1) }); }}>
                Anterior
              </button>
              <span>
                Página {r.page} de {paginas} ({r.total} linha(s))
              </span>
              <button type="button" className="botao-secundario botao-compacto" disabled={r.page >= paginas} onClick={() => { aplicar({ pagina: String(r.page + 1) }); }}>
                Próxima
              </button>
            </nav>
          )}
        </article>
      )}
      <section className="cartao" aria-labelledby="outros-relatorios">
        <h3 id="outros-relatorios">Outras exportações existentes</h3>
        <ul>
          <li>Busca de conteúdo: "Exportar resultado (CSV)" no painel de busca do mapa.</li>
          {permissoes.includes('claim.consultar') && <li>Lista de claims: "Exportar CSV" na página Claims, com os filtros da lista.</li>}
          {permissoes.includes('janela.consultar') && <li>Janelas: exportação do resumo em Janelas de devolução e a lista de preparação de cada reserva.</li>}
        </ul>
      </section>
    </Pagina>
  );
}
