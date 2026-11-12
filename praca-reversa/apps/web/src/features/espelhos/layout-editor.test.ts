import { describe, expect, it } from 'vitest';
import { desfazer, iniciarHistorico, refazer, registrar, restaurar, substituir } from './historico';
import { aplicarLayout, aplicarLayoutEmbarque, CHAVE_ARMAZENAMENTO, layoutDoEmbarque, layoutsDosPaletes, modelosSalvos, salvarModelo, type MemoriaLayouts } from './layout-armazenamento';
import {
  adicionarTexto, ajustarTamanho, alinharItens, alterarBloco, alterarItem, assinaturaLayout, blocoDe, caixaDoItem, CLASSICO, deslocarItens, EMBARQUE_CLASSICO, EMBARQUE_LIMPO, LAYOUT_PADRAO, lerLayout,
  MAX_TEXTOS, nomeDoItem, noPasso, OPERACIONAL_LIMPO, PAPEL, PX_POR_MM, removerTextos,
} from './layout-modelo';
import { problemasDaFolha } from './verificacao';

const P = (l: Parameters<typeof blocoDe>[0]) => blocoDe(l, 'palete');
const memoria = (): MemoriaLayouts & { dados: Map<string, string> } => {
  const dados = new Map<string, string>();
  return { dados, getItem: (k) => dados.get(k) ?? null, setItem: (k, v) => { dados.set(k, v); } };
};

describe('modelo de layout', () => {
  it('modelos do sistema são válidos e cabem na folha', () => {
    for (const l of [OPERACIONAL_LIMPO, CLASSICO, EMBARQUE_LIMPO, EMBARQUE_CLASSICO]) {
      expect(lerLayout(l)).toEqual(l);
      for (const b of Object.values(l.blocos)) {
        expect(b.x + b.largura).toBeLessThanOrEqual(PAPEL.largura);
        expect(b.y + (b.altura ?? 0)).toBeLessThanOrEqual(PAPEL.altura);
      }
    }
  });

  it('recusa HTML, CSS, fonte fora da lista e campos fora dos limites', () => {
    expect(lerLayout({ ...OPERACIONAL_LIMPO, blocos: { ...OPERACIONAL_LIMPO.blocos, palete: { ...P(OPERACIONAL_LIMPO), estilo: { ...P(OPERACIONAL_LIMPO).estilo, fonte: 'Comic Sans; color:red' } } } })).toBeNull();
    expect(lerLayout({ ...OPERACIONAL_LIMPO, blocos: { ...OPERACIONAL_LIMPO.blocos, palete: { ...P(OPERACIONAL_LIMPO), estilo: { ...P(OPERACIONAL_LIMPO).estilo, tamanho: 500 } } } })).toBeNull();
    expect(lerLayout({ ...OPERACIONAL_LIMPO, papel: { formato: 'A3', orientacao: 'paisagem', largura: 400, altura: 287 } })).toBeNull();
    expect(lerLayout('<script>alert(1)</script>')).toBeNull();
    expect(lerLayout({ ...OPERACIONAL_LIMPO, extra: '<b>x</b>' })).toEqual(OPERACIONAL_LIMPO);
  });

  it('não deixa bloco sair da folha nem esconder campo de dado', () => {
    const l = alterarBloco(OPERACIONAL_LIMPO, 'palete', { x: 280, largura: 60, visivel: false });
    expect(P(l).x + P(l).largura).toBeLessThanOrEqual(PAPEL.largura);
    expect(P(l).visivel).toBe(true);
    expect(blocoDe(alterarBloco(OPERACIONAL_LIMPO, 'formulario', { visivel: false }), 'formulario').visivel).toBe(false);
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
    expect(P(h.presente).x).toBe(150);
    h = restaurar(h);
    expect(h.presente).toBe(OPERACIONAL_LIMPO);
    h = desfazer(h);
    expect(P(h.presente).x).toBe(150);
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
    expect(P(OPERACIONAL_LIMPO).x).toBe(192);

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

describe('vários itens e textos livres', () => {
  it('textos livres: só texto puro, ids únicos, limite; layout antigo sem textos continua válido', () => {
    const a = adicionarTexto(OPERACIONAL_LIMPO, 'Conferente: ______');
    expect(a?.id).toBe('txt-1');
    const b = adicionarTexto(a?.layout ?? OPERACIONAL_LIMPO);
    expect(b?.id).toBe('txt-2');
    const l = alterarItem(b?.layout ?? OPERACIONAL_LIMPO, 'txt-1', { x: 500, estilo: { tamanho: 14, alinhamento: 'centro' } });
    const t1 = l.textos.find((t) => t.id === 'txt-1');
    expect(t1).toMatchObject({ texto: 'Conferente: ______', estilo: { tamanho: 14, alinhamento: 'centro' } });
    expect((t1?.x ?? 0) + (t1?.largura ?? 0)).toBeLessThanOrEqual(PAPEL.largura);
    expect(lerLayout(l)).toEqual(l);
    expect(nomeDoItem(l, 'txt-1')).toBe('Texto “Conferente: ______”');
    // Id fora do padrão, caractere de controle ou repetido: recusado.
    expect(lerLayout({ ...l, textos: [{ ...t1, id: 'endereco' }] })).toBeNull();
    expect(lerLayout({ ...l, textos: [{ ...t1, texto: 'a\u0007b' }] })).toBeNull();
    expect(lerLayout({ ...l, textos: [t1, t1] })).toBeNull();
    // Texto com tags fica como texto (nada é interpretado).
    expect(alterarItem(l, 'txt-1', { texto: '<b>x</b>' }).textos[0]?.texto).toBe('<b>x</b>');
    const { textos: _semTextos, ...antigo } = OPERACIONAL_LIMPO;
    expect(lerLayout(antigo)).toEqual(OPERACIONAL_LIMPO);
    let cheio = OPERACIONAL_LIMPO;
    for (let i = 0; i < MAX_TEXTOS; i += 1) cheio = adicionarTexto(cheio)?.layout ?? cheio;
    expect(adicionarTexto(cheio)).toBeNull();
    expect(removerTextos(l, ['txt-1']).textos.map((t) => t.id)).toEqual(['txt-2']);
  });

  it('grupo: move junto sem sair da folha, alinha e muda o tamanho de todos', () => {
    const ids = ['endereco', 'palete', 'demo'];
    const movido = deslocarItens(OPERACIONAL_LIMPO, ids, 0, 10);
    expect(ids.map((id) => caixaDoItem(movido, id).y)).toEqual(ids.map((id) => caixaDoItem(OPERACIONAL_LIMPO, id).y + 10));
    // Para a direita além da borda: o grupo para quando o palete (mais à direita) encosta; as distâncias se mantêm.
    const borda = deslocarItens(OPERACIONAL_LIMPO, ids, 100, 0);
    const p = caixaDoItem(borda, 'palete');
    expect(p.x + p.largura).toBe(PAPEL.largura);
    expect(caixaDoItem(borda, 'palete').x - caixaDoItem(borda, 'endereco').x).toBe(caixaDoItem(OPERACIONAL_LIMPO, 'palete').x - caixaDoItem(OPERACIONAL_LIMPO, 'endereco').x);
    const esq = alinharItens(OPERACIONAL_LIMPO, ['palete', 'continuacao', 'demo'], 'esquerda');
    expect(new Set(['palete', 'continuacao', 'demo'].map((id) => caixaDoItem(esq, id).x))).toEqual(new Set([10]));
    const topo = alinharItens(OPERACIONAL_LIMPO, ['endereco', 'demo'], 'topo');
    expect(caixaDoItem(topo, 'demo').y).toBe(9);
    const maior = ajustarTamanho(OPERACIONAL_LIMPO, ['emissao', 'legenda', 'divisoria'], 2);
    expect([caixaDoItem(maior, 'emissao').estilo.tamanho, caixaDoItem(maior, 'legenda').estilo.tamanho]).toEqual([9, 9]);
    expect(ajustarTamanho(OPERACIONAL_LIMPO, ['emissao'], -50).blocos.emissao?.estilo.tamanho).toBe(5);
  });

  it('avisos de texto livre usam o nome do texto', () => {
    const p = problemasDaFolha([{ campo: 'txt-1', nome: 'Texto “Conferente”', x: 280, y: 10, largura: 30, altura: 5 }], 8);
    expect(p[0]?.texto).toBe('Texto “Conferente”: passa da borda da folha.');
  });
});

describe('espelho de embarque (Expedição)', () => {
  it('modelo de um documento não vale para o outro e campos têm de bater', () => {
    expect(lerLayout(EMBARQUE_LIMPO, 'praca')).toBeNull();
    expect(lerLayout(OPERACIONAL_LIMPO, 'embarque')).toBeNull();
    expect(lerLayout({ ...EMBARQUE_LIMPO, blocos: OPERACIONAL_LIMPO.blocos })).toBeNull();
    expect(lerLayout({ ...EMBARQUE_LIMPO, tabela: OPERACIONAL_LIMPO.tabela })).toBeNull();
    // Layout guardado antes do embarque (sem "documento") continua sendo da praça.
    const { documento: _semDocumento, ...antigo } = OPERACIONAL_LIMPO;
    expect(lerLayout(antigo, 'praca')).toEqual(OPERACIONAL_LIMPO);
  });

  it('um layout só para as vias do cliente; não mexe nos espelhos da praça', () => {
    const m = memoria();
    expect(layoutDoEmbarque(m)).toBe(EMBARQUE_LIMPO);
    aplicarLayout(['a-1'], CLASSICO, m);
    const novo = alterarBloco(EMBARQUE_LIMPO, 'palete', { estilo: { tamanho: 48 } });
    aplicarLayoutEmbarque(novo, m);
    expect(blocoDe(layoutDoEmbarque(m), 'palete').estilo.tamanho).toBe(48);
    expect(layoutsDosPaletes(['a-1'], m).get('a-1')).toEqual(CLASSICO);
    expect(() => { aplicarLayoutEmbarque(OPERACIONAL_LIMPO, m); }).toThrow();
  });
});
