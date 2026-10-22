import {
  API_PREFIXO,
  ConteudosPaleteSchema,
  PaleteDetalheSchema,
  RegistrarConferenciaVolumesSchema,
  ResultadoConferenciaVolumesSchema,
  ROTULOS_CONFERENCIA_VOLUMES,
  type ConteudoPalete,
  type ResultadoConferenciaVolumes,
} from '@praca-reversa/contracts';
import { useId, useMemo, useRef, useState } from 'react';
import { useChaves } from '../../api/chaves';
import { FalhaRequisicao, enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar } from '../../components/Icones';
import { MensagemAcao } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import { formatarDataHora } from '../../utils/datas';
import { ReconferenciaCompleta } from './ReconferenciaCompleta';
import './conferencia-tabela.css';

type Modo = 'COMPLETA' | 'PARCIAL';
type Mensagem = { tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null;

const inteiro = (texto: string): number | null => (/^\d{1,6}$/.test(texto.trim()) && Number(texto.trim()) <= 100_000 ? Number(texto.trim()) : null);

/** Quantidade atual (referência) da linha; `null` = desconhecida. */
function atualDe(c: ConteudoPalete): number | null {
  const n = c.count.counted === null ? null : Number(c.count.counted);
  return n === null || !Number.isInteger(n) ? null : n;
}

const documento = (c: ConteudoPalete) => (c.documentNumber === null ? 'Sem documento' : `${c.documentType ?? ''} ${c.documentNumber}`.trim());

function SeloLinha({ c }: { c: ConteudoPalete }) {
  const estado = c.check?.state ?? 'NAO_CONFERIDO';
  const texto = estado === 'CONFERIDO' ? 'Conferida' : estado === 'CONFERIDO_COM_DIFERENCA' ? `Com diferença${c.check?.difference == null ? '' : ` (${c.check.difference > 0 ? '+' : ''}${String(c.check.difference)})`}` : 'Não conferida';
  const titulo = c.check?.at ? `${texto} em ${formatarDataHora(c.check.at)}${c.check.by ? ` por ${c.check.by.name}` : ''}` : texto;
  return (
    <span className={`selo selo-conferencia selo-conferencia--${estado}`} title={titulo} data-testid="conf-linha-estado">
      <span className="selo-marcador" aria-hidden="true">
        {estado === 'CONFERIDO' ? '✓' : estado === 'CONFERIDO_COM_DIFERENCA' ? '≠' : '?'}
      </span>
      {texto}
    </span>
  );
}

/** Palete sem conteúdo registrado: nada a contar por linha; a reconferência completa do palete continua disponível. */
function SemConteudo({ paleteId, paleteCodigo, aoReconferido }: { paleteId: string; paleteCodigo: string; aoReconferido: (texto: string) => void }) {
  const { carga } = useRecurso(`${API_PREFIXO}/paletes/${paleteId}`, PaleteDetalheSchema);
  const p = carga?.estado === 'pronto' ? carga.dados : null;
  return (
    <div className="conf-tabela" data-testid="conf-vazio">
      <p className="estado-vazio">O palete {paleteCodigo} não tem conteúdo registrado para conferir por linha. Registre o conteúdo ou importe a bipagem; se o palete inteiro foi conferido, registre a reconferência completa abaixo.</p>
      {p?.reconference != null && (
        <ReconferenciaCompleta
          paleteId={paleteId}
          prazo={p.reconference}
          conteudos={0}
          aoRegistrado={() => {
            aoReconferido(`Palete ${paleteCodigo}: reconferência completa registrada — novo prazo de 20 dias.`);
          }}
        />
      )}
    </div>
  );
}

/**
 * Conferência de volumes do palete numa tabela única (21 out. 2026): uma
 * linha por conteúdo, quantidade atual como referência e a contada ao lado.
 * "Confirmar todos sem diferença" pede a declaração de conferência física;
 * "Concluir com diferenças" grava só o que mudou; a parcial abrange só as
 * marcadas. Só fecha (aoConcluir) depois da confirmação do servidor; em erro,
 * os valores digitados ficam.
 */
export function ConferenciaTabela({
  paleteId,
  paleteCodigo,
  aoConcluir,
  aoCancelar,
  aoReconferido,
}: {
  paleteId: string;
  paleteCodigo: string;
  aoConcluir: (r: ResultadoConferenciaVolumes) => void;
  aoCancelar: () => void;
  /** Palete sem conteúdo registrado: reconferência completa registrada (prazo de 20 dias). */
  aoReconferido: (texto: string) => void;
}) {
  const ids = useId();
  const [versao, setVersao] = useState(0);
  const { carga } = useRecurso(`${API_PREFIXO}/paletes/${paleteId}/conteudos`, ConteudosPaleteSchema, versao);
  const dados = carga?.estado === 'pronto' && carga.dados.palletId === paleteId ? carga.dados : null;
  const chaves = useChaves();
  const conectado = useConectado();
  const [modo, setModo] = useState<Modo>('COMPLETA');
  const [contados, setContados] = useState<Record<string, string>>({});
  const [marcados, setMarcados] = useState<ReadonlySet<string>>(new Set());
  const [declaracao, setDeclaracao] = useState(false);
  const [observacao, setObservacao] = useState('');
  const [filtro, setFiltro] = useState('');
  const [soDiferencas, setSoDiferencas] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [conjuntoAlterado, setConjuntoAlterado] = useState(false);
  const tabela = useRef<HTMLTableSectionElement>(null);

  // Valores sugeridos = quantidade atual (referência visível); o que já foi digitado é mantido ao recarregar o conjunto.
  const [conjunto, setConjunto] = useState<string | null>(null);
  if (dados !== null && dados.setSignature !== conjunto) {
    setConjunto(dados.setSignature);
    setContados((antes) => Object.fromEntries(dados.items.map((c) => [c.id, antes[c.id] ?? (atualDe(c) === null ? '' : String(atualDe(c)))])));
    setMarcados((antes) => new Set([...antes].filter((id) => dados.items.some((c) => c.id === id))));
  }

  const itens = useMemo(() => dados?.items ?? [], [dados]);
  const linhas = itens.map((c) => {
    const atual = atualDe(c);
    const texto = contados[c.id] ?? '';
    const contado = inteiro(texto);
    return { c, atual, texto, contado, invalido: texto.trim() !== '' && contado === null, diferenca: contado === null || atual === null ? null : contado - atual };
  });
  const termo = filtro.trim().toLowerCase();
  const visiveis = linhas.filter(
    (l) => (!soDiferencas || (l.diferenca !== null && l.diferenca !== 0) || l.atual === null) && (termo === '' || `${documento(l.c)} ${l.c.sender ?? ''} ${l.c.delivery ?? ''}`.toLowerCase().includes(termo)),
  );
  const comDiferenca = linhas.filter((l) => l.diferenca !== null && l.diferenca !== 0);
  const semReferencia = linhas.filter((l) => l.atual === null);
  const faltando = linhas.filter((l) => l.contado === null);
  const totalAtual = linhas.every((l) => l.atual !== null) ? linhas.reduce((t, l) => t + (l.atual ?? 0), 0) : null;
  const totalContado = faltando.length === 0 ? linhas.reduce((t, l) => t + (l.contado ?? 0), 0) : null;
  const parciais = linhas.filter((l) => marcados.has(l.c.id));

  async function enviar(escopo: Modo, lista: { kind: ConteudoPalete['kind']; id: string; counted: number }[]) {
    if (dados === null) return;
    if (!conectado) {
      setMensagem({ tipo: 'erro', texto: 'Sem conexão: nada foi gravado. Os valores digitados continuam aqui.' });
      return;
    }
    const corpo = { scope: escopo, physicalDeclaration: escopo === 'COMPLETA' ? declaracao : false, setSignature: dados.setSignature, lines: lista, notes: observacao.trim() === '' ? null : observacao.trim() };
    const valido = RegistrarConferenciaVolumesSchema.safeParse(corpo);
    if (!valido.success) {
      setMensagem({ tipo: 'erro', texto: valido.error.issues[0]?.message ?? 'Revise a conferência.' });
      return;
    }
    const assinatura = `conferencia:${paleteId}:${JSON.stringify(corpo)}`;
    setOcupado(true);
    setMensagem(null);
    try {
      const r = await enviarJson('POST', `${API_PREFIXO}/paletes/${paleteId}/conferencias-volumes`, ResultadoConferenciaVolumesSchema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      // Só depois da confirmação do servidor a tela fecha.
      aoConcluir(r);
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      const alterado = erro instanceof FalhaRequisicao && erro.codigo === 'CONJUNTO_ALTERADO';
      setConjuntoAlterado(alterado);
      setMensagem({ tipo: alterado ? 'conflito' : 'erro', texto: mensagemDeFalha(erro) });
    } finally {
      setOcupado(false);
    }
  }

  const confirmarSemDiferenca = () => {
    void enviar(
      'COMPLETA',
      linhas.map((l) => ({ kind: l.c.kind, id: l.c.id, counted: l.atual ?? -1 })),
    );
  };
  const concluirComTabela = () => {
    void enviar(
      'COMPLETA',
      linhas.map((l) => ({ kind: l.c.kind, id: l.c.id, counted: l.contado ?? -1 })),
    );
  };
  const concluirParcial = () => {
    void enviar(
      'PARCIAL',
      parciais.map((l) => ({ kind: l.c.kind, id: l.c.id, counted: l.contado ?? -1 })),
    );
  };

  /** Enter passa para a contagem da linha seguinte (conferência rápida pelo teclado). */
  const proximo = (id: string) => {
    const campos = [...(tabela.current?.querySelectorAll<HTMLInputElement>('input[data-contado]') ?? [])];
    const i = campos.findIndex((x) => x.dataset.contado === id);
    campos[i + 1]?.focus();
    campos[i + 1]?.select();
  };

  if (carga?.estado === 'erro' && dados === null) {
    return (
      <div className="estado-erro" role="alert">
        <p>Não foi possível carregar o conteúdo do palete. {carga.mensagem}</p>
        <button
          type="button"
          className="botao-secundario"
          onClick={() => {
            setVersao((v) => v + 1);
          }}
        >
          <IconeAtualizar />
          Tentar novamente
        </button>
      </div>
    );
  }
  if (dados === null) return <p className="estado-carregando">Carregando o conteúdo do palete…</p>;
  if (itens.length === 0) return <SemConteudo paleteId={paleteId} paleteCodigo={paleteCodigo} aoReconferido={aoReconferido} />;

  return (
    <div className="conf-tabela" data-testid="conferencia-tabela">
      <div className="conf-resumo">
        <p>
          <strong>{itens.length}</strong> conteúdo(s) · atual {totalAtual === null ? `${String(semReferencia.length)} sem quantidade` : `${String(totalAtual)} volume(s)`}
          {dados.volumeCheck !== null && (
            <>
              {' '}
              · <span data-testid="conf-estado-palete">{ROTULOS_CONFERENCIA_VOLUMES[dados.volumeCheck.state].texto}</span>
              {dados.volumeCheck.lastCompleteAt !== null && ` (última completa ${formatarDataHora(dados.volumeCheck.lastCompleteAt)})`}
            </>
          )}
        </p>
        <p className="campo-ajuda">A coluna “Atual” é só referência (o que está registrado). Abrir esta tabela não confere nada: confirme depois de conferir o palete fisicamente.</p>
      </div>

      <fieldset className="conf-modo">
        <legend>Tipo de conferência</legend>
        <label>
          <input type="radio" name={`${ids}-modo`} checked={modo === 'COMPLETA'} onChange={() => { setModo('COMPLETA'); }} data-testid="conf-modo-completa" />
          Palete inteiro (renova o prazo de 20 dias)
        </label>
        <label>
          <input type="radio" name={`${ids}-modo`} checked={modo === 'PARCIAL'} onChange={() => { setModo('PARCIAL'); }} data-testid="conf-modo-parcial" />
          Só parte (marque as linhas conferidas; não renova o prazo)
        </label>
      </fieldset>

      <div className="conf-ferramentas">
        <label className="campo conf-filtro">
          <span className="campo-rotulo">Procurar na tabela</span>
          <input type="search" value={filtro} onChange={(e) => { setFiltro(e.target.value); }} placeholder="Nota, remetente ou Delivery" />
        </label>
        <label className="conf-check">
          <input type="checkbox" checked={soDiferencas} onChange={(e) => { setSoDiferencas(e.target.checked); }} />
          Mostrar só diferenças e sem quantidade ({comDiferenca.length + semReferencia.length})
        </label>
        <button
          type="button"
          className="botao-link"
          onClick={() => {
            setContados(Object.fromEntries(itens.map((c) => [c.id, atualDe(c) === null ? '' : String(atualDe(c))])));
          }}
        >
          Voltar às quantidades atuais
        </button>
      </div>
      {visiveis.length < linhas.length && (
        <p className="tabela-nota" data-testid="conf-filtrado">
          Mostrando {visiveis.length} de {linhas.length}. A conferência completa abrange todas as {linhas.length} linhas, inclusive as escondidas pelo filtro.
        </p>
      )}

      <div className="conf-rolagem" role="region" aria-label="Conteúdos do palete para conferir" tabIndex={0}>
        <table className="conf-grade">
          <thead>
            <tr>
              {modo === 'PARCIAL' && (
                <th scope="col" className="conf-col-marca">
                  <input
                    type="checkbox"
                    aria-label="Marcar todas as linhas exibidas"
                    checked={visiveis.length > 0 && visiveis.every((l) => marcados.has(l.c.id))}
                    onChange={(e) => {
                      const novo = new Set(marcados);
                      for (const l of visiveis) {
                        if (e.target.checked) novo.add(l.c.id);
                        else novo.delete(l.c.id);
                      }
                      setMarcados(novo);
                    }}
                  />
                </th>
              )}
              <th scope="col">Situação</th>
              <th scope="col">Tipo e número</th>
              <th scope="col">Remetente</th>
              <th scope="col" className="numero">
                Atual
              </th>
              <th scope="col" className="numero">
                Contado
              </th>
              <th scope="col" className="numero">
                Diferença
              </th>
            </tr>
          </thead>
          <tbody ref={tabela}>
            {visiveis.map((l) => (
              <tr key={l.c.id} data-testid="conf-linha" data-numero={l.c.documentNumber ?? ''} className={l.diferenca !== null && l.diferenca !== 0 ? 'conf-linha--diferenca' : undefined}>
                {modo === 'PARCIAL' && (
                  <td data-rotulo="Conferida">
                    <input
                      type="checkbox"
                      aria-label={`Conferi ${documento(l.c)}`}
                      checked={marcados.has(l.c.id)}
                      onChange={(e) => {
                        const novo = new Set(marcados);
                        if (e.target.checked) novo.add(l.c.id);
                        else novo.delete(l.c.id);
                        setMarcados(novo);
                      }}
                      data-testid="conf-marcar"
                    />
                  </td>
                )}
                <td data-rotulo="Situação">
                  <SeloLinha c={l.c} />
                </td>
                <td data-rotulo="Documento">{documento(l.c)}</td>
                <td data-rotulo="Remetente" className="conf-remetente">
                  {l.c.sender ?? 'Não informado'}
                </td>
                <td data-rotulo="Atual" className="numero" data-testid="conf-atual">
                  {l.atual ?? <span className="pendente">sem quantidade</span>}
                </td>
                <td data-rotulo="Contado" className="numero">
                  <input
                    className={`conf-contado${l.invalido ? ' campo-invalido' : ''}`}
                    inputMode="numeric"
                    aria-label={`Volumes contados de ${documento(l.c)}`}
                    aria-invalid={l.invalido || undefined}
                    value={l.texto}
                    data-contado={l.c.id}
                    data-testid="conf-contado"
                    onFocus={(e) => {
                      e.target.select();
                    }}
                    onChange={(e) => {
                      setContados({ ...contados, [l.c.id]: e.target.value });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        proximo(l.c.id);
                      }
                    }}
                  />
                </td>
                <td data-rotulo="Diferença" className="numero" data-testid="conf-diferenca">
                  {l.invalido ? <span className="estado-erro-texto">inválido</span> : l.diferenca === null ? '—' : l.diferenca === 0 ? '0' : <strong>{l.diferenca > 0 ? `+${String(l.diferenca)}` : String(l.diferenca)}</strong>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="conf-totais" data-testid="conf-totais">
        {comDiferenca.length === 0 ? 'Nenhuma diferença digitada.' : `${String(comDiferenca.length)} linha(s) com diferença.`} Total contado: {totalContado === null ? `faltam ${String(faltando.length)}` : String(totalContado)}
        {totalAtual !== null && totalContado !== null && totalContado !== totalAtual && ` (${totalContado - totalAtual > 0 ? '+' : ''}${String(totalContado - totalAtual)} no palete)`}
      </p>

      <label className="campo">
        <span className="campo-rotulo">Observação (opcional)</span>
        <textarea rows={2} maxLength={500} value={observacao} onChange={(e) => { setObservacao(e.target.value); }} />
      </label>

      <MensagemAcao mensagem={mensagem} testId="conf-mensagem" />
      {conjuntoAlterado && (
        <button
          type="button"
          className="botao-secundario"
          onClick={() => {
            setConjuntoAlterado(false);
            setMensagem(null);
            setVersao((v) => v + 1);
          }}
          data-testid="conf-recarregar"
        >
          <IconeAtualizar />
          Recarregar o conjunto (os valores digitados ficam)
        </button>
      )}

      {modo === 'COMPLETA' ? (
        <div className="conf-acoes">
          <label className="conf-declaracao">
            <input type="checkbox" checked={declaracao} onChange={(e) => { setDeclaracao(e.target.checked); }} data-testid="conf-declaracao" />
            Conferi fisicamente todos os {itens.length} conteúdos do palete {paleteCodigo}.
          </label>
          <div className="acoes-linha">
            <button
              type="button"
              className="botao-primario"
              disabled={ocupado || !declaracao || semReferencia.length > 0 || comDiferenca.length > 0}
              title={comDiferenca.length > 0 ? 'Há diferenças digitadas: use “Concluir com as diferenças”.' : semReferencia.length > 0 ? 'Informe a contagem das linhas sem quantidade.' : undefined}
              onClick={confirmarSemDiferenca}
              data-testid="conf-confirmar-todos"
            >
              Confirmar todos sem diferença
            </button>
            <button
              type="button"
              className="botao-secundario"
              disabled={ocupado || !declaracao || faltando.length > 0 || linhas.some((l) => l.invalido) || (comDiferenca.length === 0 && semReferencia.length === 0)}
              onClick={concluirComTabela}
              data-testid="conf-concluir-diferencas"
            >
              Concluir com as diferenças ({comDiferenca.length + semReferencia.length})
            </button>
            <button type="button" className="botao-link" disabled={ocupado} onClick={aoCancelar}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="conf-acoes">
          <div className="acoes-linha">
            <button
              type="button"
              className="botao-primario"
              disabled={ocupado || parciais.length === 0 || parciais.some((l) => l.contado === null)}
              onClick={concluirParcial}
              data-testid="conf-concluir-parcial"
            >
              Concluir conferência parcial ({parciais.length} marcada{parciais.length === 1 ? '' : 's'})
            </button>
            <button type="button" className="botao-link" disabled={ocupado} onClick={aoCancelar}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {ocupado && (
        <p className="estado-carregando" role="status">
          Gravando a conferência…
        </p>
      )}
    </div>
  );
}

