import {
  API_PREFIXO,
  HistoricoClienteSchema,
  LinhasJanelaClienteSchema,
  PainelClienteSchema,
  ROTULO_ETAPA_SELECAO,
  ROTULO_EVENTO_CLIENTE,
  type JanelaCliente,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { EstadoTela, Pagina } from '../../components/Moldura';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { JanelaModal } from '../paletes/JanelaPalete';
import { ConsultaEstoque } from './ConsultaEstoque';
import { ComparacaoJanelas } from './comum';
import { useConsultaViva } from './consulta-viva';
import { consultaDe, filtrosDe, volumes } from './formato';
import { AcaoBloco, BarraFiltros, BarraSegmentada, BlocoResumo, CartaoResumo, PaginaPainel, ResumoJanela, VolumesPorRua } from './resumo';
import { useLinhasResumo } from './resumo-dados';

/** Parâmetros que levam à consulta (estoque/histórico) em vez do resumo. */
const PARAMETROS_CONSULTA = ['aba', 'situacao', 'rua', 'palete', 'documento', 'delivery', 'remetente', 'pagina'];

/** Linhas da seleção da janela com a etapa de cada NF (projeção do cliente). */
function LinhasJanela({ janela, versao }: { janela: JanelaCliente; versao: number }) {
  const { carga } = useRecurso(`${API_PREFIXO}/painel/cliente/janelas/${janela.id}`, LinhasJanelaClienteSchema, versao);
  if (carga?.estado !== 'pronto') return <EstadoTela carga={carga ?? { estado: 'carregando' }} titulo="Não foi possível carregar a seleção da janela" aoTentarNovamente={() => undefined} />;
  if (carga.dados.lines.length === 0) return <p className="estado-vazio">Nenhuma seleção ligada a esta janela (a meta foi informada sem a lista de NFs).</p>;
  return (
    <div className="tabela-rolagem">
      <table className="tabela-indicadores tabela-painel" data-testid="tabela-selecao">
        <thead>
          <tr>
            <th scope="col">Selecionado</th>
            <th scope="col">Solicitado</th>
            <th scope="col">Na base</th>
            <th scope="col">Separado aguardando</th>
            <th scope="col">Expedido</th>
            <th scope="col">Etapa</th>
            <th scope="col">Palete / endereço</th>
          </tr>
        </thead>
        <tbody>
          {carga.dados.lines.map((l) => (
            <tr key={l.row}>
              <td data-rotulo="Selecionado">
                {l.scope === 'PALETE' ? `Palete ${l.palletRef ?? ''} (full)` : `${l.documentType ?? 'Documento'} ${l.documentNumber ?? 'não informado'}`}
                {l.delivery !== null ? ` · Delivery ${l.delivery}` : ''}
              </td>
              <td data-rotulo="Solicitado">{volumes(l.requested)}</td>
              <td data-rotulo="Na base">
                {volumes(l.locatedVolumes)}
                {l.remainder !== null && <span className="indicador-nota"> (restante fora do pedido: {volumes(l.remainder)})</span>}
              </td>
              <td data-rotulo="Separado aguardando">{volumes(l.separatedWaiting)}</td>
              <td data-rotulo="Expedido">{volumes(l.shipped)}</td>
              <td data-rotulo="Etapa">{ROTULO_ETAPA_SELECAO[l.stage]}</td>
              <td data-rotulo="Palete / endereço">{l.pallets.length === 0 ? '—' : l.pallets.map((p) => `${p.code} (${p.address ?? 'localização em atualização'})`).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Acontecimentos mais recentes permitidos ao cliente (mesma projeção do histórico e da exportação). */
function HistoricoRecente({ versao }: { versao: number }) {
  const { dados, carga } = useConsultaViva(`${API_PREFIXO}/painel/cliente/historico`, HistoricoClienteSchema, versao);
  // Acontecimentos à vista no resumo; o histórico completo abre na consulta.
  const linhas = useLinhasResumo(3, 7);
  if (dados === null) {
    return <p className={carga?.estado === 'erro' ? 'estado-erro' : 'painel-vazio'}>{carga?.estado === 'erro' ? `Não foi possível carregar o histórico: ${carga.mensagem}` : 'Carregando o histórico…'}</p>;
  }
  if (dados.events.length === 0) return <p className="painel-vazio">Nenhum acontecimento registrado.</p>;
  return (
    <ol className="resumo-eventos" data-testid="historico-recente">
      {dados.events.slice(0, linhas).map((e) => (
        <li key={e.key}>
          <time dateTime={e.at}>{formatarDataHora(e.at)}</time>
          <strong>
            {ROTULO_EVENTO_CLIENTE[e.type]}
            {e.correction ? ' (correção)' : ''}
          </strong>
          <span className="resumo-nota">
            Palete {e.palletCode}
            {e.documentNumber !== null ? ` · ${e.documentType ?? 'Documento'} ${e.documentNumber}` : ''}
            {e.volumes !== null ? ` · ${volumes(e.volumes)} volume(s)` : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Painel do cliente (consulta) em uma tela (etapa 4): estoque atual, janela
 * selecionada com as etapas e o histórico recente permitido. A API só envia
 * a projeção permitida (sem claims, valores, pendências internas,
 * comentários ou logins); a consulta completa (estoque, histórico e
 * exportação) abre ao clicar, com os filtros na URL.
 */
export function TelaPainelCliente({ parametros, aoNavegar }: { parametros: string; aoNavegar: Navegar }) {
  const [versao, setVersao] = useState(0);
  const [detalhe, setDetalhe] = useState<'selecao' | 'janelas' | null>(null);
  const { dados, carga, recarregar } = useConsultaViva(`${API_PREFIXO}/painel/cliente`, PainelClienteSchema, versao);
  const busca = new URLSearchParams(parametros);
  const emConsulta = PARAMETROS_CONSULTA.some((k) => busca.has(k));
  const consulta = (p: string) => {
    aoNavegar({ tipo: 'painel-cliente', parametros: p });
  };
  const voltar = () => {
    aoNavegar({ tipo: 'painel-cliente', parametros: '' });
  };
  if (dados === null) {
    return (
      <PaginaPainel titulo="Painel do cliente" testId="tela-painel-cliente">
        <EstadoTela carga={carga ?? { estado: 'carregando' }} titulo="Não foi possível carregar o painel" aoTentarNovamente={recarregar} />
      </PaginaPainel>
    );
  }
  const d = dados;

  if (emConsulta) {
    return (
      <Pagina
        titulo="Estoque e histórico"
        testId="tela-painel-cliente"
        aoVoltar={voltar}
        rotuloVoltar="Voltar ao painel"
        descricao={<p>Uma linha por NF × palete; os totais são a soma das linhas. A exportação traz as mesmas linhas.</p>}
      >
        <div id="consulta-cliente">
          <ConsultaEstoque base="cliente" parametros={parametros} janelas={d.windows} aoMudar={consulta} />
        </div>
      </Pagina>
    );
  }

  const abertas = d.windows.filter((j) => j.situation !== 'ENCERRADA');
  const janela = d.windows.find((j) => j.id === filtrosDe(parametros).janela) ?? abertas[0] ?? d.windows[0] ?? null;
  const semVolume = d.stock.volumesCoverage.total - d.stock.volumesCoverage.known;
  const p = janela?.progress ?? null;
  const abrirSelecao = janela
    ? () => {
        setDetalhe('selecao');
      }
    : undefined;
  const fechar = () => {
    setDetalhe(null);
  };

  return (
    <PaginaPainel titulo="Painel do cliente" testId="tela-painel-cliente">
      <BarraFiltros
        janelas={d.windows}
        janela={janela?.id ?? null}
        aoEscolherJanela={(id) => {
          consulta(consultaDe({ janela: id }));
        }}
        consultadoEm={d.consultedAt}
        carga={carga}
        aoAtualizar={() => {
          setVersao((x) => x + 1);
        }}
        acoes={
          <>
            <button
              type="button"
              className="painel-acao"
              onClick={() => {
                consulta('aba=estoque');
              }}
              data-testid="abrir-consulta"
            >
              Estoque e histórico
            </button>
            <button
              type="button"
              className="painel-acao painel-acao--ajuda"
              onClick={() => {
                aoNavegar({ tipo: 'ajuda', guia: 'painel-cliente' });
              }}
              aria-label="Como ler o painel"
              title="Como ler o painel"
              data-testid="ajuda-painel-cliente"
            >
              <span aria-hidden="true">?</span>
            </button>
          </>
        }
      />

      {d.inventoryInValidation !== null && (
        <p className="painel-validacao" role="note" data-testid="cli-inventario-validacao">
          <strong>Inventário em validação</strong>
          {d.inventoryInValidation.baseDate !== null && ` (base ${d.inventoryInValidation.baseDate.split('-').reverse().join('/')})`}: paletes e volumes provisórios, ainda em
          conferência — não são disponibilidade confirmada.
        </p>
      )}

      <div className="painel-cartoes">
        <CartaoResumo
          destaque
          rotulo="Paletes"
          valor={volumes(d.stock.pallets)}
          unidade="paletes"
          contexto={`${volumes(d.stock.fullPallets)} full · ${volumes(d.stock.mixedPallets)} misto(s)`}
          aoAbrir={() => {
            consulta('aba=estoque');
          }}
          testId="cli-card-paletes"
        />
        <CartaoResumo
          rotulo="Volumes registrados"
          valor={d.stock.volumesCoverage.known === 0 ? 'Não informado' : volumes(d.stock.volumes)}
          unidade="volumes"
          contexto={`${volumes(d.stock.documents)} ${d.stock.documents === 1 ? 'nota/minuta' : 'notas/minutas'}${semVolume > 0 ? ` · ${volumes(semVolume)} sem volume` : ''}`}
          tom={semVolume > 0 ? 'atencao' : 'neutro'}
          dica="Contado quando houver; senão o informado no inventário."
          aoAbrir={() => {
            consulta('aba=estoque');
          }}
          testId="cli-card-volumes"
        />
        <CartaoResumo
          rotulo="Solicitado"
          valor={p === null ? 'Sem janela' : p.requested === null ? 'Sem meta' : volumes(p.requested)}
          unidade="volumes"
          contexto={janela === null ? 'nenhuma janela registrada' : `janela ${janela.code}`}
          acao="ver a seleção da janela"
          aoAbrir={abrirSelecao}
          testId="cli-card-solicitado"
        />
        <CartaoResumo
          rotulo="Expedido"
          valor={p === null ? 'Sem janela' : volumes(p.shipped)}
          unidade="volumes"
          contexto={p === null ? 'nenhuma janela registrada' : p.missingToShip === null ? 'sem meta informada' : `falta expedir ${volumes(p.missingToShip)}`}
          acao="ver a seleção da janela"
          dica="Só a saída confirmada pela operação conta como expedida."
          aoAbrir={abrirSelecao}
          testId="cli-card-expedido"
        />
      </div>

      <div className="painel-linha painel-linha--meio">
        <BlocoResumo
          titulo="Janela selecionada"
          testId="cliente-janela"
          classe="painel-bloco--janela"
          acao={
            <div className="painel-bloco-acoes">
              {d.windows.length > 1 && (
                <button
                  type="button"
                  className="painel-acao"
                  onClick={() => {
                    setDetalhe('janelas');
                  }}
                  data-testid="comparar-janelas"
                >
                  Comparar ({d.windows.length})
                </button>
              )}
              {abrirSelecao !== undefined && (
                <AcaoBloco aoClicar={abrirSelecao} testId="abrir-selecao">
                  Ver seleção
                </AcaoBloco>
              )}
            </div>
          }
        >
          <ResumoJanela janela={janela} interno={false} vazio="Nenhuma janela registrada." />
        </BlocoResumo>

        <BlocoResumo titulo="Etapas da seleção" testId="cliente-etapas">
          {janela?.stages == null ? (
            <p className="painel-vazio">{janela === null ? 'Nenhuma janela registrada.' : 'Nenhuma lista de NFs ligada a esta janela: etapas não disponíveis.'}</p>
          ) : (
            <BarraSegmentada
              rotulo="Linhas da seleção"
              partes={[
                { chave: 'nao-localizadas', rotulo: 'Não localizadas', valor: janela.stages.notLocated },
                { chave: 'localizadas', rotulo: 'Localizadas na base', valor: janela.stages.located },
                { chave: 'em-separacao', rotulo: 'Em separação', valor: janela.stages.inSeparation },
                { chave: 'separadas', rotulo: 'Separadas', valor: janela.stages.separated },
                { chave: 'expedidas', rotulo: 'Expedidas', valor: janela.stages.shipped },
              ]}
              total={`${volumes(janela.stages.lines)} linha(s) da seleção · selecionada não é separada; expedida só com saída confirmada`}
            />
          )}
        </BlocoResumo>
      </div>

      <div className="painel-linha painel-linha--baixo">
        <BlocoResumo
          titulo="Volumes por rua"
          testId="painel-ruas"
          classe="painel-bloco--ruas"
          acao={
            <AcaoBloco
              aoClicar={() => {
                consulta(consultaDe({ situacao: 'sem-endereco' }));
              }}
              testId="cli-card-localizacao"
              rotulo={`Localização em atualização: ${volumes(d.stock.locationUpdating)} palete(s) — ver lista`}
            >
              Localização em atualização: {volumes(d.stock.locationUpdating)}
            </AcaoBloco>
          }
        >
          <VolumesPorRua
            ruas={d.byStreet}
            aoAbrir={(rua) => {
              consulta(consultaDe(rua === 'Sem endereço confirmado' ? { situacao: 'sem-endereco' } : { rua }));
            }}
          />
        </BlocoResumo>

        <BlocoResumo
          titulo="Histórico recente"
          testId="cliente-historico"
          acao={
            <AcaoBloco
              aoClicar={() => {
                consulta('aba=historico');
              }}
              testId="ver-historico"
            >
              Ver tudo
            </AcaoBloco>
          }
        >
          <HistoricoRecente versao={versao} />
        </BlocoResumo>
      </div>

      {detalhe === 'selecao' && janela !== null && (
        <JanelaModal titulo={`Seleção da janela ${janela.code}`} subtitulo={`${janela.name} · em volumes`} aoFechar={fechar} testId="cliente-selecao">
          <p className="resumo-nota">Selecionada pelo cliente não é o mesmo que separada: só a separação registrada pela operação conta como separada, e só a saída confirmada conta como expedida.</p>
          <LinhasJanela janela={janela} versao={versao} />
        </JanelaModal>
      )}
      {detalhe === 'janelas' && (
        <JanelaModal titulo="Comparação das janelas" subtitulo="Em volumes" aoFechar={fechar} testId="cliente-janelas-todas">
          <ComparacaoJanelas
            janelas={d.windows}
            aoAbrir={(id) => {
              setDetalhe(null);
              consulta(consultaDe({ janela: id }));
            }}
          />
        </JanelaModal>
      )}
    </PaginaPainel>
  );
}
