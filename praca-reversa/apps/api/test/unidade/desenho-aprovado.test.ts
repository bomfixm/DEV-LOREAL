import { LayoutSchema, chaveEndereco, expandirSegmentos, normalizarEndereco } from '@praca-reversa/contracts';
import { describe, expect, it } from 'vitest';
import { gerarDesenhoAprovado, lerDesenhoAprovado, nomenclaturaAprovada } from '../../src/modules/layout/desenho-aprovado.js';

const config = lerDesenhoAprovado();
const gerado = gerarDesenhoAprovado(config);

/** Converte o desenho gerado para o contrato (mesmas regras de sobreposição da API). */
function comoContrato() {
  let n = 0;
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const idFileira = new Map(gerado.fileiras.map((f) => [f.codigo, id()]));
  return LayoutSchema.parse({
    id: id(),
    code: 'PRACA-TESTE',
    version: config.versao,
    revision: 1,
    name: 'teste',
    unit: 'UNIDADE_DE_DESENHO',
    origin: 'SUPERIOR_ESQUERDO',
    width: gerado.largura,
    height: gerado.altura,
    totalCapacity: null,
    schematic: true,
    fictional: false,
    elements: gerado.elementos.map((e) => ({
      id: id(),
      kind: e.tipo,
      code: e.codigo,
      label: e.rotulo,
      fictional: e.ficticio,
      x: e.x,
      y: e.y,
      width: e.largura,
      height: e.altura,
      labelBox: e.caixaRotulo ? { x: e.caixaRotulo.x, y: e.caixaRotulo.y, width: e.caixaRotulo.largura, height: e.caixaRotulo.altura } : null,
    })),
    rows: gerado.fileiras.map((f) => ({
      id: idFileira.get(f.codigo),
      code: f.codigo,
      label: f.rotulo,
      order: f.ordem,
      blockCode: f.blocoCodigo,
      x: f.x,
      y: f.y,
      width: f.largura,
      height: f.altura,
      labelBox: { x: f.caixaRotulo.x, y: f.caixaRotulo.y, width: f.caixaRotulo.largura, height: f.caixaRotulo.altura },
      side: f.lado,
    })),
    positions: gerado.posicoes.map((p) => ({
      id: id(),
      code: p.codigo,
      provisionalCode: true,
      rowId: idFileira.get(p.fileiraCodigo),
      number: p.numero,
      x: p.x,
      y: p.y,
      width: p.largura,
      height: p.altura,
      available: p.disponivel,
      unavailableReason: p.disponivel ? null : (p.motivoIndisponibilidade ?? null),
      occupancySurveyed: false,
      deactivated: p.desativada ?? false,
    })),
  });
}

describe('desenho aprovado da praça (PDF de referência)', () => {
  it('tem 194 posições ativas, 300 desativadas e 494 no desenho', () => {
    expect(gerado.posicoes).toHaveLength(494);
    expect(gerado.posicoes.filter((p) => p.disponivel && !p.desativada)).toHaveLength(194);
    expect(gerado.posicoes.filter((p) => p.desativada && !p.disponivel)).toHaveLength(300);
  });

  it('distribui 17 à esquerda (F01–F07) e 15 à direita (F08–F12); 25 em cada fileira desativada', () => {
    const contagem = (codigo: string) => gerado.posicoes.filter((p) => p.fileiraCodigo === codigo).length;
    expect(['F01', 'F02', 'F03', 'F04', 'F05', 'F06', 'F07'].map(contagem)).toEqual([17, 17, 17, 17, 17, 17, 17]);
    expect(['F08', 'F09', 'F10', 'F11', 'F12'].map(contagem)).toEqual([15, 15, 15, 15, 15]);
    for (let i = 1; i <= 12; i++) expect(contagem(`D${String(i).padStart(2, '0')}`)).toBe(25);
  });

  it('tem 7 blocos por área, simples nos extremos e duplos no meio, com 6 corredores entre blocos', () => {
    const blocos = gerado.elementos.filter((e) => e.tipo === 'BLOCO').map((e) => e.codigo);
    expect(blocos).toEqual(['DB01', 'DB02', 'DB03', 'DB04', 'DB05', 'DB06', 'DB07', 'FB01', 'FB02', 'FB03', 'FB04', 'FB05', 'FB06', 'FB07']);
    const fileirasDe = (bloco: string) => gerado.fileiras.filter((f) => f.blocoCodigo === bloco).map((f) => f.codigo);
    expect(fileirasDe('FB01')).toEqual(['F01']);
    expect(fileirasDe('FB02')).toEqual(['F02', 'F03']);
    expect(fileirasDe('FB06')).toEqual(['F10', 'F11']);
    expect(fileirasDe('FB07')).toEqual(['F12']);
    const corredores = gerado.elementos.filter((e) => e.tipo === 'CORREDOR').map((e) => e.codigo);
    expect(corredores.filter((c) => c.startsWith('FC'))).toHaveLength(6);
    expect(corredores.filter((c) => c.startsWith('DC'))).toHaveLength(6);
    expect(corredores).toContain('CORR-TRANSV');
    expect(corredores).toContain('CORR-FRONTAL');
  });

  it('P01 fica no topo, os topos se alinham e P16/P17 sobram para baixo; eixos das áreas alinhados', () => {
    const p = (codigo: string) => gerado.posicoes.find((x) => x.codigo === codigo);
    const topos = ['F01', 'F07', 'F08', 'F12'].map((f) => p(`${f}-P01`)?.y);
    expect(new Set(topos).size).toBe(1);
    expect(p('F01-P02')?.y ?? 0).toBeGreaterThan(p('F01-P01')?.y ?? 0);
    expect(p('F07-P17')?.y ?? 0).toBeGreaterThan(p('F08-P15')?.y ?? 0);
    for (let i = 1; i <= 12; i++) {
      const n = String(i).padStart(2, '0');
      expect(p(`D${n}-P01`)?.x).toBe(p(`F${n}-P01`)?.x);
    }
    // Área desativada acima da área ativa.
    expect(p('D01-P25')?.y ?? 0).toBeLessThan(p('F01-P01')?.y ?? 0);
  });

  it('registra os lados: faixas duplas esquerda/direita, simples únicas', () => {
    const lado = (codigo: string) => gerado.fileiras.find((f) => f.codigo === codigo)?.lado;
    expect([lado('F01'), lado('F02'), lado('F03'), lado('F12')]).toEqual(['UNICO', 'ESQUERDO', 'DIREITO', 'UNICO']);
  });

  it('aplica a nomenclatura confirmada: Fileiras 11–16 e GR', () => {
    expect(nomenclaturaAprovada(config).map((n) => [n.codigo, n.nome, n.prefixo])).toEqual([
      ['FB01', 'Fileira 11', '11'],
      ['FB02', 'Fileira 12', '12'],
      ['FB03', 'Fileira 13', '13'],
      ['FB04', 'Fileira 14', '14'],
      ['FB05', 'Fileira 15', '15'],
      ['FB06', 'Fileira 16', '16'],
      ['FB07', 'GR — Grade', 'GR'],
    ]);
    const fb05 = gerado.elementos.find((e) => e.codigo === 'FB05');
    expect([fb05?.nomeOperacional, fb05?.prefixoEndereco]).toEqual(['Fileira 15', '15']);
    expect(gerado.elementos.find((e) => e.codigo === 'DB01')?.prefixoEndereco ?? null).toBeNull();
  });

  it('é um layout válido pelo contrato (sem sobreposição; títulos fora das posições)', () => {
    const layout = comoContrato();
    expect(layout.positions).toHaveLength(494);
  });
});

describe('endereço real (fileira + código local)', () => {
  it('normaliza espaços, caixa e travessão por regra registrada, preservando dígitos', () => {
    const casos: [string, string, string[]][] = [
      ['15 - A120', '15 - A120', []],
      ['15- A120', '15 - A120', ['N4']],
      ['15 - A 120', '15 - A120', ['N4']],
      ['  15 -  a120 ', '15 - A120', ['N1', 'N2']],
      ['  15-a120', '15 - A120', ['N1', 'N2', 'N4']],
      ['15 – A120', '15 - A120', ['N3']],
      ['GR - 5', 'GR - 5', []],
      ['gr-05', 'GR - 05', ['N2', 'N4']],
    ];
    for (const [entrada, saida, regras] of casos) {
      const r = normalizarEndereco(entrada);
      expect(r.ok && r.endereco).toBe(saida);
      expect(r.ok && r.regras).toEqual(regras);
    }
  });

  it('"15 - A120" e "13 - A120" são chaves distintas; A120 sozinho não identifica posição', () => {
    const a = normalizarEndereco('15 - A120');
    const b = normalizarEndereco('13 - A120');
    expect(a.ok && a.chave).toBe(chaveEndereco('15', 'A120'));
    expect(b.ok && b.chave).toBe('13|A120');
    expect(a.ok && b.ok && a.chave !== b.chave).toBe(true);
    const sozinho = normalizarEndereco('A120');
    expect(sozinho.ok ? null : sozinho.codigo).toBe('ENDERECO_SEM_FILEIRA');
  });

  it('não completa letra ausente nem corrige números', () => {
    const r = normalizarEndereco('14 - 130');
    expect(r.ok && r.endereco).toBe('14 - 130');
    expect(r.ok && r.chave).not.toBe('14|A130');
  });

  it('expande sequências com passo, intervalos irregulares e sentido descendente', () => {
    const doze = expandirSegmentos('A79-A89/2, A103-A123/2');
    expect(doze.ok && doze.codigos).toEqual(['A79', 'A81', 'A83', 'A85', 'A87', 'A89', 'A103', 'A105', 'A107', 'A109', 'A111', 'A113', 'A115', 'A117', 'A119', 'A121', 'A123']);
    const desce = expandirSegmentos('A133-A101/2');
    expect(desce.ok && desce.codigos.at(0)).toBe('A133');
    expect(desce.ok && desce.codigos).toHaveLength(17);
    const gr = expandirSegmentos('1-15');
    expect(gr.ok && gr.codigos.at(-1)).toBe('15');
    expect(expandirSegmentos('A101-A132/2').ok).toBe(false);
    expect(expandirSegmentos('A101-A103, A102-A103').ok).toBe(false);
    expect(expandirSegmentos('A1-B5').ok).toBe(false);
  });
});
