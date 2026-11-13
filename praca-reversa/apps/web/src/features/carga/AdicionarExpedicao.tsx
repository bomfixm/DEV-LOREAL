import {
  API_PREFIXO,
  CargaJanelaSchema,
  JanelasCargaSchema,
  OrigemEmbarqueSchema,
  ResultadoInclusaoNotasSchema,
  type OrigemEmbarque,
  type PaleteResumo,
  type ResultadoInclusaoNotas,
} from '@praca-reversa/contracts';
import { useEffect, useRef, useState } from 'react';
import { useChaves } from '../../api/chaves';
import { enviarJson, mensagemDeFalha, obterJson } from '../../api/cliente';
import { IconeCaminhao } from '../../components/Icones';
import { atualizarSelecao, definirSelecao } from './selecao-expedicao';
import { voarParaExpedicao } from './voo-carrinho';

/** Fracionado ativo de um veículo (destino possível de uma nota). */
interface FracionadoAberto {
  id: string;
  label: string;
  version: number;
  notas: number;
}

/** Veículo que ainda recebe paletes (montagem), com a janela dele. */
interface VeiculoAberto {
  id: string;
  janelaId: string;
  janela: string;
  rotulo: string;
  placa: string | null;
  ocupados: number;
  capacidade: number;
  fracionados: FracionadoAberto[];
}

/** Veículos em montagem das janelas abertas (mesma leitura da tela Expedição). */
function useVeiculosAbertos(): { veiculos: VeiculoAberto[] | null; erro: string | null; carregando: boolean; recarregar: () => void } {
  const [veiculos, setVeiculos] = useState<VeiculoAberto[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    const controle = new AbortController();
    void (async () => {
      try {
        const janelas = (await obterJson(`${API_PREFIXO}/cargas/janelas`, JanelasCargaSchema, controle.signal)).items.filter((j) => j.vehicles > 0 && j.state !== 'CANCELADA' && j.state !== 'ENCERRADA');
        const cargas = await Promise.all(janelas.map((j) => obterJson(`${API_PREFIXO}/cargas/janelas/${j.id}`, CargaJanelaSchema, controle.signal)));
        if (controle.signal.aborted) return;
        setVeiculos(
          cargas.flatMap((c) =>
            c.vehicles
              .filter((v) => v.state === 'MONTAGEM')
              .map((v) => ({
                id: v.id,
                janelaId: c.window.id,
                janela: c.window.code,
                rotulo: v.label,
                placa: v.plate,
                ocupados: v.occupied,
                capacidade: v.capacity,
                fracionados: v.pallets
                  .filter((p) => p.state === 'ATIVO' && p.kind === 'FRACIONADO')
                  .map((p) => ({ id: p.id, label: p.label, version: p.version, notas: p.lines.length })),
              })),
          ),
        );
      } catch (e) {
        if (!controle.signal.aborted) setErro(mensagemDeFalha(e));
      } finally {
        if (!controle.signal.aborted) setCarregando(false);
      }
    })();
    return () => {
      controle.abort();
    };
  }, [tentativa]);
  return {
    veiculos,
    erro,
    carregando,
    recarregar: () => {
      setCarregando(true);
      setErro(null);
      setTentativa((t) => t + 1);
    },
  };
}

const textoVolumes = (n: number) => `${String(n)} ${n === 1 ? 'volume' : 'volumes'}`;
const curta = (identidade: string) => identidade.split(' · ').slice(1).join(' · ') || identidade;

/** Mede o ponto de partida do voo: o elemento de origem se ainda estiver na tela, senão o retângulo guardado no clique. */
function pontoDePartida(el: HTMLElement | null, guardado: DOMRect | null): DOMRect | null {
  if (el?.isConnected) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r;
  }
  return guardado;
}

/** Texto do resultado de uma inclusão por nota: o que entrou (NF, origem, volumes) e o que já estava. */
function textoInclusaoNotas(r: ResultadoInclusaoNotas): string {
  const entrou = r.added.map((n) => `${n.documentType ?? 'Nota'} ${n.documentNumber ?? 'sem número'} (palete ${n.sourcePalletCode}, ${textoVolumes(n.volumes)})`);
  const lista = entrou.length <= 4 ? entrou.join('; ') : `${entrou.slice(0, 4).join('; ')} e mais ${String(entrou.length - 4)}`;
  const partes = [`${r.added.length === 1 ? 'Entrou' : `Entraram ${String(r.added.length)} notas`} na expedição: ${lista} → ${r.pallet.identity}${r.pallet.created ? ' (fracionado novo, sem posição)' : ''}.`];
  if (r.skipped.length > 0) {
    partes.push(`${String(r.skipped.length)} já ${r.skipped.length === 1 ? 'estava' : 'estavam'} na seleção (${r.skipped.map((s) => `${s.documentNumber ?? 'sem número'} em ${curta(s.identity)}`).join('; ')}): não ${r.skipped.length === 1 ? 'contou' : 'contaram'} de novo.`);
  }
  partes.push(`Seleção atual: ${String(r.selection.notes)} ${r.selection.notes === 1 ? 'nota' : 'notas'}. Nada baixa estoque.`);
  return partes.join(' ');
}

export interface NotaParaExpedicao {
  /** Ocorrência real (vínculo do inventário ou conteúdo registrado), pelo ID estável. */
  ocorrencias: { kind: 'VINCULO' | 'CONTEUDO'; id: string }[];
  /** "NF 37953". */
  rotulo: string;
  /** Volumes de referência (contagem); null = não informado. */
  volumes: number | null;
}

/**
 * Inclui notas escolhidas do palete na expedição (rota por nota, nunca o
 * palete inteiro): escolhe o veículo em montagem e o destino — um fracionado
 * existente dele ou um novo. Uma nota com uma ocorrência aceita volumes
 * parciais (vazio = todo o disponível). O voo parte de `origem` (a linha) só
 * depois da confirmação do servidor.
 */
export function AdicionarNotas({
  palete,
  notas,
  origem,
  aoConcluir,
  aoCancelar,
}: {
  palete: PaleteResumo;
  notas: readonly NotaParaExpedicao[];
  origem: { el: HTMLElement | null; rect: DOMRect | null };
  aoConcluir: (texto: string) => void;
  aoCancelar: () => void;
}) {
  const chaves = useChaves();
  const { veiculos, erro: erroLeitura, carregando, recarregar } = useVeiculosAbertos();
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [volumes, setVolumes] = useState('');
  const titulo = useRef<HTMLElement>(null);
  const unica = notas.at(0);
  const parcial = notas.length === 1 && unica?.ocorrencias.length === 1;
  const ocorrencias = notas.flatMap((n) => n.ocorrencias);

  useEffect(() => {
    titulo.current?.scrollIntoView({ block: 'nearest' });
    titulo.current?.focus({ preventScroll: true });
  }, []);

  async function incluir(v: VeiculoAberto, destino: FracionadoAberto | null, botao: HTMLElement) {
    const pedidoVolumes = parcial && volumes.trim() !== '' ? Number(volumes) : null;
    if (pedidoVolumes !== null && (!Number.isInteger(pedidoVolumes) || pedidoVolumes < 1)) {
      setErro('Volumes: informe um número inteiro a partir de 1, ou deixe vazio para todo o disponível.');
      return;
    }
    const assinatura = `notas-expedicao:${palete.id}:${v.id}:${destino?.id ?? 'novo'}:${ocorrencias.map((o) => o.id).join(',')}:${String(pedidoVolumes)}`;
    const guardado = pontoDePartida(origem.el, origem.rect) ?? botao.getBoundingClientRect();
    setEnviando(`${v.id}:${destino?.id ?? 'novo'}`);
    setErro(null);
    try {
      const r = await enviarJson('POST', `${API_PREFIXO}/cargas/veiculos/${v.id}/notas`, ResultadoInclusaoNotasSchema, {
        corpo: {
          sourcePalletId: palete.id,
          lines: ocorrencias.map((o) => ({ occurrence: o, volumes: pedidoVolumes })),
          targetPalletId: destino?.id ?? null,
          expectedVersion: destino?.version ?? null,
        },
        idempotencia: chaves.para(assinatura),
      });
      chaves.concluir(assinatura);
      // Origem medida antes de a tabela mudar; o contador vem da resposta do servidor.
      const partida = pontoDePartida(origem.el, guardado);
      definirSelecao(r.selection);
      const [primeira] = r.added;
      voarParaExpedicao(partida, r.added.length === 1 && primeira ? `${primeira.documentType ?? 'Nota'} ${primeira.documentNumber ?? ''}`.trim() : `${String(r.added.length)} notas`, 'nota');
      aoConcluir(textoInclusaoNotas(r));
    } catch (e) {
      chaves.concluir(assinatura, e);
      setErro(mensagemDeFalha(e));
      // Versão ou ocupação mudou: a lista de destinos é lida de novo.
      recarregar();
    } finally {
      setEnviando(null);
    }
  }

  const nome = notas.length === 1 && unica ? unica.rotulo : `${String(notas.length)} notas selecionadas`;
  return (
    <section className="adicionar-expedicao" aria-labelledby="adicionar-notas-titulo" data-testid="adicionar-notas">
      <strong id="adicionar-notas-titulo" ref={titulo} tabIndex={-1}>
        Adicionar {nome} à expedição
      </strong>
      <span className="campo-ajuda">
        Entra só {notas.length === 1 ? 'esta nota' : 'estas notas'} do palete {palete.code}; as outras continuam fora. Nada baixa estoque.
      </span>
      {parcial && (
        <label className="adicionar-expedicao-volumes">
          <span>Volumes</span>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={volumes}
            placeholder={unica.volumes === null ? 'todos' : String(unica.volumes)}
            onChange={(e) => {
              setVolumes(e.target.value);
            }}
            data-testid="adicionar-notas-volumes"
          />
          <small className="campo-ajuda">{unica.volumes === null ? 'Vazio = todo o disponível.' : `Vazio = todo o disponível (até ${textoVolumes(unica.volumes)}).`}</small>
        </label>
      )}
      {carregando && veiculos === null && <span>Buscando veículos em montagem…</span>}
      {erroLeitura !== null && (
        <span className="mensagem-conflito" role="alert">
          {erroLeitura}
        </span>
      )}
      {veiculos !== null && veiculos.length === 0 && <span>Nenhum veículo em montagem. Adicione uma carreta ou um truck numa janela, na Expedição.</span>}
      {veiculos?.map((v) => {
        const cheio = v.ocupados >= v.capacidade;
        return (
          <fieldset key={v.id} className="adicionar-expedicao-veiculo" data-veiculo={`${v.janela} ${v.rotulo}`}>
            <legend>
              {v.rotulo}
              {v.placa !== null && ` · ${v.placa}`} · {v.janela} · {v.ocupados}/{v.capacidade} paletes
            </legend>
            <ul className="adicionar-expedicao-lista">
              {v.fracionados.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="botao-secundario"
                    disabled={enviando !== null}
                    onClick={(e) => void incluir(v, f, e.currentTarget)}
                    data-testid="adicionar-notas-destino"
                    data-destino={`${v.rotulo} ${f.label}`}
                  >
                    <span>{enviando === `${v.id}:${f.id}` ? 'Adicionando…' : `Juntar ao ${f.label}`}</span>
                    <small>
                      fracionado · {f.notas} {f.notas === 1 ? 'nota' : 'notas'}
                    </small>
                  </button>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  className="botao-secundario"
                  disabled={enviando !== null || cheio}
                  onClick={(e) => void incluir(v, null, e.currentTarget)}
                  data-testid="adicionar-notas-destino"
                  data-destino={`${v.rotulo} novo`}
                >
                  <span>{enviando === `${v.id}:novo` ? 'Adicionando…' : 'Novo palete fracionado'}</span>
                  <small>{cheio ? 'veículo cheio' : 'sem posição; escolha depois no mapa do veículo'}</small>
                </button>
              </li>
            </ul>
          </fieldset>
        );
      })}
      {erro !== null && (
        <span className="mensagem-conflito" role="alert" data-testid="adicionar-notas-erro">
          {erro}
        </span>
      )}
      <button type="button" className="botao-link" onClick={aoCancelar}>
        Cancelar
      </button>
    </section>
  );
}

/**
 * "Adicionar palete inteiro" na janela do palete: ação explícita, separada da
 * inclusão por nota. Escolhe o veículo, mostra o resumo (notas, volumes e
 * sobreposição com notas já incluídas) e só então cria o FULL pela mesma
 * criação da tela Expedição, com as mesmas regras. Com nota do palete já na
 * expedição, a regra atual não deixa sair FULL: oferece incluir só as
 * restantes (sem duplicar notas nem volumes). Nada baixa estoque.
 */
export function AdicionarExpedicao({ palete, aoAlterado }: { palete: PaleteResumo; aoAlterado: (texto: string) => void }) {
  const [aberto, setAberto] = useState(false);
  if (!aberto) {
    return (
      <button
        type="button"
        className="botao-secundario"
        onClick={() => {
          setAberto(true);
        }}
        title="Inclui o palete inteiro (FULL) num veículo em montagem. Para uma nota só, use o caminhão na linha da nota."
        data-testid="acao-adicionar-expedicao"
      >
        <IconeCaminhao />
        Adicionar palete inteiro
      </button>
    );
  }
  return (
    <PaleteInteiro
      palete={palete}
      aoFechar={() => {
        setAberto(false);
      }}
      aoAlterado={aoAlterado}
    />
  );
}

function PaleteInteiro({ palete, aoFechar, aoAlterado }: { palete: PaleteResumo; aoFechar: () => void; aoAlterado: (texto: string) => void }) {
  const chaves = useChaves();
  const { veiculos, erro: erroLeitura, carregando } = useVeiculosAbertos();
  const [escolhido, setEscolhido] = useState<VeiculoAberto | null>(null);
  const [resumo, setResumo] = useState<OrigemEmbarque | null>(null);
  const [lendo, setLendo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function escolher(v: VeiculoAberto) {
    setEscolhido(v);
    setResumo(null);
    setErro(null);
    setLendo(true);
    try {
      const o = await obterJson(`${API_PREFIXO}/cargas/janelas/${v.janelaId}/origem?codigo=${encodeURIComponent(palete.code)}`, OrigemEmbarqueSchema);
      if (o.palletId !== palete.id) throw new Error('outro palete');
      setResumo(o);
    } catch (e) {
      setErro(e instanceof Error && e.message === 'outro palete' ? 'O código encontrou outro palete. Confira a numeração antes de incluir.' : mensagemDeFalha(e));
    } finally {
      setLendo(false);
    }
  }

  async function confirmarFull(v: VeiculoAberto, botao: HTMLElement) {
    const assinatura = `palete-expedicao:${palete.id}:${v.id}`;
    const partida = botao.getBoundingClientRect();
    setEnviando(true);
    setErro(null);
    try {
      await enviarJson('POST', `${API_PREFIXO}/cargas/veiculos/${v.id}/paletes`, CargaJanelaSchema, {
        corpo: { kind: 'FULL', number: null, position: null, sourcePalletId: palete.id },
        idempotencia: chaves.para(assinatura),
      });
      chaves.concluir(assinatura);
      // Contador do servidor antes do voo: na primeira inclusão o atalho aparece e vira o destino.
      await atualizarSelecao();
      voarParaExpedicao(partida, `Palete ${palete.code}`, 'palete');
      aoFechar();
      aoAlterado(`Palete ${palete.code} inteiro adicionado à ${v.rotulo} (${v.janela}) como FULL, ainda sem posição: escolha a posição no mapa do veículo, em Expedição.`);
    } catch (e) {
      chaves.concluir(assinatura, e);
      setErro(mensagemDeFalha(e));
    } finally {
      setEnviando(false);
    }
  }

  async function incluirRestantes(v: VeiculoAberto, restantes: OrigemEmbarque['occurrences'], botao: HTMLElement) {
    const assinatura = `restantes-expedicao:${palete.id}:${v.id}:${restantes.map((o) => o.id).join(',')}`;
    const partida = botao.getBoundingClientRect();
    setEnviando(true);
    setErro(null);
    try {
      const r = await enviarJson('POST', `${API_PREFIXO}/cargas/veiculos/${v.id}/notas`, ResultadoInclusaoNotasSchema, {
        corpo: { sourcePalletId: palete.id, lines: restantes.map((o) => ({ occurrence: { kind: o.kind, id: o.id }, volumes: null })), targetPalletId: null, expectedVersion: null },
        idempotencia: chaves.para(assinatura),
      });
      chaves.concluir(assinatura);
      definirSelecao(r.selection);
      voarParaExpedicao(partida, `${String(r.added.length)} notas`, 'palete');
      aoFechar();
      aoAlterado(textoInclusaoNotas(r));
    } catch (e) {
      chaves.concluir(assinatura, e);
      setErro(mensagemDeFalha(e));
    } finally {
      setEnviando(false);
    }
  }

  const ocorrencias = resumo?.occurrences ?? [];
  // Sobreposição: nota com parte (ou tudo) já em embarque ou expedida.
  const sobrepostas = ocorrencias.filter((o) => o.base !== null && o.available !== null && o.available < o.base);
  const semBase = ocorrencias.filter((o) => o.base === null);
  const restantes = ocorrencias.filter((o) => o.available !== null && o.available > 0 && !sobrepostas.includes(o));
  const totalVolumes = ocorrencias.reduce((t, o) => t + (o.available ?? 0), 0);
  const nf = (o: OrigemEmbarque['occurrences'][number]) => `${o.documentType ?? 'Nota'} ${o.documentNumber ?? 'sem número'}`;

  return (
    <div className="adicionar-expedicao" data-testid="adicionar-expedicao">
      <strong>Adicionar o palete {palete.code} inteiro a qual veículo?</strong>
      <span className="campo-ajuda">Entra inteiro (FULL), com todas as notas, sem posição. Para uma nota só, use o caminhão na linha da nota.</span>
      {carregando && veiculos === null && <span>Buscando veículos em montagem…</span>}
      {erroLeitura !== null && (
        <span className="mensagem-conflito" role="alert">
          {erroLeitura}
        </span>
      )}
      {veiculos !== null && veiculos.length === 0 && <span>Nenhum veículo em montagem. Adicione uma carreta ou um truck numa janela, na Expedição.</span>}
      {veiculos !== null && veiculos.length > 0 && escolhido === null && (
        <ul className="adicionar-expedicao-lista">
          {veiculos.map((v) => {
            const cheio = v.ocupados >= v.capacidade;
            return (
              <li key={v.id}>
                <button type="button" className="botao-secundario" disabled={cheio} onClick={() => void escolher(v)} data-testid="adicionar-expedicao-veiculo" data-veiculo={`${v.janela} ${v.rotulo}`}>
                  <span>
                    {v.rotulo}
                    {v.placa !== null && ` · ${v.placa}`}
                  </span>
                  <small>
                    {v.janela} · {v.ocupados}/{v.capacidade} paletes{cheio ? ' · cheio' : ''}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {escolhido !== null && (
        <div className="adicionar-expedicao-confirmar" data-testid="adicionar-expedicao-resumo">
          {lendo && <span>Conferindo as notas do palete…</span>}
          {resumo !== null && (
            <>
              <span>
                <strong>Resumo:</strong> palete {palete.code} inteiro → {escolhido.rotulo} ({escolhido.janela}): {ocorrencias.length} {ocorrencias.length === 1 ? 'nota' : 'notas'} · {textoVolumes(totalVolumes)} disponíveis.
              </span>
              {resumo.fullIn !== null && (
                <span className="mensagem-conflito" role="alert">
                  Este palete já sai FULL em {resumo.fullIn}. Um FULL não vai em duas cargas.
                </span>
              )}
              {semBase.length > 0 && (
                <span className="mensagem-conflito">
                  {semBase.length} {semBase.length === 1 ? 'nota sem' : 'notas sem'} volumes informados ({semBase.slice(0, 5).map(nf).join(', ')}): registre a contagem antes de embarcar FULL.
                </span>
              )}
              {sobrepostas.length > 0 && resumo.fullIn === null ? (
                <>
                  <span className="mensagem-conflito" data-testid="adicionar-expedicao-sobreposicao">
                    Sobreposição: {sobrepostas.map((o) => `${nf(o)} (${String((o.base ?? 0) - (o.available ?? 0))} de ${String(o.base ?? 0)} vol. já em expedição ou expedidos)`).join('; ')}. Pela regra atual, um palete com nota já incluída à parte não sai FULL.
                  </span>
                  {restantes.length > 0 ? (
                    <button type="button" className="botao-primario" disabled={enviando} onClick={(e) => void incluirRestantes(escolhido, restantes, e.currentTarget)} data-testid="adicionar-expedicao-restantes">
                      {enviando ? 'Adicionando…' : restantes.length === 1 ? 'Adicionar só a nota restante (fracionado novo)' : `Adicionar só as ${String(restantes.length)} notas restantes (fracionado novo)`}
                    </button>
                  ) : (
                    <span>Não há notas restantes com volumes disponíveis.</span>
                  )}
                </>
              ) : (
                resumo.fullIn === null && (
                  <button type="button" className="botao-primario" disabled={enviando || ocorrencias.length === 0} onClick={(e) => void confirmarFull(escolhido, e.currentTarget)} data-testid="adicionar-expedicao-confirmar">
                    {enviando ? 'Adicionando…' : 'Confirmar palete inteiro'}
                  </button>
                )
              )}
            </>
          )}
          <button
            type="button"
            className="botao-link"
            onClick={() => {
              setEscolhido(null);
              setResumo(null);
              setErro(null);
            }}
          >
            Escolher outro veículo
          </button>
        </div>
      )}
      {erro !== null && (
        <span className="mensagem-conflito" role="alert">
          {erro}
        </span>
      )}
      <button type="button" className="botao-link" onClick={aoFechar}>
        Cancelar
      </button>
    </div>
  );
}
