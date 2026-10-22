import { PaleteTesteSchema, SolicitacaoTesteSchema, type ConteudoPaleteTeste, type PaleteTeste, type SolicitacaoTeste } from '@praca-reversa/contracts';
import { useState } from 'react';
import { useChaves } from '../../api/chaves';
import { FalhaRequisicao, enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { JanelaModal } from '../paletes/JanelaPalete';
import { avaliarEscolha } from './escolha';
import { API_TESTE, TIPO_PALETE, chaveConteudo, remetentes, textoDocumento, textoVolumes, textoVolumesPalete } from './textos';

type Modo = 'inteiro' | 'notas';

interface Escolha {
  marcada: boolean;
  /** Texto do campo (vazio = sem quantidade). */
  quantidade: string;
  delivery: string;
  observacao: string;
  comObservacao: boolean;
}

function escolhaInicial(c: ConteudoPaleteTeste): Escolha {
  return { marcada: false, quantidade: c.volumes === null ? '' : String(c.volumes), delivery: '', observacao: '', comObservacao: false };
}

/** Delivery pedida diferente da cadastrada: a quantidade dela não está discriminada no cadastro. */
function deliveryNova(c: ConteudoPaleteTeste, e: Escolha): boolean {
  const pedida = e.delivery.trim();
  return pedida !== '' && pedida.toUpperCase() !== (c.delivery ?? '').trim().toUpperCase();
}

interface Props {
  paleteId: string;
  /** Carrinho atual (rascunho ou revisão autorizada); `null` = escolher a agenda antes. */
  solicitacao: SolicitacaoTeste | null;
  aoFechar: () => void;
  aoAdicionar: (s: SolicitacaoTeste) => void;
}

/**
 * Janela do palete da "Seleção cliente — teste". Responde, nesta ordem: qual
 * palete é, quais notas e quantos volumes ele tem, o que está sendo escolhido
 * e como adicionar ao pedido ("Adicionar à seleção", com a prévia exata do que
 * entra). Sem ferramentas da operação (conferência, movimentação, etiqueta).
 */
export function JanelaPaleteTeste({ paleteId, solicitacao, aoFechar, aoAdicionar }: Props) {
  const { carga, recarregar } = useRecurso(`${API_TESTE}/paletes/${encodeURIComponent(paleteId)}`, PaleteTesteSchema);
  const dados = carga?.estado === 'pronto' ? carga.dados : null;
  return (
    <JanelaModal
      titulo={dados === null ? 'Palete' : `Palete ${dados.palletCode}`}
      subtitulo={dados === null ? undefined : `${TIPO_PALETE[dados.palletType].rotulo}: ${TIPO_PALETE[dados.palletType].explicacao}.`}
      aoFechar={aoFechar}
      testId="janela-palete-teste"
      paleteId={paleteId}
    >
      {carga === null || carga.estado === 'carregando' ? (
        <p className="st-nota" role="status">
          Carregando o palete…
        </p>
      ) : carga.estado === 'erro' ? (
        <div className="estado-erro" role="alert">
          <p>{carga.status === 404 ? 'Este palete não está no estoque consultado (arquivado, expedido ou de outra praça).' : carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            Tentar novamente
          </button>
        </div>
      ) : (
        <ConteudoJanela key={dados?.consultedAt} palete={carga.dados} solicitacao={solicitacao} aoFechar={aoFechar} aoAdicionar={aoAdicionar} />
      )}
    </JanelaModal>
  );
}

function ConteudoJanela({ palete, solicitacao, aoFechar, aoAdicionar }: { palete: PaleteTeste; solicitacao: SolicitacaoTeste | null; aoFechar: () => void; aoAdicionar: (s: SolicitacaoTeste) => void }) {
  const conteudos = palete.contents;
  const [modo, setModo] = useState<Modo>(conteudos.length <= 1 ? 'inteiro' : 'notas');
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>(() => Object.fromEntries(conteudos.map((c) => [chaveConteudo(c), escolhaInicial(c)])));
  const [observacaoPalete, setObservacaoPalete] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<{ texto: string; troca: boolean } | null>(null);
  const chaves = useChaves();

  const conhecidos = conteudos.filter((c) => c.volumes !== null);
  const soma = conhecidos.reduce((t, c) => t + (c.volumes ?? 0), 0);
  const semVolume = conteudos.length - conhecidos.length;
  const nomes = remetentes(conteudos);
  const comDelivery = conteudos.some((c) => c.delivery !== null);
  const naSelecao = (solicitacao?.items ?? []).filter((i) => i.palletId === palete.palletId);
  const mais = {
    endereco: palete.moreInfo.address,
    cnpjs: conteudos.filter((c) => c.cnpj !== null),
    descricoes: conteudos.filter((c) => c.description !== null),
    skus: palete.moreInfo.skus,
  };
  const temMais = mais.endereco !== null || mais.cnpjs.length > 0 || mais.descricoes.length > 0 || mais.skus.length > 0;

  const marcadas = conteudos.filter((c) => escolhas[chaveConteudo(c)]?.marcada === true);
  const avaliacoes = new Map(marcadas.map((c) => [chaveConteudo(c), avaliarEscolha(c, escolhas[chaveConteudo(c)] ?? escolhaInicial(c))]));
  const invalida = [...avaliacoes.values()].some((a) => a.erro !== null);
  const vazio = modo === 'notas' && marcadas.length === 0;
  const podeAdicionar = solicitacao !== null && !enviando && !vazio && !invalida && conteudos.length + (modo === 'inteiro' ? 1 : 0) > 0;

  const alterar = (c: ConteudoPaleteTeste, parcial: Partial<Escolha>) => {
    setErro(null);
    setEscolhas((atual) => ({ ...atual, [chaveConteudo(c)]: { ...(atual[chaveConteudo(c)] ?? escolhaInicial(c)), ...parcial } }));
  };

  async function adicionar(trocar: boolean) {
    if (solicitacao === null) return;
    const corpo =
      modo === 'inteiro'
        ? { expectedVersion: solicitacao.version, palletId: palete.palletId, wholePallet: true, note: observacaoPalete.trim() === '' ? null : observacaoPalete.trim(), contents: [], replace: trocar }
        : {
            expectedVersion: solicitacao.version,
            palletId: palete.palletId,
            wholePallet: false,
            replace: trocar,
            contents: marcadas.map((c) => {
              const e = escolhas[chaveConteudo(c)] ?? escolhaInicial(c);
              return { ref: c.ref, volumes: avaliacoes.get(chaveConteudo(c))?.volumes ?? null, delivery: e.delivery.trim() === '' ? null : e.delivery.trim(), note: e.observacao.trim() === '' ? null : e.observacao.trim() };
            }),
          };
    const assinatura = `adicionar:${solicitacao.id}:${JSON.stringify(corpo)}`;
    setEnviando(true);
    setErro(null);
    try {
      const atualizada = await enviarJson('POST', `${API_TESTE}/solicitacoes/${solicitacao.id}/itens`, SolicitacaoTesteSchema, {
        corpo,
        idempotencia: chaves.para(assinatura),
        descricao: 'Adicionar à seleção (teste)',
      });
      chaves.concluir(assinatura);
      aoAdicionar(atualizada);
    } catch (falha) {
      chaves.concluir(assinatura, falha);
      const duplicada = falha instanceof FalhaRequisicao && falha.codigo === 'SELECAO_DUPLICADA';
      setErro({ texto: mensagemDeFalha(falha), troca: duplicada && !trocar && (naSelecao.some((i) => i.scope === 'PALETE') !== (modo === 'inteiro')) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="st-janela" data-testid="st-janela">
      {/* 1. Qual palete e o que tem nele. */}
      <p className="st-resumo-palete" data-testid="st-resumo-palete">
        <strong>{conteudos.length === 0 ? 'Conteúdo não identificado no cadastro' : `${String(conteudos.length)} nota${conteudos.length === 1 ? '' : 's'}`}</strong>
        {conteudos.length > 0 && ` · ${textoVolumesPalete(conteudos.length, soma, semVolume)}`}
        {nomes.length > 0 && ` · ${nomes.length === 1 ? `remetente ${nomes[0] ?? ''}` : `${String(nomes.length)} remetentes`}`}
      </p>

      {naSelecao.length > 0 && (
        <p className="st-aviso-suave" data-testid="st-ja-na-selecao">
          Já na sua seleção: {naSelecao.map((i) => (i.scope === 'PALETE' ? 'o palete inteiro' : textoDocumento(i.content))).join(', ')}.
        </p>
      )}

      {/* 2. O que estou selecionando. */}
      {conteudos.length > 0 && (
        <fieldset className="st-modo">
          <legend className="st-rotulo">O que você quer pedir deste palete?</legend>
          <label className={`st-opcao${modo === 'inteiro' ? ' st-opcao--ativa' : ''}`}>
            <input type="radio" name="st-modo" checked={modo === 'inteiro'} onChange={() => { setModo('inteiro'); setErro(null); }} data-testid="st-modo-inteiro" />
            <span>
              <strong>Selecionar palete inteiro</strong>
              <small>Todas as notas abaixo{semVolume === 0 ? ` (${textoVolumes(soma)})` : ''}.</small>
            </span>
          </label>
          <label className={`st-opcao${modo === 'notas' ? ' st-opcao--ativa' : ''}`}>
            <input type="radio" name="st-modo" checked={modo === 'notas'} onChange={() => { setModo('notas'); setErro(null); }} data-testid="st-modo-notas" />
            <span>
              <strong>Escolher notas deste palete</strong>
              <small>Marque só as notas que quer pedir; o restante continua no palete.</small>
            </span>
          </label>
        </fieldset>
      )}

      <div className="st-tabela-rolagem">
        <table className="st-tabela" data-testid="st-notas">
          <thead>
            <tr>
              {modo === 'notas' && <th scope="col" className="st-col-marca"><span className="visualmente-oculto">Escolher</span></th>}
              <th scope="col">Nota</th>
              <th scope="col">Remetente</th>
              {comDelivery && <th scope="col">Delivery</th>}
              <th scope="col" className="st-num">Volumes</th>
            </tr>
          </thead>
          <tbody>
            {conteudos.length === 0 && (
              <tr>
                <td colSpan={5}>O cadastro não identifica notas neste palete. Se pedir o palete inteiro, a operação confere o conteúdo.</td>
              </tr>
            )}
            {conteudos.map((c) => {
              const k = chaveConteudo(c);
              const e = escolhas[k] ?? escolhaInicial(c);
              const av = avaliacoes.get(k);
              const idCampo = `st-${k.replace(/[^a-z0-9]/gi, '')}`;
              return (
                <FragmentoNota
                  key={k}
                  c={c}
                  e={e}
                  modo={modo}
                  comDelivery={comDelivery}
                  idCampo={idCampo}
                  avaliacao={av ?? null}
                  deliveryNova={deliveryNova(c, e)}
                  aoAlterar={(parcial) => {
                    alterar(c, parcial);
                  }}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {modo === 'inteiro' && conteudos.length > 0 && (
        <label className="campo st-observacao-palete">
          <span className="campo-rotulo">Observação para a separação deste palete (opcional)</span>
          <textarea rows={2} maxLength={500} value={observacaoPalete} onChange={(ev) => { setObservacaoPalete(ev.target.value); }} data-testid="st-observacao-palete" />
        </label>
      )}

      {temMais && (
        <details className="st-mais" data-testid="st-mais-informacoes">
          <summary>Mais informações</summary>
          <dl>
            {mais.endereco !== null && (
              <>
                <dt>Endereço físico</dt>
                <dd>{mais.endereco}</dd>
              </>
            )}
            {mais.cnpjs.length > 0 && (
              <>
                <dt>CNPJ do remetente</dt>
                <dd>{mais.cnpjs.map((c) => `${textoDocumento(c)}: ${c.cnpj ?? ''}`).join(' · ')}</dd>
              </>
            )}
            {mais.descricoes.length > 0 && (
              <>
                <dt>Produto ou descrição</dt>
                <dd>{mais.descricoes.map((c) => `${textoDocumento(c)}: ${c.description ?? ''}`).join(' · ')}</dd>
              </>
            )}
            {mais.skus.length > 0 && (
              <>
                <dt>SKU com saldo no palete</dt>
                <dd>{mais.skus.map((s) => `${s.sku} — ${s.description}${s.lot === null ? '' : ` (lote ${s.lot})`}`).join(' · ')}</dd>
              </>
            )}
          </dl>
        </details>
      )}

      {/* 3. Prévia exata e 4. a ação principal. */}
      <section className="st-previa" aria-live="polite" data-testid="st-previa">
        <h3 className="st-rotulo">Você vai adicionar</h3>
        {modo === 'inteiro' ? (
          <p>
            <strong>Palete {palete.palletCode} inteiro</strong> —{' '}
            {conteudos.length === 0
              ? 'conteúdo não identificado no cadastro: a operação confere o conteúdo e a quantidade'
              : semVolume === 0
                ? textoVolumes(soma)
                : 'quantidade em análise (há nota sem volume informado)'}
            {observacaoPalete.trim() !== '' && <span className="st-nota"> · Observação: {observacaoPalete.trim()}</span>}
          </p>
        ) : marcadas.length === 0 ? (
          <p className="st-nota">Nada ainda: marque as notas que quer pedir.</p>
        ) : (
          <ul>
            {marcadas.map((c) => {
              const k = chaveConteudo(c);
              const e = escolhas[k] ?? escolhaInicial(c);
              const av = avaliacoes.get(k);
              return (
                <li key={k}>
                  <strong>{textoDocumento(c)}</strong>
                  {e.delivery.trim() !== '' && ` · Delivery ${e.delivery.trim()}`} —{' '}
                  {av?.erro !== null && av?.erro !== undefined ? <span className="st-erro">{av.erro}</span> : av?.volumes === null || av === undefined ? 'sem quantidade definida (análise)' : textoVolumes(av.volumes)}
                  {e.observacao.trim() !== '' && <span className="st-nota"> · Obs.: {e.observacao.trim()}</span>}
                </li>
              );
            })}
          </ul>
        )}
        {erro !== null && (
          <div className="estado-erro" role="alert" data-testid="st-erro-adicionar">
            <p>{erro.texto}</p>
            {erro.troca && (
              <button type="button" className="botao-secundario" onClick={() => void adicionar(true)} disabled={enviando} data-testid="st-trocar">
                {modo === 'inteiro' ? 'Trocar as notas pelo palete inteiro' : 'Trocar o palete inteiro pelas notas escolhidas'}
              </button>
            )}
          </div>
        )}
        {solicitacao === null && <p className="st-nota">Escolha a agenda no topo da página para começar a seleção.</p>}
        <div className="st-acoes">
          <button type="button" className="botao-primario" disabled={!podeAdicionar} onClick={() => void adicionar(false)} data-testid="st-adicionar">
            {enviando ? 'Adicionando…' : 'Adicionar à seleção'}
          </button>
          <button type="button" className="botao-secundario" onClick={aoFechar}>
            Cancelar
          </button>
        </div>
      </section>
    </div>
  );
}

function FragmentoNota({
  c,
  e,
  modo,
  comDelivery,
  idCampo,
  avaliacao,
  deliveryNova: nova,
  aoAlterar,
}: {
  c: ConteudoPaleteTeste;
  e: Escolha;
  modo: Modo;
  comDelivery: boolean;
  idCampo: string;
  avaliacao: ReturnType<typeof avaliarEscolha> | null;
  deliveryNova: boolean;
  aoAlterar: (parcial: Partial<Escolha>) => void;
}) {
  const colunas = (modo === 'notas' ? 1 : 0) + 3 + (comDelivery ? 1 : 0);
  return (
    <>
      <tr className={e.marcada && modo === 'notas' ? 'st-linha-marcada' : undefined} data-testid="st-nota">
        {modo === 'notas' && (
          <td className="st-col-marca">
            <input
              type="checkbox"
              id={`${idCampo}-marca`}
              checked={e.marcada}
              onChange={(ev) => {
                aoAlterar({ marcada: ev.target.checked });
              }}
              aria-label={`Escolher ${textoDocumento(c)}`}
              data-testid="st-marcar-nota"
            />
          </td>
        )}
        <td>
          <label htmlFor={modo === 'notas' ? `${idCampo}-marca` : undefined}>{textoDocumento(c)}</label>
        </td>
        <td>{c.sender ?? 'Não informado'}</td>
        {comDelivery && <td>{c.delivery ?? '—'}</td>}
        <td className="st-num">{c.volumes === null ? 'não informado' : c.volumes.toLocaleString('pt-BR')}</td>
      </tr>
      {modo === 'notas' && e.marcada && (
        <tr className="st-linha-escolha">
          <td colSpan={colunas}>
            <div className="st-escolha">
              <label className="campo">
                <span className="campo-rotulo">Quantidade a pedir{c.volumes === null ? '' : ` (de ${String(c.volumes)})`}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={c.volumes ?? undefined}
                  step={1}
                  value={e.quantidade}
                  onChange={(ev) => {
                    aoAlterar({ quantidade: ev.target.value });
                  }}
                  aria-invalid={avaliacao?.erro !== null && avaliacao?.erro !== undefined}
                  data-testid="st-quantidade"
                />
              </label>
              <label className="campo">
                <span className="campo-rotulo">Delivery a pedir (opcional)</span>
                <input
                  type="text"
                  maxLength={60}
                  value={e.delivery}
                  placeholder={c.delivery ?? 'Ex.: 8000123'}
                  onChange={(ev) => {
                    aoAlterar({ delivery: ev.target.value });
                  }}
                  data-testid="st-delivery"
                />
              </label>
              {e.comObservacao ? (
                <label className="campo st-escolha-observacao">
                  <span className="campo-rotulo">Observação desta nota</span>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={e.observacao}
                    onChange={(ev) => {
                      aoAlterar({ observacao: ev.target.value });
                    }}
                    data-testid="st-observacao-nota"
                  />
                </label>
              ) : (
                <button
                  type="button"
                  className="botao-link st-escolha-observacao"
                  onClick={() => {
                    aoAlterar({ comObservacao: true });
                  }}
                  data-testid="st-adicionar-observacao"
                >
                  Adicionar observação
                </button>
              )}
            </div>
            {nova && <p className="st-nota">A Delivery {e.delivery.trim()} não está discriminada no cadastro desta nota: a operação confere a quantidade dela na separação.</p>}
            {avaliacao?.erro !== null && avaliacao?.erro !== undefined && (
              <p className="st-erro" role="alert">
                {avaliacao.erro}
              </p>
            )}
            {avaliacao?.erro === null && avaliacao.analise !== null && <p className="st-aviso-suave">{avaliacao.analise}</p>}
          </td>
        </tr>
      )}
    </>
  );
}
