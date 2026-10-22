import {
  EstoqueTesteSchema,
  ListaSolicitacoesTesteSchema,
  SolicitacaoTesteSchema,
  type PaleteEstoqueTeste,
  type SolicitacaoTeste,
} from "@praca-reversa/contracts";
import { Suspense, lazy, useEffect, useState } from "react";
import { useChaves } from "../../api/chaves";
import { enviarJson, mensagemDeFalha, obterJson } from "../../api/cliente";
import { useRecurso } from "../../api/use-recurso";
import { IconeMapa } from "../../components/Icones";
import type { Navegar } from "../../rotas";
import { EscolhaAgenda, PassosTeste, SeloAmbienteTeste } from "./comum";
import { JanelaPaleteTeste } from "./JanelaPaleteTeste";
import {
  API_TESTE,
  TIPO_PALETE,
  chaveConteudo,
  remetentes,
  textoAgenda,
  textoDocumento,
  textoPedido,
  textoVolumes,
  textoVolumesPalete,
} from "./textos";

// Leaflet só é carregado quando o mapa é aberto.
const MapaConsultaTeste = lazy(() =>
  import("./MapaConsultaTeste").then((m) => ({ default: m.MapaConsultaTeste })),
);

const ESPERA_PESQUISA_MS = 300;

const editavel = (s: SolicitacaoTeste | null) => s?.can.edit === true;

/**
 * "Seleção cliente — teste" — consultar e escolher. Lista simples e
 * pesquisável dos paletes (palete, tipo e número do documento, remetente,
 * Delivery); o mapa é complementar ("Ver mapa"). Abrir um palete mostra a
 * janela de escolha; o carrinho fica ao lado. Pesquisa, carrinho e contexto
 * continuam iguais ao voltar do mapa. Nada aqui movimenta estoque.
 */
export function TelaSelecaoTeste({
  solicitacaoId,
  podeVerMapa,
  aoNavegar,
}: {
  solicitacaoId: string | null;
  podeVerMapa: boolean;
  aoNavegar: Navegar;
}) {
  const [texto, setTexto] = useState("");
  const [pesquisa, setPesquisa] = useState("");
  const [pagina, setPagina] = useState(1);
  const [paleteAberto, setPaleteAberto] = useState<string | null>(null);
  const [mapaAberto, setMapaAberto] = useState(false);
  const [trocarAgenda, setTrocarAgenda] = useState(false);
  const [local, setLocal] = useState<SolicitacaoTeste | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Pesquisa no servidor depois de uma pausa na digitação.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setPesquisa(texto.trim());
      setPagina(1);
    }, ESPERA_PESQUISA_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [texto]);

  // Sem solicitação na rota: continua o carrinho mais recente da pessoa (rascunho ou revisão autorizada).
  const [procurando, setProcurando] = useState(solicitacaoId === null);
  useEffect(() => {
    if (solicitacaoId !== null) return;
    let ativo = true;
    obterJson(`${API_TESTE}/solicitacoes`, ListaSolicitacoesTesteSchema).then(
      (lista) => {
        if (!ativo) return;
        const atual = lista.items.find(
          (s) =>
            s.mine && (s.status === "RASCUNHO" || s.status === "EM_REVISAO"),
        );
        if (atual)
          aoNavegar(
            { tipo: "selecao-teste", solicitacao: atual.id },
            { substituir: true },
          );
        setProcurando(false);
      },
      () => {
        if (ativo) setProcurando(false);
      },
    );
    return () => {
      ativo = false;
    };
  }, [solicitacaoId, aoNavegar]);

  const { carga: cargaSol, recarregar: recarregarSol } = useRecurso(
    solicitacaoId === null
      ? null
      : `${API_TESTE}/solicitacoes/${solicitacaoId}`,
    SolicitacaoTesteSchema,
  );
  const servidor = cargaSol?.estado === "pronto" ? cargaSol.dados : null;
  const solicitacao =
    local !== null &&
    local.id === solicitacaoId &&
    (servidor === null || local.version >= servidor.version)
      ? local
      : servidor;
  const carrinho = editavel(solicitacao) ? solicitacao : null;

  const urlEstoque = `${API_TESTE}/estoque?${new URLSearchParams({ ...(pesquisa === "" ? {} : { texto: pesquisa }), pagina: String(pagina) }).toString()}`;
  const { carga, recarregar } = useRecurso(urlEstoque, EstoqueTesteSchema);
  const estoque = carga?.estado === "pronto" ? carga.dados : null;
  const paginas =
    estoque === null
      ? 1
      : Math.max(1, Math.ceil(estoque.total / estoque.pageSize));

  const atualizar = (s: SolicitacaoTeste) => {
    setLocal(s);
    if (s.id !== solicitacaoId)
      aoNavegar({ tipo: "selecao-teste", solicitacao: s.id });
  };

  return (
    <main
      className="principal principal--pagina st-pagina"
      data-testid="tela-selecao-teste"
    >
      <div className="pagina-conteudo st-conteudo">
        <header className="st-topo">
          <div>
            <h2>Seleção cliente — teste</h2>
            <p className="st-nota">
              Consulte o estoque como o cliente veria e monte uma solicitação
              para uma agenda de saída.
            </p>
          </div>
          <SeloAmbienteTeste />
        </header>
        <PassosTeste
          ativo="escolher"
          solicitacaoId={carrinho?.id ?? null}
          aoNavegar={aoNavegar}
        />

        <section className="st-agenda" aria-label="Agenda de referência">
          {carrinho !== null && !trocarAgenda ? (
            <p className="st-agenda-atual" data-testid="st-agenda-atual">
              <span>
                Agenda: <strong>{textoAgenda(carrinho.agenda)}</strong> ·
                Solicitação <strong>{carrinho.code}</strong>
                {carrinho.status === "EM_REVISAO" && " (revisão autorizada)"}
              </span>
              <button
                type="button"
                className="botao-link"
                onClick={() => {
                  setTrocarAgenda(true);
                }}
                data-testid="st-trocar-agenda"
              >
                Outra agenda ou nova solicitação
              </button>
            </p>
          ) : procurando ? (
            <p className="st-nota" role="status">
              Procurando a sua seleção em andamento…
            </p>
          ) : (
            <>
              {solicitacao !== null &&
                !editavel(solicitacao) &&
                !trocarAgenda && (
                  <p className="st-aviso-suave">
                    A solicitação {solicitacao.code} já foi enviada.{" "}
                    <button
                      type="button"
                      className="botao-link"
                      onClick={() => {
                        aoNavegar({
                          tipo: "selecao-teste-solicitacao",
                          id: solicitacao.id,
                        });
                      }}
                    >
                      Ver a solicitação
                    </button>
                  </p>
                )}
              <h3 className="st-rotulo">Para qual agenda é este pedido?</h3>
              <EscolhaAgenda
                adicional={trocarAgenda}
                rotuloAcao={
                  trocarAgenda ? "Abrir esta agenda" : "Começar a seleção"
                }
                aoEscolher={(s) => {
                  setTrocarAgenda(false);
                  atualizar(s);
                }}
              />
              {trocarAgenda && (
                <button
                  type="button"
                  className="botao-link"
                  onClick={() => {
                    setTrocarAgenda(false);
                  }}
                >
                  Continuar na agenda atual
                </button>
              )}
            </>
          )}
        </section>

        <div className="st-grade">
          <section className="st-lista" aria-label="Paletes do estoque">
            <label className="campo st-pesquisa">
              <span className="campo-rotulo">
                Pesquisar palete, nota (tipo e número), remetente ou Delivery
              </span>
              <input
                type="search"
                value={texto}
                onChange={(ev) => {
                  setTexto(ev.target.value);
                }}
                placeholder="Ex.: NF 900123, Distribuidora, 8000123"
                data-testid="st-pesquisa"
              />
            </label>
            {carga === null || carga.estado === "carregando" ? (
              <p className="st-nota" role="status">
                Consultando o estoque…
              </p>
            ) : carga.estado === "erro" ? (
              <div className="estado-erro" role="alert">
                <p>{carga.mensagem}</p>
                <button
                  type="button"
                  className="botao-secundario"
                  onClick={recarregar}
                >
                  Tentar novamente
                </button>
              </div>
            ) : estoque !== null && estoque.total === 0 ? (
              <p className="st-nota">
                {pesquisa === ""
                  ? "Nenhum palete no estoque consultado."
                  : `Nada encontrado para “${pesquisa}”.`}
              </p>
            ) : (
              <>
                <p className="st-nota" data-testid="st-total">
                  {estoque?.total.toLocaleString("pt-BR")} palete
                  {estoque?.total === 1 ? "" : "s"}
                  {pesquisa === ""
                    ? " no estoque"
                    : ` encontrado${estoque?.total === 1 ? "" : "s"}`}
                </p>
                <ul className="st-paletes">
                  {estoque?.rows.map((p) => (
                    <LinhaPalete
                      key={p.palletId}
                      p={p}
                      naSelecao={(carrinho?.items ?? []).some(
                        (i) => i.palletId === p.palletId,
                      )}
                      aoAbrir={() => {
                        setPaleteAberto(p.palletId);
                      }}
                    />
                  ))}
                </ul>
                {paginas > 1 && (
                  <nav className="st-paginacao" aria-label="Páginas">
                    <button
                      type="button"
                      className="botao-secundario"
                      disabled={pagina <= 1}
                      onClick={() => {
                        setPagina((n) => n - 1);
                      }}
                    >
                      Anterior
                    </button>
                    <span>
                      Página {pagina} de {paginas}
                    </span>
                    <button
                      type="button"
                      className="botao-secundario"
                      disabled={pagina >= paginas}
                      onClick={() => {
                        setPagina((n) => n + 1);
                      }}
                    >
                      Próxima
                    </button>
                  </nav>
                )}
              </>
            )}
          </section>

          <div className="st-lateral">
            <ResumoCarrinho
              solicitacao={carrinho}
              erroCarga={cargaSol?.estado === "erro" ? cargaSol.mensagem : null}
              aviso={aviso}
              aoRecarregar={recarregarSol}
              aoAtualizar={(s, texto) => {
                setLocal(s);
                setAviso(texto);
              }}
              aoRevisar={() => {
                if (carrinho !== null)
                  aoNavegar({
                    tipo: "selecao-teste-solicitacao",
                    id: carrinho.id,
                  });
              }}
            />
            {podeVerMapa && (
              <button
                type="button"
                className="botao-secundario st-ver-mapa"
                onClick={() => {
                  setMapaAberto(true);
                }}
                data-testid="st-ver-mapa"
              >
                <IconeMapa />
                Ver mapa
              </button>
            )}
          </div>
        </div>
      </div>

      {mapaAberto && (
        <div className="st-mapa-camada">
          <Suspense
            fallback={
              <p className="st-nota" role="status">
                Carregando o mapa…
              </p>
            }
          >
            <MapaConsultaTeste
              aoEscolherPalete={(id) => {
                setPaleteAberto(id);
              }}
              aoVoltar={() => {
                setMapaAberto(false);
              }}
            />
          </Suspense>
        </div>
      )}

      {paleteAberto !== null && (
        <JanelaPaleteTeste
          key={paleteAberto}
          paleteId={paleteAberto}
          solicitacao={carrinho}
          aoFechar={() => {
            setPaleteAberto(null);
          }}
          aoAdicionar={(s) => {
            setLocal(s);
            setAviso("Adicionado à seleção.");
            setPaleteAberto(null);
          }}
        />
      )}
    </main>
  );
}

function LinhaPalete({
  p,
  naSelecao,
  aoAbrir,
}: {
  p: PaleteEstoqueTeste;
  naSelecao: boolean;
  aoAbrir: () => void;
}) {
  const encontrados = new Set(p.matches.map((m) => `${m.kind}:${m.id}`));
  const docs = p.contents.map((c) => ({
    texto: textoDocumento(c),
    achado: encontrados.has(chaveConteudo(c)),
  }));
  const nomes = remetentes(p.contents);
  const deliveries = [
    ...new Set(
      p.contents.flatMap((c) => (c.delivery === null ? [] : [c.delivery])),
    ),
  ];
  const visiveis = docs.slice(0, 4);
  return (
    <li>
      <button
        type="button"
        className="st-palete"
        onClick={aoAbrir}
        data-testid="st-palete"
        data-codigo={p.palletCode}
      >
        <span className="st-palete-topo">
          <strong>{p.palletCode}</strong>
          <span className="st-chip">{TIPO_PALETE[p.palletType].rotulo}</span>
          {naSelecao && (
            <span className="st-chip st-chip--selecionado">Na seleção</span>
          )}
          <span className="st-palete-volumes">
            {p.contents.length === 0
              ? 'Conteúdo não identificado'
              : `${String(p.contents.length)} nota${p.contents.length === 1 ? '' : 's'} · ${textoVolumesPalete(p.contents.length, p.volumes.known, p.volumes.unknownContents)}`}
          </span>
        </span>
        <span className="st-palete-docs">
          {visiveis.map((d, i) => (
            <span
              key={`${d.texto}-${String(i)}`}
              className={d.achado ? "st-achado" : undefined}
            >
              {d.texto}
            </span>
          ))}
          {docs.length > visiveis.length && (
            <span className="st-nota">+{docs.length - visiveis.length}</span>
          )}
        </span>
        {nomes.length > 0 && (
          <span className="st-palete-linha">
            Remetente: {nomes.slice(0, 2).join(", ")}
            {nomes.length > 2 ? ` e mais ${String(nomes.length - 2)}` : ""}
          </span>
        )}
        {deliveries.length > 0 && (
          <span className="st-palete-linha">
            Delivery: {deliveries.slice(0, 3).join(", ")}
            {deliveries.length > 3 ? "…" : ""}
          </span>
        )}
      </button>
    </li>
  );
}

function ResumoCarrinho({
  solicitacao,
  erroCarga,
  aviso,
  aoRecarregar,
  aoAtualizar,
  aoRevisar,
}: {
  solicitacao: SolicitacaoTeste | null;
  erroCarga: string | null;
  aviso: string | null;
  aoRecarregar: () => void;
  aoAtualizar: (s: SolicitacaoTeste, aviso: string | null) => void;
  aoRevisar: () => void;
}) {
  const chaves = useChaves();
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function remover(itemId: string) {
    if (solicitacao === null) return;
    const assinatura = `remover:${solicitacao.id}:${itemId}:${String(solicitacao.version)}`;
    setRemovendo(itemId);
    setErro(null);
    try {
      const s = await enviarJson(
        "POST",
        `${API_TESTE}/solicitacoes/${solicitacao.id}/itens/${itemId}/remocao`,
        SolicitacaoTesteSchema,
        {
          corpo: { expectedVersion: solicitacao.version },
          idempotencia: chaves.para(assinatura),
          descricao: "Retirar da seleção (teste)",
        },
      );
      chaves.concluir(assinatura);
      aoAtualizar(s, "Item retirado da seleção.");
    } catch (falha) {
      chaves.concluir(assinatura, falha);
      setErro(mensagemDeFalha(falha));
    } finally {
      setRemovendo(null);
    }
  }

  return (
    <aside
      className="st-carrinho"
      aria-label="Sua seleção"
      data-testid="st-carrinho"
    >
      <h3>Sua seleção</h3>
      {erroCarga !== null ? (
        <div className="estado-erro" role="alert">
          <p>{erroCarga}</p>
          <button
            type="button"
            className="botao-secundario"
            onClick={aoRecarregar}
          >
            Tentar novamente
          </button>
        </div>
      ) : solicitacao === null ? (
        <p className="st-nota">
          Escolha a agenda para começar. Depois abra um palete e use “Adicionar
          à seleção”.
        </p>
      ) : solicitacao.items.length === 0 ? (
        <p className="st-nota">
          Nada escolhido ainda. Abra um palete na lista (ou no mapa) e use
          “Adicionar à seleção”.
        </p>
      ) : (
        <>
          <ul className="st-carrinho-itens">
            {solicitacao.items.map((i) => (
              <li key={i.id} data-testid="st-item-carrinho">
                <span>
                  <strong>{i.palletCode}</strong> ·{" "}
                  {i.scope === "PALETE"
                    ? "palete inteiro"
                    : textoDocumento(i.content)}
                  {i.requestedDelivery !== null &&
                    ` · Delivery ${i.requestedDelivery}`}
                  <br />
                  <span className={i.needsAnalysis ? "st-analise" : undefined}>
                    {textoPedido(i)}
                  </span>
                  {i.note !== null && (
                    <span className="st-nota"> · Obs.: {i.note}</span>
                  )}
                </span>
                <button
                  type="button"
                  className="botao-link"
                  disabled={removendo !== null}
                  onClick={() => void remover(i.id)}
                  aria-label={`Retirar ${i.palletCode}`}
                >
                  {removendo === i.id ? "Retirando…" : "Retirar"}
                </button>
              </li>
            ))}
          </ul>
          <p className="st-total" data-testid="st-total-carrinho">
            Total com quantidade definida:{" "}
            <strong>{textoVolumes(solicitacao.totals.definedVolumes)}</strong>
          </p>
          {solicitacao.totals.itemsInAnalysis > 0 && (
            <p className="st-aviso-suave">
              {solicitacao.totals.itemsInAnalysis} item
              {solicitacao.totals.itemsInAnalysis === 1 ? "" : "s"} sem
              quantidade definida: a operação analisa (fora do total).
            </p>
          )}
        </>
      )}
      {aviso !== null && (
        <p className="mensagem-ok" role="status">
          {aviso}
        </p>
      )}
      {erro !== null && (
        <p className="estado-erro" role="alert">
          {erro}
        </p>
      )}
      <button
        type="button"
        className="botao-primario"
        disabled={solicitacao === null || solicitacao.items.length === 0}
        onClick={aoRevisar}
        data-testid="st-revisar"
      >
        Revisar seleção
      </button>
    </aside>
  );
}
