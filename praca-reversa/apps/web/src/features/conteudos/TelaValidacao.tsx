import { API_PREFIXO, FilaValidacaoSchema, type FilaValidacao, type ItemValidacao } from '@praca-reversa/contracts';
import { useState } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar } from '../../components/Icones';
import { MensagemAcao, Pagina } from '../../components/Moldura';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { JanelaModal } from '../paletes/JanelaPalete';
import { AcoesConteudo } from './AcoesConteudo';
import { textoResultadoAcao } from './textos-resultado';
import './correcoes.css';

const documento = (i: ItemValidacao) => (i.documentNumber === null ? `Sem documento (${i.sender ?? 'remetente não informado'})` : `${i.documentType ?? 'Documento'} ${i.documentNumber}`);
const notas = (n: number) => (n === 1 ? '1 nota' : `${String(n)} notas`);

function Pendencia({ item, marcado, aoMarcar }: { item: ItemValidacao; marcado: boolean; aoMarcar: (v: boolean) => void }) {
  return (
    <li className={marcado ? 'validacao-item validacao-item--marcado' : 'validacao-item'} data-testid="validacao-item" data-numero={item.documentNumber ?? ''} data-id={item.id}>
      <input
        type="checkbox"
        aria-label={`Selecionar ${documento(item)}`}
        checked={marcado}
        onChange={(e) => {
          aoMarcar(e.target.checked);
        }}
        data-testid="validacao-marcar"
      />
      <div>
        <p>
          <strong>{documento(item)}</strong> · {item.sender ?? 'Remetente não informado'} · <strong>{item.volumes === null ? 'quantidade desconhecida' : `${String(item.volumes)} volume(s)`}</strong>
          {item.delivery !== null && ` · Delivery ${item.delivery}`}
        </p>
        <p>Motivo: {item.reason ?? 'não registrado'}</p>
        <p className="tabela-nota">
          Desde {formatarDataHora(item.since)} · por {item.by?.name ?? 'não registrado'}
          {item.lastKnown !== null && (
            <>
              {' '}
              · <span title="Histórico: não é a localização atual.">último conhecido (histórico): palete {item.lastKnown.code}
              {item.lastKnown.address === null ? '' : `, ${item.lastKnown.address}`}</span>
            </>
          )}
          {item.source !== null && ` · origem: ${item.source}`}
        </p>
        <details>
          <summary>Histórico e dados técnicos</summary>
          <ol className="validacao-historico">
            {item.history.map((e, i) => (
              <li key={`${e.at}-${String(i)}`}>
                {formatarDataHora(e.at)} — {e.text} · {e.by?.name ?? 'autor não registrado'}
                {e.reason !== null && ` · motivo: ${e.reason}`}
              </li>
            ))}
          </ol>
          <p className="validacao-tecnico">
            Ocorrência {item.technical.occurrenceId}
            {item.technical.inventory !== null && ` · ${item.technical.inventory}`}
            {item.technical.row !== null && ` linha ${String(item.technical.row)}`}
            {item.technical.batchId !== null && ` · lote ${item.technical.batchId}`}
          </p>
        </details>
      </div>
    </li>
  );
}

/** Resumo compacto do que vai ao mapa (todas as selecionadas, inclusive as escondidas pela busca). */
function ResumoSelecao({ itens }: { itens: readonly ItemValidacao[] }) {
  const conhecidos = itens.reduce((t, i) => t + (i.volumes ?? 0), 0);
  const sem = itens.filter((i) => i.volumes === null).length;
  return (
    <section className="validacao-resumo-selecao" aria-label="Notas selecionadas" data-testid="validacao-janela-resumo">
      <p className="tabela-nota">
        {notas(itens.length)} · {conhecidos} volume(s) conhecido(s){sem > 0 ? ` + ${String(sem)} sem quantidade` : ''}. Selecionar não movimenta nada: a gravação só acontece depois de escolher o destino e confirmar.
      </p>
      <ul className="validacao-resumo-lista">
        {itens.map((i) => (
          <li key={i.id} data-testid="validacao-janela-item">
            <strong>{documento(i)}</strong> · {i.sender ?? 'remetente não informado'} · {i.volumes === null ? 'quantidade desconhecida' : `${String(i.volumes)} volume(s)`}
            {i.delivery !== null && ` · Delivery ${i.delivery}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Validação urgente — sem endereço (21 out. 2026): conteúdos cujo local físico
 * não é conhecido. Não é posição do mapa, não ocupa capacidade e não aparece
 * para o cliente. Resolver = escolher no mapa o destino verdadeiro, uma ou
 * várias de uma vez (sem recadastrar nota por nota).
 *
 * 26 out. 2026: ao marcar a primeira nota aparece uma barra presa ao rodapé da
 * área de conteúdo (sem rolar até o fim) com "Colocar no mapa", que abre a
 * escolha do destino numa janela. A seleção é pelo ID da ocorrência (a mesma
 * NF pode ser conteúdos diferentes) e sobrevive a busca e atualização da lista;
 * só sai da seleção o que o servidor confirmou ou o que já não está pendente.
 */
export function TelaValidacao({ podeResolver, aoNavegar, aoGravar }: { podeResolver: boolean; aoNavegar: Navegar; aoGravar: () => void }) {
  const [versao, setVersao] = useState(0);
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/validacao`, FilaValidacaoSchema, versao);
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const [filtro, setFiltro] = useState('');
  const [janela, setJanela] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'conflito'; texto: string } | null>(null);
  // Durante a atualização a lista (e a janela aberta) continua com os últimos dados confirmados.
  const [ultimos, setUltimos] = useState<FilaValidacao | null>(null);
  if (carga?.estado === 'pronto' && carga.dados !== ultimos) setUltimos(carga.dados);
  const dados = carga?.estado === 'pronto' ? carga.dados : ultimos;
  const atualizando = carga?.estado === 'carregando' && ultimos !== null;
  const termo = filtro.trim().toLowerCase();
  const visiveis = (dados?.items ?? []).filter((i) => termo === '' || `${documento(i)} ${i.sender ?? ''} ${i.lastKnown?.code ?? ''} ${i.lastKnown?.address ?? ''} ${i.reason ?? ''}`.toLowerCase().includes(termo));
  // Seleção efetiva = marcadas que continuam pendentes (resolvidas por outra pessoa saem sozinhas).
  const escolhidos = (dados?.items ?? []).filter((i) => marcados.has(i.id));
  const ocultos = escolhidos.length - visiveis.filter((i) => marcados.has(i.id)).length;
  const janelaAberta = janela && podeResolver && escolhidos.length > 0;
  // Janela pedida, mas todas as escolhidas foram resolvidas por outra pessoa: aviso até a próxima ação.
  const resolvidasPorOutra = janela && dados !== null && escolhidos.length === 0;

  const marcar = (ids: readonly string[], v: boolean) => {
    const pendentes = new Set((dados?.items ?? []).map((i) => i.id));
    setJanela(false);
    setMarcados((atual) => {
      const novo = new Set([...atual].filter((id) => pendentes.has(id)));
      for (const id of ids) {
        if (v) novo.add(id);
        else novo.delete(id);
      }
      return novo;
    });
  };

  return (
    <Pagina
      titulo="Validação urgente — sem endereço"
      testId="tela-validacao"
      aoVoltar={() => {
        aoNavegar({ tipo: 'praca' });
      }}
      rotuloVoltar="Voltar ao mapa"
      descricao={
        <p>
          Conteúdos retirados do estoque físico de um palete porque o local real não é conhecido. Não ocupam posição nem aparecem para o cliente. Escolha uma ou várias e indique no mapa onde estão.
        </p>
      }
    >
      <MensagemAcao
        mensagem={resolvidasPorOutra ? { tipo: 'conflito', texto: 'As notas selecionadas já foram resolvidas por outra pessoa. A lista foi atualizada; nada foi gravado por você.' } : mensagem}
        testId="validacao-mensagem"
      />
      {carga?.estado === 'erro' && dados === null && (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar a fila. {carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {dados === null && carga?.estado !== 'erro' && <p className="estado-carregando">Carregando a fila…</p>}
      {dados !== null && dados.total === 0 && (
        <p className="estado-vazio" data-testid="validacao-vazia">
          Nenhuma pendência de validação.
        </p>
      )}
      {dados !== null && dados.total > 0 && (
        <div className="validacao-area">
          <p data-testid="validacao-resumo">
            <strong>{dados.total}</strong> pendência(s) · {dados.volumes} volume(s)
            {atualizando && <span className="tabela-nota"> · atualizando…</span>}
          </p>
          <div className="janela-selecao">
            <label className="campo conf-filtro">
              <span className="campo-rotulo">Procurar</span>
              <input type="search" value={filtro} onChange={(e) => { setFiltro(e.target.value); }} placeholder="Nota, remetente, palete ou endereço" />
            </label>
            <label className="conf-check">
              <input
                type="checkbox"
                checked={visiveis.length > 0 && visiveis.every((i) => marcados.has(i.id))}
                onChange={(e) => {
                  marcar(
                    visiveis.map((i) => i.id),
                    e.target.checked,
                  );
                }}
                data-testid="validacao-todas"
              />
              Selecionar as {visiveis.length} exibidas
            </label>
            <span className="tabela-nota" data-testid="validacao-contagem">
              {escolhidos.length} selecionada(s)
            </span>
          </div>
          <ul className="validacao-lista">
            {visiveis.map((i) => (
              <Pendencia
                key={i.id}
                item={i}
                marcado={marcados.has(i.id)}
                aoMarcar={(v) => {
                  marcar([i.id], v);
                }}
              />
            ))}
          </ul>
          {visiveis.length === 0 && <p className="estado-vazio">Nenhuma pendência com esse texto.</p>}
          {escolhidos.length > 0 && (
            <div className="validacao-barra" role="region" aria-label="Notas selecionadas" data-testid="validacao-barra">
              <p className="validacao-barra-texto" aria-live="polite">
                <strong data-testid="validacao-barra-contagem">{escolhidos.length === 1 ? '1 nota selecionada' : `${String(escolhidos.length)} notas selecionadas`}</strong>
                {ocultos > 0 && <span className="tabela-nota"> · {ocultos} fora da busca atual</span>}
              </p>
              <div className="validacao-barra-acoes">
                <button
                  type="button"
                  className="botao-link"
                  onClick={() => {
                    setJanela(false);
                    setMarcados(new Set());
                  }}
                  data-testid="validacao-limpar"
                >
                  Limpar seleção
                </button>
                {podeResolver ? (
                  <button
                    type="button"
                    className="botao-primario"
                    onClick={() => {
                      setMensagem(null);
                      setJanela(true);
                    }}
                    data-testid="validacao-colocar"
                  >
                    Colocar no mapa
                  </button>
                ) : (
                  <span className="tabela-nota">Colocar no mapa fica com o supervisor ou o administrador.</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {janelaAberta && (
        <JanelaModal
          titulo={`Colocar ${notas(escolhidos.length)} no mapa`}
          subtitulo="Escolha o palete ou a posição vazia onde as notas estão. Palete com conteúdo recebe as notas sem perder o que já tem."
          aoFechar={() => {
            setJanela(false);
          }}
          testId="validacao-janela"
          classe="validacao-janela-fundo"
        >
          <ResumoSelecao itens={escolhidos} />
          <AcoesConteudo
            paleteId={null}
            apenasResolver
            selecionados={escolhidos.map((i) => ({ kind: i.kind, id: i.id, documento: documento(i), volumes: i.volumes }))}
            aoConcluido={(r) => {
              const feitos = escolhidos.map((i) => i.id);
              setJanela(false);
              marcar(feitos, false);
              setMensagem({ tipo: 'ok', texto: textoResultadoAcao(r) });
              setVersao((v) => v + 1);
              aoGravar();
            }}
            aoConflito={() => {
              setVersao((v) => v + 1);
            }}
          />
        </JanelaModal>
      )}
    </Pagina>
  );
}
