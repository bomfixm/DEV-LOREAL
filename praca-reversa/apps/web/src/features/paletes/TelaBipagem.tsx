import {
  API_PREFIXO,
  ListaPaletesSchema,
  LoteImportacaoSchema,
  ParametrosBipagemSchema,
  PracaSchema,
  ROTULOS_ACAO_DOCUMENTO_BIPAGEM,
  ResultadoConfirmacaoSchema,
  ResultadoEnvioSchema,
  type DecisaoBipagem,
  type DestinoBipagem,
  type DocumentoBipagem,
  type ParametrosBipagem,
  type ResumoBipagem,
  type Sessao,
} from "@praca-reversa/contracts";
import { useId, useRef, useState } from "react";
import { useChaves } from "../../api/chaves";
import {
  FalhaRequisicao,
  enviarArquivo,
  enviarJson,
  mensagemDeFalha,
} from "../../api/cliente";
import { useRecurso } from "../../api/use-recurso";
import {
  IconeAtualizar,
  IconeMais,
  IconeMenos,
  IconeVoltar,
} from "../../components/Icones";
import { useConectado } from "../../hooks/ambiente";
import type { Navegar } from "../../rotas";
import { formatarDataHora } from "../../utils/datas";
import type { MargensMapa } from "../mapa/controlador-mapa";
import { MapaPraca, type MapaPracaHandle } from "../mapa/MapaPraca";
import "./bipagem.css";

/**
 * Importar a bipagem "Etiquetas" (21 out. 2026, D283–D288): um arquivo = um
 * palete. 1) Enviar o Excel (lido sozinho: Tipo, Número, Lidos, Remetente;
 * CNPJ e Última Leitura se houver). 2) Conferir a prévia. 3) Escolher no mapa
 * onde o palete está: posição livre = palete novo (número gerado ao
 * confirmar); palete existente = as notas são acrescentadas. 4) Resolver notas
 * repetidas (Revalidar ou Importar separadamente) e confirmar. Nada é gravado
 * antes da confirmação. Aberta pelo palete (atalho), o destino já vem escolhido.
 */
interface Props {
  /** Palete aberto (atalho da janela do palete); `null` = começa pelo arquivo e escolhe no mapa. */
  paleteId: string | null;
  sessao: Sessao;
  aoNavegar: Navegar;
  /** Depois de uma gravação confirmada: mapa, lista e detalhe consultam de novo. */
  aoGravar: () => void;
}

type Aviso = {
  tipo: "ok" | "erro" | "conflito";
  texto: string;
  incerto?: boolean;
} | null;
const MB = 1_048_576;
const PERGUNTA_ACRESCENTAR = 'Este palete já contém notas. Deseja acrescentar os conteúdos desta importação?';
const POR_VEZ = 100;
const MARGENS: MargensMapa = { topo: 12, direita: 56, base: 12, esquerda: 12 };
const plural = (n: number, um: string, varios: string) =>
  `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
const dataLeitura = (iso: string | null) =>
  iso === null
    ? "—"
    : `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}${iso.length > 10 ? ` ${iso.slice(11, 16)}` : ""}`;

function MensagemAviso({
  aviso,
  aoReenviar,
  testId,
}: {
  aviso: Aviso;
  aoReenviar?: () => void;
  testId: string;
}) {
  if (aviso === null) return null;
  return (
    <div
      className={
        aviso.tipo === "ok"
          ? "mensagem-ok"
          : aviso.tipo === "conflito"
            ? "mensagem-conflito"
            : "estado-erro"
      }
      role={aviso.tipo === "ok" ? "status" : "alert"}
      data-testid={testId}
    >
      <p>{aviso.texto}</p>
      {aviso.incerto && aoReenviar && (
        <button type="button" className="botao-secundario" onClick={aoReenviar}>
          Reenviar com a mesma chave (não duplica)
        </button>
      )}
    </div>
  );
}

/** 1. Enviar o arquivo; o servidor lê, reconhece as colunas e devolve a prévia (nada é gravado). */
function EnvioArquivo({
  paleteId,
  aoCriado,
}: {
  paleteId: string | null;
  aoCriado: (loteId: string) => void;
}) {
  const ids = useId();
  const chaves = useChaves();
  const conectado = useConectado();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);

  async function enviar() {
    if (!arquivo) return;
    const assinatura = `bipagem:${paleteId ?? "mapa"}:${arquivo.name}:${String(arquivo.size)}:${String(arquivo.lastModified)}`;
    setEnviando(true);
    setAviso(null);
    try {
      const r = await enviarArquivo(
        `${API_PREFIXO}/importacoes?tipo=BIPAGEM${paleteId === null ? "" : `&palete=${paleteId}`}`,
        arquivo,
        arquivo.name,
        ResultadoEnvioSchema,
        chaves.para(assinatura),
      );
      chaves.concluir(assinatura);
      if (r.batch) aoCriado(r.batch.id);
    } catch (e) {
      chaves.concluir(assinatura, e);
      setAviso({
        tipo:
          e instanceof FalhaRequisicao && e.tipo === "rede"
            ? "conflito"
            : "erro",
        texto: mensagemDeFalha(e),
        incerto: e instanceof FalhaRequisicao && e.tipo === "rede",
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section
      className="cartao"
      aria-labelledby={`${ids}-titulo`}
      data-testid="bipagem-envio"
    >
      <h3 id={`${ids}-titulo`}>1. Arquivo da bipagem</h3>
      <p className="campo-ajuda">
        Exporte a bipagem de <strong>um palete</strong> (planilha “Etiquetas”,
        .xlsx). O aplicativo lê sozinho Tipo, Número, Lidos e Remetente (e CNPJ
        e Última Leitura, se houver). As outras colunas não são usadas.
      </p>
      <label className="campo">
        <span className="campo-rotulo">Arquivo</span>
        <input
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            setArquivo(e.target.files?.[0] ?? null);
            setAviso(null);
          }}
          data-testid="bipagem-arquivo"
        />
        {arquivo && (
          <span className="campo-ajuda">
            {arquivo.name} · {(arquivo.size / MB).toFixed(2)} MB
          </span>
        )}
      </label>
      <MensagemAviso
        aviso={aviso}
        aoReenviar={() => {
          void enviar();
        }}
        testId="bipagem-aviso-envio"
      />
      <div className="acoes-linha">
        <button
          type="button"
          className="botao-primario"
          disabled={!arquivo || enviando || !conectado}
          onClick={() => {
            void enviar();
          }}
          data-testid="bipagem-enviar"
        >
          {enviando ? "Lendo o arquivo…" : "Ler arquivo"}
        </button>
      </div>
      {!conectado && (
        <p className="mensagem-conflito">
          Sem conexão: o arquivo só é lido com resposta do servidor.
        </p>
      )}
    </section>
  );
}

/** 2. Prévia objetiva: notas, remetentes, volumes e total; o resto sob demanda. */
function Previa({ resumo }: { resumo: ResumoBipagem }) {
  const ids = useId();
  const [mostrar, setMostrar] = useState(POR_VEZ);
  const c = resumo.counters;
  const aceitas = resumo.documents.filter(
    (d) => d.action === "NOVO" || d.action === "IMPORTAR_SEPARADO",
  );
  const revalidadas = resumo.documents.filter((d) => d.action === "REVALIDADO");
  return (
    <section
      className="cartao"
      aria-labelledby={`${ids}-titulo`}
      data-testid="bipagem-previa"
    >
      <h3 id={`${ids}-titulo`}>2. O que veio no arquivo</h3>
      <ul className="bipagem-contadores" data-testid="bipagem-totais">
        <li data-testid="bipagem-aceitas">
          <span className="bipagem-contador-valor">
            {c.accepted.toLocaleString("pt-BR")}
          </span>
          <span className="bipagem-contador-rotulo">notas a importar</span>
        </li>
        <li data-testid="bipagem-volumes">
          <span className="bipagem-contador-valor">
            {c.volumesToAdd.toLocaleString("pt-BR")}
          </span>
          <span className="bipagem-contador-rotulo">volumes</span>
        </li>
        <li data-testid="bipagem-sem-leitura">
          <span className="bipagem-contador-valor">
            {c.withoutReads.toLocaleString("pt-BR")}
          </span>
          <span className="bipagem-contador-rotulo">linhas sem volumes</span>
        </li>
        {c.rowsWithErrors > 0 && (
          <li
            className="bipagem-contador--atencao"
            data-testid="bipagem-pendencias"
          >
            <span className="bipagem-contador-valor">{c.rowsWithErrors}</span>
            <span className="bipagem-contador-rotulo">pendências</span>
          </li>
        )}
        {c.awaitingDecision > 0 && (
          <li
            className="bipagem-contador--atencao"
            data-testid="bipagem-aguardando"
          >
            <span className="bipagem-contador-valor">{c.awaitingDecision}</span>
            <span className="bipagem-contador-rotulo">
              notas repetidas para decidir
            </span>
          </li>
        )}
        {c.revalidated > 0 && (
          <li data-testid="bipagem-revalidadas">
            <span className="bipagem-contador-valor">{c.revalidated}</span>
            <span className="bipagem-contador-rotulo">
              revalidadas (não entram)
            </span>
          </li>
        )}
      </ul>

      {resumo.errors.length > 0 && (
        <div className="estado-erro" role="alert" data-testid="bipagem-erros">
          <p>
            <strong>Pendências</strong> — estas linhas impedem a importação.
            Exporte a bipagem de novo no padrão e envie outra vez:
          </p>
          <ul>
            {resumo.errors.slice(0, 50).map((e) => (
              <li key={e.row}>
                Linha {e.row}: {e.messages.join(" ")}
              </li>
            ))}
            {resumo.errors.length > 50 && (
              <li>… e mais {resumo.errors.length - 50}.</li>
            )}
          </ul>
        </div>
      )}

      <div
        className="bipagem-rolagem"
        role="region"
        aria-label="Notas com volumes lidos"
        tabIndex={0}
      >
        <table className="bipagem-tabela" data-testid="bipagem-documentos">
          <caption>Notas com volumes lidos ({resumo.documents.length})</caption>
          <thead>
            <tr>
              <th scope="col">Tipo</th>
              <th scope="col">Número</th>
              <th scope="col">Remetente</th>
              <th scope="col" className="numero">
                Volumes
              </th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {resumo.documents.slice(0, mostrar).map((d) => (
              <tr
                key={d.row}
                data-testid="bipagem-documento"
                data-documento={`${d.type} ${d.number}`}
                data-acao={d.action}
              >
                <td>{d.type}</td>
                <td>{d.number}</td>
                <td>{d.sender}</td>
                <td className="numero">{d.volumes}</td>
                <td>
                  <span
                    className={`bipagem-situacao bipagem-situacao--${d.action}`}
                  >
                    {ROTULOS_ACAO_DOCUMENTO_BIPAGEM[d.action]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                Total a importar ({plural(aceitas.length, "nota", "notas")})
              </th>
              <td className="numero" data-testid="bipagem-total">
                {c.volumesToAdd.toLocaleString("pt-BR")}
              </td>
              <td>
                {revalidadas.length > 0
                  ? `${String(revalidadas.length)} revalidada(s) fora`
                  : ""}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      {resumo.documents.length > mostrar && (
        <button
          type="button"
          className="botao-link"
          onClick={() => {
            setMostrar((m) => m + POR_VEZ);
          }}
        >
          Mostrar mais {Math.min(POR_VEZ, resumo.documents.length - mostrar)}
        </button>
      )}

      <details className="bipagem-mais" data-testid="bipagem-mais-informacoes">
        <summary>
          Mais informações (CNPJ, Última Leitura, colunas lidas)
        </summary>
        <p className="tabela-nota">
          Colunas lidas{resumo.sheet ? ` (aba ${resumo.sheet})` : ""}:{" "}
          {resumo.columns
            .map(
              (col) =>
                `${col.label} ${col.letter === "—" ? "(não veio)" : `(coluna ${col.letter})`}`,
            )
            .join(" · ")}
          . Última Leitura é o horário da bipagem; não é conferência do palete.
        </p>
        <div
          className="bipagem-rolagem"
          role="region"
          aria-label="Detalhes das notas"
          tabIndex={0}
        >
          <table className="bipagem-tabela">
            <thead>
              <tr>
                <th scope="col">Linha</th>
                <th scope="col">Nota</th>
                <th scope="col">CNPJ do remetente</th>
                <th scope="col">Última Leitura</th>
              </tr>
            </thead>
            <tbody>
              {resumo.documents.slice(0, mostrar).map((d) => (
                <tr key={d.row}>
                  <td>{d.row}</td>
                  <td>
                    {d.type} {d.number}
                  </td>
                  <td>{d.senderCnpj ?? "não informado"}</td>
                  <td>{dataLeitura(d.lastRead)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      {resumo.withoutReads.length > 0 && (
        <details className="bipagem-mais" data-testid="bipagem-zeros">
          <summary>
            {plural(
              resumo.withoutReads.length,
              "linha sem volumes lidos",
              "linhas sem volumes lidos",
            )}{" "}
            (Lidos = 0): não entram no palete
          </summary>
          <ul className="lista-documentos">
            {resumo.withoutReads.map((z) => (
              <li key={z.row}>
                Linha {z.row}: {z.type ?? "?"} {z.number ?? ""} ·{" "}
                {z.sender ?? "remetente não informado"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** 3. Escolher no mapa onde o palete está (posição livre = palete novo; palete = acrescentar). */
function EscolhaNoMapa({
  aoEscolher,
  ocupado,
}: {
  aoEscolher: (d: DestinoBipagem) => void;
  ocupado: boolean;
}) {
  const ids = useId();
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/praca`, PracaSchema);
  const mapa = useRef<MapaPracaHandle>(null);
  const [busca, setBusca] = useState("");
  const termo = busca.trim();
  const lista = useRecurso(
    termo.length >= 2
      ? `${API_PREFIXO}/paletes?texto=${encodeURIComponent(termo)}&limite=10`
      : null,
    ListaPaletesSchema,
  );
  const achados =
    lista.carga?.estado === "pronto"
      ? lista.carga.dados.items.filter((p) => p.flowState !== "EXPEDIDO")
      : [];
  const dados = carga?.estado === "pronto" ? carga.dados : null;
  return (
    <section
      className="cartao"
      aria-labelledby={`${ids}-titulo`}
      data-testid="bipagem-mapa"
    >
      <h3 id={`${ids}-titulo`}>3. Onde está este palete?</h3>
      <p className="campo-ajuda">
        Clique numa <strong>posição vazia</strong> para criar um palete novo (o
        número sai na confirmação) ou num <strong>palete</strong> para
        acrescentar as notas a ele.
      </p>
      <div className="bipagem-mapa-area">
        {carga === null || carga.estado === "carregando" ? (
          <p className="estado-carregando">Carregando o mapa…</p>
        ) : carga.estado === "erro" ? (
          <div className="estado-erro" role="alert">
            <p>{carga.mensagem}</p>
            <button
              type="button"
              className="botao-secundario"
              onClick={recarregar}
            >
              <IconeAtualizar />
              Tentar novamente
            </button>
          </div>
        ) : dados?.layout === null || dados === null ? (
          <p className="estado-vazio">
            Esta praça ainda não tem layout cadastrado: procure o palete pelo
            número abaixo.
          </p>
        ) : (
          <>
            <MapaPraca
              ref={mapa}
              layout={dados.layout}
              paletes={dados.pallets}
              selecionadoId={null}
              idsVisiveis={null}
              margens={MARGENS}
              aoSelecionar={(id) => {
                const p = dados.pallets.find((x) => x.id === id);
                aoEscolher(
                  p?.positionId
                    ? { kind: "POSICAO", id: p.positionId }
                    : { kind: "PALETE", id },
                );
              }}
              aoEscolherPosicao={(id) => {
                aoEscolher({ kind: "POSICAO", id });
              }}
              aoMudarVisao={() => undefined}
            />
            <div className="bipagem-mapa-zoom">
              <button
                type="button"
                className="botao-secundario botao-icone"
                onClick={() => mapa.current?.ampliar()}
                aria-label="Aproximar"
              >
                <IconeMais />
              </button>
              <button
                type="button"
                className="botao-secundario botao-icone"
                onClick={() => mapa.current?.reduzir()}
                aria-label="Afastar"
              >
                <IconeMenos />
              </button>
              <button
                type="button"
                className="botao-secundario"
                onClick={() => mapa.current?.focarPrincipal()}
              >
                Focar L’Oréal
              </button>
            </div>
          </>
        )}
      </div>
      <label className="campo">
        <span className="campo-rotulo">
          Ou procure um palete existente pelo número
        </span>
        <input
          type="search"
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
          }}
          placeholder="Ex.: 279, PR-000123 ou 15 - A120"
          data-testid="bipagem-busca-palete"
        />
      </label>
      {termo.length >= 2 &&
        lista.carga?.estado === "pronto" &&
        achados.length === 0 && (
          <p className="campo-ajuda">Nenhum palete encontrado.</p>
        )}
      <ul className="lista-documentos">
        {achados.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="botao-link"
              onClick={() => {
                aoEscolher(
                  p.positionId
                    ? { kind: "POSICAO", id: p.positionId }
                    : { kind: "PALETE", id: p.id },
                );
              }}
            >
              Palete {p.code}
              {p.informedAddress
                ? ` · ${p.informedAddress}`
                : p.positionCode
                  ? ` · posição ${p.positionCode}`
                  : ""}
            </button>
          </li>
        ))}
      </ul>
      {ocupado && (
        <p className="tabela-nota">
          Novo número não pode ser digitado: ele é gerado pelo sistema na
          confirmação.
        </p>
      )}
    </section>
  );
}

/** Notas repetidas: existente e proposta lado a lado, com a escolha e o efeito de cada uma. */
function Coincidencias({
  documentos,
  aoDecidir,
  ocupado,
}: {
  documentos: readonly DocumentoBipagem[];
  aoDecidir: (linhas: readonly number[], d: DecisaoBipagem) => void;
  ocupado: boolean;
}) {
  if (documentos.length === 0) return null;
  return (
    <div className="bipagem-coincidencias" data-testid="bipagem-coincidencias">
      <h4>Notas repetidas ({documentos.length})</h4>
      <p className="campo-ajuda">
        Mesma nota (tipo, número, CNPJ e remetente) já está no palete ou em
        outra linha deste arquivo. Nada é somado nem substituído: escolha o que
        fazer com a linha deste envio.
      </p>
      {documentos.length > 1 && (
        <div className="acoes-linha">
          <button
            type="button"
            className="botao-secundario"
            disabled={ocupado}
            onClick={() => {
              aoDecidir(
                documentos.map((d) => d.row),
                "REVALIDAR",
              );
            }}
            data-testid="bipagem-revalidar-todas"
          >
            Revalidar todas
          </button>
          <button
            type="button"
            className="botao-secundario"
            disabled={ocupado}
            onClick={() => {
              aoDecidir(
                documentos.map((d) => d.row),
                "IMPORTAR_SEPARADO",
              );
            }}
            data-testid="bipagem-separar-todas"
          >
            Importar todas separadamente
          </button>
        </div>
      )}
      {documentos.map((d) => {
        const existente = d.matches[0];
        const antes = existente?.volumes ?? null;
        return (
          <fieldset
            key={d.row}
            className="bipagem-coincidencia"
            data-testid="bipagem-coincidencia"
            data-linha={d.row}
          >
            <legend>
              {d.type} {d.number} · {d.sender}
            </legend>
            <div className="bipagem-lado-a-lado">
              <div>
                <p className="bipagem-lado-rotulo">Já registrada</p>
                {d.matches.map((m) => (
                  <p
                    key={`${m.source}:${m.row === null ? (m.target?.id ?? "") : String(m.row)}`}
                  >
                    {m.documentType ?? "?"} {m.documentNumber ?? ""} ·{" "}
                    {m.sender ?? "remetente não informado"} · CNPJ{" "}
                    {m.senderCnpj ?? "não informado"} ·{" "}
                    <strong>
                      {m.volumes === null
                        ? "volumes não informados"
                        : plural(m.volumes, "volume", "volumes")}
                    </strong>
                    <span className="tabela-nota">
                      {" "}
                      (
                      {m.source === "PALETE"
                        ? `no palete: ${m.origin}`
                        : m.origin}
                      )
                    </span>
                  </p>
                ))}
              </div>
              <div>
                <p className="bipagem-lado-rotulo">
                  Neste envio (linha {d.row})
                </p>
                <p>
                  {d.type} {d.number} · {d.sender} · CNPJ{" "}
                  {d.senderCnpj ?? "não informado"} ·{" "}
                  <strong>{plural(d.volumes, "volume", "volumes")}</strong>
                </p>
              </div>
            </div>
            {d.matches.some((m) => m.incomplete) && (
              <p className="mensagem-conflito">
                Identificação incompleta (falta CNPJ ou remetente): não dá para
                afirmar que é a mesma nota. Decida.
              </p>
            )}
            <label className="opcao">
              <input
                type="radio"
                name={`decisao-${String(d.row)}`}
                checked={d.decision === "REVALIDAR"}
                disabled={ocupado}
                onChange={() => {
                  aoDecidir([d.row], "REVALIDAR");
                }}
                data-testid="bipagem-revalidar"
              />
              <span>
                <strong>Revalidar</strong> — mantém a já registrada
                {antes === null
                  ? ""
                  : ` (${plural(antes, "volume", "volumes")})`}
                ; os {d.volumes} deste envio não entram.
              </span>
            </label>
            <label className="opcao">
              <input
                type="radio"
                name={`decisao-${String(d.row)}`}
                checked={d.decision === "IMPORTAR_SEPARADO"}
                disabled={ocupado}
                onChange={() => {
                  aoDecidir([d.row], "IMPORTAR_SEPARADO");
                }}
                data-testid="bipagem-separar"
              />
              <span>
                <strong>Importar separadamente</strong> — nova entrada com{" "}
                {plural(d.volumes, "volume", "volumes")}; a já registrada não
                muda e as duas contam
                {antes === null
                  ? ""
                  : ` (${String(antes)} + ${String(d.volumes)} = ${String(antes + d.volumes)})`}
                .
              </span>
            </label>
          </fieldset>
        );
      })}
    </div>
  );
}

export function TelaBipagem({ paleteId, sessao, aoNavegar, aoGravar }: Props) {
  const ids = useId();
  const chaves = useChaves();
  const conectado = useConectado();
  const podeExecutar = sessao.permissions.includes("palete.cadastrar");
  const [loteId, setLoteId] = useState<string | null>(null);
  const [versaoLote, setVersaoLote] = useState(0);
  const [trocandoDestino, setTrocandoDestino] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [cancelando, setCancelando] = useState(false);
  const cargaLote = useRecurso(
    loteId === null ? null : `${API_PREFIXO}/importacoes/${loteId}`,
    LoteImportacaoSchema,
    versaoLote,
  );
  const lote =
    cargaLote.carga?.estado === "pronto" ? cargaLote.carga.dados : null;
  const resumo = lote?.palletImport ?? null;
  const destino = resumo?.destination ?? null;
  const atualizar = () => {
    setVersaoLote((v) => v + 1);
  };
  const voltar = () => {
    if (paleteId !== null) aoNavegar({ tipo: "palete", id: paleteId });
    else aoNavegar({ tipo: "praca" });
  };

  /** Destino, decisões e nova operação: o servidor refaz a prévia (nada é gravado). */
  async function aplicar(mudanca: Partial<ParametrosBipagem>): Promise<void> {
    if (!lote) return;
    const atual = ParametrosBipagemSchema.parse(lote.parameters ?? {});
    const parametros: ParametrosBipagem = { ...atual, ...mudanca };
    const corpo = {
      expectedVersion: lote.version,
      options: lote.options ?? {
        sheet: null,
        headerRow: 1,
        encoding: null,
        delimiter: null,
      },
      decimalSeparator: "VIRGULA" as const,
      columns: {},
      parameters: parametros,
    };
    const assinatura = `bipagem-previa:${lote.id}:${JSON.stringify(corpo)}`;
    setEnviando(true);
    setAviso(null);
    try {
      await enviarJson(
        "PUT",
        `${API_PREFIXO}/importacoes/${lote.id}/mapeamento`,
        LoteImportacaoSchema,
        { corpo, idempotencia: chaves.para(assinatura) },
      );
      chaves.concluir(assinatura);
      setTrocandoDestino(false);
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      setAviso({
        tipo:
          erro instanceof FalhaRequisicao &&
          (erro.tipo === "rede" || erro.codigo === "CONFLITO_VERSAO")
            ? "conflito"
            : "erro",
        texto: mensagemDeFalha(erro),
      });
    } finally {
      setEnviando(false);
      atualizar();
    }
  }

  function decidir(linhas: readonly number[], decisao: DecisaoBipagem) {
    if (!lote) return;
    const atuais = ParametrosBipagemSchema.parse(
      lote.parameters ?? {},
    ).decisions.filter((d) => !linhas.includes(d.row));
    void aplicar({
      decisions: [
        ...atuais,
        ...linhas.map((row) => ({ row, decision: decisao })),
      ],
    });
  }

  async function confirmar() {
    if (!lote) return;
    const corpo = {
      previewVersion: lote.previewVersion,
      reviewed: true as const,
    };
    const assinatura = `bipagem-confirmar:${lote.id}:${String(lote.previewVersion)}`;
    setEnviando(true);
    setAviso(null);
    try {
      const r = await enviarJson(
        "POST",
        `${API_PREFIXO}/importacoes/${lote.id}/confirmar`,
        ResultadoConfirmacaoSchema,
        { corpo, idempotencia: chaves.para(assinatura) },
      );
      chaves.concluir(assinatura);
      setAviso(
        r.alreadyConfirmed
          ? {
              tipo: "ok",
              texto:
                "Esta importação já estava gravada: nada foi adicionado de novo.",
            }
          : null,
      );
      aoGravar();
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      const incerto = erro instanceof FalhaRequisicao && erro.tipo === "rede";
      const codigo = erro instanceof FalhaRequisicao ? erro.codigo : null;
      if (incerto)
        setAviso({
          tipo: "conflito",
          texto:
            "Sem resposta do servidor: não se sabe se a importação foi gravada. Reenvie com a mesma chave (não duplica).",
          incerto: true,
        });
      else if (
        codigo === "PREVIA_DESATUALIZADA" ||
        codigo === "IMPORTACAO_BLOQUEADA"
      )
        setAviso({
          tipo: "conflito",
          texto: `${mensagemDeFalha(erro)} A prévia foi atualizada (por exemplo, a posição foi ocupada por outra pessoa): confira antes de confirmar.`,
        });
      else if (
        erro instanceof FalhaRequisicao &&
        erro.status !== null &&
        erro.status >= 500
      )
        setAviso({
          tipo: "erro",
          texto: `A gravação falhou e foi desfeita: nada deste arquivo foi gravado. ${mensagemDeFalha(erro)}`,
        });
      else setAviso({ tipo: "erro", texto: mensagemDeFalha(erro) });
    } finally {
      setEnviando(false);
      atualizar();
    }
  }

  async function cancelar() {
    if (!lote) return;
    const assinatura = `bipagem-cancelar:${lote.id}:${String(lote.version)}`;
    setEnviando(true);
    setAviso(null);
    try {
      await enviarJson(
        "POST",
        `${API_PREFIXO}/importacoes/${lote.id}/descartar`,
        LoteImportacaoSchema,
        {
          corpo: { expectedVersion: lote.version },
          idempotencia: chaves.para(assinatura),
        },
      );
      chaves.concluir(assinatura);
      setCancelando(false);
      setAviso({
        tipo: "ok",
        texto: "Importação cancelada: nada foi gravado.",
      });
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      setAviso({ tipo: "erro", texto: mensagemDeFalha(erro) });
    } finally {
      setEnviando(false);
      atualizar();
    }
  }

  const outroArquivo = () => {
    setLoteId(null);
    setAviso(null);
    setCancelando(false);
    setTrocandoDestino(false);
  };
  const decidirMapa = !destino || trocandoDestino;
  const repetidas = resumo?.documents.filter((d) => d.matches.length > 0) ?? [];
  const parametros = lote
    ? ParametrosBipagemSchema.safeParse(lote.parameters ?? {})
    : null;
  const novaOperacao =
    parametros?.success === true && parametros.data.newOperation;

  return (
    <main className="principal principal--pagina" data-testid="tela-bipagem">
      <div className="pagina-conteudo bipagem-pagina">
        <header className="pagina-topo">
          <h2>Importar bipagem</h2>
          <div className="pagina-descricao">
            <p>
              Um arquivo por palete: envie o Excel, confira as notas, escolha no
              mapa onde o palete está e confirme.
            </p>
          </div>
          <button
            type="button"
            className="botao-secundario"
            onClick={voltar}
            data-testid="bipagem-voltar"
          >
            <IconeVoltar />
            {paleteId === null ? "Voltar ao mapa" : "Voltar ao palete"}
          </button>
        </header>

        {!podeExecutar ? (
          <p className="estado-erro">
            Seu perfil não pode importar conteúdo para paletes neste escopo.
          </p>
        ) : loteId === null ? (
          <EnvioArquivo
            paleteId={paleteId}
            aoCriado={(novo) => {
              setLoteId(novo);
              setAviso(null);
            }}
          />
        ) : (
          <>
            {cargaLote.carga?.estado === "erro" && lote === null && (
              <div className="estado-erro" role="alert">
                <p>
                  Não foi possível carregar a importação.{" "}
                  {cargaLote.carga.mensagem}
                </p>
                <button
                  type="button"
                  className="botao-secundario"
                  onClick={cargaLote.recarregar}
                >
                  <IconeAtualizar />
                  Tentar novamente
                </button>
              </div>
            )}
            {lote === null && cargaLote.carga?.estado !== "erro" && (
              <p className="estado-carregando">Carregando a importação…</p>
            )}
            {lote && (
              <p className="tabela-nota" data-testid="bipagem-lote">
                Arquivo <strong>{lote.fileName}</strong> (
                {(lote.fileSize / 1024).toFixed(1)} KB) · enviado em{" "}
                {formatarDataHora(lote.createdAt)}
                {lote.createdBy ? ` por ${lote.createdBy.name}` : ""}
              </p>
            )}
            {lote?.state === "PREVIA" && resumo && (
              <>
                <Previa resumo={resumo} />
                {decidirMapa ? (
                  <EscolhaNoMapa
                    aoEscolher={(d) => {
                      void aplicar({ destination: d });
                    }}
                    ocupado={enviando}
                  />
                ) : (
                  <section
                    className="cartao"
                    aria-labelledby={`${ids}-destino`}
                    data-testid="bipagem-destino"
                  >
                    <h3 id={`${ids}-destino`}>3. Destino</h3>
                    {destino.kind === "NOVO_PALETE" ? (
                      <p data-testid="bipagem-destino-resumo">
                        <strong>Palete novo</strong> em{" "}
                        <strong>
                          {destino.position?.address ??
                            destino.position?.code ??
                            "?"}
                        </strong>{" "}
                        · número: <strong>gerado ao confirmar</strong>.
                      </p>
                    ) : (
                      <>
                        <p
                          className="mensagem-conflito"
                          data-testid="bipagem-destino-resumo"
                        >
                          {PERGUNTA_ACRESCENTAR}
                        </p>
                        <dl className="bipagem-destino-dados">
                          <div>
                            <dt>Palete</dt>
                            <dd data-testid="bipagem-destino-codigo">
                              {destino.pallet?.code ?? "?"}
                            </dd>
                          </div>
                          <div>
                            <dt>Endereço</dt>
                            <dd>
                              {destino.pallet?.address ??
                                destino.position?.address ??
                                destino.position?.code ??
                                "não informado"}
                            </dd>
                          </div>
                          <div>
                            <dt>Já tem</dt>
                            <dd>
                              {plural(destino.currentEntries, "nota", "notas")}{" "}
                              ·{" "}
                              {plural(
                                destino.currentVolumes,
                                "volume",
                                "volumes",
                              )}
                              {destino.currentUnknown > 0
                                ? ` (+${String(destino.currentUnknown)} sem contagem)`
                                : ""}
                            </dd>
                          </div>
                          <div>
                            <dt>Vai receber</dt>
                            <dd data-testid="bipagem-destino-adicionar">
                              {plural(
                                resumo.counters.accepted,
                                "nota",
                                "notas",
                              )}{" "}
                              ·{" "}
                              {plural(
                                resumo.counters.volumesToAdd,
                                "volume",
                                "volumes",
                              )}
                            </dd>
                          </div>
                        </dl>
                      </>
                    )}
                    {destino.blocked && (
                      <p className="estado-erro">{destino.blocked}</p>
                    )}
                    <button
                      type="button"
                      className="botao-link"
                      onClick={() => {
                        setTrocandoDestino(true);
                      }}
                      data-testid="bipagem-trocar-destino"
                    >
                      Escolher outro lugar
                    </button>
                  </section>
                )}

                <section
                  className="cartao"
                  aria-labelledby={`${ids}-confirmar`}
                  data-testid="bipagem-confirmar"
                >
                  <h3 id={`${ids}-confirmar`}>4. Revisar e confirmar</h3>
                  {resumo.previousImports.length > 0 && (
                    <div
                      className="mensagem-conflito"
                      data-testid="bipagem-ja-importado"
                    >
                      <p>
                        Este mesmo arquivo já foi importado:{" "}
                        {resumo.previousImports
                          .map(
                            (p) =>
                              `${formatarDataHora(p.at)}${p.palletCode ? ` no palete ${p.palletCode}` : ""}${p.by ? ` por ${p.by}` : ""}`,
                          )
                          .join("; ")}
                        .
                      </p>
                      <label className="opcao">
                        <input
                          type="checkbox"
                          checked={novaOperacao}
                          disabled={enviando}
                          onChange={(e) => {
                            void aplicar({ newOperation: e.target.checked });
                          }}
                          data-testid="bipagem-nova-operacao"
                        />
                        É uma nova operação: importar de novo (as notas
                        repetidas ainda pedem escolha)
                      </label>
                    </div>
                  )}
                  <Coincidencias
                    documentos={repetidas}
                    aoDecidir={decidir}
                    ocupado={enviando}
                  />
                  {lote.blockReason && destino !== null && (
                    <p
                      className="mensagem-conflito"
                      role="alert"
                      data-testid="bipagem-bloqueio"
                    >
                      {lote.blockReason}
                    </p>
                  )}
                  <MensagemAviso
                    aviso={aviso}
                    aoReenviar={() => {
                      void confirmar();
                    }}
                    testId="bipagem-aviso"
                  />
                  <div className="acoes-linha">
                    <button
                      type="button"
                      className="botao-primario"
                      disabled={!lote.canConfirm || enviando || !conectado}
                      onClick={() => {
                        void confirmar();
                      }}
                      data-testid="bipagem-importar"
                    >
                      {enviando
                        ? "Gravando…"
                        : destino?.kind === "NOVO_PALETE"
                          ? "Criar o palete e importar"
                          : "Acrescentar ao palete"}
                    </button>
                    {!cancelando ? (
                      <button
                        type="button"
                        className="botao-link"
                        onClick={() => {
                          setCancelando(true);
                        }}
                        data-testid="bipagem-cancelar"
                      >
                        Cancelar…
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="botao-perigo"
                          disabled={enviando}
                          onClick={() => {
                            void cancelar();
                          }}
                          data-testid="bipagem-cancelar-confirmar"
                        >
                          Cancelar sem gravar
                        </button>
                        <button
                          type="button"
                          className="botao-link"
                          onClick={() => {
                            setCancelando(false);
                          }}
                        >
                          Continuar
                        </button>
                      </>
                    )}
                  </div>
                  {!conectado && (
                    <p className="mensagem-conflito">
                      Sem conexão: a importação só é gravada com resposta do
                      servidor.
                    </p>
                  )}
                </section>
              </>
            )}
            {lote && lote.state !== "PREVIA" && (
              <MensagemAviso aviso={aviso} testId="bipagem-aviso" />
            )}
            {lote?.state === "CONFIRMADO" && lote.result && (
              <section
                className="cartao cartao-sucesso"
                data-testid="bipagem-resultado"
              >
                <h3 data-testid="bipagem-resultado-titulo">
                  {lote.result.palletCreated
                    ? `Palete ${lote.result.palletCode ?? ""} criado`
                    : `Acrescentado ao palete ${lote.result.palletCode ?? ""}`}
                </h3>
                <p>
                  {plural(
                    lote.result.contentsCreated,
                    "nota importada",
                    "notas importadas",
                  )}{" "}
                  ({plural(lote.result.volumesRead, "volume", "volumes")})
                  {lote.result.rowsRevalidated > 0
                    ? `, ${plural(lote.result.rowsRevalidated, "linha revalidada", "linhas revalidadas")} (não entraram)`
                    : ""}
                  {lote.result.recordsWithoutReads > 0
                    ? `; ${plural(lote.result.recordsWithoutReads, "linha sem volumes", "linhas sem volumes")} só no relatório`
                    : ""}
                  .
                </p>
                <p className="campo-ajuda">
                  Gravado em{" "}
                  {lote.confirmedAt ? formatarDataHora(lote.confirmedAt) : "—"}
                  {lote.confirmedBy ? ` por ${lote.confirmedBy.name}` : ""}.
                  Delivery, SKU e validade podem ser completados depois, no
                  conteúdo do palete.
                </p>
                <div className="acoes-linha">
                  {lote.result.palletId && (
                    <button
                      type="button"
                      className="botao-primario"
                      onClick={() => {
                        if (lote.result?.palletId)
                          aoNavegar({
                            tipo: "palete",
                            id: lote.result.palletId,
                          });
                      }}
                      data-testid="bipagem-ver-palete"
                    >
                      Ver o palete no mapa
                    </button>
                  )}
                  <button
                    type="button"
                    className="botao-link"
                    onClick={outroArquivo}
                  >
                    Importar outro arquivo
                  </button>
                </div>
              </section>
            )}
            {lote?.state === "DESCARTADO" && (
              <section className="cartao" data-testid="bipagem-cancelada">
                <p>
                  Importação cancelada
                  {lote.discardedAt
                    ? ` em ${formatarDataHora(lote.discardedAt)}`
                    : ""}
                  : nada foi gravado.
                </p>
                <div className="acoes-linha">
                  <button
                    type="button"
                    className="botao-secundario"
                    onClick={outroArquivo}
                  >
                    Importar outro arquivo
                  </button>
                </div>
              </section>
            )}
            {lote?.state === "AGUARDANDO_MAPEAMENTO" && (
              <div className="mensagem-conflito" role="note">
                <p>
                  Importação de uma versão anterior, sem prévia. Cancele e envie
                  o arquivo de novo.
                </p>
                <button
                  type="button"
                  className="botao-perigo"
                  disabled={enviando}
                  onClick={() => {
                    void cancelar();
                  }}
                  data-testid="bipagem-cancelar-confirmar"
                >
                  Cancelar sem gravar
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
