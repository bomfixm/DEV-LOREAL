import {
  API_PREFIXO,
  LeituraNotaFotoSchema,
  NotasFotoPaleteSchema,
  ROTULOS_DECISAO_NOTA_FOTO,
  ResultadoNotasFotoSchema,
  totalIndicado,
  type AlteracoesNotaFoto,
  type DecisaoNotaFoto,
  type NotaFoto,
  type NotasFotoPalete,
  type TipoEtiqueta,
} from '@praca-reversa/contracts';
import { useEffect, useRef, useState } from 'react';
import { useChaves } from '../../api/chaves';
import { enviarArquivo, enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { paraEndereco } from '../../base';
import { EstadoTela } from '../../components/Moldura';
import { ErroFoto, lerFoto, prepararFoto } from './imagem';
import './notas-foto.css';

interface Envio {
  chave: string;
  nome: string;
  estado: 'enviando' | 'falhou';
  arquivo: File;
  mensagem: string | null;
}

const urlFoto = (id: string) => paraEndereco(`${API_PREFIXO}/notas-foto/fotos/${id}`);

/**
 * Notas por foto: captura rápida no celular e complementação em tabela, em
 * qualquer aparelho. Tudo fica salvo no servidor; nada entra em estoque antes de
 * "Incluir no palete". Volumes vazios continuam vazios (nunca zero).
 */
export function TelaNotasFoto({ paleteId, aoVoltar, aoGravar }: { paleteId: string; aoVoltar: () => void; aoGravar: () => void }) {
  const url = `${API_PREFIXO}/paletes/${paleteId}/notas-foto`;
  const { carga, recarregar } = useRecurso(url, NotasFotoPaleteSchema);
  const [lista, setLista] = useState<NotasFotoPalete | null>(null);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [edicoes, setEdicoes] = useState<Record<string, AlteracoesNotaFoto>>({});
  const [lendo, setLendo] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const [avisos, setAvisos] = useState<Record<string, string>>({});
  const [resumo, setResumo] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState<string | null>(null);
  const tentadas = useRef(new Set<string>());
  const rotacoes = useRef(new Map<string, number>());
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const chaves = useChaves();

  const dados = lista ?? (carga?.estado === 'pronto' ? carga.dados : null);
  const notas = dados?.items ?? [];

  async function enviar(arquivo: File, chave: string) {
    setEnvios((e) => [...e.filter((x) => x.chave !== chave), { chave, nome: arquivo.name, estado: 'enviando', arquivo, mensagem: null }]);
    try {
      const foto = await prepararFoto(arquivo);
      const r = await enviarArquivo(`${url}/fotos`, foto, arquivo.name.replace(/\.[^.]+$/, '') + '.jpg', NotasFotoPaleteSchema, chaves.para(chave));
      chaves.concluir(chave);
      setLista(r);
      setEnvios((e) => e.filter((x) => x.chave !== chave));
    } catch (e) {
      chaves.concluir(chave, e);
      const mensagem = e instanceof ErroFoto ? e.message : mensagemDeFalha(e);
      setEnvios((lista2) => lista2.map((x) => (x.chave === chave ? { ...x, estado: 'falhou', mensagem } : x)));
    }
  }

  function escolher(arquivos: FileList | null) {
    for (const arquivo of arquivos ?? []) void enviar(arquivo, `${arquivo.name}:${String(arquivo.size)}:${String(arquivo.lastModified)}`);
  }

  async function ler(nota: NotaFoto) {
    const foto = nota.photos[0];
    if (!foto) return;
    setLendo(nota.id);
    let corpo;
    try {
      const r = await lerFoto(foto.id, API_PREFIXO, rotacoes.current.get(nota.id) ?? 0);
      corpo = LeituraNotaFotoSchema.parse({ rawText: r.rawText, number: r.number, numberRaw: r.numberRaw, candidates: r.candidates, sender: r.sender, reference: r.reference, labelKind: r.labelKind });
    } catch {
      corpo = LeituraNotaFotoSchema.parse({ failed: true });
    }
    try {
      setLista(await enviarJson('POST', `${API_PREFIXO}/notas-foto/${nota.id}/leitura`, NotasFotoPaleteSchema, { corpo, idempotencia: crypto.randomUUID() }));
    } catch (e) {
      setAvisos((a) => ({ ...a, [nota.id]: `Leitura não gravada: ${mensagemDeFalha(e)}` }));
    } finally {
      setLendo(null);
    }
  }

  // Uma foto por vez, sem travar a tela; também retoma as pendentes de outro aparelho.
  useEffect(() => {
    if (lendo !== null) return;
    const proxima = notas.find((n) => n.read.state === 'PENDENTE' && !tentadas.current.has(n.id));
    if (!proxima) return;
    tentadas.current.add(proxima.id);
    void ler(proxima);
  }, [lendo, dados]);

  const valor = <K extends keyof AlteracoesNotaFoto>(n: NotaFoto, campo: K): NotaFoto[K & keyof NotaFoto] | AlteracoesNotaFoto[K] => {
    const editado = edicoes[n.id];
    return editado !== undefined && campo in editado ? editado[campo] : (n[campo as keyof NotaFoto] as NotaFoto[K & keyof NotaFoto]);
  };
  const alterar = (id: string, mudanca: AlteracoesNotaFoto) => {
    setEdicoes((e) => ({ ...e, [id]: { ...e[id], ...mudanca } }));
    setResumo(null);
  };

  /** Grava as edições pendentes; o que falhar continua na tela, com o motivo. */
  async function salvar(): Promise<boolean> {
    const ids = Object.keys(edicoes);
    if (ids.length === 0) return true;
    const items = ids.flatMap((id) => {
      const n = notas.find((x) => x.id === id);
      const changes = edicoes[id];
      return n && changes ? [{ id, expectedVersion: n.version, changes }] : [];
    });
    const r = await enviarJson('PUT', url, ResultadoNotasFotoSchema, { corpo: { items }, idempotencia: crypto.randomUUID() });
    setLista(r.list);
    const falhas = r.results.filter((x) => !x.ok);
    setEdicoes((e) => Object.fromEntries(Object.entries(e).filter(([id]) => falhas.some((f) => f.id === id))));
    setAvisos(Object.fromEntries(falhas.map((f) => [f.id, f.message ?? 'Não foi salvo.'])));
    setResumo(falhas.length === 0 ? `${String(r.results.length)} nota(s) salva(s).` : `${String(r.results.length - falhas.length)} salva(s); ${String(falhas.length)} não salva(s): veja na tabela.`);
    return falhas.length === 0;
  }

  async function acao(executar: () => Promise<void>) {
    setGravando(true);
    try {
      await executar();
    } catch (e) {
      setResumo(`Nada foi confirmado: ${mensagemDeFalha(e)}`);
    } finally {
      setGravando(false);
    }
  }

  const incluir = () =>
    acao(async () => {
      if (!(await salvar())) return;
      const atual = lista ?? dados;
      const ids = notas.filter((n) => n.missing.length === 0 || edicoes[n.id] !== undefined).map((n) => n.id);
      if (atual === null || ids.length === 0) {
        setResumo('Nenhuma nota completa para incluir.');
        return;
      }
      const r = await enviarJson('POST', `${url}/incluir`, ResultadoNotasFotoSchema, { corpo: { ids }, idempotencia: crypto.randomUUID() });
      setLista(r.list);
      const falhas = r.results.filter((x) => !x.ok);
      setAvisos(Object.fromEntries(falhas.map((f) => [f.id, f.message ?? 'Não incluída.'])));
      setResumo(`${String(r.results.length - falhas.length)} nota(s) incluída(s) no palete${falhas.length > 0 ? `; ${String(falhas.length)} ainda com pendência` : ''}.`);
      aoGravar();
    });

  if (carga?.estado !== 'pronto' || dados === null) return <EstadoTela carga={carga} titulo="Não foi possível abrir as notas por foto" aoTentarNovamente={recarregar} />;

  const situacao = (n: NotaFoto): string => {
    if (lendo === n.id) return 'Lendo…';
    if (n.read.state === 'PENDENTE') return 'Na fila de leitura';
    if (n.missing.length > 0) return `${n.read.state === 'FALHOU' ? 'Não foi possível ler. ' : ''}Falta: ${n.missing.join(', ')}`;
    return valor(n, 'volumes') === null ? 'Pronta (volumes não informados)' : 'Pronta para incluir';
  };

  return (
    <main className="principal principal--pagina tela-notas-foto" data-testid="tela-notas-foto">
      <div className="pagina-conteudo">
        <header className="notas-foto-topo">
          <h2>Palete {dados.pallet.code}</h2>
          <p>{dados.pallet.address ?? 'Sem endereço'}</p>
        </header>

        <div className="notas-foto-acoes">
          <input ref={camera} type="file" accept="image/*" capture="environment" hidden data-testid="notas-foto-camera" onChange={(e) => { escolher(e.target.files); e.target.value = ''; }} />
          <input ref={galeria} type="file" accept="image/*" multiple hidden data-testid="notas-foto-galeria" onChange={(e) => { escolher(e.target.files); e.target.value = ''; }} />
          <button type="button" className="botao-primario" onClick={() => camera.current?.click()}>Tirar foto</button>
          <button type="button" className="botao-secundario" onClick={() => galeria.current?.click()}>Escolher da galeria</button>
          <button type="button" className="botao-secundario" disabled={envios.some((x) => x.estado === 'enviando')} onClick={aoVoltar} data-testid="notas-foto-depois">Salvar e completar depois</button>
        </div>

        {envios.length > 0 && (
          <ul className="notas-foto-envios" data-testid="notas-foto-envios">
            {envios.map((x) => (
              <li key={x.chave}>
                {x.estado === 'enviando' ? `Enviando ${x.nome}…` : <><strong>Não salva:</strong> {x.nome}. {x.mensagem}{' '}
                  <button type="button" className="botao-link" onClick={() => void enviar(x.arquivo, x.chave)}>Tentar de novo</button></>}
              </li>
            ))}
          </ul>
        )}

        {notas.length === 0 && envios.length === 0 && <p className="campo-ajuda">Fotografe as etiquetas. Cada foto salva vira uma linha para completar aqui ou no computador.</p>}

        {notas.length > 0 && (
          <div className="janela-tabela-rolagem">
            <table className="janela-tabela janela-tabela--fichas notas-foto-tabela" data-testid="notas-foto-tabela">
              <thead>
                <tr>
                  <th scope="col">Foto</th>
                  <th scope="col">Número</th>
                  <th scope="col">Remetente</th>
                  <th scope="col">Etiqueta</th>
                  <th scope="col">Delivery</th>
                  <th scope="col">Volumes no palete</th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {notas.map((n) => {
                  const tipo = valor(n, 'labelKind') as TipoEtiqueta | null;
                  const indicado = totalIndicado(tipo, n.labelReference);
                  const volumes = valor(n, 'volumes') as number | null;
                  return (
                    <tr key={n.id} data-testid="notas-foto-linha" data-numero={n.documentNumber ?? ''}>
                      <td data-rotulo="Foto">
                        {n.photos.map((f) => (
                          <button key={f.id} type="button" className="notas-foto-miniatura" onClick={() => { setAmpliada(f.id); }} aria-label="Ampliar a foto">
                            <img src={urlFoto(f.id)} alt="" loading="lazy" />
                          </button>
                        ))}
                      </td>
                      <td data-rotulo="Número">
                        <input aria-label="Número da nota" value={(valor(n, 'documentNumber') as string | null) ?? ''} onChange={(e) => { alterar(n.id, { documentNumber: e.target.value }); }} data-testid="notas-foto-numero" />
                        {n.read.candidates.length > 0 && <small>Possíveis: {n.read.candidates.join(', ')}</small>}
                      </td>
                      <td data-rotulo="Remetente">
                        <input aria-label="Remetente" value={(valor(n, 'sender') as string | null) ?? ''} onChange={(e) => { alterar(n.id, { sender: e.target.value }); }} data-testid="notas-foto-remetente" />
                      </td>
                      <td data-rotulo="Etiqueta">
                        <select aria-label="Tipo de etiqueta" value={tipo ?? ''} onChange={(e) => { alterar(n.id, { labelKind: e.target.value === '' ? null : (e.target.value as TipoEtiqueta) }); }} data-testid="notas-foto-etiqueta">
                          <option value="">Escolher…</option>
                          <option value="COMUM">Etiqueta comum</option>
                          <option value="FULL">Etiqueta FULL</option>
                        </select>
                        {tipo === 'FULL' && n.labelReference !== null && <small>Referência {n.labelReference} (não é quantidade)</small>}
                      </td>
                      <td data-rotulo="Delivery">
                        <input aria-label="Delivery" value={(valor(n, 'delivery') as string | null) ?? ''} onChange={(e) => { alterar(n.id, { delivery: e.target.value }); }} />
                      </td>
                      <td data-rotulo="Volumes no palete">
                        <input
                          aria-label="Volumes no palete"
                          inputMode="numeric"
                          value={volumes === null ? '' : String(volumes)}
                          onChange={(e) => {
                            const t = e.target.value.replace(/\D/g, '').slice(0, 6);
                            alterar(n.id, { volumes: t === '' ? null : Number(t) });
                          }}
                          data-testid="notas-foto-volumes"
                        />
                        {indicado !== null && (
                          <small>
                            Total indicado na etiqueta: {indicado}{' '}
                            <button type="button" className="botao-link" onClick={() => { alterar(n.id, { volumes: indicado }); }}>Aplicar</button>
                          </small>
                        )}
                      </td>
                      <td data-rotulo="Situação" data-testid="notas-foto-situacao">
                        {situacao(n)}
                        {avisos[n.id] !== undefined && <small className="mensagem-conflito" role="alert">{avisos[n.id]}</small>}
                        {n.existing.length > 0 && (
                          <label className="notas-foto-decisao">
                            <small>Já no palete: {n.existing[0]?.label}</small>
                            <select value={(valor(n, 'decision') as DecisaoNotaFoto | null) ?? ''} onChange={(e) => { alterar(n.id, { decision: e.target.value === '' ? null : (e.target.value as DecisaoNotaFoto) }); }} data-testid="notas-foto-decisao">
                              <option value="">Decidir…</option>
                              <option value="VINCULAR_FOTO">{ROTULOS_DECISAO_NOTA_FOTO.VINCULAR_FOTO}</option>
                              <option value="OUTRA_OCORRENCIA">{ROTULOS_DECISAO_NOTA_FOTO.OUTRA_OCORRENCIA}</option>
                            </select>
                          </label>
                        )}
                        <span className="notas-foto-linha-acoes">
                          <button type="button" className="botao-link" disabled={lendo !== null} onClick={() => { rotacoes.current.set(n.id, ((rotacoes.current.get(n.id) ?? 0) + 90) % 360); void ler(n); }}>Girar e ler</button>
                          <button
                            type="button"
                            className="botao-link"
                            onClick={() => {
                              void acao(async () => {
                                setLista(await enviarJson('POST', `${API_PREFIXO}/notas-foto/${n.id}/descartar`, NotasFotoPaleteSchema, { corpo: {}, idempotencia: crypto.randomUUID() }));
                                setEdicoes((e) => Object.fromEntries(Object.entries(e).filter(([id]) => id !== n.id)));
                              });
                            }}
                          >
                            Descartar
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {resumo !== null && <p role="status" data-testid="notas-foto-resumo">{resumo}</p>}
        {dados.done > 0 && <p className="campo-ajuda">{dados.done} nota(s) deste palete já incluída(s) ou vinculada(s).</p>}

        {notas.length > 0 && (
          <div className="notas-foto-acoes notas-foto-rodape">
            <button type="button" className="botao-secundario" disabled={gravando || Object.keys(edicoes).length === 0} onClick={() => void acao(async () => { await salvar(); })} data-testid="notas-foto-salvar">Salvar alterações</button>
            <button type="button" className="botao-primario" disabled={gravando} onClick={() => void incluir()} data-testid="notas-foto-incluir">Incluir no palete</button>
          </div>
        )}
      </div>

      {ampliada !== null && (
        <button type="button" className="notas-foto-ampliada" aria-label="Fechar a foto" onClick={() => { setAmpliada(null); }}>
          <img src={urlFoto(ampliada)} alt="Foto da etiqueta" />
        </button>
      )}
    </main>
  );
}
