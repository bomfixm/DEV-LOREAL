import {
  API_PREFIXO,
  AlterarProdutoSchema,
  CriarProdutoSchema,
  ListaProdutosSchema,
  ProdutoSchema,
  type Produto,
} from '@praca-reversa/contracts';
import { useEffect, useId, useState, type SubmitEvent } from 'react';
import { ehConflitoDeVersao, useChaves } from '../../api/chaves';
import { enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeMais } from '../../components/Icones';
import { MensagemAcao, Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';

const URL_PRODUTOS = `${API_PREFIXO}/produtos`;
/** Sugestões de unidade; outras unidades podem ser digitadas (1 a 10 letras/dígitos). */
const UNIDADES_SUGERIDAS = ['UN', 'CX', 'PCT', 'KG', 'L'];

interface CodigoForm {
  chave: number;
  code: string;
  packaging: string;
  factor: string;
  /** Fator ainda não conhecido/aprovado: código reconhecido, conversão bloqueada. */
  fatorPendente: boolean;
}

interface Formulario {
  id: string | null;
  version: number;
  sku: string;
  description: string;
  canonicalUnit: string;
  active: boolean;
  inUse: boolean;
  barcodes: CodigoForm[];
}

const VAZIO: Formulario = { id: null, version: 1, sku: '', description: '', canonicalUnit: 'UN', active: true, inUse: false, barcodes: [] };

type Mensagem = { tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null;

function formularioDe(p: Produto): Formulario {
  return {
    id: p.id,
    version: p.version,
    sku: p.sku,
    description: p.description,
    canonicalUnit: p.canonicalUnit,
    active: p.active,
    inUse: p.inUse,
    barcodes: p.barcodes.map((b, i) => ({ chave: i + 1, code: b.code, packaging: b.packaging, factor: b.factor ?? '', fatorPendente: b.factor === null })),
  };
}

/**
 * Cadastro de produtos do escopo: SKU textual (zeros à esquerda preservados),
 * unidade canônica e códigos de barras com embalagem e fator explícitos.
 * Cadastrar produto não cria saldo físico.
 */
export function TelaProdutos({ podeEditar, aoVoltar, aoGravar }: { podeEditar: boolean; aoVoltar: () => void; aoGravar: () => void }) {
  const ids = useId();
  const conectado = useConectado();
  const chaves = useChaves();
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [inativos, setInativos] = useState(false);
  const [versao, setVersao] = useState(0);
  const [form, setForm] = useState<Formulario | null>(null);
  const [proximo, setProximo] = useState(100);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);

  useEffect(() => {
    const espera = setTimeout(() => {
      setBusca(texto.trim().slice(0, 64));
    }, 250);
    return () => {
      clearTimeout(espera);
    };
  }, [texto]);
  const parametros = new URLSearchParams({ limite: '200', inativos: String(inativos) });
  if (busca) parametros.set('texto', busca);
  const lista = useRecurso(`${URL_PRODUTOS}?${parametros.toString()}`, ListaProdutosSchema, versao);

  function alterarCodigo(chave: number, mudanca: Partial<CodigoForm>) {
    setForm((f) => (f ? { ...f, barcodes: f.barcodes.map((b) => (b.chave === chave ? { ...b, ...mudanca } : b)) } : f));
  }

  async function gravar(evento: SubmitEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!form || enviando) return;
    setMensagem(null);
    const barcodes = form.barcodes.map((b) => ({ code: b.code, packaging: b.packaging, factor: b.fatorPendente ? null : b.factor.trim().replace(',', '.') }));
    const base = { description: form.description, canonicalUnit: form.canonicalUnit, active: form.active, barcodes };
    const corpo = form.id === null ? { ...base, sku: form.sku } : { ...base, expectedVersion: form.version };
    const validacao = form.id === null ? CriarProdutoSchema.safeParse(corpo) : AlterarProdutoSchema.safeParse(corpo);
    if (!validacao.success) {
      setMensagem({ tipo: 'erro', texto: validacao.error.issues[0]?.message ?? 'Confira os dados do produto.' });
      return;
    }
    const assinatura = `${form.id ?? 'novo'}:${JSON.stringify(corpo)}`;
    setEnviando(true);
    try {
      const salvo =
        form.id === null
          ? await enviarJson('POST', URL_PRODUTOS, ProdutoSchema, { corpo, idempotencia: chaves.para(assinatura) })
          : await enviarJson('PUT', `${URL_PRODUTOS}/${form.id}`, ProdutoSchema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      setMensagem({ tipo: 'ok', texto: `Produto ${salvo.sku} ${form.id === null ? 'cadastrado' : 'atualizado'}. Nenhum saldo físico foi criado.` });
      setForm(null);
      setVersao((v) => v + 1);
      aoGravar();
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      if (ehConflitoDeVersao(erro)) {
        setMensagem({ tipo: 'conflito', texto: mensagemDeFalha(erro) });
        setForm(null);
        setVersao((v) => v + 1);
      } else {
        setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Pagina
      titulo="Produtos"
      testId="tela-produtos"
      aoVoltar={aoVoltar}
      descricao={
        <p>
          SKU e códigos de barras são textos: zeros à esquerda são preservados. Embalagens só convertem com fator conhecido; fator pendente deixa o código reconhecido, mas
          bloqueia a conversão na conferência.
        </p>
      }
    >
      <MensagemAcao mensagem={mensagem} testId="mensagem-produto" />

      {podeEditar && form === null && (
        <button
          type="button"
          className="botao-primario"
          onClick={() => {
            setMensagem(null);
            setForm(VAZIO);
          }}
        >
          <IconeMais />
          Novo produto
        </button>
      )}

      {form !== null && (
        <form
          className="cartao formulario-cadastro"
          aria-labelledby={`${ids}-titulo`}
          noValidate
          onSubmit={(e) => {
            void gravar(e);
          }}
        >
          <h3 id={`${ids}-titulo`}>{form.id === null ? 'Novo produto' : `Editar ${form.sku}`}</h3>
          <div className="formulario-grade">
            <label className="campo">
              <span className="campo-rotulo">SKU</span>
              <input
                value={form.sku}
                readOnly={form.id !== null}
                maxLength={64}
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => {
                  setForm({ ...form, sku: e.target.value });
                }}
              />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Descrição</span>
              <input value={form.description} maxLength={200} onChange={(e) => { setForm({ ...form, description: e.target.value }); }} />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Unidade canônica</span>
              <input
                value={form.canonicalUnit}
                list={`${ids}-unidades`}
                maxLength={10}
                disabled={form.inUse}
                autoCapitalize="characters"
                onChange={(e) => {
                  setForm({ ...form, canonicalUnit: e.target.value.toUpperCase() });
                }}
              />
              {form.inUse && <span className="campo-ajuda">Já usada em linhas declaradas: não pode mudar.</span>}
            </label>
            <label className="opcao">
              <input type="checkbox" checked={form.active} onChange={(e) => { setForm({ ...form, active: e.target.checked }); }} />
              Ativo
            </label>
          </div>
          <datalist id={`${ids}-unidades`}>
            {UNIDADES_SUGERIDAS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          <fieldset className="codigos-barras">
            <legend>Códigos de barras e embalagens</legend>
            {form.barcodes.length === 0 && <p className="sem-itens">Nenhum código de barras cadastrado.</p>}
            {form.barcodes.map((b, indice) => (
              <div key={b.chave} className="linha-codigo">
                <label className="campo">
                  <span className="campo-rotulo">Código de barras {indice + 1}</span>
                  <input value={b.code} maxLength={64} spellCheck={false} inputMode="numeric" onChange={(e) => { alterarCodigo(b.chave, { code: e.target.value }); }} />
                </label>
                <label className="campo">
                  <span className="campo-rotulo">Embalagem</span>
                  <input
                    value={b.packaging}
                    list={`${ids}-unidades`}
                    maxLength={10}
                    autoCapitalize="characters"
                    onChange={(e) => {
                      alterarCodigo(b.chave, { packaging: e.target.value.toUpperCase() });
                    }}
                  />
                </label>
                <label className="campo">
                  <span className="campo-rotulo">Fator ({form.canonicalUnit || 'unidade'} por embalagem)</span>
                  <input value={b.fatorPendente ? '' : b.factor} inputMode="decimal" disabled={b.fatorPendente} onChange={(e) => { alterarCodigo(b.chave, { factor: e.target.value }); }} />
                </label>
                <label className="opcao">
                  <input type="checkbox" checked={b.fatorPendente} onChange={(e) => { alterarCodigo(b.chave, { fatorPendente: e.target.checked }); }} />
                  Fator desconhecido (pendente: sem conversão)
                </label>
                <button
                  type="button"
                  className="botao-link"
                  onClick={() => {
                    setForm({ ...form, barcodes: form.barcodes.filter((x) => x.chave !== b.chave) });
                  }}
                >
                  Remover código {indice + 1}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="botao-secundario"
              onClick={() => {
                setForm({ ...form, barcodes: [...form.barcodes, { chave: proximo, code: '', packaging: form.canonicalUnit, factor: '1', fatorPendente: false }] });
                setProximo((n) => n + 1);
              }}
            >
              Acrescentar código de barras
            </button>
          </fieldset>
          <div className="acoes-linha">
            <button type="submit" className="botao-primario" disabled={enviando || !conectado}>
              {enviando ? 'Gravando…' : 'Gravar produto'}
            </button>
            <button type="button" className="botao-link" onClick={() => { setForm(null); }}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <section className="cartao" aria-labelledby={`${ids}-lista`} aria-busy={lista.carga?.estado === 'carregando'}>
        <h3 id={`${ids}-lista`}>Produtos do escopo</h3>
        <div className="formulario-grade">
          <label className="campo">
            <span className="campo-rotulo">Buscar por SKU ou descrição</span>
            <input type="search" value={texto} spellCheck={false} onChange={(e) => { setTexto(e.target.value); }} />
          </label>
          <label className="opcao">
            <input type="checkbox" checked={inativos} onChange={(e) => { setInativos(e.target.checked); }} />
            Incluir inativos
          </label>
        </div>
        {lista.carga?.estado === 'erro' ? (
          <div className="estado-erro" role="alert">
            <p>{lista.carga.mensagem}</p>
            <button type="button" className="botao-secundario" onClick={lista.recarregar}>
              Tentar novamente
            </button>
          </div>
        ) : lista.carga?.estado === 'pronto' ? (
          lista.carga.dados.items.length === 0 ? (
            <p className="estado-vazio">{busca ? 'Nenhum produto corresponde à busca.' : 'Nenhum produto cadastrado neste escopo.'}</p>
          ) : (
            <ul className="lista-produtos" data-testid="lista-produtos">
              {lista.carga.dados.items.map((p) => (
                <li key={p.id} className="produto-linha" data-sku={p.sku}>
                  <div>
                    <strong className="produto-sku">{p.sku}</strong> {p.description}
                    <span className="produto-situacao">
                      {' '}
                      · {p.canonicalUnit} · {p.active ? 'ativo' : 'inativo'}
                    </span>
                    {p.barcodes.length > 0 && (
                      <ul className="produto-codigos">
                        {p.barcodes.map((b) => (
                          <li key={b.code}>
                            <code>{b.code}</code> {b.packaging} = {b.factor === null ? 'fator pendente (sem conversão)' : `${b.factor} ${p.canonicalUnit}`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {podeEditar && (
                    <button
                      type="button"
                      className="botao-secundario"
                      onClick={() => {
                        setMensagem(null);
                        setForm(formularioDe(p));
                      }}
                    >
                      Editar
                    </button>
                  )}
                </li>
              ))}
              {lista.carga.dados.truncated && <li className="filtro-nota">Mostrando os primeiros {lista.carga.dados.items.length}. Refine a busca.</li>}
            </ul>
          )
        ) : (
          <p className="estado-carregando">Carregando produtos…</p>
        )}
      </section>
    </Pagina>
  );
}
