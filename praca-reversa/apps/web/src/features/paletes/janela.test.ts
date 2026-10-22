import type { ConteudoPalete, PaleteResumo } from '@praca-reversa/contracts';
import { describe, expect, it } from 'vitest';
import { avisoReconferencia, baseDosVolumes, somaContada, textoConferenciaInformada, textoFull, textoVolumes } from './janela';

const contagem = (counted: string | null, origin: ConteudoPalete['count']['origin']): Pick<ConteudoPalete, 'count'> => ({
  count: { state: counted === null ? 'AGUARDANDO' : 'REALIZADA', counted, expected: null, origin, at: null, by: null, reference: null },
});

const prazo = (due: boolean, dias: number): Pick<PaleteResumo, 'reconference'> => ({
  reconference: {
    startedAt: '2026-10-01T00:00:00.000Z',
    startOrigin: 'CADASTRO',
    lastMovementAt: null,
    lastMovementType: null,
    lastFullCountAt: null,
    lastFullCountOrigin: null,
    lastFullCountBy: null,
    nextAt: '2026-10-21T00:00:00.000Z',
    due,
    required: null,
    daysWithoutMovement: 20 - dias,
    daysUntilDue: dias,
  },
});

describe('janela do palete: resumo curto', () => {
  it('volumes: soma exata das contagens vigentes (sem duplicar), base breve e conteúdo sem contagem à parte', () => {
    const bipagem = [contagem('5', 'BIPAGEM'), contagem('1', 'BIPAGEM'), contagem('41', 'BIPAGEM')];
    expect(somaContada(bipagem)).toEqual({ total: '47', semContagem: 0 });
    expect(baseDosVolumes(bipagem)).toBe('lidos na bipagem');
    expect(textoVolumes(somaContada([...bipagem, contagem(null, null)]))).toBe('47 (+1 sem contagem)');
    expect(baseDosVolumes([contagem('3', 'BIPAGEM'), contagem('2', 'CONTAGEM_FISICA')])).toBe('contagens registradas');
    expect(baseDosVolumes([contagem('2.5', 'IMPORTACAO')])).toBe('do inventário');
    expect(somaContada([contagem('2.5', 'IMPORTACAO'), contagem('0.25', 'IMPORTACAO')]).total).toBe('2.75');
  });

  it('sem contagem nenhuma: "Não informado", nunca zero', () => {
    expect(textoVolumes(somaContada([contagem(null, null)]))).toBe('Não informado');
    expect(textoVolumes(somaContada([]))).toBe('Não informado');
    expect(baseDosVolumes([contagem(null, null)])).toBeNull();
  });

  it('reconferência: aviso curto só vencida ou a até 5 dias', () => {
    expect(avisoReconferencia(prazo(true, 0))).toBe('Precisa conferir');
    expect(avisoReconferencia(prazo(false, 3))).toBe('Conferir em 3 dias');
    expect(avisoReconferencia(prazo(false, 1))).toBe('Conferir em 1 dia');
    expect(avisoReconferencia(prazo(false, 12))).toBeNull();
    expect(avisoReconferencia({ reconference: null })).toBeNull();
  });
});

describe('janela do palete: dados do inventário em validação', () => {
  const inv = (x: Partial<Pick<ConteudoPalete, 'fullKind' | 'fullTags' | 'inventoryCheck' | 'latestInventory'>>) => ({
    fullKind: null,
    fullTags: [],
    inventoryCheck: null,
    latestInventory: null,
    ...x,
  });

  it('FULL com etiquetas e FRACIONADO como na planilha; nada informado = null', () => {
    expect(textoFull([inv({ fullKind: 'FULL', fullTags: ['3/9'] })])).toBe('FULL 3/9');
    expect(textoFull([inv({ fullKind: 'FULL', fullTags: ['1/3', '2/3'] })])).toBe('FULL 1/3, 2/3');
    expect(textoFull([inv({ fullKind: 'FRACIONADO' })])).toBe('Fracionado');
    expect(textoFull([inv({})])).toBeNull();
  });

  it('conferência informada por linha: data sem fuso, "a validar" ou sem data; nunca inventa data', () => {
    expect(textoConferenciaInformada([inv({ inventoryCheck: { state: 'INFORMADA', date: '2026-10-16', text: '16-10' } })])).toBe('Conferência 16/10/2026');
    expect(textoConferenciaInformada([inv({ inventoryCheck: { state: 'A_VALIDAR', date: null, text: 'VALIDAR' } })])).toBe('Conferência a validar');
    expect(textoConferenciaInformada([inv({ inventoryCheck: { state: 'SEM_DATA', date: null, text: null } })])).toBe('Conferência sem data');
    expect(textoConferenciaInformada([inv({})])).toBeNull();
  });
});
