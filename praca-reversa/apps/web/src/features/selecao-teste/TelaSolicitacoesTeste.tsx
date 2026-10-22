import { ListaSolicitacoesTesteSchema, ROTULO_SITUACAO_SOLICITACAO_TESTE, SituacaoSolicitacaoTesteSchema, type SituacaoSolicitacaoTeste } from '@praca-reversa/contracts';
import { useState } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar } from '../../components/Icones';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { PassosTeste, SeloAmbienteTeste } from './comum';
import { API_TESTE, textoAgenda, textoVolumes } from './textos';

/**
 * Lista interna das solicitações de teste (enviar e acompanhar), separada
 * das seleções importadas e das agendas reais. Abre o detalhe para revisar,
 * pedir alteração ou responder.
 */
export function TelaSolicitacoesTeste({ aoNavegar }: { aoNavegar: Navegar }) {
  const { carga, recarregar } = useRecurso(`${API_TESTE}/solicitacoes`, ListaSolicitacoesTesteSchema);
  const [situacao, setSituacao] = useState<SituacaoSolicitacaoTeste | ''>('');
  const [agenda, setAgenda] = useState('');
  const lista = carga?.estado === 'pronto' ? carga.dados.items : [];
  const agendas = [...new Set(lista.map((s) => textoAgenda(s.agenda)))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const filtradas = lista.filter((s) => (situacao === '' || s.status === situacao) && (agenda === '' || textoAgenda(s.agenda) === agenda));

  return (
    <main className="principal principal--pagina st-pagina" data-testid="tela-solicitacoes-teste">
      <div className="pagina-conteudo st-conteudo">
        <header className="st-topo">
          <div>
            <h2>Solicitações de teste</h2>
            <p className="st-nota">Pedidos montados na “Seleção cliente — teste”. Ficam separados das seleções importadas e das agendas reais; nada aqui reserva ou baixa estoque.</p>
          </div>
          <SeloAmbienteTeste />
        </header>
        <PassosTeste ativo="acompanhar" solicitacaoId={null} aoNavegar={aoNavegar} />
        <div className="st-filtros">
          <label className="campo">
            <span className="campo-rotulo">Situação</span>
            <select value={situacao} onChange={(ev) => { setSituacao(ev.target.value === '' ? '' : SituacaoSolicitacaoTesteSchema.parse(ev.target.value)); }}>
              <option value="">Todas</option>
              {SituacaoSolicitacaoTesteSchema.options.map((o) => (
                <option key={o} value={o}>
                  {ROTULO_SITUACAO_SOLICITACAO_TESTE[o]}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span className="campo-rotulo">Agenda</span>
            <select value={agenda} onChange={(ev) => { setAgenda(ev.target.value); }}>
              <option value="">Todas</option>
              {agendas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            <IconeAtualizar />
            Atualizar
          </button>
          <button type="button" className="botao-primario" onClick={() => { aoNavegar({ tipo: 'selecao-teste', solicitacao: null }); }}>
            Consultar e escolher
          </button>
        </div>
        {carga === null || carga.estado === 'carregando' ? (
          <p className="st-nota" role="status">
            Carregando…
          </p>
        ) : carga.estado === 'erro' ? (
          <div className="estado-erro" role="alert">
            <p>{carga.mensagem}</p>
            <button type="button" className="botao-secundario" onClick={recarregar}>
              Tentar novamente
            </button>
          </div>
        ) : filtradas.length === 0 ? (
          <p className="st-nota">{lista.length === 0 ? 'Nenhuma solicitação de teste ainda.' : 'Nenhuma solicitação com estes filtros.'}</p>
        ) : (
          <div className="st-tabela-rolagem">
            <table className="st-tabela" data-testid="st-lista-solicitacoes">
              <thead>
                <tr>
                  <th scope="col">Solicitação</th>
                  <th scope="col">Agenda</th>
                  <th scope="col">Situação</th>
                  <th scope="col" className="st-num">Itens</th>
                  <th scope="col" className="st-num">Volumes definidos</th>
                  <th scope="col" className="st-num">Em análise</th>
                  <th scope="col">Enviada em</th>
                  <th scope="col">Por</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((s) => (
                  <tr key={s.id} data-testid="st-linha-solicitacao">
                    <td>
                      <button type="button" className="botao-link" onClick={() => { aoNavegar({ tipo: 'selecao-teste-solicitacao', id: s.id }); }}>
                        {s.code}
                      </button>
                    </td>
                    <td>{textoAgenda(s.agenda)}</td>
                    <td>
                      <span className={`st-chip st-chip--${s.status}`}>{ROTULO_SITUACAO_SOLICITACAO_TESTE[s.status]}</span>
                      {s.pendingChange && <span className="st-nota"> · aguardando resposta</span>}
                    </td>
                    <td className="st-num">{s.totals.items}</td>
                    <td className="st-num">{textoVolumes(s.totals.definedVolumes)}</td>
                    <td className="st-num">{s.totals.itemsInAnalysis}</td>
                    <td>{s.sentAt === null ? '—' : formatarDataHora(s.sentAt)}</td>
                    <td>{s.createdBy.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
