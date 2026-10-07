import {
  API_PREFIXO,
  FORMATO_QUANTIDADE,
  PaginaMaterialSchema,
  PreviaReservaSchema,
  ReservaDetalheSchema,
  UNIDADE_PECA,
  compararQuantidades,
  ehQuantidadeInteira,
  type BasePeso,
  type FilaMaterial,
  type JanelaDetalhe,
  type MaterialExpedicao,
  type Permissao,
  type PreviaReserva,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar } from '../../components/Icones';
import { MensagemAcao } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import type { Navegar } from '../../rotas';
import { formatarData, formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';
import { useAcoes } from './acoes';
import { ROTULOS_BASE_PESO, ROTULOS_CONDICAO, ROTULOS_PENDENCIA_MATERIAL, q, rotuloMetrica, textoOrigem } from './rotulos';

const TAMANHO = 20;

interface Selecionado {
  item: MaterialExpedicao;
  quantidade: string;
}

interface Medida {
  boxes: string;
  weightKg: string;
  weightBase: BasePeso;
  volumeM3: string;
  measurementSource: string;
}

const MEDIDA_VAZIA: Medida = { boxes: '', weightKg: '', weightBase: 'BRUTO', volumeM3: '', measurementSource: '' };
const chave = (i: Pick<MaterialExpedicao, 'palletId' | 'segmentId'>) => `${i.palletId}:${i.segmentId}`;
const decimal = (t: string) => t.trim().replace(',', '.');

function problemaQuantidade(texto: string, item: MaterialExpedicao): string | null {
  const v = decimal(texto);
  if (!FORMATO_QUANTIDADE.test(v)) return 'Número com até 3 casas decimais.';
  if (compararQuantidades(v, '0') <= 0) return 'Maior que zero.';
  if (item.unit === UNIDADE_PECA && !ehQuantidadeInteira(v)) return 'Peças (UN) só inteiras.';
  if (compararQuantidades(v, item.available) > 0) return `Acima do disponível (${formatarQuantidade(item.available)}).`;
  return null;
}

/**
 * Seleção de material para a janela: filas elegível (FIFO pela entrada física
 * validada; data documental à parte) e de pendências (motivo, responsável e
 * próximo passo), medidas das unidades de carga exigidas pelas restrições,
 * prévia no servidor (todas as restrições juntas) e confirmação da reserva.
 */
export function SelecaoMaterial({
  janela,
  permissoes,
  aoNavegar,
  aoReservar,
  aoRecarregarJanela,
}: {
  janela: JanelaDetalhe;
  permissoes: readonly Permissao[];
  aoNavegar: Navegar;
  aoReservar: (reservaId: string) => void;
  aoRecarregarJanela: () => void;
}) {
  const conectado = useConectado();
  const [fila, setFila] = useState<FilaMaterial>('ELEGIVEL');
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [selecao, setSelecao] = useState<Map<string, Selecionado>>(new Map());
  const [medidas, setMedidas] = useState<Map<string, Medida>>(new Map());
  const [previa, setPrevia] = useState<PreviaReserva | null>(null);
  const [erroPrevia, setErroPrevia] = useState<string | null>(null);
  const acoes = useAcoes(aoRecarregarJanela);
  const p = new URLSearchParams({ janela: janela.id, fila, pagina: String(pagina), tamanho: String(TAMANHO) });
  if (busca.trim()) p.set('texto', busca.trim());
  const lista = useRecurso(`${API_PREFIXO}/material-expedicao?${p.toString()}`, PaginaMaterialSchema);
  const dados = lista.carga?.estado === 'pronto' ? lista.carga.dados : null;
  const paginas = dados ? Math.max(1, Math.ceil(dados.total / TAMANHO)) : 1;
  const podeReservar = permissoes.includes('janela.reservar');
  const operavel = janela.state === 'CONFIRMADA' || janela.state === 'PREPARACAO';
  const metricas = new Set(janela.restrictions.map((r) => r.metric));
  const pedeMedidas = metricas.has('CAIXAS') || metricas.has('PESO_KG') || metricas.has('VOLUME_M3');
  const paletesSelecionados = [...new Map([...selecao.values()].map((s) => [s.item.palletId, s.item.palletCode])).entries()];
  const problemas = [...selecao.values()].map((s) => problemaQuantidade(s.quantidade, s.item)).filter((x): x is string => x !== null);

  const corpo = () => ({
    expectedWindowVersion: janela.version,
    lines: [...selecao.values()].map((s) => ({ palletId: s.item.palletId, segmentId: s.item.segmentId, quantity: decimal(s.quantidade), expectedPalletVersion: s.item.palletVersion })),
    loadUnits: pedeMedidas
      ? paletesSelecionados.map(([palletId]) => {
          const m = medidas.get(palletId) ?? MEDIDA_VAZIA;
          return {
            palletId,
            boxes: m.boxes.trim() === '' ? null : m.boxes.trim(),
            weightKg: m.weightKg.trim() === '' ? null : decimal(m.weightKg),
            weightBase: m.weightKg.trim() === '' ? null : m.weightBase,
            volumeM3: m.volumeM3.trim() === '' ? null : decimal(m.volumeM3),
            measurementSource: m.measurementSource.trim() === '' ? null : m.measurementSource.trim(),
          };
        })
      : [],
    notes: null,
  });

  const alternar = (item: MaterialExpedicao, marcado: boolean) => {
    const nova = new Map(selecao);
    if (marcado) nova.set(chave(item), { item, quantidade: formatarQuantidade(item.available).replace(/\./g, '') });
    else nova.delete(chave(item));
    setSelecao(nova);
    setPrevia(null);
  };

  return (
    <div className="secao-janela" data-testid="secao-material">
      {!operavel && (
        <p className="mensagem-conflito" role="note">
          Janela {janela.state === 'RASCUNHO' ? 'em rascunho' : 'encerrada ou cancelada'}: as filas podem ser consultadas, mas reservar exige janela confirmada ou em preparação.
        </p>
      )}
      <div className="abas-claim" role="tablist" aria-label="Filas de material">
        {(['ELEGIVEL', 'PENDENTE'] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={fila === f}
            onClick={() => {
              setFila(f);
              setPagina(1);
            }}
            data-testid={`fila-${f.toLowerCase()}`}
          >
            {f === 'ELEGIVEL' ? 'Elegível (FIFO)' : 'Pendências'}
          </button>
        ))}
      </div>
      <form
        className="formulario-grade formulario-grade--compacta"
        onSubmit={(e) => {
          e.preventDefault();
          setPagina(1);
          setBusca(texto);
        }}
      >
        <label className="campo">
          <span className="campo-rotulo">SKU, palete, lote ou descrição</span>
          <input value={texto} maxLength={64} onChange={(e) => { setTexto(e.target.value); }} data-testid="filtro-material" />
        </label>
        <div className="acoes-linha">
          <button type="submit" className="botao-secundario">
            Filtrar
          </button>
        </div>
      </form>

      {lista.carga?.estado === 'erro' && (
        <div className="estado-erro" role="alert">
          <p>{lista.carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={lista.recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {lista.carga?.estado === 'carregando' && <p className="estado-carregando">Consultando material…</p>}
      {dados?.total === 0 && <p className="estado-vazio">{fila === 'ELEGIVEL' ? 'Nenhum material elegível para esta janela.' : 'Nenhuma pendência.'}</p>}
      {dados && dados.total > 0 && (
        <ul className="lista-material" data-testid={`lista-${fila.toLowerCase()}`}>
          {dados.items.map((m) => {
            const sel = selecao.get(chave(m));
            const erro = sel ? problemaQuantidade(sel.quantidade, m) : null;
            return (
              <li key={chave(m)} className="cartao cartao-material" data-testid="item-material" data-palete={m.palletCode}>
                <div className="cartao-material-topo">
                  {fila === 'ELEGIVEL' && podeReservar && operavel && (
                    <input
                      type="checkbox"
                      aria-label={`Selecionar ${m.sku} do palete ${m.palletCode}`}
                      checked={sel !== undefined}
                      onChange={(e) => {
                        alternar(m, e.target.checked);
                      }}
                      data-testid="selecionar-material"
                    />
                  )}
                  <strong>{m.sku}</strong> <span>{m.description}</span>
                  <span className="selo">{ROTULOS_CONDICAO[m.condition]}</span>
                </div>
                <p>
                  Palete{' '}
                  <button type="button" className="botao-link" onClick={() => { aoNavegar({ tipo: 'palete', id: m.palletId }); }}>
                    {m.palletCode}
                  </button>{' '}
                  · {m.positionCode ?? 'sem posição'} · lote {m.lot ?? 'pendente'} · origem {m.originReference ? `${textoOrigem(m.originType)}${m.originReference}` : 'pendente'}
                </p>
                <p className="campo-ajuda">
                  Saldo físico {formatarQuantidade(m.quantity)} {m.unit} · liberado {formatarQuantidade(m.released)} · reservado (todas as janelas) {formatarQuantidade(m.reserved)}
                  {m.claimLinked !== '0' ? ` · vinculado a claim ${formatarQuantidade(m.claimLinked)}` : ''} · <strong>disponível {formatarQuantidade(m.available)}</strong>
                </p>
                <p className="campo-ajuda">
                  Entrada física comprovada: {m.fifoDate ? formatarData(m.fifoDate) : 'sem data comprovada'} · data documental: {m.documentDate ? m.documentDate.split('-').reverse().join('/') : 'não informada'}
                </p>
                {m.pendencies.length > 0 && (
                  <ul className="linha-avisos">
                    {m.pendencies.map((x) => (
                      <li key={x.code}>
                        <strong>{ROTULOS_PENDENCIA_MATERIAL[x.code]}:</strong> {x.message} Próximo passo: {x.nextStep}
                        {x.responsible ? ` (registrado por ${x.responsible.name})` : ''}
                      </li>
                    ))}
                  </ul>
                )}
                {sel && (
                  <label className="campo campo--curto">
                    <span className="campo-rotulo">Quantidade a reservar ({m.unit})</span>
                    <input
                      value={sel.quantidade}
                      inputMode="decimal"
                      onChange={(e) => {
                        const nova = new Map(selecao);
                        nova.set(chave(m), { item: m, quantidade: e.target.value });
                        setSelecao(nova);
                        setPrevia(null);
                      }}
                      data-testid="quantidade-material"
                    />
                    {erro && <span className="campo-erro">{erro}</span>}
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {dados && dados.total > TAMANHO && (
        <nav className="paginacao" aria-label="Páginas do material">
          <button type="button" className="botao-secundario botao-compacto" disabled={pagina <= 1} onClick={() => { setPagina(pagina - 1); }}>
            Anterior
          </button>
          <span>
            Página {pagina} de {paginas} ({dados.total}) · {formatarDataHora(dados.consultedAt)}
          </span>
          <button type="button" className="botao-secundario botao-compacto" disabled={pagina >= paginas} onClick={() => { setPagina(pagina + 1); }}>
            Próxima
          </button>
        </nav>
      )}

      {selecao.size > 0 && (
        <section className="cartao cartao-confirmacao" aria-label="Revisar reserva" data-testid="revisao-reserva">
          <h3>Revisar reserva ({selecao.size} linha(s) em {paletesSelecionados.length} palete(s))</h3>
          {pedeMedidas && (
            <>
              <p className="campo-ajuda">A janela limita {[...metricas].filter((x) => x !== 'QUANTIDADE' && x !== 'PALETES').map((x) => rotuloMetrica({ metric: x, unit: '', weightBase: janela.restrictions.find((r) => r.metric === x)?.weightBase ?? null }).toLowerCase()).join(', ')}: informe a medida de cada unidade de carga (palete), com a fonte. Medida desconhecida mantém a reserva pendente.</p>
              {paletesSelecionados.map(([palletId, codigo]) => {
                const m = medidas.get(palletId) ?? MEDIDA_VAZIA;
                const mudar = (parcial: Partial<Medida>) => {
                  const nova = new Map(medidas);
                  nova.set(palletId, { ...m, ...parcial });
                  setMedidas(nova);
                  setPrevia(null);
                };
                return (
                  <fieldset key={palletId} className="formulario-grade formulario-grade--compacta" data-testid="medidas-palete">
                    <legend>Unidade de carga {codigo}</legend>
                    {metricas.has('CAIXAS') && (
                      <label className="campo">
                        <span className="campo-rotulo">Caixas (contagem física)</span>
                        <input value={m.boxes} inputMode="numeric" onChange={(e) => { mudar({ boxes: e.target.value }); }} />
                      </label>
                    )}
                    {metricas.has('PESO_KG') && (
                      <>
                        <label className="campo">
                          <span className="campo-rotulo">Peso (kg)</span>
                          <input value={m.weightKg} inputMode="decimal" onChange={(e) => { mudar({ weightKg: e.target.value }); }} />
                        </label>
                        <label className="campo">
                          <span className="campo-rotulo">Base</span>
                          <select value={m.weightBase} onChange={(e) => { mudar({ weightBase: e.target.value as BasePeso }); }}>
                            <option value="BRUTO">{ROTULOS_BASE_PESO.BRUTO}</option>
                            <option value="LIQUIDO">{ROTULOS_BASE_PESO.LIQUIDO}</option>
                          </select>
                        </label>
                      </>
                    )}
                    {metricas.has('VOLUME_M3') && (
                      <label className="campo">
                        <span className="campo-rotulo">Volume (m³)</span>
                        <input value={m.volumeM3} inputMode="decimal" onChange={(e) => { mudar({ volumeM3: e.target.value }); }} data-testid="medida-volume" />
                      </label>
                    )}
                    <label className="campo">
                      <span className="campo-rotulo">Fonte da medida</span>
                      <input value={m.measurementSource} maxLength={120} onChange={(e) => { mudar({ measurementSource: e.target.value }); }} data-testid="medida-fonte" />
                    </label>
                  </fieldset>
                );
              })}
            </>
          )}
          {problemas.length > 0 && <p className="estado-erro">Corrija as quantidades: {problemas.join(' ')}</p>}
          <div className="acoes-linha">
            <button
              type="button"
              className="botao-secundario"
              disabled={!conectado || problemas.length > 0}
              data-testid="previa-reserva"
              onClick={() => {
                setErroPrevia(null);
                enviarJson('POST', `${API_PREFIXO}/janelas/${janela.id}/reservas/previa`, PreviaReservaSchema, { corpo: corpo() }).then(setPrevia, (e: unknown) => {
                  setErroPrevia(mensagemDeFalha(e));
                });
              }}
            >
              Revisar medidas e capacidade
            </button>
            <button
              type="button"
              className="botao-link"
              onClick={() => {
                setSelecao(new Map());
                setPrevia(null);
              }}
            >
              Limpar seleção
            </button>
          </div>
          {erroPrevia && <p className="estado-erro">{erroPrevia}</p>}
          {previa && (
            <div data-testid="resultado-previa">
              <div className="tabela-rolagem">
                <table className="tabela-comparacao">
                  <thead>
                    <tr>
                      <th>Métrica</th>
                      <th>Limite</th>
                      <th>Reservado</th>
                      <th>Expedido</th>
                      <th>Restante</th>
                      <th>Esta reserva</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previa.metrics.map((x) => (
                      <tr key={x.restrictionId} data-estado={x.state}>
                        <td data-rotulo="Métrica">{rotuloMetrica({ metric: x.metric, unit: x.unit, weightBase: x.weightBase })}</td>
                        <td data-rotulo="Limite">{q(x.limit)}</td>
                        <td data-rotulo="Reservado">{q(x.reserved)}</td>
                        <td data-rotulo="Expedido">{q(x.shipped)}</td>
                        <td data-rotulo="Restante">{q(x.remaining)}</td>
                        <td data-rotulo="Esta reserva">{q(x.requested, 'desconhecido')}</td>
                        <td data-rotulo="Situação" className={x.state === 'OK' ? undefined : 'pendente'}>
                          {x.message} <span className="tabela-nota">({x.basis})</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {previa.blockers.length > 0 ? (
                <ul className="linha-motivos" data-testid="bloqueios-previa">
                  {previa.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : (
                <p className="mensagem-ok">Tudo cabe: material liberado e disponível, critérios atendidos e todas as restrições respeitadas.</p>
              )}
              <button
                type="button"
                className="botao-primario"
                disabled={!previa.allowed || acoes.enviando !== null || !conectado}
                data-testid="confirmar-reserva"
                onClick={() => {
                  void acoes.executar(`reservar:${janela.id}:${JSON.stringify(corpo())}`, 'POST', `${API_PREFIXO}/janelas/${janela.id}/reservas`, corpo(), ReservaDetalheSchema, 'Reserva confirmada.').then((r) => {
                    if (r) aoReservar(r.id);
                    else setPrevia(null);
                  });
                }}
              >
                {acoes.enviando !== null ? 'Confirmando…' : 'Confirmar reserva'}
              </button>
              <p className="campo-ajuda">A reserva separa estoque e capacidade para esta janela; não baixa estoque nem comprova saída. Tudo é revalidado no servidor ao confirmar.</p>
            </div>
          )}
          <MensagemAcao mensagem={acoes.mensagem} testId="mensagem-reserva" />
        </section>
      )}
    </div>
  );
}
