import { describe, expect, it } from 'vitest';
import { calcularConsumo, restante, verificar, verificarTodas, type LinhaCarga, type MedidaCarga, type RestricaoRegra } from '../../src/modules/janelas/capacidade.js';
import { disponivelParaReserva, elegivel, falhasDeCriterio, janelaOperavel, pendenciasDoMaterial, problemasParaExpedir, type CriteriosRegra, type MaterialRegra } from '../../src/modules/janelas/regras.js';

const restricao = (metrica: RestricaoRegra['metrica'], limite: string | null, extra: Partial<RestricaoRegra> = {}): RestricaoRegra => ({
  id: `r-${metrica}`,
  metrica,
  unidade: metrica === 'QUANTIDADE' ? 'UN' : metrica === 'VOLUME_M3' ? 'm³' : metrica === 'PESO_KG' ? 'kg' : metrica === 'CAIXAS' ? 'caixas' : 'paletes',
  basePeso: metrica === 'PESO_KG' ? 'BRUTO' : null,
  limite,
  reservado: '0',
  expedido: '0',
  ...extra,
});
const linha = (palete: string, sku: string, quantidade: string, unidade = 'UN'): LinhaCarga => ({ paleteId: palete, paleteCodigo: palete.toUpperCase(), sku, unidade, quantidade });
const medida = (palete: string, m: Partial<MedidaCarga>): MedidaCarga => ({ paleteId: palete, caixas: null, pesoKg: null, basePeso: null, volumeM3: null, fonte: 'Fonte fictícia', ...m });

describe('capacidade da janela (R21–R23)', () => {
  it('peças somam só na mesma unidade; unidade diferente não é convertida por suposição', () => {
    const r = restricao('QUANTIDADE', '20');
    expect(calcularConsumo(r, [linha('a', 'X', '8'), linha('b', 'Y', '4')], new Map())).toMatchObject({ valor: '12', situacao: 'OK', base: 'mesma unidade (UN), fator 1' });
    const cx = calcularConsumo(r, [linha('a', 'X', '8'), linha('b', 'Y', '2', 'CX')], new Map());
    expect([cx.valor, cx.situacao, cx.mensagem]).toEqual([null, 'INCOMPATIVEL', expect.stringMatching(/Y em CX sem fator aprovado para UN/)]);
  });

  it('paletes contam unidades físicas distintas (várias linhas no mesmo palete contam um), sem frações', () => {
    const c = calcularConsumo(restricao('PALETES', '2'), [linha('a', 'X', '1'), linha('a', 'Y', '7'), linha('b', 'Z', '0.5')], new Map());
    expect([c.valor, c.situacao]).toEqual(['2', 'OK']);
  });

  it('m³, peso e caixas exigem medida da unidade de carga; peso bruto e líquido não se misturam', () => {
    const carga = [linha('a', 'X', '5'), linha('b', 'Y', '5')];
    const so = new Map([['a', medida('a', { volumeM3: '1.2', caixas: '3', pesoKg: '100', basePeso: 'BRUTO' })]]);
    const volume = calcularConsumo(restricao('VOLUME_M3', '10'), carga, so);
    expect([volume.valor, volume.situacao]).toEqual([null, 'PENDENTE']);
    expect(volume.mensagem).toMatch(/Volume \(m³\) desconhecido da unidade de carga B.*não é inferido do número de paletes/);
    expect(calcularConsumo(restricao('CAIXAS', '10'), carga, so).mensagem).toMatch(/Peças soltas não viram caixas/);
    const ambas = new Map([
      ['a', medida('a', { pesoKg: '100', basePeso: 'BRUTO' })],
      ['b', medida('b', { pesoKg: '80.25', basePeso: 'LIQUIDO' })],
    ]);
    const misturado = calcularConsumo(restricao('PESO_KG', '500'), carga, ambas);
    expect(misturado.situacao).toBe('INCOMPATIVEL');
    expect(misturado.mensagem).toMatch(/B \(líquido\)/);
    const brutos = new Map([
      ['a', medida('a', { pesoKg: '100', basePeso: 'BRUTO', volumeM3: '0.1' })],
      ['b', medida('b', { pesoKg: '80.25', basePeso: 'BRUTO', volumeM3: '0.2' })],
    ]);
    expect(calcularConsumo(restricao('PESO_KG', '500'), carga, brutos)).toMatchObject({ valor: '180.25', situacao: 'OK' });
    // Decimais exatos: 0,1 + 0,2 = 0,3 (sem ponto flutuante).
    expect(calcularConsumo(restricao('VOLUME_M3', '0.3'), carga, brutos).valor).toBe('0.3');
    expect(verificar(restricao('VOLUME_M3', '0.3'), calcularConsumo(restricao('VOLUME_M3', '0.3'), carga, brutos)).state).toBe('OK');
  });

  it('limite pendente não é ilimitado; limite zero não aceita reserva positiva; restante = limite − reservado − expedido', () => {
    const consumo = calcularConsumo(restricao('QUANTIDADE', null), [linha('a', 'X', '1')], new Map());
    const pendente = verificar(restricao('QUANTIDADE', null), consumo);
    expect([pendente.state, pendente.remaining]).toEqual(['PENDENTE', null]);
    expect(pendente.message).toMatch(/não é ilimitada/);
    const zero = restricao('QUANTIDADE', '0');
    const semCapacidade = verificar(zero, calcularConsumo(zero, [linha('a', 'X', '1')], new Map()));
    expect(semCapacidade.state).toBe('EXCEDE');
    expect(semCapacidade.message).toMatch(/é zero/);
    const usada = restricao('QUANTIDADE', '20', { reservado: '8', expedido: '6' });
    expect(restante(usada)).toBe('6');
    expect(verificar(usada, calcularConsumo(usada, [linha('a', 'X', '7')], new Map()))).toMatchObject({ state: 'EXCEDE', requested: '7', remaining: '6' });
    expect(verificar(usada, calcularConsumo(usada, [linha('a', 'X', '6')], new Map())).state).toBe('OK');
    // Revalidação da própria reserva: a parte já reservada por ela volta ao restante.
    expect(verificar(usada, calcularConsumo(usada, [linha('a', 'X', '9')], new Map()), '3').state).toBe('OK');
  });

  it('todas as restrições passam juntas: espaço em peças com m³ estourado bloqueia com motivo específico; janela sem restrição fica pendente', () => {
    const carga = [linha('a', 'X', '5')];
    const medidas = new Map([['a', medida('a', { volumeM3: '2' })]]);
    const { metricas, bloqueios } = verificarTodas([restricao('QUANTIDADE', '100'), restricao('VOLUME_M3', '1.5')], carga, medidas);
    expect(metricas.map((m) => m.state)).toEqual(['OK', 'EXCEDE']);
    expect(bloqueios).toHaveLength(1);
    expect(bloqueios[0]).toMatch(/volume.*restante 1.5/);
    expect(verificarTodas([], carga, medidas).bloqueios[0]).toMatch(/nenhuma restrição de capacidade declarada/);
  });
});

const material = (extra: Partial<MaterialRegra> = {}): MaterialRegra => ({
  paleteCodigo: 'PAL-X',
  arquivado: false,
  estadoFluxo: 'EM_ESTOQUE',
  estadoConferencia: 'RECONCILIADO',
  conferenciaAtiva: false,
  paleteBloqueio: null,
  linhaBloqueio: null,
  quantidade: '12',
  reservada: '0',
  liberada: '12',
  vinculada: '0',
  condicao: 'SAUDAVEL',
  lote: 'L1',
  origemTipo: 'DEVOLUCAO',
  origemReferencia: 'DEV-1',
  ...extra,
});
const criterios = (extra: Partial<CriteriosRegra> = {}): CriteriosRegra => ({ definidos: true, condicoes: ['SAUDAVEL'], origemQualquer: true, origens: [], exigeLote: false, exigeOrigem: false, ...extra });

describe('elegibilidade e liberação (R11, R22, R26)', () => {
  it('disponível = liberado − reservado, sem a parte vinculada a claim', () => {
    expect(disponivelParaReserva(material({ reservada: '8' }))).toBe('4');
    expect(disponivelParaReserva(material({ liberada: '6' }))).toBe('6');
    expect(disponivelParaReserva(material({ vinculada: '4', reservada: '2' }))).toBe('6');
    expect(disponivelParaReserva(material({ liberada: '3', reservada: '3' }))).toBe('0');
  });

  it('bloqueio, conferência pendente e conteúdo desconhecido tiram da fila elegível; parte não liberada é pendência parcial', () => {
    expect(elegivel(material(), criterios())).toBe(true);
    expect(elegivel(material({ linhaBloqueio: 'Avaria' }), criterios())).toBe(false);
    expect(elegivel(material({ paleteBloqueio: 'Avaliação' }), criterios())).toBe(false);
    expect(elegivel(material({ estadoConferencia: 'PARCIAL' }), null)).toBe(false);
    expect(elegivel(material({ conferenciaAtiva: true }), null)).toBe(false);
    const parcial = pendenciasDoMaterial(material({ liberada: '5' }), null);
    expect(parcial.map((p) => [p.code, p.bloqueia])).toEqual([['NAO_LIBERADO', false]]);
    expect(elegivel(material({ liberada: '5' }), null)).toBe(true);
    expect(pendenciasDoMaterial(material({ liberada: '0' }), null).map((p) => [p.code, p.bloqueia])).toEqual([['NAO_LIBERADO', true]]);
    expect(pendenciasDoMaterial(material({ vinculada: '2' }), null).map((p) => p.code)).toEqual(['VINCULADO_CLAIM']);
  });

  it('critérios: condição, origem, lote; critérios pendentes bloqueiam; FIFO nunca supera bloqueio (sem atalho na regra)', () => {
    expect(falhasDeCriterio(material({ condicao: 'AVARIADO' }), criterios()).map((f) => f.code)).toEqual(['CRITERIO_CONDICAO']);
    expect(falhasDeCriterio(material({ origemReferencia: null, origemTipo: null }), criterios({ exigeOrigem: true })).map((f) => f.code)).toEqual(['CRITERIO_ORIGEM']);
    expect(falhasDeCriterio(material({ origemTipo: 'NOTA_FISCAL' }), criterios({ origemQualquer: false, origens: ['DEVOLUCAO'] })).map((f) => f.code)).toEqual(['CRITERIO_ORIGEM']);
    expect(falhasDeCriterio(material({ lote: null }), criterios({ exigeLote: true })).map((f) => f.code)).toEqual(['CRITERIO_LOTE']);
    expect(falhasDeCriterio(material(), criterios({ definidos: false })).map((f) => f.code)).toEqual(['CRITERIOS_PENDENTES']);
    // Bloqueio posterior à reserva impede expedir (a liberação já cobre o reservado).
    expect(problemasParaExpedir(material({ reservada: '4', linhaBloqueio: 'Recall' }), criterios())).toEqual(['Material bloqueado: Recall']);
    expect(problemasParaExpedir(material({ reservada: '4', liberada: '4' }), criterios())).toEqual([]);
  });

  it('janela operável só confirmada ou em preparação', () => {
    expect(janelaOperavel('CONFIRMADA')).toBeNull();
    expect(janelaOperavel('PREPARACAO')).toBeNull();
    for (const s of ['RASCUNHO', 'ENCERRADA', 'CANCELADA'] as const) expect(janelaOperavel(s)).toMatch(/exigem janela confirmada/);
  });
});
