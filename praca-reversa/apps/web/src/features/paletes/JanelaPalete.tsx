import {
  API_PREFIXO,
  ConteudosPaleteSchema,
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
import { IconeAlvo, IconeArquivo, IconeFechar, IconeImprimir } from '../../components/Icones';
import { formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';
import { AcoesConteudo, type OcorrenciaSelecionada } from '../conteudos/AcoesConteudo';
import { textoResultadoAcao } from '../conteudos/textos-resultado';
import { agruparDocumentos, contarDocumentos } from './documentos';
import { estadoExibido } from './estados';
import { NAO_INFORMADO, avisoReconferencia, baseDosVolumes, dataSimples, somaContada, textoConferenciaInformada, textoFull, textoVolumes } from './janela';
import { textoSequenciaFull } from './volumes';

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
  aoRegistrarConteudo: (() => void) | null;
  aoImprimir: (() => void) | null;
  /** Detalhes completos (situação, conferência, liberação, movimentações, cadastro): o detalhe existente, sem o cabeçalho. */
  detalhesCompletos: ReactNode;
  /** Depois de uma correção gravada (mover, validação, cancelar): mapa e totais consultam de novo; o texto vira aviso. */
  aoAlterado: (texto: string) => void;
  /** Abre a fila "Validação urgente — sem endereço" (perfis internos). */
  aoAbrirValidacao: (() => void) | null;
}

const textoDocumento = (c: ConteudoPalete) => (c.documentNumber === null ? `Sem documento (${c.sender ?? 'remetente não informado'})` : `${c.documentTypeOriginal ?? c.documentType ?? ''} ${c.documentNumber}`.trim());
const volumesDe = (c: ConteudoPalete): number | null => (c.count.counted === null || !Number.isInteger(Number(c.count.counted)) ? null : Number(c.count.counted));

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
  return (
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
  );
}

/** Tabela de conteúdo: uma linha por documento (várias Deliveries da mesma nota somam no documento), paginada. */
function TabelaConteudo({ itens }: { itens: readonly ConteudoPalete[] }) {
  const [pagina, setPagina] = useState(1);
  // Ordem estável para achar o documento: tipo e número (comparação numérica); sem número por último.
  // Notas que não constam da versão atual do inventário vão para o fim (a validar no piso).
  const foraDaVersao = (g: { parcelas: readonly ConteudoPalete[] }) => g.parcelas.every((x) => x.latestInventory === 'NAO_CONSTA');
  const grupos = agruparDocumentos(itens).sort(
    (a, b) =>
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
            </tr>
          </thead>
          <tbody>
            {visiveis.map((g) => {
              const primeiro = g.parcelas[0];
              return (
                <tr key={g.chave} data-testid="janela-linha" data-numero={g.numero ?? ''}>
                  <td data-rotulo="Tipo">{g.tipo ?? vazio}</td>
                  <td data-rotulo="Número">{g.numero ?? vazio}</td>
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
  // Correção de conteúdos (perfis internos com conteudo.corrigir): seleção por ocorrência.
  const podeCorrigir = props.permissoes.includes('conteudo.corrigir') && palete.flowState !== 'EXPEDIDO';
  const [selecionando, setSelecionando] = useState(false);
  const [selecionados, setSelecionados] = useState<ReadonlySet<string>>(new Set());
  const escolhidos: OcorrenciaSelecionada[] = (conteudo?.items ?? []).filter((i) => selecionados.has(i.id)).map((i) => ({ kind: i.kind, id: i.id, documento: textoDocumento(i), volumes: volumesDe(i) }));
  const conferencia = estadoExibido(palete);
  const vc = palete.volumeCheck;

  const rodape = (
    <>
      <div className="acoes-linha">
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
        {props.aoRegistrarConteudo !== null && (
          <button type="button" className="botao-secundario" onClick={props.aoRegistrarConteudo} data-testid="acao-registrar-conteudo">
            Registrar conteúdo
          </button>
        )}
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
        </>
      }
      aoFechar={props.aoFechar}
      rodape={rodape}
      testId="janela-palete"
      tutorial="identificacao-palete"
      paleteId={palete.id}
    >
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
        {conteudo !== null && (tipoPalete !== 'NAO_INFORMADO' || fullPlanilha !== null) && (
          <div>
            <dt>Palete</dt>
            <dd data-testid="janela-full">
              {/* Indicação da planilha (FULL n/m ou Fracionado) prevalece sobre a regra de uma nota só. */}
              {tipoPalete === 'MISTO' ? 'Misto' : (fullPlanilha ?? 'Full')}
              {tipoPalete === 'FULL' && fullPlanilha === null && sequencia !== null && ` · ${sequencia}`}
            </dd>
          </div>
        )}
        {inventario?.inValidation === true && (
          <div>
            <dt>Inventário</dt>
            <dd data-testid="janela-inventario-validacao" title="Base provisória: os volumes não são disponibilidade certificada.">
              Em validação
              {inventario.baseDate !== null && <span className="janela-base"> · base {dataSimples(inventario.baseDate)}</span>}
              {naoConstam > 0 && <span className="janela-base"> · {naoConstam} não {naoConstam === 1 ? 'consta' : 'constam'} da versão atual</span>}
            </dd>
          </div>
        )}
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
        {palete.flowState === 'RESERVADO' && (
          <div>
            <dt>Agenda</dt>
            <dd data-testid="janela-agenda">Separação para agenda</dd>
          </div>
        )}
        {aviso !== null && (
          <div>
            <dt>Reconferência</dt>
            <dd className={palete.reconference?.due ? 'janela-alerta' : undefined} data-testid="janela-reconferencia">
              {aviso}
              {palete.reconference?.required != null && (
                <span className="janela-base" data-testid="janela-reconferencia-motivo">
                  {' '}
                  · {palete.reconference.required.reason}
                </span>
              )}
            </dd>
          </div>
        )}
      </dl>

      {cargaConteudo?.estado === 'erro' ? (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar o conteúdo. {cargaConteudo.mensagem}</p>
          <button type="button" className="botao-secundario botao-compacto" onClick={recarregar}>
            Tentar novamente
          </button>
        </div>
      ) : conteudo === null ? (
        <p className="estado-carregando">Carregando conteúdo…</p>
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
        <TabelaConteudo key={palete.id} itens={conteudo.items} />
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
