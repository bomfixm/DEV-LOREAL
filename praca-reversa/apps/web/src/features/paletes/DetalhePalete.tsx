import { API_PREFIXO, PaleteDetalheSchema, compararQuantidades, subtrairQuantidades, type PaleteDetalhe, type PaleteResumo, type Permissao } from '@praca-reversa/contracts';
import { useState, type Ref } from 'react';
import { ehConflitoDeVersao, useChaves } from '../../api/chaves';
import { enviarJson, mensagemDeFalha } from '../../api/cliente';
import type { Carga } from '../../api/use-recurso';
import { IconeAlvo, IconeArquivo, IconeAtualizar, IconeImprimir, IconeVoltar } from '../../components/Icones';
import type { AcaoPalete } from '../../rotas';
import { MensagemAcao } from '../../components/Moldura';
import { SeloConferenciaExibida, SeloLiberacao } from '../../components/Selos';
import { formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';
import { apresentarConteudo, type ApresentacaoConteudo, type ContagemApresentada, type LinhaConteudo } from './conteudo';
import { ROTULOS_CONFERENCIA, ROTULOS_FLUXO } from './estados';
import { PrazoReconferencia } from './PrazoReconferencia';
import { DocumentosInformados } from './DocumentosInformados';
import { SecaoConferencia } from './SecaoConferencia';
import { ConteudoDoPalete } from '../conteudos/ConteudoDoPalete';
import { SecaoLiberacao } from '../janelas/SecaoLiberacao';

interface Props {
  resumo: PaleteResumo;
  carga: Carga<PaleteDetalhe> | null;
  /** Fileira e bloco/zona da posição, para orientação. */
  local: string | null;
  consultadoEm: string;
  compacto: boolean;
  permissoes: readonly Permissao[];
  tituloRef: Ref<HTMLHeadingElement>;
  aoCentralizar: () => void;
  /** Volta ao resumo do palete (a seleção continua). Só no computador; no celular é "Voltar ao mapa". */
  aoRecolher?: () => void;
  aoFechar: () => void;
  aoRecarregar: () => void;
  aoImprimir: () => void;
  /** Abre a tela da conferência (rota /conferencias/<id>). */
  aoAbrirConferencia: (id: string) => void;
  /** Abre mover, transferir, histórico ou a importação da bipagem do palete (rotas /paletes/<id>/…). */
  aoMovimentar: (acao: AcaoPalete) => void;
  /** Depois de uma gravação confirmada: recarregar detalhe, mapa e lista. */
  aoAlterado: () => void;
  /** Dentro da janela do palete (etapa 3): sem o cabeçalho próprio (título, endereço e ações ficam na janela). */
  embutido?: boolean;
}

const ROTULOS_ORIGEM_CODIGO = {
  EXISTENTE: 'identificação existente informada no cadastro',
  GERADO: 'código interno gerado pelo aplicativo',
  DEMONSTRACAO: 'carga de demonstração',
} as const;

function ListaItens({ titulo, linhas, vazio, nota, testId }: { titulo: string; linhas: LinhaConteudo[]; vazio: string; nota?: string; testId: string }) {
  return (
    <div className="bloco-itens" data-testid={testId}>
      <h4>{titulo}</h4>
      {nota !== undefined && <p className="bloco-nota">{nota}</p>}
      {linhas.length === 0 ? (
        <p className="sem-itens">{vazio}</p>
      ) : (
        <ul className="itens">
          {linhas.map((linha) => (
            <li key={linha.chave} className="item-conteudo">
              <div className="item-conteudo-topo">
                <span className={linha.skuPendente ? 'item-sku pendente' : 'item-sku'}>{linha.sku}</span>
                <span className="item-descricao">{linha.descricao}</span>
                <span className="item-quantidade">{linha.quantidade}</span>
              </div>
              <dl className="item-conteudo-dados">
                <div>
                  <dt>Lote</dt>
                  <dd className={linha.lotePendente ? 'pendente' : undefined}>{linha.lote}</dd>
                </div>
                <div>
                  <dt>Origem</dt>
                  <dd className={linha.origemPendente ? 'pendente' : undefined}>{linha.origem}</dd>
                </div>
                <div>
                  <dt>Condição</dt>
                  <dd>{linha.condicao}</dd>
                </div>
                {linha.reservado !== null && (
                  <div>
                    <dt>Reservado</dt>
                    <dd>{linha.reservado}</dd>
                  </div>
                )}
                {linha.vinculado !== null && (
                  <div>
                    <dt>Vinculado a claim</dt>
                    <dd data-testid="vinculado-claim">{linha.vinculado} (prova de recuperação validada; continua no estoque)</dd>
                  </div>
                )}
                {linha.registroProprio && (
                  <div>
                    <dt>Identidade</dt>
                    <dd className="pendente">Registro pendente próprio (não é unido a outro só por ter lote/origem pendentes)</dd>
                  </div>
                )}
                {linha.codigoBarras !== null && (
                  <div>
                    <dt>Código de barras</dt>
                    <dd>{linha.codigoBarras}</dd>
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Contagens({ contagens }: { contagens: ContagemApresentada[] }) {
  return (
    <>
      {contagens.map((c) => (
        <ListaItens
          key={c.sessaoId}
          titulo={c.titulo}
          nota={`${c.nota}${c.pendencias > 0 ? ` ${String(c.pendencias)} observação(ões) pendente(s) de identificação/conversão, fora destas quantidades.` : ''}`}
          linhas={c.linhas}
          vazio="Nenhuma quantidade convertida nesta contagem."
          testId="itens-observados"
        />
      ))}
    </>
  );
}

function Conteudo({ apresentacao }: { apresentacao: ApresentacaoConteudo }) {
  const aviso = (marcador: string) => (
    <div className={`aviso-conteudo aviso-conteudo--${apresentacao.tipo}`} data-testid={`conteudo-${apresentacao.tipo}`}>
      <p className="aviso-titulo">
        <span className="aviso-marcador" aria-hidden="true">
          {marcador}
        </span>
        {apresentacao.titulo}
      </p>
      <p>{apresentacao.explicacao}</p>
    </div>
  );
  const declarados =
    apresentacao.declarados.length > 0 || apresentacao.tipo === 'aguardando' ? (
      <ListaItens
        titulo="Declarado em documento"
        nota="Declaração documental não comprova presença física nem cria saldo."
        linhas={apresentacao.declarados}
        vazio="Nenhuma declaração documental vinculada."
        testId="itens-declarados"
      />
    ) : null;

  const conhecido = (linhas: LinhaConteudo[] | null) =>
    linhas === null ? null : (
      <ListaItens
        titulo="Saldo validado conhecido (recebido por transferência)"
        nota="Somente o que chegou por transferência de saldo validado. O restante do palete continua desconhecido: nada é presumido como zero."
        linhas={linhas}
        vazio="Nenhum saldo validado restante (isso não comprova que o palete físico está vazio)."
        testId="itens-saldo-conhecido"
      />
    );

  switch (apresentacao.tipo) {
    case 'desconhecido':
      return (
        <>
          {aviso(ROTULOS_CONFERENCIA.NAO_CONFERIDO.marcador)}
          {conhecido(apresentacao.saldoConhecido)}
          {declarados}
        </>
      );
    case 'parcial':
      return (
        <>
          {aviso(ROTULOS_CONFERENCIA.PARCIAL.marcador)}
          <Contagens contagens={apresentacao.contagens} />
          {conhecido(apresentacao.saldoConhecido)}
          {declarados}
        </>
      );
    case 'aguardando':
      return (
        <>
          {aviso(ROTULOS_CONFERENCIA.AGUARDANDO_VALIDACAO.marcador)}
          <Contagens contagens={apresentacao.contagens} />
          {apresentacao.saldoAnterior !== null && (
            <ListaItens
              titulo="Saldo validado atual (anterior a esta contagem)"
              nota="Continua valendo até a nova contagem ser reconciliada."
              linhas={apresentacao.saldoAnterior}
              vazio="Nenhum item no saldo validado."
              testId="itens-saldo"
            />
          )}
          {declarados}
        </>
      );
    case 'validado':
      return (
        <>
          {aviso(ROTULOS_CONFERENCIA.RECONCILIADO.marcador)}
          <ListaItens titulo="Saldo validado" linhas={apresentacao.saldo} vazio="Nenhum item no saldo validado." testId="itens-saldo" />
          <Contagens contagens={apresentacao.contagens} />
          {declarados}
        </>
      );
  }
}

type Mensagem = { tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null;

/**
 * Separação para agenda (front aprovado): o que foi solicitado (reservado para
 * uma janela) e o que permanece no palete, por item do saldo validado. Consultar
 * não altera nada; reserva não é saída e não libera a posição.
 */
function SecaoAgenda({ detalhe }: { detalhe: PaleteDetalhe }) {
  const itens = detalhe.currentItems ?? [];
  const solicitados = itens.filter((i) => compararQuantidades(i.reserved, '0') > 0);
  return (
    <section className="detalhe-secao" aria-labelledby="secao-agenda" data-testid="secao-agenda">
      <h3 id="secao-agenda">Separação para agenda</h3>
      {detalhe.currentItems === null ? (
        <p className="bloco-nota">Sem saldo validado: o pedido da agenda por produto ainda não pode ser separado neste palete.</p>
      ) : solicitados.length === 0 ? (
        <p className="bloco-nota">Nenhum conteúdo deste palete foi solicitado para agenda.</p>
      ) : (
        <div className="tabela-documentos-rolagem">
          <table className="tabela-documentos">
            <thead>
              <tr>
                <th scope="col">Produto</th>
                <th scope="col">Solicitado para separação</th>
                <th scope="col">Permanece no palete</th>
              </tr>
            </thead>
            <tbody>
              {solicitados.map((i) => (
                <tr key={i.segmentId} data-testid="linha-agenda">
                  <th scope="row">
                    {i.sku} · {i.description}
                  </th>
                  <td>
                    {formatarQuantidade(i.reserved)} {i.unit}
                  </td>
                  <td>
                    {formatarQuantidade(subtrairQuantidades(i.quantity, i.reserved))} {i.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="campo-ajuda">
        Reserva para agenda não é saída: o material e a posição continuam no palete até a saída física confirmada. Pedido por nota ou Delivery depende do arquivo da
        agenda do cliente (formato ainda não recebido).
      </p>
    </section>
  );
}

/**
 * Ações de movimentação, conforme permissão. Ficam bloqueadas (com o motivo)
 * enquanto há conferência em andamento ou para cadastro arquivado; o servidor
 * valida tudo de novo. O histórico é só consulta.
 */
function Movimentacoes({ detalhe, permissoes, aoMovimentar }: { detalhe: PaleteDetalhe; permissoes: readonly Permissao[]; aoMovimentar: (acao: AcaoPalete) => void }) {
  const podeMovimentar = permissoes.includes('movimento.registrar');
  const bloqueio =
    detalhe.archived !== null
      ? 'Cadastro arquivado: não é movimentado.'
      : detalhe.activeCountId !== null
        ? 'Conferência em andamento neste palete: mover e transferir ficam bloqueados até ela ser concluída ou cancelada.'
        : null;
  const comSaldo = (detalhe.currentItems ?? []).length > 0;
  // Etapa 10: palete reconciliado que ficou sem saldo (consolidação) pode sair da posição sem baixa de estoque.
  const vazioConhecido =
    detalhe.countState === 'RECONCILIADO' &&
    detalhe.positionId !== null &&
    (detalhe.currentItems ?? []).every((i) => compararQuantidades(i.quantity, '0') === 0 && compararQuantidades(i.reserved, '0') === 0);
  return (
    <section className="detalhe-secao" aria-labelledby="secao-movimentacoes" data-testid="secao-movimentacoes">
      <h3 id="secao-movimentacoes">Movimentações</h3>
      {podeMovimentar && (
        <div className="acoes-linha">
          <button type="button" className="botao-secundario" disabled={bloqueio !== null} onClick={() => { aoMovimentar('mover'); }} data-testid="acao-mover">
            Mover palete
          </button>
          <button
            type="button"
            className="botao-secundario"
            disabled={bloqueio !== null || !comSaldo}
            onClick={() => { aoMovimentar('transferir'); }}
            data-testid="acao-transferir"
          >
            Transferir produtos
          </button>
        </div>
      )}
      {podeMovimentar && bloqueio !== null && <p className="bloco-nota">{bloqueio}</p>}
      {podeMovimentar && bloqueio === null && !comSaldo && (
        <p className="bloco-nota">Sem saldo validado para transferir: quantidade declarada ou apenas observada não é transferível.</p>
      )}
      {podeMovimentar && bloqueio === null && vazioConhecido && (
        <div className="acoes-linha">
          <button type="button" className="botao-secundario" onClick={() => { aoMovimentar('retirar'); }} data-testid="acao-retirar">
            Retirar palete vazio…
          </button>
          <span className="bloco-nota">Depois de consolidar o conteúdo em outro palete: libera a posição sem baixa de estoque.</span>
        </div>
      )}
      <button type="button" className="botao-link" onClick={() => { aoMovimentar('historico'); }} data-testid="acao-historico">
        Histórico de localização e conteúdo
      </button>
    </section>
  );
}

/** Observações do cadastro, editáveis com proteção de versão. */
function Cadastro({ detalhe, podeEditar, podeArquivar, aoAlterado }: { detalhe: PaleteDetalhe; podeEditar: boolean; podeArquivar: boolean; aoAlterado: () => void }) {
  const chaves = useChaves();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(detalhe.notes ?? '');
  const [arquivando, setArquivando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const url = `${API_PREFIXO}/paletes/${detalhe.id}`;

  async function gravar(assinatura: string, acao: (chave: string) => Promise<PaleteDetalhe>, sucesso: string): Promise<boolean> {
    setOcupado(true);
    setMensagem(null);
    try {
      await acao(chaves.para(assinatura));
      chaves.concluir(assinatura);
      setMensagem({ tipo: 'ok', texto: sucesso });
      aoAlterado();
      return true;
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      if (ehConflitoDeVersao(erro)) {
        setMensagem({ tipo: 'conflito', texto: mensagemDeFalha(erro) });
        aoAlterado();
      } else {
        setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
      }
      return false;
    } finally {
      setOcupado(false);
    }
  }

  const criadoPor = detalhe.createdBy ? `${detalhe.createdBy.name} (${detalhe.createdBy.login})` : 'carga de demonstração';
  return (
    <section className="detalhe-secao" aria-labelledby="secao-cadastro" data-testid="secao-cadastro">
      <h3 id="secao-cadastro">Cadastro</h3>
      <dl className="situacao">
        <div>
          <dt>Data de cadastro</dt>
          <dd>{formatarDataHora(detalhe.createdAt)}</dd>
        </div>
        <div>
          <dt>Responsável</dt>
          <dd>{criadoPor}</dd>
        </div>
        <div>
          <dt>Código</dt>
          <dd>{ROTULOS_ORIGEM_CODIGO[detalhe.codeOrigin]}</dd>
        </div>
      </dl>
      {editando ? (
        <form
          className="formulario-coluna"
          onSubmit={(evento) => {
            evento.preventDefault();
            const corpo = { expectedVersion: detalhe.version, notes: texto };
            void gravar(
              `notas:${detalhe.id}:${String(detalhe.version)}:${texto}`,
              (chave) => enviarJson('PATCH', url, PaleteDetalheSchema, { corpo, idempotencia: chave }),
              'Observações gravadas.',
            ).then((ok) => {
              if (ok) setEditando(false);
            });
          }}
        >
          <label className="campo">
            <span className="campo-rotulo">Observações (até 500 caracteres)</span>
            <textarea rows={3} maxLength={500} value={texto} onChange={(e) => { setTexto(e.target.value); }} />
          </label>
          <div className="acoes-linha">
            <button type="submit" className="botao-primario" disabled={ocupado}>
              {ocupado ? 'Gravando…' : 'Gravar observações'}
            </button>
            <button type="button" className="botao-link" onClick={() => { setEditando(false); setTexto(detalhe.notes ?? ''); }}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="detalhe-observacoes" data-testid="observacoes">
            {detalhe.notes ?? 'Sem observações.'}
          </p>
          {podeEditar && detalhe.archived === null && (
            <button
              type="button"
              className="botao-secundario"
              onClick={() => {
                setTexto(detalhe.notes ?? '');
                setEditando(true);
              }}
            >
              Editar observações
            </button>
          )}
        </>
      )}
      {podeArquivar && detalhe.archived === null && detalhe.countState === 'NAO_CONFERIDO' && detalhe.activeCountId === null && (
        <div className="detalhe-arquivar">
          {arquivando ? (
            <form
              className="formulario-coluna"
              onSubmit={(evento) => {
                evento.preventDefault();
                const corpo = { expectedVersion: detalhe.version, reason: motivo };
                void gravar(
                  `arquivar:${detalhe.id}:${String(detalhe.version)}:${motivo}`,
                  (chave) => enviarJson('POST', `${url}/arquivar`, PaleteDetalheSchema, { corpo, idempotencia: chave }),
                  'Cadastro arquivado. O código continua reservado.',
                );
              }}
            >
              <p className="bloco-nota">
                Arquivar desfaz um cadastro feito por engano: o palete sai do mapa e da lista, a posição fica livre e o código não pode
                ser reutilizado. Mudança física de local usa “Mover palete”, não um arquivamento.
              </p>
              <label className="campo">
                <span className="campo-rotulo">Motivo do arquivamento</span>
                <input value={motivo} minLength={3} maxLength={300} required onChange={(e) => { setMotivo(e.target.value); }} />
              </label>
              <div className="acoes-linha">
                <button type="submit" className="botao-perigo" disabled={ocupado || motivo.trim().length < 3}>
                  Confirmar arquivamento
                </button>
                <button type="button" className="botao-link" onClick={() => { setArquivando(false); }}>
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="botao-link" onClick={() => { setArquivando(true); }}>
              Arquivar cadastro feito por engano…
            </button>
          )}
        </div>
      )}
      <MensagemAcao mensagem={mensagem} testId="mensagem-palete" />
    </section>
  );
}

export function DetalhePalete({
  resumo,
  carga,
  local,
  consultadoEm,
  compacto,
  permissoes,
  tituloRef,
  aoCentralizar,
  aoRecolher,
  aoFechar,
  aoRecarregar,
  aoImprimir,
  aoAbrirConferencia,
  aoMovimentar,
  aoAlterado,
  embutido = false,
}: Props) {
  const detalhe = carga?.estado === 'pronto' && carga.dados.id === resumo.id ? carga.dados : null;
  const carregando = detalhe === null && carga?.estado !== 'erro';
  const arquivado = detalhe?.archived ?? null;
  const pode = (p: Permissao) => permissoes.includes(p);
  // Prazo de reconferência (20 dias): o detalhe traz quem fez a última conferência completa.
  // A situação vem da praça (atualizada periodicamente); o detalhe acrescenta quem fez a última conferência completa.
  const prazo = resumo.reconference === null ? null : { ...resumo.reconference, lastFullCountBy: detalhe?.reconference?.lastFullCountBy ?? resumo.reconference.lastFullCountBy };

  return (
    <article className="detalhe" aria-labelledby="detalhe-titulo" data-testid="detalhe" data-palete-id={resumo.id}>
      {!embutido && (
      <header className="detalhe-topo" data-tutorial="identificacao-palete">
        {compacto && (
          <button type="button" className="botao-voltar" onClick={aoFechar}>
            <IconeVoltar />
            Voltar ao mapa
          </button>
        )}
        <p className="detalhe-sobretitulo">Palete</p>
        <h2 id="detalhe-titulo" ref={tituloRef} tabIndex={-1}>
          {resumo.code}
        </h2>
        <p className="detalhe-local">
          {resumo.positionCode !== null ? (
            <>
              Posição <strong>{resumo.positionCode}</strong>
              {local !== null && <> · {local}</>}
              <span className="detalhe-provisorio"> (código provisório)</span>
            </>
          ) : arquivado ? (
            <strong>Sem posição: cadastro arquivado</strong>
          ) : resumo.informedAddress ? (
            <span data-testid="endereco-informado">
              Endereço <strong>{resumo.informedAddress}</strong> (informado no inventário) ·{' '}
              <strong className="detalhe-mapa-pendente">Posição no mapa pendente</strong>
            </span>
          ) : (
            <strong>Localização pendente: sem posição registrada</strong>
          )}
        </p>
        <p className="detalhe-id">
          ID permanente <code>{resumo.id}</code>
        </p>
        <div className="detalhe-acoes">
          <button
            type="button"
            className="botao-secundario"
            onClick={aoCentralizar}
            disabled={resumo.positionId === null}
            title={resumo.positionId === null ? 'Sem posição: o palete não aparece no mapa.' : undefined}
          >
            <IconeAlvo />
            Centralizar no mapa
          </button>
          {pode('etiqueta.imprimir') && arquivado === null && (
            <button type="button" className="botao-secundario" onClick={aoImprimir} data-testid="acao-etiqueta">
              <IconeImprimir />
              Imprimir etiqueta
            </button>
          )}
          {pode('conferencia.registrar') && arquivado === null && resumo.flowState !== 'EXPEDIDO' && (
            <button
              type="button"
              className="botao-primario"
              onClick={() => {
                aoMovimentar('volumes');
              }}
              data-testid="acao-volumes"
            >
              Conferir volumes
            </button>
          )}
          {pode('palete.cadastrar') && arquivado === null && resumo.flowState !== 'EXPEDIDO' && (
            <button
              type="button"
              className="botao-secundario"
              onClick={() => {
                aoMovimentar('bipagem');
              }}
              data-testid="acao-bipagem"
            >
              <IconeArquivo />
              Importar bipagem
            </button>
          )}
          {!compacto && aoRecolher !== undefined && (
            <button type="button" className="botao-secundario" onClick={aoRecolher} data-testid="recolher-detalhe">
              Recolher detalhes
            </button>
          )}
          {!compacto && (
            <button type="button" className="botao-link" onClick={aoFechar} data-testid="fechar-selecao">
              Fechar
            </button>
          )}
        </div>
      </header>
      )}

      {embutido && (
        // Na janela: o título e as ações ficam no topo dela; aqui ficam a localização detalhada e o ID permanente.
        <section className="detalhe-secao" aria-labelledby="secao-identificacao" data-testid="secao-identificacao">
          <h3 id="secao-identificacao">Identificação</h3>
          <p className="detalhe-local">
            {resumo.positionCode !== null ? (
              <>
                Posição <strong>{resumo.positionCode}</strong>
                {local !== null && <> · {local}</>}
                <span className="detalhe-provisorio"> (código provisório)</span>
              </>
            ) : arquivado ? (
              <strong>Sem posição: cadastro arquivado</strong>
            ) : resumo.informedAddress ? (
              <span data-testid="endereco-informado">
                Endereço <strong>{resumo.informedAddress}</strong> (informado no inventário) ·{' '}
                <strong className="detalhe-mapa-pendente">Posição no mapa pendente</strong>
              </span>
            ) : (
              <strong>Localização pendente: sem posição registrada</strong>
            )}
          </p>
          <p className="detalhe-id">
            ID permanente <code>{resumo.id}</code>
          </p>
        </section>
      )}

      {arquivado !== null && (
        <div className="aviso-arquivado" role="note" data-testid="palete-arquivado">
          <strong>Cadastro arquivado</strong> em {formatarDataHora(arquivado.at)}
          {arquivado.by ? ` por ${arquivado.by.name}` : ''}: {arquivado.reason}. O código não pode ser reutilizado.
        </div>
      )}

      {prazo && (
        <PrazoReconferencia
          r={prazo}
          aoConferir={pode('conferencia.registrar') && arquivado === null && resumo.flowState !== 'EXPEDIDO' ? () => { aoMovimentar('volumes'); } : null}
        />
      )}

      <section className="detalhe-secao" aria-labelledby="secao-situacao">
        <h3 id="secao-situacao">Situação</h3>
        <dl className="situacao">
          <div>
            <dt>Conferência</dt>
            <dd>
              <SeloConferenciaExibida palete={resumo} />
            </dd>
          </div>
          <div>
            <dt>Liberação</dt>
            <dd>
              <SeloLiberacao estado={resumo.releaseState} />
            </dd>
          </div>
          <div>
            <dt>Fluxo</dt>
            <dd>{ROTULOS_FLUXO[resumo.flowState]}</dd>
          </div>
          <div>
            <dt>Pendência</dt>
            <dd>{resumo.pendingReason ?? 'Nenhuma pendência registrada'}</dd>
          </div>
        </dl>
      </section>

      <section className="detalhe-secao" aria-labelledby="secao-conteudo" aria-busy={carregando} data-tutorial="conteudo-palete">
        <h3 id="secao-conteudo">Conteúdo</h3>
        {carga?.estado === 'erro' ? (
          <div className="estado-erro" role="alert">
            <p>Não foi possível carregar o conteúdo deste palete. {carga.mensagem}</p>
            <button type="button" className="botao-secundario" onClick={aoRecarregar}>
              <IconeAtualizar />
              Tentar novamente
            </button>
          </div>
        ) : detalhe === null ? (
          <p className="estado-carregando">Carregando conteúdo…</p>
        ) : (
          <Conteudo apresentacao={apresentarConteudo(detalhe)} />
        )}
      </section>

      {detalhe !== null && <SecaoAgenda detalhe={detalhe} />}

      {detalhe !== null && (
        <ConteudoDoPalete
          key={`conteudo-${detalhe.id}:${detalhe.updatedAt}`}
          paleteId={detalhe.id}
          versao={0}
          aoConferir={arquivado === null ? () => { aoMovimentar('volumes'); } : null}
          aoRegistrar={null}
        />
      )}

      {detalhe !== null && <DocumentosInformados key={`docs-${detalhe.id}:${detalhe.updatedAt}`} paleteId={detalhe.id} versao={0} podeEditar={pode('palete.cadastrar') && arquivado === null} />}

      {detalhe !== null && (
        <SecaoConferencia key={`conf-${detalhe.id}`} detalhe={detalhe} permissoes={permissoes} aoAbrirConferencia={aoAbrirConferencia} aoAlterado={aoAlterado} />
      )}

      {detalhe?.currentItems && (
        <SecaoLiberacao key={`lib-${detalhe.id}`} detalhe={detalhe} permissoes={permissoes} aoAlterado={aoAlterado} />
      )}

      {detalhe !== null && <Movimentacoes detalhe={detalhe} permissoes={permissoes} aoMovimentar={aoMovimentar} />}

      {detalhe !== null && (
        <Cadastro
          key={detalhe.id}
          detalhe={detalhe}
          podeEditar={pode('palete.cadastrar')}
          podeArquivar={pode('palete.arquivar')}
          aoAlterado={aoAlterado}
        />
      )}

      <section className="detalhe-secao detalhe-origem" aria-labelledby="secao-origem">
        <h3 id="secao-origem">Origem dos dados</h3>
        {detalhe?.dataSource === 'OPERACAO' ? (
          <p>Registro da operação.</p>
        ) : (
          <p>Dados fictícios de demonstração, persistidos no banco de desenvolvimento. Não representam o estoque DHL / L’Oréal.</p>
        )}
        <p>
          Consultado em {formatarDataHora(consultadoEm)}
          {detalhe !== null && <>; registro atualizado em {formatarDataHora(detalhe.updatedAt)}</>} (horário de Brasília).
        </p>
      </section>
    </article>
  );
}
