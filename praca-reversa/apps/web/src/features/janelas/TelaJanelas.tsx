import { API_PREFIXO, PaginaJanelasSchema, SITUACOES_JANELA, type Permissao, type SituacaoJanela } from '@praca-reversa/contracts';
import { useState } from 'react';
import { baixarArquivo, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeArquivo, IconeAtualizar, IconeMais } from '../../components/Icones';
import { Pagina } from '../../components/Moldura';
import type { Navegar } from '../../rotas';
import { deslocarMes, formatarDataHora, mesAtual, nomeDoMes } from '../../utils/datas';
import { Capacidade } from './Capacidade';
import { ROTULOS_SITUACAO_JANELA } from './rotulos';

const TAMANHO = 30;

/**
 * Janelas de devolução do mês (visão mensal em lista): situação, saída
 * autorizada, capacidade por métrica (limite, reservado, expedido, restante)
 * e pendências. A quantidade de janelas por mês é a cadastrada — nada é
 * criado, distribuído ou datado automaticamente.
 */
export function TelaJanelas({ mes, permissoes, aoNavegar }: { mes: string | null; permissoes: readonly Permissao[]; aoNavegar: Navegar }) {
  const mesExibido = mes ?? mesAtual();
  const [situacao, setSituacao] = useState<SituacaoJanela | ''>('');
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [erroExportar, setErroExportar] = useState<string | null>(null);
  const p = new URLSearchParams({ mes: mesExibido });
  if (situacao) p.set('situacao', situacao);
  if (busca.trim()) p.set('texto', busca.trim());
  const consulta = p.toString();
  const lista = useRecurso(`${API_PREFIXO}/janelas?${consulta}&pagina=${String(pagina)}&tamanho=${String(TAMANHO)}`, PaginaJanelasSchema);
  const dados = lista.carga?.estado === 'pronto' ? lista.carga.dados : null;
  const paginas = dados ? Math.max(1, Math.ceil(dados.total / TAMANHO)) : 1;
  const irPara = (novo: string) => {
    setPagina(1);
    aoNavegar({ tipo: 'janelas', mes: novo }, { substituir: true });
  };

  return (
    <Pagina ajuda="janela"
      titulo="Janelas de devolução"
      testId="tela-janelas"
      aoVoltar={() => {
        aoNavegar({ tipo: 'praca' });
      }}
      descricao={
        <p>
          Saídas autorizadas pelo cliente. Cada janela tem as próprias datas, capacidades e critérios informados; campo desconhecido fica pendente (sem data, limite ou
          critério presumido). Reserva não baixa estoque; só a confirmação da expedição baixa, uma única vez.
        </p>
      }
    >
      <div className="acoes-linha">
        {permissoes.includes('janela.gerenciar') && (
          <button
            type="button"
            className="botao-primario"
            onClick={() => {
              aoNavegar({ tipo: 'nova-janela' });
            }}
            data-testid="nova-janela"
          >
            <IconeMais />
            Nova janela
          </button>
        )}
        {permissoes.includes('janela.exportar') && (
          <button
            type="button"
            className="botao-secundario"
            onClick={() => {
              setErroExportar(null);
              baixarArquivo(`${API_PREFIXO}/janelas/exportar?${consulta}`, `janelas-${mesExibido}.csv`).catch((e: unknown) => {
                setErroExportar(mensagemDeFalha(e));
              });
            }}
            data-testid="exportar-janelas"
          >
            <IconeArquivo />
            Exportar CSV do mês
          </button>
        )}
      </div>
      {erroExportar && (
        <p className="estado-erro" role="alert">
          {erroExportar}
        </p>
      )}

      <nav className="navegacao-mes" aria-label="Mês das janelas">
        <button type="button" className="botao-secundario botao-compacto" onClick={() => { irPara(deslocarMes(mesExibido, -1)); }} data-testid="mes-anterior">
          ← Mês anterior
        </button>
        <strong data-testid="mes-exibido">{nomeDoMes(mesExibido)}</strong>
        <button type="button" className="botao-secundario botao-compacto" onClick={() => { irPara(deslocarMes(mesExibido, 1)); }} data-testid="mes-seguinte">
          Mês seguinte →
        </button>
      </nav>

      <form
        className="formulario-grade formulario-grade--compacta"
        onSubmit={(e) => {
          e.preventDefault();
          setPagina(1);
          setBusca(texto);
        }}
        aria-label="Filtros das janelas"
      >
        <label className="campo">
          <span className="campo-rotulo">Código, nome ou referência</span>
          <input value={texto} maxLength={64} onChange={(e) => { setTexto(e.target.value); }} data-testid="filtro-texto-janelas" />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Situação</span>
          <select value={situacao} onChange={(e) => { setPagina(1); setSituacao(e.target.value as SituacaoJanela | ''); }} data-testid="filtro-situacao-janelas">
            <option value="">Todas</option>
            {SITUACOES_JANELA.map((s) => (
              <option key={s} value={s}>
                {ROTULOS_SITUACAO_JANELA[s]}
              </option>
            ))}
          </select>
        </label>
        <div className="acoes-linha">
          <button type="submit" className="botao-secundario">
            Aplicar
          </button>
        </div>
      </form>

      {lista.carga?.estado === 'erro' && (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar as janelas. {lista.carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={lista.recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {lista.carga?.estado === 'carregando' && <p className="estado-carregando">Carregando janelas…</p>}
      {dados?.total === 0 && <p className="estado-vazio">Nenhuma janela cadastrada para {nomeDoMes(mesExibido)}{situacao || busca ? ' com estes filtros' : ''}.</p>}
      {dados && dados.total > 0 && (
        <>
          <ul className="lista-janelas" data-testid="lista-janelas">
            {dados.items.map((j) => (
              <li key={j.id}>
                <article className="cartao cartao-janela" data-testid="cartao-janela" data-situacao={j.state}>
                  <header className="cartao-janela-topo">
                    <button
                      type="button"
                      className="botao-link cartao-janela-titulo"
                      onClick={() => {
                        aoNavegar({ tipo: 'janela', id: j.id, aba: null });
                      }}
                      data-testid="abrir-janela"
                    >
                      <strong>{j.code}</strong> {j.name}
                    </button>
                    <span className={`selo selo-janela selo-janela--${j.state}`}>{ROTULOS_SITUACAO_JANELA[j.state]}</span>
                  </header>
                  <p className="cartao-janela-saida">
                    Saída autorizada:{' '}
                    {j.exitStart === null ? <span className="selo selo-alerta">pendente</span> : `${formatarDataHora(j.exitStart)} a ${formatarDataHora(j.exitEnd ?? j.exitStart)}`}
                    {j.clientReference ? ` · ref. ${j.clientReference}` : ''}
                  </p>
                  <Capacidade restricoes={j.restrictions} compacta />
                  <p className="campo-ajuda">
                    {j.activeReservations} reserva(s) ativa(s) · {j.expeditions} expedição(ões) · regras v{j.rulesVersion}
                  </p>
                  {j.pendencies.length > 0 && (
                    <ul className="linha-avisos" aria-label="Pendências">
                      {j.pendencies.map((pend) => (
                        <li key={pend}>{pend}</li>
                      ))}
                    </ul>
                  )}
                </article>
              </li>
            ))}
          </ul>
          <nav className="paginacao" aria-label="Páginas das janelas">
            <button type="button" className="botao-secundario botao-compacto" disabled={pagina <= 1} onClick={() => { setPagina(pagina - 1); }}>
              Anterior
            </button>
            <span>
              Página {pagina} de {paginas} ({dados.total} janela(s)) · consultado em {formatarDataHora(dados.consultedAt)}
            </span>
            <button type="button" className="botao-secundario botao-compacto" disabled={pagina >= paginas} onClick={() => { setPagina(pagina + 1); }}>
              Próxima
            </button>
          </nav>
        </>
      )}
    </Pagina>
  );
}
