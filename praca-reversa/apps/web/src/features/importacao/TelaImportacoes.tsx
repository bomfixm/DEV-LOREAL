import {
  API_PREFIXO,
  PaginaLotesSchema,
  SITUACOES_IMPORTACAO,
  tiposImportacaoPermitidos,
  type Permissao,
  type SituacaoImportacao,
  type TipoImportacao,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar, IconeMais } from '../../components/Icones';
import { Pagina } from '../../components/Moldura';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { ROTULOS_SITUACAO, ROTULOS_TIPO } from './rotulos';

const TAMANHO = 20;

/** Histórico dos lotes de importação do escopo, com contadores e situação real. */
export function TelaImportacoes({ permissoes, aoNavegar }: { permissoes: readonly Permissao[]; aoNavegar: Navegar }) {
  const [tipo, setTipo] = useState<TipoImportacao | ''>('');
  const [situacao, setSituacao] = useState<SituacaoImportacao | ''>('');
  const [pagina, setPagina] = useState(1);
  const parametros = new URLSearchParams({ pagina: String(pagina), tamanho: String(TAMANHO) });
  if (tipo) parametros.set('tipo', tipo);
  if (situacao) parametros.set('situacao', situacao);
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/importacoes?${parametros.toString()}`, PaginaLotesSchema);
  const dados = carga?.estado === 'pronto' ? carga.dados : null;
  const paginas = dados ? Math.max(1, Math.ceil(dados.total / TAMANHO)) : 1;

  return (
    <Pagina
      titulo="Importações"
      testId="tela-importacoes"
      aoVoltar={() => {
        aoNavegar({ tipo: 'praca' });
      }}
      descricao={
        <p>
          Cadastro de produtos, documentos de devolução e lista de claims por CSV ou XLSX, com prévia e confirmação. Documentos importados são declarações e claims importados
          são só investigação: nada cria saldo físico.
        </p>
      }
    >
      {tiposImportacaoPermitidos(permissoes, 'executar').length > 0 && (
        <button
          type="button"
          className="botao-primario"
          onClick={() => {
            aoNavegar({ tipo: 'nova-importacao' });
          }}
          data-testid="nova-importacao"
        >
          <IconeMais />
          Nova importação
        </button>
      )}
      <div className="formulario-grade formulario-grade--compacta">
        <label className="campo">
          <span className="campo-rotulo">Tipo</span>
          <select value={tipo} onChange={(e) => { setTipo(e.target.value as TipoImportacao | ''); setPagina(1); }}>
            <option value="">Todos</option>
            {tiposImportacaoPermitidos(permissoes, 'consultar').map((t) => (
              <option key={t} value={t}>
                {ROTULOS_TIPO[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Situação</span>
          <select value={situacao} onChange={(e) => { setSituacao(e.target.value as SituacaoImportacao | ''); setPagina(1); }}>
            <option value="">Todas</option>
            {SITUACOES_IMPORTACAO.map((s) => (
              <option key={s} value={s}>
                {ROTULOS_SITUACAO[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {carga?.estado === 'erro' && (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar o histórico. {carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {carga?.estado === 'carregando' && <p className="estado-carregando">Carregando histórico…</p>}
      {dados?.total === 0 && <p className="estado-vazio">Nenhuma importação registrada{tipo || situacao ? ' com estes filtros' : ''}.</p>}
      {dados && dados.total > 0 && (
        <>
          <ul className="lista-lotes" data-testid="lista-lotes">
            {dados.items.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  className="item-lote"
                  onClick={() => {
                    aoNavegar({ tipo: 'importacao', id: l.id });
                  }}
                  data-testid="item-lote"
                  data-situacao={l.state}
                >
                  <span className="item-lote-topo">
                    <strong>{l.fileName}</strong>
                    <span className={`selo-situacao-lote selo-situacao-lote--${l.state}`}>{ROTULOS_SITUACAO[l.state]}</span>
                  </span>
                  <span className="item-lote-dados">
                    {ROTULOS_TIPO[l.type]} · {l.format} · enviado em {formatarDataHora(l.createdAt)}
                    {l.createdBy ? ` por ${l.createdBy.name}` : ''}
                  </span>
                  <span className="item-lote-dados">
                    {l.counters.total} linha(s): {l.counters.validNew} válidas novas, {l.counters.duplicate} duplicadas, {l.counters.invalid} inválidas, {l.counters.conflicting} conflitantes
                    {l.state === 'CONFIRMADO' && ` · gravadas ${String(l.counters.written)}, ignoradas ${String(l.counters.ignored)}`}
                  </span>
                  {l.lastFailure && <span className="item-alerta">Última confirmação falhou: nada foi gravado</span>}
                </button>
              </li>
            ))}
          </ul>
          <nav className="paginacao" aria-label="Páginas do histórico">
            <button type="button" className="botao-secundario botao-compacto" disabled={pagina <= 1} onClick={() => { setPagina((p) => p - 1); }}>
              Anterior
            </button>
            <span>
              Página {pagina} de {paginas} ({dados.total} lote(s))
            </span>
            <button type="button" className="botao-secundario botao-compacto" disabled={pagina >= paginas} onClick={() => { setPagina((p) => p + 1); }}>
              Próxima
            </button>
          </nav>
        </>
      )}
    </Pagina>
  );
}
