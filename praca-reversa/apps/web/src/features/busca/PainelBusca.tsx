import {
  BASES_FILTRO_BUSCA,
  CAMPOS_BUSCA,
  CONDICOES_MATERIAL,
  ESTADOS_CONFERENCIA,
  ESTADOS_LIBERACAO,
  RespostaBuscaSchema,
  type BaseResultado,
  type CampoBusca,
  type GrupoResumo,
  type Permissao,
  type ResultadoBusca,
} from '@praca-reversa/contracts';
import { useEffect, useId, useState } from 'react';
import { baixarArquivo, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeAlvo, IconeAtualizar } from '../../components/Icones';
import { SeloConferencia, SeloLiberacao } from '../../components/Selos';
import { useConectado } from '../../hooks/ambiente';
import { formatarData, formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';
import { ROTULOS_ORIGEM_DOCUMENTO } from '../paletes/conteudo';
import { ROTULOS_CONDICAO, ROTULOS_CONFERENCIA, ROTULOS_LIBERACAO } from '../paletes/estados';
import {
  CRITERIOS_VAZIOS,
  ROTULOS_BASE,
  ROTULOS_CAMPO,
  ROTULOS_CORRESPONDENCIA,
  TAMANHO_PAGINA,
  aproximada,
  gravarMemoriaBusca,
  lerMemoriaBusca,
  temCriterio,
  urlBusca,
  urlExportacao,
  type CriteriosBusca,
} from './estado';

/** Espera depois da última alteração antes de consultar o servidor. */
const ESPERA_MS = 300;

const q = (valor: string, unidade: string | null) => `${formatarQuantidade(valor)}${unidade ? ` ${unidade}` : ''}`;

function origem(r: Pick<ResultadoBusca, 'originType' | 'originReference'>): { texto: string; pendente: boolean } {
  if (r.originType === null) return { texto: 'Origem pendente', pendente: true };
  return { texto: `${ROTULOS_ORIGEM_DOCUMENTO[r.originType]}${r.originReference === null ? ' (referência pendente)' : ` ${r.originReference}`}`, pendente: r.originReference === null };
}

/** Quantidade com a base explícita: nunca um "total de estoque" misturado. */
function linhaQuantidade(r: ResultadoBusca): string {
  switch (r.base) {
    case 'PALETE':
      return 'Conteúdo: abra o palete para ver saldo, contagens e declarações.';
    case 'SALDO_VALIDADO':
      return `${q(r.quantity ?? '0', r.unit)} em saldo validado · reservado ${q(r.reserved ?? '0', r.unit)} · disponível ${q(r.available ?? '0', r.unit)}`;
    case 'OBSERVADO': {
      const s = r.session;
      const escopo = s?.scope === 'PARCIAL' ? 'parcial' : 'completa';
      return `${q(r.quantity ?? '0', r.unit)} observadas na conferência nº ${String(s?.number ?? '?')} (${escopo}, não validada)${s && s.pendingLines > 0 ? ` · ${String(s.pendingLines)} pendência(s) fora desta soma` : ''}`;
    }
    case 'DECLARADO_PALETE':
      return `${q(r.quantity ?? '0', r.unit)} declaradas no cadastro do palete (não comprova presença física)`;
    case 'DOCUMENTO': {
      const d = r.document;
      if (!d) return '';
      const conversao = d.declaredUnit !== r.unit ? ` (${q(d.declaredQuantity, d.declaredUnit)} × fator ${formatarQuantidade(d.factor)})` : '';
      return `${q(r.quantity ?? '0', r.unit)} declaradas no documento${conversao} · sem vínculo físico registrado`;
    }
    case 'INVENTARIO': {
      const v = r.documentLink;
      if (!v) return '';
      const volumes = v.volumes === null ? 'volumes não informados' : `${formatarQuantidade(v.volumes)} ${v.volumesUnit.toLowerCase()} informados`;
      return `${volumes} no inventário ${v.inventoryCode} (linha ${String(v.row)}) · não são unidades de produto nem saldo validado`;
    }
  }
}

function CartaoResultado({
  r,
  escolhido,
  podeVerImportacao,
  aoEscolher,
  aoAbrirImportacao,
}: {
  r: ResultadoBusca;
  escolhido: boolean;
  podeVerImportacao: boolean;
  aoEscolher: () => void;
  aoAbrirImportacao: (id: string) => void;
}) {
  const base = ROTULOS_BASE[r.base];
  const o = origem(r);
  const produto = r.product ? `${r.product.sku} — ${r.product.description}` : r.pendingDescription ? `Produto pendente: ${r.pendingDescription}` : null;
  return (
    <li>
      <article
        className={`resultado-busca resultado-busca--${r.base}`}
        aria-current={escolhido ? 'true' : undefined}
        aria-label={`${base.texto}${r.pallet ? `, palete ${r.pallet.code}` : ''}${produto ? `, ${produto}` : ''}`}
        data-testid="resultado-busca"
        data-base={r.base}
        data-chave={r.key}
        data-palete={r.pallet?.code ?? ''}
      >
        <header className="resultado-topo">
          <span className={`selo-base selo-base--${r.base}`}>
            <span aria-hidden="true">{base.marcador}</span> {base.texto}
          </span>
          <span className={aproximada(r.match) ? 'correspondencia correspondencia--aproximada' : 'correspondencia'}>
            {ROTULOS_CORRESPONDENCIA[r.match]}
            {aproximada(r.match) && ' — confira antes de usar'}
          </span>
        </header>
        {produto !== null && <p className={r.product ? 'resultado-produto' : 'resultado-produto pendente'}>{produto}</p>}
        <p className="resultado-quantidade" data-testid="resultado-quantidade">
          {linhaQuantidade(r)}
        </p>
        {r.documentLink && (
          <p className="resultado-dados" data-testid="resultado-vinculo">
            <span>
              {r.documentLink.documentType ?? 'Tipo documental pendente'} {r.documentLink.documentNumber}
            </span>
            {r.documentLink.delivery !== null && <span>DELIVERY {r.documentLink.delivery}</span>}
            <span className={r.documentLink.informedAddress === null ? 'pendente' : undefined}>
              {r.documentLink.informedAddress === null ? 'Endereço não informado' : `Informado em ${r.documentLink.informedAddress}`}
            </span>
            {r.documentLink.documentation !== null && <span>Documentação: {r.documentLink.documentation} (não libera saída)</span>}
            <span>{r.documentLink.externalCount ? 'Conferência externa reconhecida' : 'Conferência externa não registrada'}</span>
          </p>
        )}
        {r.base !== 'PALETE' && r.base !== 'INVENTARIO' && (
          <p className="resultado-dados">
            <span className={r.lot === null ? 'pendente' : undefined}>{r.lot === null ? 'Lote pendente' : `Lote ${r.lot}`}</span>
            <span className={o.pendente ? 'pendente' : undefined}>{o.texto}</span>
            {r.condition !== null && <span>{ROTULOS_CONDICAO[r.condition]}</span>}
            {r.lineage !== null && <span className="pendente">Registro pendente próprio</span>}
            {r.document && (
              <>
                <span>Linha {r.document.lineReference}</span>
                <span className={r.document.invoice === null ? 'pendente' : undefined}>{r.document.invoice === null ? 'NF pendente' : `NF ${r.document.invoice}`}</span>
                {r.document.date !== null && <span>Data {formatarData(`${r.document.date}T12:00:00Z`)}</span>}
              </>
            )}
          </p>
        )}
        {r.pallet ? (
          <div className="resultado-palete">
            <span className="resultado-codigo">{r.pallet.code}</span>
            <span className={r.pallet.positionCode === null ? 'resultado-endereco pendente' : 'resultado-endereco'}>
              {r.pallet.positionCode ?? 'Localização pendente'}
            </span>
            <SeloConferencia estado={r.pallet.countState} curto />
            <SeloLiberacao estado={r.pallet.releaseState} />
            {r.pallet.activeCountId !== null && <span className="item-alerta item-alerta--conferencia">✎ Em conferência</span>}
          </div>
        ) : (
          <p className="resultado-palete resultado-palete--sem">Documento sem palete: nenhum palete ou endereço é presumido pelo SKU.</p>
        )}
        <div className="resultado-acoes">
          {r.pallet && (
            <button type="button" className={escolhido ? 'botao-primario botao-compacto' : 'botao-secundario botao-compacto'} onClick={aoEscolher} data-testid="resultado-abrir">
              {r.pallet.positionId !== null ? (
                <>
                  <IconeAlvo />
                  Ver no mapa
                </>
              ) : (
                'Abrir palete (sem posição)'
              )}
            </button>
          )}
          {r.document?.batchId && podeVerImportacao && (
            <button
              type="button"
              className="botao-link"
              onClick={() => {
                aoAbrirImportacao(r.document?.batchId ?? '');
              }}
            >
              Ver lote de importação
            </button>
          )}
        </div>
      </article>
    </li>
  );
}

function ResumoBusca({ grupos, truncado }: { grupos: readonly GrupoResumo[]; truncado: boolean }) {
  if (grupos.length === 0) return null;
  return (
    <details className="resumo-busca" open data-testid="resumo-busca">
      <summary>Resumo por base (as bases não se somam)</summary>
      <ul>
        {grupos.map((g) => (
          <li key={`${g.base}-${g.productId ?? g.description}-${g.unit}`} data-base={g.base} data-testid="resumo-grupo">
            <span className={`selo-base selo-base--${g.base}`}>{ROTULOS_BASE[g.base].curto}</span>{' '}
            <strong>{g.sku ?? 'Produto pendente'}</strong> {g.description}:{' '}
            {g.quantity === null ? (
              <span>
                {g.records} contagem(ns) em {g.pallets} palete(s) — quantidades observadas não são somadas (podem se sobrepor)
              </span>
            ) : (
              <span data-testid="resumo-total">
                <strong>{q(g.quantity, g.unit)}</strong> em {g.records} registro(s){g.pallets > 0 ? `, ${String(g.pallets)} palete(s)` : ''}
                {g.reserved !== null && g.available !== null && ` · reservado ${q(g.reserved, g.unit)} · disponível ${q(g.available, g.unit)}`}
              </span>
            )}
            {g.breakdown.length > 1 && (
              <ul className="resumo-quebra">
                {g.breakdown.map((b, i) => (
                  <li key={i}>
                    {b.lot ?? 'lote pendente'} · {origem(b).texto}
                    {b.condition !== null ? ` · ${ROTULOS_CONDICAO[b.condition]}` : ''}
                    {b.quantity !== null ? `: ${q(b.quantity, g.unit)}` : `: ${String(b.records)} contagem(ns)`}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {truncado && <p className="filtro-nota">Resumo limitado aos primeiros produtos; refine a busca.</p>}
    </details>
  );
}

interface Props {
  /** Usuário + escopo: a memória da busca é própria de cada um. */
  chaveMemoria: string;
  permissoes: readonly Permissao[];
  /** Aumenta depois de gravações: a busca consulta de novo. */
  versao: number;
  oculto: boolean;
  aoEscolherPalete: (id: string) => void;
  aoAbrirImportacao: (loteId: string) => void;
  /** Paletes do resultado para destacar no mapa (`null` = sem busca ativa). */
  aoMudarDestaque: (ids: ReadonlySet<string> | null) => void;
}

/**
 * Busca operacional no servidor: palete, endereço, SKU, código de barras,
 * lote, devolução/NF, descrição e situação. Resultados em lista, cada um com
 * a base da informação; escolher um resultado com palete centraliza o palete
 * certo e abre o detalhe. Respostas de buscas antigas são descartadas.
 */
export function PainelBusca({ chaveMemoria, permissoes, versao, oculto, aoEscolherPalete, aoAbrirImportacao, aoMudarDestaque }: Props) {
  const ids = useId();
  const conectado = useConectado();
  const inicial = lerMemoriaBusca(chaveMemoria);
  const [criterios, setCriterios] = useState<CriteriosBusca>(inicial?.criterios ?? CRITERIOS_VAZIOS);
  const [aplicado, setAplicado] = useState<CriteriosBusca>(inicial?.criterios ?? CRITERIOS_VAZIOS);
  const [pagina, setPagina] = useState(inicial?.pagina ?? 1);
  const [escolhido, setEscolhido] = useState<string | null>(inicial?.escolhido ?? null);
  const [exportando, setExportando] = useState(false);
  const [erroExportacao, setErroExportacao] = useState<string | null>(null);
  const pode = (p: Permissao) => permissoes.includes(p);

  useEffect(() => {
    if (criterios === aplicado) return;
    const espera = setTimeout(() => {
      setAplicado(criterios);
      setPagina(1);
    }, ESPERA_MS);
    return () => {
      clearTimeout(espera);
    };
  }, [criterios, aplicado]);

  useEffect(() => {
    gravarMemoriaBusca(chaveMemoria, { criterios: aplicado, pagina, escolhido, ativo: !oculto });
  }, [chaveMemoria, aplicado, pagina, escolhido, oculto]);

  const ativa = temCriterio(aplicado);
  const { carga, recarregar } = useRecurso(ativa ? urlBusca(aplicado, pagina) : null, RespostaBuscaSchema, versao);
  const resposta = carga?.estado === 'pronto' ? carga.dados : null;

  useEffect(() => {
    if (!ativa) aoMudarDestaque(null);
    else if (resposta) aoMudarDestaque(new Set(resposta.palletIds));
  }, [ativa, resposta, aoMudarDestaque]);

  const mudar = (parcial: Partial<CriteriosBusca>) => {
    setCriterios((c) => ({ ...c, ...parcial }));
  };
  const alternarBase = (base: BaseResultado) => {
    setCriterios((c) => ({ ...c, bases: c.bases.includes(base) ? c.bases.filter((b) => b !== base) : [...c.bases, base] }));
  };
  const aguardando = criterios !== aplicado;
  const paginas = resposta ? Math.max(1, Math.ceil(resposta.total / TAMANHO_PAGINA)) : 1;
  const filtrosAtivos = aplicado.bases.length + [aplicado.conferencia, aplicado.liberacao, aplicado.condicao, aplicado.localizacao].filter(Boolean).length + (aplicado.emConferencia ? 1 : 0);

  async function exportar() {
    setExportando(true);
    setErroExportacao(null);
    try {
      await baixarArquivo(urlExportacao(aplicado), 'busca.csv');
    } catch (erro) {
      setErroExportacao(mensagemDeFalha(erro));
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="painel-busca" hidden={oculto} data-testid="painel-busca">
      <form
        className="filtro-lista"
        role="search"
        aria-label="Buscar produtos, paletes e documentos"
        onSubmit={(e) => {
          e.preventDefault();
          setAplicado(criterios);
          setPagina(1);
        }}
      >
        <label className="campo">
          <span className="campo-rotulo">Buscar</span>
          <input
            type="search"
            value={criterios.texto}
            maxLength={120}
            placeholder="SKU, código de barras, lote, devolução, NF, palete…"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            data-testid="campo-busca"
            aria-describedby={`${ids}-ajuda`}
            onChange={(e) => {
              mudar({ texto: e.target.value });
            }}
          />
          <span id={`${ids}-ajuda`} className="campo-ajuda">
            Identificadores: igual ou começo (3+ caracteres), sem diferenciar maiúsculas. Zeros à esquerda contam.
          </span>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Buscar em</span>
          <select
            value={criterios.campo}
            data-testid="campo-busca-em"
            onChange={(e) => {
              mudar({ campo: e.target.value as CampoBusca });
            }}
          >
            {CAMPOS_BUSCA.map((c) => (
              <option key={c} value={c}>
                {ROTULOS_CAMPO[c]}
              </option>
            ))}
          </select>
        </label>
        <details className="filtros-busca">
          <summary>Filtros{filtrosAtivos > 0 ? ` (${String(filtrosAtivos)})` : ''}</summary>
          <fieldset className="campo">
            <legend className="campo-rotulo">Base da informação</legend>
            <div className="opcoes-base">
              {BASES_FILTRO_BUSCA.map((b) => (
                <label key={b} className="opcao">
                  <input
                    type="checkbox"
                    checked={criterios.bases.includes(b)}
                    onChange={() => {
                      alternarBase(b);
                    }}
                  />
                  {ROTULOS_BASE[b].texto}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="formulario-grade formulario-grade--compacta">
            <label className="campo">
              <span className="campo-rotulo">Conferência do palete</span>
              <select value={criterios.conferencia} onChange={(e) => { mudar({ conferencia: e.target.value as CriteriosBusca['conferencia'] }); }}>
                <option value="">Todas</option>
                {ESTADOS_CONFERENCIA.map((s) => (
                  <option key={s} value={s}>
                    {ROTULOS_CONFERENCIA[s].texto}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span className="campo-rotulo">Liberação</span>
              <select value={criterios.liberacao} onChange={(e) => { mudar({ liberacao: e.target.value as CriteriosBusca['liberacao'] }); }}>
                <option value="">Todas</option>
                {ESTADOS_LIBERACAO.map((s) => (
                  <option key={s} value={s}>
                    {ROTULOS_LIBERACAO[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span className="campo-rotulo">Condição</span>
              <select value={criterios.condicao} onChange={(e) => { mudar({ condicao: e.target.value as CriteriosBusca['condicao'] }); }}>
                <option value="">Todas</option>
                {CONDICOES_MATERIAL.map((s) => (
                  <option key={s} value={s}>
                    {ROTULOS_CONDICAO[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span className="campo-rotulo">Localização</span>
              <select value={criterios.localizacao} data-testid="filtro-localizacao" onChange={(e) => { mudar({ localizacao: e.target.value as CriteriosBusca['localizacao'] }); }}>
                <option value="">Todas</option>
                <option value="COM_POSICAO">Com posição</option>
                <option value="PENDENTE">Localização pendente</option>
              </select>
            </label>
          </div>
          <label className="opcao">
            <input type="checkbox" checked={criterios.emConferencia} onChange={(e) => { mudar({ emConferencia: e.target.checked }); }} />
            Somente paletes em conferência
          </label>
          <p className="filtro-nota">Filtros de palete deixam de fora os documentos importados, que não têm palete.</p>
        </details>
        <div className="filtro-resumo">
          <p aria-live="polite" data-testid="busca-total">
            {!ativa && !aguardando
              ? 'Digite um código ou escolha um filtro.'
              : aguardando || carga?.estado === 'carregando'
                ? 'Buscando no servidor…'
                : resposta
                  ? `${String(resposta.total)} resultado(s) · página ${String(resposta.page)} de ${String(paginas)}`
                  : ''}
          </p>
          {(ativa || aguardando) && (
            <button
              type="button"
              className="botao-link"
              onClick={() => {
                setCriterios(CRITERIOS_VAZIOS);
                setAplicado(CRITERIOS_VAZIOS);
                setPagina(1);
                setEscolhido(null);
              }}
            >
              Limpar
            </button>
          )}
        </div>
        {!conectado && (
          <p className="mensagem-conflito" role="alert">
            Sem conexão: a busca é feita no servidor e não está disponível agora.
          </p>
        )}
      </form>

      <div className="lista-rolagem busca-resultados" aria-busy={aguardando || carga?.estado === 'carregando'}>
        {carga?.estado === 'erro' && (
          <div className="estado-erro" role="alert">
            <p>Não foi possível buscar. {carga.mensagem}</p>
            <button type="button" className="botao-secundario" onClick={recarregar}>
              <IconeAtualizar />
              Tentar novamente
            </button>
          </div>
        )}
        {resposta && !aguardando && (
          <>
            {resposta.total === 0 ? (
              <div className="estado-vazio" data-testid="busca-vazia">
                <p>Nenhum resultado para esta busca.</p>
                <p>Documento importado só aparece pela referência, NF, SKU ou lote; conteúdo não conferido não aparece como saldo.</p>
              </div>
            ) : (
              <>
                <ResumoBusca grupos={resposta.summary} truncado={resposta.summaryTruncated} />
                <ol className="lista-resultados">
                  {resposta.items.map((r) => (
                    <CartaoResultado
                      key={r.key}
                      r={r}
                      escolhido={escolhido === r.key}
                      podeVerImportacao={pode('importacao.consultar')}
                      aoEscolher={() => {
                        setEscolhido(r.key);
                        if (r.pallet) aoEscolherPalete(r.pallet.id);
                      }}
                      aoAbrirImportacao={aoAbrirImportacao}
                    />
                  ))}
                </ol>
                <nav className="paginacao" aria-label="Páginas do resultado">
                  <button type="button" className="botao-secundario botao-compacto" disabled={pagina <= 1} onClick={() => { setPagina((p) => p - 1); }} data-testid="busca-anterior">
                    Anterior
                  </button>
                  <span>
                    Página {resposta.page} de {paginas}
                  </span>
                  <button type="button" className="botao-secundario botao-compacto" disabled={pagina >= paginas} onClick={() => { setPagina((p) => p + 1); }} data-testid="busca-proxima">
                    Próxima
                  </button>
                </nav>
                <p className="filtro-nota">
                  Consultado em {formatarDataHora(resposta.consultedAt)} (Brasília). Saldo e endereço são os atuais; declaração documental não comprova presença física.
                </p>
                {pode('busca.exportar') && (
                  <div className="exportar-busca">
                    <button type="button" className="botao-secundario botao-compacto" disabled={exportando || !conectado} onClick={() => { void exportar(); }} data-testid="busca-exportar">
                      {exportando ? 'Gerando CSV no servidor…' : 'Exportar resultado (CSV)'}
                    </button>
                    <p className="filtro-nota">Mesmos filtros, no servidor; o arquivo informa filtros, horário, base das quantidades e se houve limite de linhas.</p>
                    {erroExportacao && (
                      <p className="estado-erro" role="alert">
                        {erroExportacao}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
