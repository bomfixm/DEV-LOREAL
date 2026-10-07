import {
  API_PREFIXO,
  CadastroPaleteSchema,
  ListaProdutosSchema,
  PaleteDetalheSchema,
  PracaSchema,
  TIPOS_ORIGEM_DOCUMENTO,
  type CadastroPalete,
  type PaleteDetalhe,
  type Produto,
  type Sessao,
  type TipoOrigemDocumento,
} from '@praca-reversa/contracts';
import { useId, useMemo, useState, type SubmitEvent } from 'react';
import { useChaves } from '../../api/chaves';
import { enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeImprimir, IconeMais } from '../../components/Icones';
import { EstadoTela, MensagemAcao, Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { ROTULOS_ORIGEM_DOCUMENTO } from '../paletes/conteudo';
import { normalizar } from '../paletes/filtro';

const URL_PRACA = `${API_PREFIXO}/praca`;
const URL_PRODUTOS = `${API_PREFIXO}/produtos?limite=200`;
const URL_PALETES = `${API_PREFIXO}/paletes`;

interface LinhaForm {
  chave: number;
  sku: string;
  descricao: string;
  lote: string;
  origemTipo: TipoOrigemDocumento | '';
  referencia: string;
  quantidade: string;
  unidade: string;
}

const linhaVazia = (chave: number): LinhaForm => ({
  chave,
  sku: '',
  descricao: '',
  lote: '',
  origemTipo: '',
  referencia: '',
  quantidade: '',
  unidade: 'UN',
});

type Mensagem = { tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null;

function unidadesDe(produto: Produto | undefined): string[] {
  return produto ? [produto.canonicalUnit, ...produto.barcodes.map((b) => b.packaging).filter((u) => u !== produto.canonicalUnit)] : [];
}

/**
 * Cadastro de palete: ID permanente gerado no servidor, código legível
 * (existente ou gerado), localização inicial opcional, observações e linhas
 * declaradas em documento. Não existe campo de saldo: o conteúdo físico fica
 * desconhecido até a conferência (etapa 04).
 */
export function TelaNovoPalete({ sessao, aoNavegar, aoGravar }: { sessao: Sessao; aoNavegar: Navegar; aoGravar: () => void }) {
  const praca = useRecurso(URL_PRACA, PracaSchema);
  const produtos = useRecurso(sessao.permissions.includes('produto.consultar') ? URL_PRODUTOS : null, ListaProdutosSchema);
  const conectado = useConectado();
  const chaves = useChaves();
  const ids = useId();

  const [modoCodigo, setModoCodigo] = useState<'GERAR' | 'INFORMAR'>('GERAR');
  const [codigo, setCodigo] = useState('');
  const [modoPosicao, setModoPosicao] = useState<'posicao' | 'pendente'>('posicao');
  const [posicaoTexto, setPosicaoTexto] = useState('');
  const [notas, setNotas] = useState('');
  const [linhas, setLinhas] = useState<LinhaForm[]>([]);
  const [proximaLinha, setProximaLinha] = useState(1);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [resultado, setResultado] = useState<PaleteDetalhe | null>(null);

  const dados = praca.carga?.estado === 'pronto' ? praca.carga.dados : null;
  const layout = dados?.layout ?? null;
  const ocupadas = useMemo(
    () => new Map((dados?.pallets ?? []).flatMap((p) => (p.positionId === null ? [] : [[p.positionId, p.code] as const]))),
    [dados],
  );
  const posicoesPorChave = useMemo(() => new Map((layout?.positions ?? []).map((p) => [normalizar(p.code), p])), [layout]);
  const livres = useMemo(() => (layout?.positions ?? []).filter((p) => p.available && !ocupadas.has(p.id)), [layout, ocupadas]);
  const produtosPorSku = useMemo(
    () => new Map((produtos.carga?.estado === 'pronto' ? produtos.carga.dados.items : []).map((p) => [p.sku, p])),
    [produtos.carga],
  );

  const escolhida = posicaoTexto.trim() === '' ? undefined : posicoesPorChave.get(normalizar(posicaoTexto));
  const situacaoPosicao =
    modoPosicao === 'pendente' || posicaoTexto.trim() === ''
      ? null
      : escolhida === undefined
        ? { ok: false, texto: 'Posição não encontrada no layout ativo.' }
        : !escolhida.available
          ? { ok: false, texto: `Indisponível${escolhida.unavailableReason ? `: ${escolhida.unavailableReason}` : ''}.` }
          : ocupadas.has(escolhida.id)
            ? { ok: false, texto: `Ocupada pelo palete ${ocupadas.get(escolhida.id) ?? ''}.` }
            : { ok: true, texto: `Livre${escolhida.provisionalCode ? ' (código provisório)' : ''}.` };

  function alterarLinha(chave: number, mudanca: Partial<LinhaForm>) {
    setLinhas((atual) =>
      atual.map((l) => {
        if (l.chave !== chave) return l;
        const nova = { ...l, ...mudanca };
        // Produto do cadastro: a unidade padrão é a canônica dele.
        if (mudanca.sku !== undefined) {
          const produto = produtosPorSku.get(mudanca.sku.trim());
          if (produto && !unidadesDe(produto).includes(nova.unidade)) nova.unidade = produto.canonicalUnit;
        }
        return nova;
      }),
    );
  }

  function montarCorpo(): CadastroPalete {
    return {
      code: modoCodigo === 'GERAR' ? { mode: 'GERAR' } : { mode: 'INFORMAR', value: codigo },
      positionId: modoPosicao === 'pendente' ? null : (escolhida?.id ?? null),
      notes: notas,
      declaredItems: linhas.map((l) => ({
        sku: l.sku.trim() === '' ? null : l.sku.trim(),
        description: l.sku.trim() === '' ? l.descricao : null,
        lot: l.lote.trim() === '' ? null : l.lote,
        originType: l.origemTipo === '' ? null : l.origemTipo,
        originReference: l.referencia.trim() === '' ? null : l.referencia,
        quantity: l.quantidade.trim().replace(',', '.'),
        unit: l.unidade,
      })),
    };
  }

  async function enviar(evento: SubmitEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    setMensagem(null);
    if (modoPosicao === 'posicao' && (escolhida === undefined || situacaoPosicao?.ok !== true)) {
      setMensagem({ tipo: 'erro', texto: 'Escolha uma posição livre do layout ou marque "Sem posição (localização pendente)".' });
      return;
    }
    const corpo = montarCorpo();
    const validacao = CadastroPaleteSchema.safeParse(corpo);
    if (!validacao.success) {
      setMensagem({ tipo: 'erro', texto: validacao.error.issues[0]?.message ?? 'Confira os dados do cadastro.' });
      return;
    }
    const assinatura = JSON.stringify(corpo);
    setEnviando(true);
    try {
      const criado = await enviarJson('POST', URL_PALETES, PaleteDetalheSchema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      setResultado(criado);
      aoGravar();
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
      // A ocupação pode ter mudado (outra pessoa cadastrou na mesma posição).
      praca.recarregar();
    } finally {
      setEnviando(false);
    }
  }

  function recomecar() {
    setResultado(null);
    setModoCodigo('GERAR');
    setCodigo('');
    setPosicaoTexto('');
    setNotas('');
    setLinhas([]);
    setMensagem(null);
    praca.recarregar();
  }

  const voltar = () => {
    aoNavegar({ tipo: 'praca' });
  };

  if (resultado !== null) {
    return (
      <Pagina titulo="Palete cadastrado" testId="tela-novo-palete" aoVoltar={voltar}>
        <section className="cartao cartao-sucesso" data-testid="cadastro-sucesso" aria-live="polite">
          <p className="sucesso-codigo">{resultado.code}</p>
          <dl className="situacao">
            <div>
              <dt>Localização inicial</dt>
              <dd>{resultado.positionCode ?? 'Pendente (sem posição)'}</dd>
            </div>
            <div>
              <dt>Conteúdo</dt>
              <dd>Desconhecido até a conferência</dd>
            </div>
            <div>
              <dt>Cadastrado em</dt>
              <dd>{formatarDataHora(resultado.createdAt)}</dd>
            </div>
            <div>
              <dt>ID permanente</dt>
              <dd>
                <code>{resultado.id}</code>
              </dd>
            </div>
          </dl>
          <div className="acoes-linha">
            <button
              type="button"
              className="botao-primario"
              onClick={() => {
                aoNavegar({ tipo: 'palete', id: resultado.id });
              }}
            >
              Ver no mapa
            </button>
            {sessao.permissions.includes('etiqueta.imprimir') && (
              <button
                type="button"
                className="botao-secundario"
                onClick={() => {
                  aoNavegar({ tipo: 'etiquetas', ids: [resultado.id] });
                }}
              >
                <IconeImprimir />
                Imprimir etiqueta
              </button>
            )}
            <button type="button" className="botao-secundario" onClick={recomecar}>
              Cadastrar outro
            </button>
          </div>
        </section>
      </Pagina>
    );
  }

  if (praca.carga?.estado !== 'pronto') {
    return <EstadoTela carga={praca.carga} titulo="Não foi possível carregar o layout para o cadastro" aoTentarNovamente={praca.recarregar} />;
  }

  return (
    <Pagina ajuda="cadastrar"
      titulo="Cadastrar palete"
      testId="tela-novo-palete"
      aoVoltar={voltar}
      descricao={
        <p>
          Escopo <strong>{sessao.activeScope?.name}</strong> · responsável <strong>{sessao.user.name}</strong>. O palete novo fica com conferência
          e liberação pendentes e conteúdo desconhecido.
        </p>
      }
    >
      <form
        className="formulario-cadastro"
        noValidate
        onSubmit={(evento) => {
          void enviar(evento);
        }}
      >
        <fieldset className="cartao">
          <legend>Código do palete</legend>
          <label className="opcao">
            <input type="radio" name="modo-codigo" checked={modoCodigo === 'GERAR'} onChange={() => { setModoCodigo('GERAR'); }} />
            Gerar código interno (próximo da sequência do escopo)
          </label>
          <label className="opcao">
            <input type="radio" name="modo-codigo" checked={modoCodigo === 'INFORMAR'} onChange={() => { setModoCodigo('INFORMAR'); }} />
            Informar identificação existente da operação
          </label>
          {modoCodigo === 'INFORMAR' && (
            <label className="campo">
              <span className="campo-rotulo">Identificação existente</span>
              <input
                value={codigo}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={40}
                onChange={(e) => {
                  setCodigo(e.target.value);
                }}
              />
              <span className="campo-ajuda">Letras, números e . _ / -. Não use o número da posição: a localização é registrada à parte.</span>
            </label>
          )}
        </fieldset>

        <fieldset className="cartao">
          <legend>Localização inicial</legend>
          <label className="opcao">
            <input type="radio" name="modo-posicao" checked={modoPosicao === 'posicao'} onChange={() => { setModoPosicao('posicao'); }} />
            Posição no layout
          </label>
          <label className="opcao">
            <input type="radio" name="modo-posicao" checked={modoPosicao === 'pendente'} onChange={() => { setModoPosicao('pendente'); }} />
            Sem posição (localização pendente)
          </label>
          {modoPosicao === 'posicao' &&
            (layout === null ? (
              <p className="estado-erro">Este escopo ainda não tem layout. Cadastre sem posição ou peça a configuração do layout.</p>
            ) : (
              <label className="campo">
                <span className="campo-rotulo">Código da posição</span>
                <input
                  value={posicaoTexto}
                  list={`${ids}-posicoes`}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="Ex.: F06-P17"
                  aria-describedby={`${ids}-situacao`}
                  onChange={(e) => {
                    setPosicaoTexto(e.target.value);
                  }}
                />
                <datalist id={`${ids}-posicoes`}>
                  {livres.map((p) => (
                    <option key={p.id} value={p.code} />
                  ))}
                </datalist>
                <span
                  id={`${ids}-situacao`}
                  className={situacaoPosicao === null ? 'campo-ajuda' : situacaoPosicao.ok ? 'campo-ajuda campo-ok' : 'campo-ajuda campo-erro'}
                  data-testid="situacao-posicao"
                >
                  {situacaoPosicao?.texto ?? `${String(livres.length)} posições livres e disponíveis neste layout.`}
                </span>
              </label>
            ))}
        </fieldset>

        <fieldset className="cartao">
          <legend>Observações</legend>
          <label className="campo">
            <span className="campo-rotulo">Observações do cadastro (opcional)</span>
            <textarea rows={3} maxLength={500} value={notas} onChange={(e) => { setNotas(e.target.value); }} />
          </label>
        </fieldset>

        <fieldset className="cartao">
          <legend>Declarado em documento (opcional)</legend>
          <p className="bloco-nota">
            Linhas de nota, devolução ou manifesto. Não comprovam presença física nem criam saldo. Sem SKU, o produto fica pendente; sem
            documento, a origem fica pendente.
          </p>
          {linhas.map((l, indice) => {
            const produto = produtosPorSku.get(l.sku.trim());
            const unidades = unidadesDe(produto);
            return (
              <div key={l.chave} className="linha-declarada" data-testid="linha-declarada">
                <p className="linha-titulo">Linha {indice + 1}</p>
                <label className="campo">
                  <span className="campo-rotulo">SKU (vazio = produto pendente)</span>
                  <input
                    value={l.sku}
                    list={`${ids}-produtos`}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => {
                      alterarLinha(l.chave, { sku: e.target.value });
                    }}
                  />
                  {produto && <span className="campo-ajuda campo-ok">{produto.description}</span>}
                </label>
                {l.sku.trim() === '' && (
                  <label className="campo">
                    <span className="campo-rotulo">Descrição no documento</span>
                    <input value={l.descricao} maxLength={200} onChange={(e) => { alterarLinha(l.chave, { descricao: e.target.value }); }} />
                  </label>
                )}
                <label className="campo">
                  <span className="campo-rotulo">Lote (vazio = pendente)</span>
                  <input value={l.lote} maxLength={64} spellCheck={false} onChange={(e) => { alterarLinha(l.chave, { lote: e.target.value }); }} />
                </label>
                <label className="campo">
                  <span className="campo-rotulo">Documento de origem</span>
                  <select value={l.origemTipo} onChange={(e) => { alterarLinha(l.chave, { origemTipo: e.target.value as TipoOrigemDocumento | '' }); }}>
                    <option value="">Origem pendente</option>
                    {TIPOS_ORIGEM_DOCUMENTO.map((t) => (
                      <option key={t} value={t}>
                        {ROTULOS_ORIGEM_DOCUMENTO[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="campo">
                  <span className="campo-rotulo">Referência do documento</span>
                  <input
                    value={l.referencia}
                    maxLength={64}
                    spellCheck={false}
                    disabled={l.origemTipo === ''}
                    onChange={(e) => {
                      alterarLinha(l.chave, { referencia: e.target.value });
                    }}
                  />
                </label>
                <label className="campo">
                  <span className="campo-rotulo">Quantidade declarada</span>
                  <input value={l.quantidade} inputMode="decimal" onChange={(e) => { alterarLinha(l.chave, { quantidade: e.target.value }); }} />
                </label>
                <label className="campo">
                  <span className="campo-rotulo">Unidade</span>
                  {unidades.length > 0 ? (
                    <select value={l.unidade} onChange={(e) => { alterarLinha(l.chave, { unidade: e.target.value }); }}>
                      {unidades.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={l.unidade}
                      maxLength={10}
                      autoCapitalize="characters"
                      onChange={(e) => {
                        alterarLinha(l.chave, { unidade: e.target.value.toUpperCase() });
                      }}
                    />
                  )}
                </label>
                <button
                  type="button"
                  className="botao-link"
                  onClick={() => {
                    setLinhas((atual) => atual.filter((x) => x.chave !== l.chave));
                  }}
                >
                  Remover linha {indice + 1}
                </button>
              </div>
            );
          })}
          <datalist id={`${ids}-produtos`}>
            {[...produtosPorSku.values()].map((p) => (
              <option key={p.id} value={p.sku}>
                {p.description}
              </option>
            ))}
          </datalist>
          <button
            type="button"
            className="botao-secundario"
            disabled={linhas.length >= 50}
            onClick={() => {
              setLinhas((atual) => [...atual, linhaVazia(proximaLinha)]);
              setProximaLinha((n) => n + 1);
            }}
          >
            <IconeMais />
            Acrescentar linha declarada
          </button>
        </fieldset>

        <MensagemAcao mensagem={mensagem} testId="erro-cadastro" />
        {!conectado && <p className="estado-erro">Sem conexão: nada é registrado. Tente quando a rede voltar.</p>}
        <div className="acoes-linha">
          <button type="submit" className="botao-primario" disabled={enviando || !conectado} aria-busy={enviando}>
            {enviando ? 'Cadastrando…' : 'Cadastrar palete'}
          </button>
          <button type="button" className="botao-link" onClick={voltar}>
            Cancelar
          </button>
        </div>
      </form>
    </Pagina>
  );
}
