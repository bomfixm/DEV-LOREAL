import { API_PREFIXO, FilaValidacaoSchema, type ItemValidacao } from '@praca-reversa/contracts';
import { useState } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar } from '../../components/Icones';
import { MensagemAcao, Pagina } from '../../components/Moldura';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { AcoesConteudo } from './AcoesConteudo';
import { textoResultadoAcao } from './textos-resultado';
import './correcoes.css';

const documento = (i: ItemValidacao) => (i.documentNumber === null ? `Sem documento (${i.sender ?? 'remetente não informado'})` : `${i.documentType ?? 'Documento'} ${i.documentNumber}`);

function Pendencia({ item, marcado, aoMarcar }: { item: ItemValidacao; marcado: boolean; aoMarcar: (v: boolean) => void }) {
  return (
    <li className="validacao-item" data-testid="validacao-item" data-numero={item.documentNumber ?? ''}>
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

/**
 * Validação urgente — sem endereço (21 out. 2026): conteúdos cujo local físico
 * não é conhecido. Não é posição do mapa, não ocupa capacidade e não aparece
 * para o cliente. Resolver = escolher no mapa o destino verdadeiro, uma ou
 * várias de uma vez (sem recadastrar nota por nota).
 */
export function TelaValidacao({ podeResolver, aoNavegar, aoGravar }: { podeResolver: boolean; aoNavegar: Navegar; aoGravar: () => void }) {
  const [versao, setVersao] = useState(0);
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/validacao`, FilaValidacaoSchema, versao);
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const [filtro, setFiltro] = useState('');
  const [mensagem, setMensagem] = useState<{ tipo: 'ok'; texto: string } | null>(null);
  const dados = carga?.estado === 'pronto' ? carga.dados : null;
  const termo = filtro.trim().toLowerCase();
  const visiveis = (dados?.items ?? []).filter((i) => termo === '' || `${documento(i)} ${i.sender ?? ''} ${i.lastKnown?.code ?? ''} ${i.lastKnown?.address ?? ''} ${i.reason ?? ''}`.toLowerCase().includes(termo));
  const escolhidos = (dados?.items ?? []).filter((i) => marcados.has(i.id));

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
      <MensagemAcao mensagem={mensagem} testId="validacao-mensagem" />
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
        <>
          <p data-testid="validacao-resumo">
            <strong>{dados.total}</strong> pendência(s) · {dados.volumes} volume(s)
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
                  const novo = new Set(marcados);
                  for (const i of visiveis) {
                    if (e.target.checked) novo.add(i.id);
                    else novo.delete(i.id);
                  }
                  setMarcados(novo);
                }}
                data-testid="validacao-todas"
              />
              Selecionar as {visiveis.length} exibidas
            </label>
            <span className="tabela-nota">{marcados.size} selecionada(s)</span>
          </div>
          <ul className="validacao-lista">
            {visiveis.map((i) => (
              <Pendencia
                key={i.id}
                item={i}
                marcado={marcados.has(i.id)}
                aoMarcar={(v) => {
                  const novo = new Set(marcados);
                  if (v) novo.add(i.id);
                  else novo.delete(i.id);
                  setMarcados(novo);
                }}
              />
            ))}
          </ul>
          {podeResolver ? (
            <AcoesConteudo
              paleteId={null}
              apenasResolver
              selecionados={escolhidos.map((i) => ({ kind: i.kind, id: i.id, documento: documento(i), volumes: i.volumes }))}
              aoConcluido={(r) => {
                setMarcados(new Set());
                setMensagem({ tipo: 'ok', texto: textoResultadoAcao(r) });
                setVersao((v) => v + 1);
                aoGravar();
              }}
            />
          ) : (
            <p className="tabela-nota">Seu perfil consulta a fila; resolver fica com o supervisor ou o administrador.</p>
          )}
        </>
      )}
    </Pagina>
  );
}
