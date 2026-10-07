import { describe, expect, it } from 'vitest';
import { lerArquivosDemo } from '../../src/demo/arquivos.js';
import { montarFixturesDemo, validarFixtures } from '../../src/demo/fixtures.js';
import { idDeterministico } from '../../src/demo/ids.js';
import { gerarLayoutInformado } from '../../src/demo/layout-informado.js';

const arquivos = lerArquivosDemo();

describe('esquema informado', () => {
  it('segue a sequência central: única de 15, par de 15, par de 17, única de 17', () => {
    const layout = gerarLayoutInformado(arquivos.layoutInformado);
    const porFileira = layout.fileiras.map((f) => layout.posicoes.filter((p) => p.fileiraCodigo === f.codigo).length);
    expect(porFileira).toEqual([15, 15, 15, 17, 17, 17]);
    expect(layout.posicoes).toHaveLength(96);
    expect(layout.elementos.map((e) => [e.codigo, e.tipo])).toEqual([
      ['B01', 'BLOCO'],
      ['B02', 'BLOCO'],
      ['B03', 'BLOCO'],
      ['B04', 'BLOCO'],
    ]);
  });

  it('repetições na configuração geram mais pares sem mudar códigos anteriores', () => {
    const config = structuredClone(arquivos.layoutInformado);
    const parDe15 = config.sequencia[1];
    if (!parDe15) throw new Error('sequência incompleta');
    parDe15.repeticoes = 3;
    const layout = gerarLayoutInformado(config);
    expect(layout.fileiras).toHaveLength(10);
    expect(layout.posicoes.find((p) => p.codigo === 'F01-P15')).toBeDefined();
    expect(layout.fileiras.map((f) => f.blocoCodigo)).toEqual(['B01', 'B02', 'B02', 'B03', 'B03', 'B04', 'B04', 'B05', 'B05', 'B06']);
  });

  it('títulos e rótulos ficam fora das posições selecionáveis', () => {
    const layout = gerarLayoutInformado(arquivos.layoutInformado);
    const cruza = (a: { x: number; y: number; largura: number; altura: number }, b: typeof a) =>
      a.x < b.x + b.largura && b.x < a.x + a.largura && a.y < b.y + b.altura && b.y < a.y + a.altura;
    const caixas = [...layout.elementos.map((e) => e.caixaRotulo), ...layout.fileiras.map((f) => f.caixaRotulo)];
    for (const caixa of caixas) {
      if (!caixa) continue;
      for (const posicao of layout.posicoes) expect(cruza(caixa, posicao)).toBe(false);
    }
  });

  it('recusa espaçamento entre blocos que não comporta o título', () => {
    const config = structuredClone(arquivos.layoutInformado);
    config.geometria.espacoEntreBlocos = 20;
    expect(() => gerarLayoutInformado(config)).toThrow(/título/);
  });
});

describe('fixtures', () => {
  it('são válidas pelos contratos e determinísticas', () => {
    const a = montarFixturesDemo(arquivos, new Date('2026-10-01T00:00:00Z'));
    const b = montarFixturesDemo(arquivos, new Date('2030-01-01T00:00:00Z'));
    expect(b.posicoes.map((p) => p.id)).toEqual(a.posicoes.map((p) => p.id));
    expect(b.paletes).toEqual(a.paletes);
    const { layouts, paletes } = validarFixtures(a);
    // Praça da demonstração: desenho aprovado (194 ativas + 300 desativadas); navegação: 384.
    expect(layouts.map((l) => l.positions.length)).toEqual([494, 384]);
    expect(paletes).toHaveLength(343);
  });

  it('recusam mapeamento divergente das fixtures da etapa 01', () => {
    const alterado = structuredClone(arquivos);
    const primeiro = alterado.mapeamento.mapeamento[0];
    if (!primeiro) throw new Error('mapeamento vazio');
    primeiro.posicaoEtapa02 = 'F09-P99';
    expect(() => montarFixturesDemo(alterado, new Date())).toThrow(/não existe/);
  });

  it('UUID determinístico é versão 5 e estável', () => {
    const id = idDeterministico('posicao:F01-P01');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idDeterministico('posicao:F01-P01')).toBe(id);
    expect(idDeterministico('posicao:F01-P02')).not.toBe(id);
  });
});
