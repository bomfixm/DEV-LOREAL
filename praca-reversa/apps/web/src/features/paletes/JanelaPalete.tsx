import {
  API_PREFIXO,
  ConteudosPaleteSchema,
  DefinirObservacaoPaleteSchema,
  DefinirSequenciaFullSchema,
  DefinirTipoCargaSchema,
  PaleteDetalheSchema,
  RenumerarPaleteSchema,
  ResultadoMarcaSeparadoSchema,
  SelecaoExpedicaoSchema,
  compararQuantidades,
  subtrairQuantidades,
  type ConteudoPalete,
  type PaleteDetalhe,
  type PaleteResumo,
  type Permissao,
} from '@praca-reversa/contracts';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Carga } from '../../api/use-recurso';
import { useRecurso } from '../../api/use-recurso';
import { enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useChaves } from '../../api/chaves';
import { IconeAlvo, IconeArquivo, IconeCaminhao, IconeFechar, IconeImprimir } from '../../components/Icones';
import { formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';
import { AdicionarExpedicao, AdicionarNotas, type NotaParaExpedicao } from '../carga/AdicionarExpedicao';
import { AcoesConteudo, type OcorrenciaSelecionada } from '../conteudos/AcoesConteudo';
import { textoResultadoAcao } from '../conteudos/textos-resultado';
import { agruparDocumentos, contarDocumentos } from './documentos';
import { estadoExibido } from './estados';
import { NAO_INFORMADO, avisoReconferencia, baseDosVolumes, dataSimples, somaContada, textoConferenciaInformada, textoFull, textoVolumes } from './janela';
import { textoSequenciaFull } from './volumes';
import { Carregando } from '../../components/carregamento/Carregando';

/** Troca manual do número do palete (ex.: "28" → "30"): campo curto no cabeçalho da janela. */
/** Marca manual "separado para a agenda" no palete roxo (e desfaz). Não reserva nem altera estoque. */
function SeparadoAgenda({ palete, aoAlterado }: { palete: PaleteResumo; aoAlterado: (texto: string) => void }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const chaves = useChaves();
  const feito = palete.clientSeparationDone === true;
  async function alternar() {
    const assinatura = `palete-separado:${palete.id}:${String(!feito)}`;
    setEnviando(true);
    setErro(null);
    try {
      await enviarJson('POST', `${API_PREFIXO}/paletes/${palete.id}/separado-agenda`, ResultadoMarcaSeparadoSchema, { corpo: { separated: !feito }, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      aoAlterado(feito ? `Palete ${palete.code}: marca de separado desfeita.` : `Palete ${palete.code} marcado como separado para a agenda.`);
    } catch (e) {
      chaves.concluir(assinatura, e);
      setErro(mensagemDeFalha(e));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <>
      <button type="button" className={feito ? 'botao-secundario' : 'botao-primario'} disabled={enviando} onClick={() => void alternar()} data-testid="acao-separado-agenda">
        {enviando ? 'Gravando…' : feito ? '✓ Separado para agenda · Desfazer' : 'Separado para agenda'}
      </button>
      {erro !== null && (
        <span className="mensagem-conflito" role="alert">
          {erro}
        </span>
      )}
    </>
  );
}

function AlterarNumero({ palete, aoTrocado }: { palete: PaleteResumo; aoTrocado: (texto: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const chaves = useChaves();
  if (!aberto) {
    return (
      <button type="button" className="botao-link" data-testid="janela-alterar-numero" onClick={() => { setValor(palete.code); setAberto(true); }}>
        Alterar número
      </button>
    );
  }
  async function salvar() {
    const lido = RenumerarPaleteSchema.safeParse({ number: valor });
    if (!lido.success) {
      setErro(lido.error.issues[0]?.message ?? 'Número inválido.');
      return;
    }
    const assinatura = `palete-numero:${palete.id}:${lido.data.number}`;
    setEnviando(true);
    setErro(null);
    try {
      await enviarJson('PUT', `${API_PREFIXO}/paletes/${palete.id}/numero`, PaleteDetalheSchema, { corpo: lido.data, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      setAberto(false);
      aoTrocado(`Número do palete trocado para ${lido.data.number}.`);
    } catch (e) {
      chaves.concluir(assinatura, e);
      setErro(mensagemDeFalha(e));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <span className="janela-alterar-numero" data-testid="janela-numero-formulario">
      <input
        type="text"
        value={valor}
        maxLength={40}
        autoFocus
        disabled={enviando}
        aria-label="Novo número do palete"
        data-testid="janela-numero-campo"
        onChange={(e) => { setValor(e.target.value); setErro(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void salvar(); } }}
      />{' '}
      <button type="button" className="botao-secundario" disabled={enviando} onClick={() => void salvar()} data-testid="janela-numero-salvar">Salvar</button>{' '}
      <button type="button" className="botao-link" disabled={enviando} onClick={() => { setAberto(false); setErro(null); }}>Cancelar</button>
      {erro !== null && <span className="mensagem-conflito" role="alert"> {erro}</span>}
    </span>
  );
}

/** Full ou fracionado à mão; "Automático" volta à regra (1 nota = full, 2 ou mais = fracionado). */
function EscolherTipoCarga({ paleteId, atual, aoTrocado }: { paleteId: string; atual: 'FULL' | 'FRACIONADO' | null; aoTrocado: (texto: string) => void }) {
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const chaves = useChaves();
  async function trocar(valor: string) {
    const lido = DefinirTipoCargaSchema.parse({ kind: valor === '' ? null : valor });
    const assinatura = `palete-tipo:${paleteId}:${valor}`;
    setEnviando(true);
    setErro(null);
    try {
      await enviarJson('PUT', `${API_PREFIXO}/paletes/${paleteId}/tipo-carga`, PaleteDetalheSchema, { corpo: lido, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      aoTrocado(lido.kind === null ? 'Tipo do palete voltou ao automático.' : `Palete marcado como ${lido.kind === 'FULL' ? 'full' : 'fracionado'}.`);
    } catch (e) {
      chaves.concluir(assinatura, e);
      setErro(mensagemDeFalha(e));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <span className="janela-tipo-carga">
      <select value={atual ?? ''} disabled={enviando} aria-label="Tipo do palete" data-testid="janela-tipo-carga-escolha" onChange={(e) => void trocar(e.target.value)}>
        <option value="">Automático</option>
        <option value="FULL">Full</option>
        <option value="FRACIONADO">Fracionado</option>
      </select>
      {erro !== null && <span className="mensagem-conflito" role="alert"> {erro}</span>}
    </span>
  );
}

/** Posição do palete full na carga ("2/7", "11/11"); vazio apaga. */
function InformarSequenciaFull({ paleteId, atual, aoTrocado }: { paleteId: string; atual: string | null; aoTrocado: (texto: string) => void }) {
  const [valor, setValor] = useState(atual ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const chaves = useChaves();
  useEffect(() => { setValor(atual ?? ''); }, [atual]);
  async function salvar() {
    const analisado = DefinirSequenciaFullSchema.safeParse({ sequence: valor.trim() === '' ? null : valor });
    if (!analisado.success) { setErro(analisado.error.issues[0]?.message ?? 'Use o formato 2/7.'); return; }
    const lido = analisado.data;
    const assinatura = `palete-seq:${paleteId}:${lido.sequence ?? ''}`;
    setEnviando(true);
    setErro(null);
    try {
      await enviarJson('PUT', `${API_PREFIXO}/paletes/${paleteId}/sequencia-full`, PaleteDetalheSchema, { corpo: lido, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      aoTrocado(lido.sequence === null ? 'Posição do full apagada.' : `Full ${lido.sequence} registrado.`);
    } catch (e) {
      chaves.concluir(assinatura, e);
      setErro(mensagemDeFalha(e));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <span className="janela-sequencia-full">
      <input
        type="text"
        inputMode="text"
        size={6}
        maxLength={7}
        placeholder="ex.: 2/7"
        value={valor}
        disabled={enviando}
        aria-label="Posição do full na carga (ex.: 2/7)"
        data-testid="janela-full-sequencia"
        onChange={(e) => { setValor(e.target.value); setErro(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void salvar(); } }}
      />{' '}
      <button type="button" className="botao-secundario" disabled={enviando || valor.trim() === (atual ?? '')} onClick={() => void salvar()} data-testid="janela-full-sequencia-salvar">Salvar</button>
      {erro !== null && <span className="mensagem-conflito" role="alert"> {erro}</span>}
    </span>
  );
}

/** Observação do palete (vale para qualquer palete, inclusive os vindos do inventário). */
function ObservacaoPalete({ paleteId, atual, podeEditar, aoTrocado }: { paleteId: string; atual: string | null; podeEditar: boolean; aoTrocado: (texto: string) => void }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(atual ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const chaves = useChaves();
  useEffect(() => { if (!editando) setValor(atual ?? ''); }, [atual, editando]);
  async function salvar() {
    const analisado = DefinirObservacaoPaleteSchema.safeParse({ notes: valor });
    if (!analisado.success) { setErro(analisado.error.issues[0]?.message ?? 'Observação inválida.'); return; }
    const lido = analisado.data;
    const assinatura = `palete-obs:${paleteId}:${lido.notes ?? ''}`;
    setEnviando(true);
    setErro(null);
    try {
      await enviarJson('PUT', `${API_PREFIXO}/paletes/${paleteId}/observacao`, PaleteDetalheSchema, { corpo: lido, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      setEditando(false);
      aoTrocado(lido.notes === null ? 'Observação do palete apagada.' : 'Observação do palete gravada.');
    } catch (e) {
      chaves.concluir(assinatura, e);
      setErro(mensagemDeFalha(e));
    } finally {
      setEnviando(false);
    }
  }
  if (!editando) {
    return (
      <>
        <p className={`janela-observacao-texto${atual === null ? ' janela-observacao-texto--vazia' : ''}`} data-testid="janela-observacao">{atual ?? 'Sem observação.'}</p>
        {podeEditar && (
          <>
            {' '}
            <button type="button" className="botao-secundario" data-testid="janela-observacao-editar" onClick={() => { setValor(atual ?? ''); setErro(null); setEditando(true); }}>
              {atual === null ? 'Adicionar' : 'Editar'}
            </button>
          </>
        )}
      </>
    );
  }
  return (
    <span className="janela-observacao-edicao">
      <textarea rows={3} maxLength={500} value={valor} disabled={enviando} aria-label="Observação do palete (até 500 caracteres)" data-testid="janela-observacao-texto" style={{ width: '100%' }} onChange={(e) => { setValor(e.target.value); setErro(null); }} />
      <br />
      <button type="button" className="botao-secundario" disabled={enviando} onClick={() => void salvar()} data-testid="janela-observacao-salvar">Salvar</button>{' '}
      <button type="button" className="botao-link" disabled={enviando} onClick={() => { setEditando(false); setErro(null); }}>Cancelar</button>
      {erro !== null && <span className="mensagem-conflito" role="alert"> {erro}</span>}
    </span>
  );
}

/** Linhas por página na tabela de conteúdo (o restante fica nas páginas seguintes, nunca escondido). */
const LINHAS_POR_PAGINA = 50;

/** Elementos que recebem foco pelo teclado dentro da janela. */
const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Janela sobre a página (etapa 3, out. 2026): `role="dialog"` com
 * `aria-modal`, fundo escurecido e foco contido (Tab e Shift+Tab circulam
 * dentro dela). Esc, o botão "Fechar" e o clique no fundo fecham; o foco
 * começa no título e volta a quem abriu. O balão do tutorial continua por
 * cima. Abrir ou fechar não mexe no mapa (mesma posição, zoom e pesquisa)
 * nem em estoque, conferência ou endereço.
 */
export function JanelaModal({
  titulo,
  subtitulo,
  aoFechar,
  rodape,
  children,
  testId,
  tutorial,
  rotulo,
  paleteId,
  classe,
}: {
  /** `null` = o conteúdo traz o próprio título (detalhe de posição ou de palete fora do mapa carregado). */
  titulo: ReactNode | null;
  /** Nome acessível quando não há título no cabeçalho. */
  rotulo?: string;
  subtitulo?: ReactNode;
  aoFechar: () => void;
  rodape?: ReactNode;
  children: ReactNode;
  testId: string;
  /** Marcador do tutorial no cabeçalho (identificação do palete). */
  tutorial?: string;
  /** ID permanente do palete exibido (inspeção e testes). */
  paleteId?: string;
  /** Classe extra do fundo (ex.: janela larga da conferência). */
  classe?: string;
}) {
  const ids = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const el = caixa.current;
    if (el === null) return;
    // Quem abriu recebe o foco de volta ao fechar (se ainda estiver na tela).
    const origem = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (tituloRef.current ?? el.querySelector<HTMLElement>('h2[tabindex]') ?? el).focus();
    return () => {
      if (origem?.isConnected) origem.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className={classe === undefined ? 'janela-fundo' : `janela-fundo ${classe}`}
      onMouseDown={(evento) => {
        // Clique no fundo escurecido (fora da caixa) fecha.
        if (evento.target === evento.currentTarget) aoFechar();
      }}
    >
      <div
        ref={caixa}
        className="janela"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titulo === null ? undefined : `${ids}-titulo`}
        aria-label={titulo === null ? rotulo : undefined}
        tabIndex={-1}
        data-testid={testId}
        data-palete-id={paleteId}
        onKeyDown={(evento) => {
          if (evento.key === 'Escape') {
            evento.stopPropagation();
            aoFechar();
            return;
          }
          if (evento.key !== 'Tab' || caixa.current === null) return;
          const focaveis = [...caixa.current.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((x) => x.offsetParent !== null || x === document.activeElement);
          const primeiro = focaveis[0];
          const ultimo = focaveis[focaveis.length - 1];
          if (primeiro === undefined || ultimo === undefined) return;
          if (evento.shiftKey && (document.activeElement === primeiro || !caixa.current.contains(document.activeElement) || document.activeElement === caixa.current || document.activeElement === tituloRef.current)) {
            evento.preventDefault();
            ultimo.focus();
          } else if (!evento.shiftKey && document.activeElement === ultimo) {
            evento.preventDefault();
            primeiro.focus();
          }
        }}
      >
        <header className={titulo === null ? 'janela-topo janela-topo--so-fechar' : 'janela-topo'} data-tutorial={tutorial}>
          {titulo !== null && (
            <div className="janela-titulos">
              <h2 id={`${ids}-titulo`} ref={tituloRef} tabIndex={-1} data-testid="janela-titulo">
                {titulo}
              </h2>
              {subtitulo !== undefined && <p className="janela-subtitulo">{subtitulo}</p>}
            </div>
          )}
          <button type="button" className="botao-secundario botao-icone janela-fechar" onClick={aoFechar} aria-label="Fechar" title="Fechar (Esc)" data-testid="janela-fechar">
            <IconeFechar />
          </button>
        </header>
        <div className="janela-corpo">{children}</div>
        {rodape !== undefined && rodape !== null && <footer className="janela-rodape">{rodape}</footer>}
      </div>
    </div>
  );
}

interface PropsPalete {
  palete: PaleteResumo;
  /** Endereço real (15 - A120, GR9) ou o informado no inventário; `null` = não informado. */
  endereco: string | null;
  permissoes: readonly Permissao[];
  /** Aumenta depois de gravações: o conteúdo é consultado de novo. */
  versao: number;
  /** Detalhe do palete (saldo/agenda e detalhes completos). */
  carga: Carga<PaleteDetalhe> | null;
  aoFechar: () => void;
  aoCentralizar: () => void;
  aoConferirVolumes: (() => void) | null;
  aoImportarBipagem: (() => void) | null;
  aoNotasFoto: (() => void) | null;
  aoRegistrarConteudo: (() => void) | null;
  aoImprimir: (() => void) | null;
  /** Liberar a posição (palete não está no local); `null` sem permissão, sem posição ou arquivado. */
  aoLiberarPosicao: (() => void) | null;
  /** Detalhes completos (situação, conferência, liberação, movimentações, cadastro): o detalhe existente, sem o cabeçalho. */
  detalhesCompletos: ReactNode;
  /** Depois de uma correção gravada (mover, validação, cancelar): mapa e totais consultam de novo; o texto vira aviso. */
  aoAlterado: (texto: string) => void;
  /** Abre a fila "Validação urgente — sem endereço" (perfis internos). */
  aoAbrirValidacao: (() => void) | null;
}

const textoDocumento = (c: ConteudoPalete) => (c.documentNumber === null ? `Sem documento (${c.sender ?? 'remetente não informado'})` : `${c.documentTypeOriginal ?? c.documentType ?? ''} ${c.documentNumber}`.trim());
const volumesDe = (c: ConteudoPalete): number | null => (c.count.counted === null || !Number.isInteger(Number(c.count.counted)) ? null : Number(c.count.counted));
/** Ocorrência real da linha (ID estável do vínculo do inventário ou do conteúdo registrado), nunca o número da NF. */
const ocorrenciaDe = (c: ConteudoPalete) => ({ kind: c.kind === 'IMPORTADO' ? ('VINCULO' as const) : ('CONTEUDO' as const), id: c.id });
const notaDe = (rotulo: string, parcelas: readonly ConteudoPalete[]): NotaParaExpedicao => {
  const volumes = parcelas.map(volumesDe);
  return { ocorrencias: parcelas.map(ocorrenciaDe), rotulo, volumes: volumes.some((v) => v === null) ? null : volumes.reduce<number>((t, v) => t + (v ?? 0), 0) };
};
/** "Carreta 01 · Palete 03" (sem a janela). */
const identidadeCurta = (identidade: string) => identidade.split(' · ').slice(1).join(' · ') || identidade;

/** Ação por linha da tabela: onde cada ocorrência já está na expedição e como incluir uma nota. */
interface ExpedicaoLinha {
  marcas: ReadonlyMap<string, string>;
  aoAdicionar: (nota: NotaParaExpedicao, origem: HTMLElement) => void;
}

/** Conferência da linha em poucas letras (com o detalhe no título). */
function CelulaConferencia({ parcelas }: { parcelas: readonly ConteudoPalete[] }) {
  const estados = parcelas.map((p) => p.check?.state ?? 'NAO_CONFERIDO');
  const estado = estados.includes('CONFERIDO_COM_DIFERENCA') ? 'CONFERIDO_COM_DIFERENCA' : estados.every((e) => e !== 'NAO_CONFERIDO') ? 'CONFERIDO' : estados.some((e) => e !== 'NAO_CONFERIDO') ? 'PARCIAL' : 'NAO_CONFERIDO';
  const dif = parcelas.reduce<number | null>((t, p) => (p.check?.difference == null ? t : (t ?? 0) + p.check.difference), null);
  const texto = estado === 'CONFERIDO' ? '✓ Conferida' : estado === 'CONFERIDO_COM_DIFERENCA' ? `≠ Diferença${dif === null ? '' : ` ${dif > 0 ? '+' : ''}${String(dif)}`}` : estado === 'PARCIAL' ? '½ Parcial' : '? Não conferida';
  const ultima = parcelas.find((p) => p.check?.at)?.check;
  return (
    <td data-rotulo="Conferência" className={`janela-conferencia janela-conferencia--${estado}`} data-testid="janela-linha-conferencia-volumes" title={ultima?.at ? `${formatarDataHora(ultima.at)}${ultima.by ? ` · ${ultima.by.name}` : ''}` : undefined}>
      {texto}
    </td>
  );
}

/** Seleção por ocorrência (uma linha por conteúdo, nunca agrupada pela NF) para mover, validar ou cancelar. */
function TabelaSelecao({ itens, selecionados, aoMudar }: { itens: readonly ConteudoPalete[]; selecionados: ReadonlySet<string>; aoMudar: (ids: readonly string[], marcado: boolean) => void }) {
  // O <section> em volta é necessário: um contêiner com rolagem direto na grade da janela (altura limitada)
  // encolhe a zero e a tabela some (as ações de mover/validar/cancelar nunca apareciam).
  return (
    <section className="janela-secao" aria-label="Selecionar conteúdos">
      <div className="janela-tabela-rolagem" role="region" aria-label="Selecionar conteúdos" tabIndex={0}>
        <table className="janela-tabela janela-tabela--fichas" data-testid="janela-tabela-selecao">
          <thead>
            <tr>
              <th scope="col">
                <input
                  type="checkbox"
                  aria-label={`Selecionar todos os ${String(itens.length)} conteúdos`}
                  checked={itens.length > 0 && itens.every((i) => selecionados.has(i.id))}
                  onChange={(e) => {
                    aoMudar(
                      itens.map((i) => i.id),
                      e.target.checked,
                    );
                  }}
                  data-testid="selecionar-todos"
                />
              </th>
              <th scope="col">Documento</th>
              <th scope="col">Remetente</th>
              <th scope="col">Origem</th>
              <th scope="col" className="numero">
                Volumes
              </th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.id} data-testid="janela-linha-selecao" data-numero={i.documentNumber ?? ''}>
                <td data-rotulo="Selecionar">
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${textoDocumento(i)}`}
                    checked={selecionados.has(i.id)}
                    onChange={(e) => {
                      aoMudar([i.id], e.target.checked);
                    }}
                    data-testid="selecionar-conteudo"
                  />
                </td>
                <td data-rotulo="Documento">{textoDocumento(i)}</td>
                <td data-rotulo="Remetente" className="janela-remetente">
                  {i.sender ?? NAO_INFORMADO}
                </td>
                <td data-rotulo="Origem">
                  {i.source ?? 'Registrado no aplicativo'}
                  {i.latestInventory === 'NAO_CONSTA' && <span className="janela-alerta"> · não consta do inventário atual</span>}
                </td>
                <td data-rotulo="Volumes" className="numero">
                  {i.count.counted === null ? NAO_INFORMADO : formatarQuantidade(i.count.counted)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Tabela de conteúdo: uma linha por documento (várias Deliveries da mesma nota somam no documento), paginada. */
function TabelaConteudo({ itens, expedicao }: { itens: readonly ConteudoPalete[]; expedicao: ExpedicaoLinha | null }) {
  const [pagina, setPagina] = useState(1);
  // Ordem estável para achar o documento: tipo e número (comparação numérica); sem número por último.
  // Notas que não constam da versão atual do inventário vão para o fim (a validar no piso).
  const foraDaVersao = (g: { parcelas: readonly ConteudoPalete[] }) => g.parcelas.every((x) => x.latestInventory === 'NAO_CONSTA');
  const naSeparacao = (g: { parcelas: readonly ConteudoPalete[] }) => g.parcelas.some((x) => x.clientSeparation === true);
  const grupos = agruparDocumentos(itens).sort(
    (a, b) =>
      // Nota pedida na separação do cliente vem primeiro.
      Number(naSeparacao(b)) - Number(naSeparacao(a)) ||
      Number(foraDaVersao(a)) - Number(foraDaVersao(b)) ||
      Number(a.numero === null) - Number(b.numero === null) ||
      (a.tipo ?? '').localeCompare(b.tipo ?? '', 'pt-BR') ||
      (a.numero ?? '').localeCompare(b.numero ?? '', 'pt-BR', { numeric: true }),
  );
  const comCnpj = itens.some((i) => i.senderCnpj !== null);
  // Inventário em validação: Delivery, FULL/FRACIONADO e conferência informada ao lado do documento (só quando existirem).
  const comDelivery = itens.some((i) => i.kind === 'IMPORTADO' && i.delivery !== null);
  const comInventario = itens.some((i) => i.fullKind !== null || i.inventoryCheck !== null || i.latestInventory === 'NAO_CONSTA');
  const paginas = Math.max(1, Math.ceil(grupos.length / LINHAS_POR_PAGINA));
  const atual = Math.min(pagina, paginas);
  const inicio = (atual - 1) * LINHAS_POR_PAGINA;
  const visiveis = grupos.slice(inicio, inicio + LINHAS_POR_PAGINA);
  const vazio = <span className="pendente">{NAO_INFORMADO}</span>;
  return (
    <section className="janela-secao" aria-labelledby="janela-conteudo-titulo">
      <h3 id="janela-conteudo-titulo" className="visualmente-oculto">
        Conteúdo do palete
      </h3>
      <div className="janela-tabela-rolagem" role="region" aria-label="Conteúdo do palete" tabIndex={0}>
        <table className="janela-tabela janela-tabela--fichas" data-testid="janela-tabela">
          <thead>
            <tr>
              <th scope="col">Tipo</th>
              <th scope="col">Número</th>
              <th scope="col">Remetente</th>
              {comCnpj && <th scope="col">CNPJ</th>}
              {comDelivery && <th scope="col">Delivery</th>}
              {comInventario && <th scope="col">Inventário</th>}
              <th scope="col">Conferência</th>
              <th scope="col" className="numero">
                Volumes
              </th>
              {expedicao !== null && (
                <th scope="col">
                  <span className="visualmente-oculto">Expedição</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {visiveis.map((g) => {
              const primeiro = g.parcelas[0];
              const rotulo = g.numero === null ? 'Sem documento' : `${g.tipo ?? 'Nota'} ${g.numero}`;
              const onde =
                expedicao === null
                  ? []
                  : g.parcelas.flatMap((p) => {
                      const m = expedicao.marcas.get(p.id);
                      return m === undefined ? [] : [m];
                    });
              const toda = onde.length > 0 && onde.length === g.parcelas.length;
              return (
                <tr key={g.chave} data-testid="janela-linha" data-numero={g.numero ?? ''} data-separacao={naSeparacao(g) ? 'sim' : undefined} className={naSeparacao(g) ? 'janela-linha--separacao' : undefined}>
                  <td data-rotulo="Tipo">{g.tipo ?? vazio}</td>
                  <td data-rotulo="Número">
                    {g.numero ?? vazio}
                    {naSeparacao(g) && <span className="janela-selo-separacao"> · Separar</span>}
                  </td>
                  <td data-rotulo="Remetente" className="janela-remetente">
                    {primeiro?.sender ?? vazio}
                  </td>
                  {comCnpj && <td data-rotulo="CNPJ">{primeiro?.senderCnpj ?? vazio}</td>}
                  {comDelivery && (
                    <td data-rotulo="Delivery">
                      {[...new Set(g.parcelas.flatMap((x) => (x.delivery === null ? [] : [x.delivery])))].join(', ') || <span className="janela-base">—</span>}
                    </td>
                  )}
                  {comInventario && <CelulaInventario parcelas={g.parcelas} />}
                  <CelulaConferencia parcelas={g.parcelas} />
                  <td data-rotulo="Volumes" className="numero" data-testid="janela-linha-volumes">
                    {textoVolumes(somaContada(g.parcelas))}
                  </td>
                  {expedicao !== null && (
                    <td data-rotulo="Expedição" className="janela-acao-expedicao">
                      {toda ? (
                        <span className="janela-na-expedicao" title={[...new Set(onde)].join('; ')} data-testid="janela-linha-na-expedicao">
                          Na expedição · {[...new Set(onde.map(identidadeCurta))].join(', ')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="botao-secundario botao-icone"
                          aria-label={`Adicionar esta nota à expedição: ${rotulo}`}
                          title={`Adicionar esta nota à expedição (${rotulo}). Só ela entra; o palete inteiro, não.`}
                          onClick={(e) => {
                            expedicao.aoAdicionar(notaDe(rotulo, g.parcelas), e.currentTarget);
                          }}
                          data-testid="janela-linha-expedicao"
                        >
                          <IconeCaminhao />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {paginas > 1 && (
        <nav className="janela-paginas" aria-label="Páginas do conteúdo" data-testid="janela-paginas">
          <button type="button" className="botao-secundario botao-compacto" disabled={atual <= 1} onClick={() => { setPagina(atual - 1); }}>
            Anterior
          </button>
          <span>
            {String(inicio + 1)}–{String(Math.min(inicio + LINHAS_POR_PAGINA, grupos.length))} de {grupos.length}
          </span>
          <button type="button" className="botao-secundario botao-compacto" disabled={atual >= paginas} onClick={() => { setPagina(atual + 1); }} data-testid="janela-proxima">
            Próxima
          </button>
        </nav>
      )}
    </section>
  );
}

/** FULL/FRACIONADO, conferência informada na linha e a marca de vínculo que não consta da versão atual. */
function CelulaInventario({ parcelas }: { parcelas: readonly ConteudoPalete[] }) {
  const full = textoFull(parcelas);
  const conferencia = textoConferenciaInformada(parcelas);
  const naoConsta = parcelas.some((x) => x.latestInventory === 'NAO_CONSTA');
  return (
    <td data-rotulo="Inventário" className="janela-inventario" data-testid="janela-linha-inventario">
      {full !== null && <span data-testid="janela-linha-full">{full}</span>}
      {conferencia !== null && (
        <span className={conferencia === 'Conferência a validar' ? 'janela-alerta' : 'janela-base'} data-testid="janela-linha-conferencia">
          {conferencia}
        </span>
      )}
      {naoConsta && (
        <span className="janela-alerta" data-testid="janela-linha-nao-consta" title="Mantido da versão anterior: não aparece no inventário ativo. Validar no piso.">
          Não consta do inventário atual
        </span>
      )}
      {full === null && conferencia === null && !naoConsta && <span className="janela-base">—</span>}
    </td>
  );
}

/** Origem dos conteúdos importados: linha do inventário, PF/CNPJ, documentação e o texto da coluna INVENTÁRIO. */
function OrigemInventario({ itens }: { itens: readonly ConteudoPalete[] }) {
  const importados = itens.filter((i) => i.kind === 'IMPORTADO');
  if (importados.length === 0) return null;
  return (
    <div className="janela-tabela-rolagem">
      <table className="janela-tabela" data-testid="janela-origem-inventario">
        <caption>Origem no inventário (informação da planilha; não é conferência completa do palete)</caption>
        <thead>
          <tr>
            <th scope="col">Documento</th>
            <th scope="col">Origem</th>
            <th scope="col">PF/CNPJ</th>
            <th scope="col">Documentação</th>
            <th scope="col">Inventário</th>
          </tr>
        </thead>
        <tbody>
          {importados.map((i) => (
            <tr key={i.id}>
              <td>{i.documentNumber === null ? NAO_INFORMADO : `${i.documentType ?? ''} ${i.documentNumber}`.trim()}</td>
              <td>{i.source ?? NAO_INFORMADO}</td>
              <td>{i.classification ?? NAO_INFORMADO}</td>
              <td>{i.documentation ?? NAO_INFORMADO}</td>
              <td>
                {i.inventoryCheck === null
                  ? NAO_INFORMADO
                  : i.inventoryCheck.state === 'INFORMADA' && i.inventoryCheck.date !== null
                    ? `${dataSimples(i.inventoryCheck.date)}${i.inventoryCheck.text === null ? '' : ` (“${i.inventoryCheck.text}”)`}`
                    : (i.inventoryCheck.text ?? 'Sem data')}
                {i.latestInventory === 'NAO_CONSTA' && ' · não consta da versão atual'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Delivery e descrição de cada conteúdo (opcionais) e, quando há saldo por produto, o que vai para a agenda e o que permanece. */
function InformacoesAdicionais({ itens, detalhe }: { itens: readonly ConteudoPalete[]; detalhe: PaleteDetalhe | null }) {
  const complementares = itens.filter((i) => i.delivery !== null || i.description !== null);
  const produtos = detalhe?.currentItems ?? [];
  return (
    <details className="janela-adicionais" data-testid="janela-adicionais">
      <summary>Informações adicionais</summary>
      {complementares.length === 0 ? (
        <p className="janela-nota">Nenhum Delivery ou descrição registrado (são opcionais).</p>
      ) : (
        <div className="janela-tabela-rolagem">
          <table className="janela-tabela">
            <thead>
              <tr>
                <th scope="col">Documento</th>
                <th scope="col">Delivery</th>
                <th scope="col">Descrição</th>
                <th scope="col" className="numero">
                  Volumes
                </th>
              </tr>
            </thead>
            <tbody>
              {complementares.map((i) => (
                <tr key={i.id}>
                  <td>{i.documentNumber === null ? NAO_INFORMADO : `${i.documentTypeOriginal ?? i.documentType ?? ''} ${i.documentNumber}`.trim()}</td>
                  <td>{i.delivery ?? NAO_INFORMADO}</td>
                  <td className="janela-remetente">{i.description ?? NAO_INFORMADO}</td>
                  <td className="numero">{i.count.counted === null ? NAO_INFORMADO : formatarQuantidade(i.count.counted)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <OrigemInventario itens={itens} />
      {produtos.length > 0 && (
        <div className="janela-tabela-rolagem">
          <table className="janela-tabela" data-testid="janela-produtos">
            <caption>Produtos com saldo validado: para agenda e o que permanece</caption>
            <thead>
              <tr>
                <th scope="col">SKU</th>
                <th scope="col">Descrição</th>
                <th scope="col">Lote</th>
                <th scope="col" className="numero">
                  Para agenda
                </th>
                <th scope="col" className="numero">
                  Permanece
                </th>
              </tr>
            </thead>
            <tbody>
              {produtos.map((p) => (
                <tr key={p.segmentId}>
                  <td>{p.sku}</td>
                  <td className="janela-remetente">{p.description}</td>
                  <td>{p.lot ?? NAO_INFORMADO}</td>
                  <td className="numero">
                    {compararQuantidades(p.reserved, '0') > 0 ? `${formatarQuantidade(p.reserved)} ${p.unit}` : '—'}
                  </td>
                  <td className="numero">
                    {formatarQuantidade(subtrairQuantidades(p.quantity, p.reserved))} {p.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

/**
 * Janela do palete (etapa 3): cabeçalho com o número operacional e o endereço
 * real; resumo curto (volumes com a base, notas/minutas, FULL/misto quando
 * informado, aviso de reconferência); tabela Tipo | Número | Remetente | CNPJ |
 * Volumes; informações adicionais recolhidas; ações permitidas (conferir
 * volumes, importar bipagem, registrar conteúdo). Os detalhes completos
 * existentes continuam acessíveis, recolhidos, no fim.
 */
export function JanelaPalete(props: PropsPalete) {
  const { palete, endereco, carga } = props;
  const { carga: cargaConteudo, recarregar } = useRecurso(`${API_PREFIXO}/paletes/${palete.id}/conteudos`, ConteudosPaleteSchema, props.versao);
  // Resposta de outro palete nunca aparece aqui (a consulta é por palete e a janela é recriada a cada troca).
  const conteudo = cargaConteudo?.estado === 'pronto' && cargaConteudo.dados.palletId === palete.id ? cargaConteudo.dados : null;
  const detalhe = carga?.estado === 'pronto' && carga.dados.id === palete.id ? carga.dados : null;
  const aviso = avisoReconferencia(palete);
  const inventario = conteudo?.inventory ?? null;
  const naoConstam = conteudo === null ? 0 : conteudo.items.filter((i) => i.latestInventory === 'NAO_CONSTA').length;
  // Notas que não constam da versão atual (mantidas, a validar no piso): fora do resumo, somadas à parte; nada é zerado.
  const vigentes = conteudo === null ? [] : conteudo.items.filter((i) => naoConstam === 0 || i.latestInventory !== 'NAO_CONSTA');
  const foraDaVersao = conteudo === null || naoConstam === 0 ? [] : conteudo.items.filter((i) => i.latestInventory === 'NAO_CONSTA');
  const volumes = conteudo === null ? null : somaContada(vigentes);
  const base = conteudo === null ? null : baseDosVolumes(vigentes);
  const sequencia = conteudo === null ? null : textoSequenciaFull(vigentes.find((i) => i.palletFull !== null)?.palletFull ?? null);
  const fullPlanilha = conteudo === null ? null : textoFull(vigentes);
  const tipoPalete = conteudo === null ? 'NAO_INFORMADO' : naoConstam === 0 ? conteudo.full : contarDocumentos(vigentes) >= 2 ? 'MISTO' : 'NAO_INFORMADO';
  // Detalhes completos só são montados (e consultados) quando abertos.
  const [completos, setCompletos] = useState(false);
  const [ajustandoTipo, setAjustandoTipo] = useState(false);
  // Correção de conteúdos (perfis internos com conteudo.corrigir): seleção por ocorrência.
  const podeCorrigir = props.permissoes.includes('conteudo.corrigir') && palete.flowState !== 'EXPEDIDO';
  const [selecionando, setSelecionando] = useState(false);
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(new Set());
  const escolhidos: OcorrenciaSelecionada[] = (conteudo?.items ?? []).filter((i) => selecionados.has(i.id)).map((i) => ({ kind: i.kind, id: i.id, documento: textoDocumento(i), volumes: volumesDe(i) }));
  const conferencia = estadoExibido(palete);
  const vc = palete.volumeCheck;
  // Inclusão por nota na expedição (13 nov. 2026): ação por linha, separada do "Adicionar palete inteiro".
  const podeExpedir = props.permissoes.includes('expedicao.preparar') && (palete.flowState === 'EM_ESTOQUE' || palete.flowState === 'RESERVADO');
  const [versaoMarcas, setVersaoMarcas] = useState(0);
  const { carga: cargaMarcas } = useRecurso(podeExpedir ? `${API_PREFIXO}/cargas/selecao?palete=${palete.id}` : null, SelecaoExpedicaoSchema, props.versao + versaoMarcas);
  const marcas = new Map(cargaMarcas?.estado === 'pronto' ? cargaMarcas.dados.pallet.map((p) => [p.occurrenceId, p.identity] as const) : []);
  const [incluindo, setIncluindo] = useState<{ notas: NotaParaExpedicao[]; origem: { el: HTMLElement; rect: DOMRect } } | null>(null);
  const abrirInclusao = (notas: NotaParaExpedicao[], el: HTMLElement) => {
    setIncluindo({ notas, origem: { el, rect: el.getBoundingClientRect() } });
  };
  const expedicaoLinha: ExpedicaoLinha | null = podeExpedir
    ? {
        marcas,
        aoAdicionar: (nota, el) => {
          abrirInclusao([nota], el);
        },
      }
    : null;

  const rodape = (
    <>
      <div className="acoes-linha">
        {palete.clientSeparation === true && props.permissoes.includes('movimento.registrar') && palete.flowState !== 'EXPEDIDO' && <SeparadoAgenda palete={palete} aoAlterado={props.aoAlterado} />}
        {props.aoConferirVolumes !== null && (
          <button type="button" className="botao-primario" onClick={props.aoConferirVolumes} data-testid="acao-volumes">
            Conferir volumes
          </button>
        )}
        {props.aoImportarBipagem !== null && (
          <button type="button" className="botao-secundario" onClick={props.aoImportarBipagem} data-testid="acao-bipagem">
            <IconeArquivo />
            Importar bipagem
          </button>
        )}
        {props.aoNotasFoto !== null && (
          <button type="button" className="botao-secundario" onClick={props.aoNotasFoto} data-testid="acao-notas-foto">
            Adicionar notas por foto
          </button>
        )}
        {props.aoRegistrarConteudo !== null && (
          <button type="button" className="botao-secundario" onClick={props.aoRegistrarConteudo} data-testid="acao-registrar-conteudo">
            Registrar conteúdo
          </button>
        )}
        {podeExpedir && <AdicionarExpedicao palete={palete} aoAlterado={props.aoAlterado} />}
      </div>
      <div className="acoes-linha janela-acoes-secundarias">
        <button
          type="button"
          className="botao-link"
          onClick={props.aoCentralizar}
          disabled={palete.positionId === null}
          title={palete.positionId === null ? 'Sem posição: o palete não aparece no mapa.' : 'Fechar e centralizar no mapa'}
          data-testid="janela-centralizar"
        >
          <IconeAlvo />
          Centralizar
        </button>
        {props.aoImprimir !== null && (
          <button type="button" className="botao-link" onClick={props.aoImprimir} data-testid="acao-etiqueta">
            <IconeImprimir />
            Etiqueta
          </button>
        )}
        {props.aoLiberarPosicao !== null && (
          <button
            type="button"
            className="botao-link"
            onClick={props.aoLiberarPosicao}
            title="O palete não está nesta posição: tira o vínculo e deixa a posição livre."
            data-testid="acao-liberar-posicao"
          >
            Liberar posição
          </button>
        )}
      </div>
    </>
  );

  return (
    <JanelaModal
      titulo={<>Palete {palete.code}</>}
      subtitulo={
        <>
          <span data-testid="janela-endereco">{endereco ?? 'Endereço não informado'}</span>
          {palete.legacyCode !== null && (
            <span className="janela-base" data-testid="janela-codigo-legado" title="Identificador anterior do mesmo palete (ID e etiqueta QR não mudam).">
              {' '}
              · antes {palete.legacyCode}
            </span>
          )}
          {props.permissoes.includes('palete.cadastrar') && palete.flowState !== 'EXPEDIDO' && (
            <>
              {' · '}
              <AlterarNumero palete={palete} aoTrocado={props.aoAlterado} />
            </>
          )}
        </>
      }
      aoFechar={props.aoFechar}
      rodape={rodape}
      testId="janela-palete"
      tutorial="identificacao-palete"
      paleteId={palete.id}
    >
      {/* 1) Quem é: selos curtos de situação; o ajuste manual do tipo fica recolhido. */}
      <div className="janela-selos" data-testid="janela-selos">
        {conteudo !== null && (tipoPalete !== 'NAO_INFORMADO' || fullPlanilha !== null || conteudo.loadKind !== null) && (
          <span className="janela-selo janela-selo--tipo" data-testid="janela-full">
            {/* Marcação manual prevalece; depois a indicação da planilha (FULL n/m ou Fracionado) e a regra de contagem de notas. */}
            {conteudo.loadKind !== null
              ? conteudo.loadKind === 'FULL' ? 'Full' : 'Fracionado'
              : tipoPalete === 'MISTO' ? 'Fracionado' : tipoPalete === 'FULL' || fullPlanilha !== null ? (fullPlanilha ?? 'Full') : 'Não informado'}
            {conteudo.loadSequence !== null ? ` ${conteudo.loadSequence}` : conteudo.loadKind === null && tipoPalete === 'FULL' && fullPlanilha === null && sequencia !== null && ` ${sequencia}`}
            {conteudo.loadKind !== null && <span className="janela-base"> · marcado à mão</span>}
          </span>
        )}
        {inventario?.inValidation === true && (
          <span className="janela-selo janela-selo--aviso" data-testid="janela-inventario-validacao" title="Base provisória: os volumes não são disponibilidade certificada.">
            Inventário em validação
            {inventario.baseDate !== null && <span> · base {dataSimples(inventario.baseDate)}</span>}
            {naoConstam > 0 && <span> · {naoConstam} não {naoConstam === 1 ? 'consta' : 'constam'} da versão atual</span>}
          </span>
        )}
        {palete.flowState === 'RESERVADO' && (
          <span className="janela-selo" data-testid="janela-agenda">Separação para agenda</span>
        )}
        {aviso !== null && (
          <span className={`janela-selo ${palete.reconference?.due ? 'janela-selo--alerta' : ''}`} data-testid="janela-reconferencia">
            {aviso}
            {palete.reconference?.required != null && (
              <span data-testid="janela-reconferencia-motivo"> · {palete.reconference.required.reason}</span>
            )}
          </span>
        )}
        {conteudo !== null && props.permissoes.includes('palete.cadastrar') && palete.flowState !== 'EXPEDIDO' && (
          <button type="button" className="botao-link janela-ajustar" aria-expanded={ajustandoTipo} onClick={() => setAjustandoTipo(!ajustandoTipo)} data-testid="janela-ajustar-tipo">
            {ajustandoTipo ? 'Fechar ajuste' : 'Ajustar tipo'}
          </button>
        )}
      </div>
      {ajustandoTipo && conteudo !== null && props.permissoes.includes('palete.cadastrar') && palete.flowState !== 'EXPEDIDO' && (
        <div className="janela-ajuste" data-testid="janela-ajuste-tipo">
          <span className="janela-ajuste-rotulo">Tipo do palete</span>
          <EscolherTipoCarga paleteId={palete.id} atual={conteudo.loadKind} aoTrocado={props.aoAlterado} />
          {(conteudo.loadKind === 'FULL' || (conteudo.loadKind === null && (tipoPalete === 'FULL' || (fullPlanilha ?? '').startsWith('FULL')))) && (
            <>
              <span className="janela-ajuste-rotulo">Posição na carga</span>
              <InformarSequenciaFull paleteId={palete.id} atual={conteudo.loadSequence} aoTrocado={props.aoAlterado} />
            </>
          )}
        </div>
      )}

      {/* 2) O que tem dentro: números e, logo abaixo, a tabela de notas. */}
      <dl className="janela-resumo" data-testid="janela-resumo" data-tutorial="conteudo-palete">
        <div>
          <dt>Volumes</dt>
          <dd data-testid="janela-volumes">
            {volumes === null ? '…' : textoVolumes(volumes)}
            {base !== null && <span className="janela-base"> · {base}</span>}
            {foraDaVersao.length > 0 && (
              <span className="janela-base" data-testid="janela-volumes-nao-consta">
                {' '}
                · +{textoVolumes(somaContada(foraDaVersao))} em notas que não constam da versão atual
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Notas/minutas</dt>
          <dd data-testid="janela-documentos">
            {conteudo === null ? '…' : conteudo.items.length === 0 ? NAO_INFORMADO : conteudo.documents}
            {conteudo !== null && conteudo.withoutDocument > 0 && <span className="janela-base"> + {conteudo.withoutDocument} sem documento</span>}
          </dd>
        </div>
        <div>
          <dt>Conferência</dt>
          <dd data-testid="janela-conferencia" data-estado={conferencia.chave}>
            <span className={`selo selo-conferencia selo-conferencia--${conferencia.chave}`}>
              <span className="selo-marcador" aria-hidden="true">
                {conferencia.rotulo.marcador}
              </span>
              {conferencia.rotulo.texto}
            </span>
            {vc !== null && vc.items > 0 && vc.state === 'PARCIAL' && (
              <span className="janela-base"> · {vc.covered === vc.items ? 'todos contados, falta a conferência completa' : `${String(vc.covered)} de ${String(vc.items)} conferidos`}</span>
            )}
            {vc !== null && vc.differences > 0 && <span className="janela-alerta"> · {vc.differences} com diferença</span>}
            {vc?.lastCompleteAt != null && (
              <span className="janela-base">
                {' '}
                · completa {formatarDataHora(vc.lastCompleteAt)}
                {vc.lastCompleteBy !== null && ` por ${vc.lastCompleteBy.name}`}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {cargaConteudo?.estado === 'erro' ? (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar o conteúdo. {cargaConteudo.mensagem}</p>
          <button type="button" className="botao-secundario botao-compacto" onClick={recarregar}>
            Tentar novamente
          </button>
        </div>
      ) : conteudo === null ? (
        <Carregando mensagem="Carregando conteúdo…" />
      ) : conteudo.items.length === 0 ? (
        <p className="janela-nota" data-testid="janela-sem-conteudo">
          Nenhum conteúdo registrado neste palete.
        </p>
      ) : selecionando ? (
        <TabelaSelecao
          itens={conteudo.items}
          selecionados={selecionados}
          aoMudar={(ids, marcado) => {
            const novo = new Set(selecionados);
            for (const id of ids) {
              if (marcado) novo.add(id);
              else novo.delete(id);
            }
            setSelecionados(novo);
          }}
        />
      ) : (
        <TabelaConteudo key={palete.id} itens={conteudo.items} expedicao={expedicaoLinha} />
      )}

      {incluindo !== null && (
        <AdicionarNotas
          key={incluindo.notas.flatMap((n) => n.ocorrencias.map((o) => o.id)).join(',')}
          palete={palete}
          notas={incluindo.notas}
          origem={incluindo.origem}
          aoCancelar={() => {
            const el = incluindo.origem.el;
            setIncluindo(null);
            if (el.isConnected) el.focus();
          }}
          aoConcluir={(texto) => {
            setIncluindo(null);
            setVersaoMarcas((v) => v + 1);
            if (selecionando) {
              setSelecionados(new Set());
              setSelecionando(false);
            }
            props.aoAlterado(texto);
          }}
        />
      )}

      {conteudo !== null && conteudo.items.length > 0 && (podeCorrigir || props.aoAbrirValidacao !== null) && (
        <div className="janela-selecao">
          {podeCorrigir && (
            <button
              type="button"
              className="botao-secundario botao-compacto"
              aria-pressed={selecionando}
              onClick={() => {
                setSelecionando(!selecionando);
                setSelecionados(new Set());
              }}
              data-testid="acao-corrigir-conteudos"
            >
              {selecionando ? 'Voltar à tabela do palete' : 'Corrigir conteúdos (mover, validar, cancelar)'}
            </button>
          )}
          {selecionando && (
            <span className="tabela-nota" data-testid="selecao-contagem">
              {selecionados.size} de {conteudo.items.length} selecionado(s)
            </span>
          )}
          {selecionando && podeExpedir && selecionados.size > 0 && (
            <button
              type="button"
              className="botao-secundario botao-compacto"
              onClick={(e) => {
                abrirInclusao(
                  conteudo.items.filter((i) => selecionados.has(i.id)).map((i) => notaDe(textoDocumento(i), [i])),
                  e.currentTarget,
                );
              }}
              data-testid="acao-adicionar-selecionadas"
            >
              <IconeCaminhao />
              Adicionar {selecionados.size} {selecionados.size === 1 ? 'nota selecionada' : 'notas selecionadas'} à expedição
            </button>
          )}
          {props.aoAbrirValidacao !== null && (
            <button type="button" className="botao-link" onClick={props.aoAbrirValidacao}>
              Validação urgente — sem endereço
            </button>
          )}
        </div>
      )}
      {selecionando && (
        <AcoesConteudo
          paleteId={palete.id}
          selecionados={escolhidos}
          aoConcluido={(r) => {
            setSelecionados(new Set());
            setSelecionando(false);
            recarregar();
            props.aoAlterado(textoResultadoAcao(r));
          }}
        />
      )}

      {/* 3) Observação do palete: cartão próprio, com o texto inteiro. */}
      {conteudo !== null && (conteudo.paletteNotes !== null || props.permissoes.includes('palete.cadastrar')) && (
        <section className="janela-observacao-cartao" aria-label="Observação do palete" data-testid="janela-observacao-cartao">
          <h3 className="janela-observacao-titulo">Observação</h3>
          <ObservacaoPalete paleteId={palete.id} atual={conteudo.paletteNotes} podeEditar={props.permissoes.includes('palete.cadastrar')} aoTrocado={props.aoAlterado} />
        </section>
      )}

      {conteudo !== null && (conteudo.items.length > 0 || (detalhe?.currentItems ?? []).length > 0) && <InformacoesAdicionais itens={conteudo.items} detalhe={detalhe} />}

      <details
        className="janela-adicionais janela-completos"
        data-testid="janela-detalhes-completos"
        onToggle={(evento) => {
          setCompletos(evento.currentTarget.open);
        }}
      >
        <summary>Detalhes completos e outras ações</summary>
        {completos && props.detalhesCompletos}
      </details>
    </JanelaModal>
  );
}
