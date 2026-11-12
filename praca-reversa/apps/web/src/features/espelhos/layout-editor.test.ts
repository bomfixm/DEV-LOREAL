import { describe, expect, it } from 'vitest';
import { desfazer, iniciarHistorico, refazer, registrar, restaurar, substituir } from './historico';
import { aplicarLayout, CHAVE_ARMAZENAMENTO, layoutsDosPaletes, modelosSalvos, salvarModelo, type MemoriaLayouts } from './layout-armazenamento';
import { alterarBloco, assinaturaLayout, CLASSICO, LAYOUT_PADRAO, lerLayout, noPasso, OPERACIONAL_LIMPO, PAPEL, PX_POR_MM } from './layout-modelo';
import { problemasDaFolha } from './verificacao';

const memoria = (): MemoriaLayouts & { dados: Map<string, string> } => {
  const dados = new Map<string, string>();
  return { dados, getItem: (k) => dados.get(k) ?? null, setItem: (k, v) => { dados.set(k, v); } };
};

describe('modelo de layout', () => {
  it('modelos do sistema são válidos e cabem na folha', () => {
    for (const l of [OPERACIONAL_LIMPO, CLASSICO]) {
      expect(lerLayout(l)).toEqual(l);
      for (const b of Object.values(l.blocos)) {
        expect(b.x + b.largura).toBeLessThanOrEqual(PAPEL.largura);
        expect(b.y + (b.altura ?? 0)).toBeLessThanOrEqual(PAPEL.altura);
      }
    }
  });

  it('recusa HTML, CSS, fonte fora da lista e campos fora dos limites', () => {
    expect(lerLayout({ ...OPERACIONAL_LIMPO, blocos: { ...OPERACIONAL_LIMPO.blocos, palete: { ...OPERACIONAL_LIMPO.blocos.palete, estilo: { ...OPERACIONAL_LIMPO.blocos.palete.estilo, fonte: 'Comic Sans; color:red' } } } })).toBeNull();
    expect(lerLayout({ ...OPERACIONAL_LIMPO, blocos: { ...OPERACIONAL_LIMPO.blocos, palete: { ...OPERACIONAL_LIMPO.blocos.palete, estilo: { ...OPERACIONAL_LIMPO.blocos.palete.estilo, tamanho: 500 } } } })).toBeNull();
    expect(lerLayout({ ...OPERACIONAL_LIMPO, papel: { formato: 'A3', orientacao: 'paisagem', largura: 400, altura: 287 } })).toBeNull();
    expect(lerLayout('<script>alert(1)</script>')).toBeNull();
    expect(lerLayout({ ...OPERACIONAL_LIMPO, extra: '<b>x</b>' })).toEqual(OPERACIONAL_LIMPO);
  });

  it('não deixa bloco sair da folha nem esconder campo de dado', () => {
    const l = alterarBloco(OPERACIONAL_LIMPO, 'palete', { x: 280, largura: 60, visivel: false });
    expect(l.blocos.palete.x + l.blocos.palete.largura).toBeLessThanOrEqual(PAPEL.largura);
    expect(l.blocos.palete.visivel).toBe(true);
    expect(alterarBloco(OPERACIONAL_LIMPO, 'formulario', { visivel: false }).blocos.formulario.visivel).toBe(false);
  });

  it('o mesmo deslocamento na tela dá a mesma coordenada em qualquer zoom', () => {
    // 50 mm de arraste vistos a 50% e a 150%: na tela são pixels diferentes, na folha é o mesmo valor.
    const mm = (pixels: number, zoom: number) => noPasso(10 + pixels / (zoom * PX_POR_MM));
    expect(mm(50 * PX_POR_MM * 0.5, 0.5)).toBe(60);
    expect(mm(50 * PX_POR_MM * 1.5, 1.5)).toBe(60);
    expect(mm(50 * PX_POR_MM * 1.5 + 0.4, 1.5)).toBe(60);
  });
});

describe('histórico do rascunho', () => {
  it('um gesto inteiro é um passo; desfazer, refazer e restaurar', () => {
    let h = iniciarHistorico(OPERACIONAL_LIMPO);
    const a = alterarBloco(h.presente, 'palete', { x: 100 });
    h = registrar(h, a);
    h = substituir(h, alterarBloco(a, 'palete', { x: 120 }));
    h = substituir(h, alterarBloco(a, 'palete', { x: 150 }));
    expect(h.passado).toHaveLength(1);
    h = desfazer(h);
    expect(h.presente).toBe(OPERACIONAL_LIMPO);
    h = refazer(h);
    expect(h.presente.blocos.palete.x).toBe(150);
    h = restaurar(h);
    expect(h.presente).toBe(OPERACIONAL_LIMPO);
    h = desfazer(h);
    expect(h.presente.blocos.palete.x).toBe(150);
  });
});

describe('aplicar a um lote (A e B marcados, C fora)', () => {
  it('A e B recebem o layout novo, C e o padrão não mudam; modelo salvo não leva dados', () => {
    const m = memoria();
    const [A, B, C] = ['a-1', 'b-2', 'c-3'];
    // C já tinha um layout aplicado antes (clássico).
    aplicarLayout([C], CLASSICO, m);
    const antesC = layoutsDosPaletes([C], m).get(C);
    // Número do palete no canto superior direito, 24 pt.
    const novo = alterarBloco(alterarBloco(OPERACIONAL_LIMPO, 'palete', { x: 217, y: 8, largura: 62, estilo: { tamanho: 24, alinhamento: 'direita' } }), 'endereco', { largura: 190 });
    aplicarLayout([A, B], novo, m);
    const depois = layoutsDosPaletes([A, B, C, 'd-4'], m);
    expect(depois.get(A)?.blocos.palete).toMatchObject({ x: 217, y: 8, estilo: { tamanho: 24 } });
    expect(assinaturaLayout(depois.get(B) ?? LAYOUT_PADRAO)).toBe(assinaturaLayout(depois.get(A) ?? LAYOUT_PADRAO));
    expect(depois.get(C)).toEqual(antesC);
    expect(depois.get('d-4')).toBe(LAYOUT_PADRAO);
    expect(LAYOUT_PADRAO).toBe(OPERACIONAL_LIMPO);
    expect(OPERACIONAL_LIMPO.blocos.palete.x).toBe(192);

    salvarModelo('Topo à direita', novo, new Date('2026-11-12T10:00:00Z'), m);
    const guardado = m.dados.get(CHAVE_ARMAZENAMENTO) ?? '';
    const modeloGuardado = (JSON.parse(guardado) as { modelos: { layout: string }[]; layouts: Record<string, unknown> });
    expect(JSON.stringify(modeloGuardado.layouts[modeloGuardado.modelos[0]?.layout ?? ''])).not.toMatch(/a-1|b-2|c-3/u);
    expect(modelosSalvos(m)).toHaveLength(1);
    expect(modelosSalvos(m)[0]?.layout).toEqual(novo);
    // Só o vínculo id → layout fica guardado; nenhum valor de palete, nota ou remetente.
    expect(Object.keys(JSON.parse(guardado) as object).sort()).toEqual(['aplicados', 'layouts', 'modelos']);
  });

  it('armazenamento corrompido ou adulterado volta ao padrão', () => {
    const m = memoria();
    m.setItem(CHAVE_ARMAZENAMENTO, '{"aplicados":{"x":"h"},"layouts":{"h":{"versao":1,"css":"body{display:none}"}}}');
    expect(layoutsDosPaletes(['x'], m).get('x')).toBe(LAYOUT_PADRAO);
    m.setItem(CHAVE_ARMAZENAMENTO, 'não é json');
    expect(layoutsDosPaletes(['x'], m).get('x')).toBe(LAYOUT_PADRAO);
  });
});

describe('verificação da folha', () => {
  it('fora do papel e conteúdo cortado são erro; sobreposição e fora da margem são aviso', () => {
    const p = problemasDaFolha([
      { campo: 'palete', x: 250, y: 10, largura: 60, altura: 10 },
      { campo: 'endereco', x: 10, y: 10, largura: 100, altura: 12 },
      { campo: 'demo', x: 50, y: 15, largura: 40, altura: 5 },
      { campo: 'emissao', x: 2, y: 190, largura: 50, altura: 4 },
      { campo: 'tabela', x: 10, y: 40, largura: 260, altura: 130, transborda: true },
    ], 8);
    expect(p.filter((x) => x.gravidade === 'erro').map((x) => x.campo).sort()).toEqual(['palete', 'tabela']);
    expect(p.some((x) => x.gravidade === 'aviso' && x.texto.includes('sobrepostos'))).toBe(true);
    expect(p.some((x) => x.campo === 'emissao' && x.gravidade === 'aviso')).toBe(true);
  });
});
