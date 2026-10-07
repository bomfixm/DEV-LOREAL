import { PERMISSOES_IMPLEMENTADAS, PermissaoSchema } from '@praca-reversa/contracts';
import { describe, expect, it } from 'vitest';
import guiaNoRepositorio from '../../../../../docs/GUIA-DO-OPERADOR.md?raw';
import { DUVIDAS, GLOSSARIO, GUIAS, INDISPONIVEIS, podeExecutar } from './conteudo';
import { guiaMarkdown } from './guia-markdown';
import { TAREFAS } from './tarefas';

// Código-fonte da interface, para conferir que os nomes citados nos guias existem de fato.
const fontes = Object.values(import.meta.glob<string>(['../../**/*.tsx', '../../**/*.ts', '!../../**/*.test.ts', '!./conteudo.ts', '!./guia-markdown.ts'], { query: '?raw', import: 'default', eager: true }));

/** Textos entre aspas duplas num passo: nomes de botões, campos e mensagens da tela. */
function citados(texto: string): string[] {
  return [...texto.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '').filter(Boolean);
}

describe('guias por tarefa (etapa 10)', () => {
  it('há um guia para cada tarefa do roteiro, com o que fazer, onde e o que deve aparecer', () => {
    expect(GUIAS.map((g) => g.id)).toEqual([...TAREFAS]);
    for (const g of GUIAS) {
      expect(g.passos.length, g.id).toBeGreaterThanOrEqual(3);
      for (const p of g.passos) {
        expect(p.fazer.length, g.id).toBeGreaterThan(10);
        expect(p.onde.length, g.id).toBeGreaterThan(3);
        expect(p.aparece.length, g.id).toBeGreaterThan(10);
      }
    }
  });

  it('cada nome citado entre aspas existe na interface desta versão', () => {
    const faltando: string[] = [];
    for (const g of GUIAS) {
      for (const p of g.passos) {
        for (const nome of [...citados(p.fazer), ...citados(p.onde), ...citados(p.aparece)]) {
          if (!fontes.some((f) => f.includes(nome))) faltando.push(`${g.id}: "${nome}"`);
        }
      }
    }
    expect(faltando).toEqual([]);
  });

  it('passos executáveis só usam permissões implementadas; sem permissão o passo vira consulta', () => {
    for (const g of GUIAS) {
      for (const p of g.passos) {
        if (p.permissao === undefined) continue;
        expect(PermissaoSchema.options).toContain(p.permissao);
        expect(PERMISSOES_IMPLEMENTADAS.has(p.permissao)).toBe(true);
      }
    }
    const conferir = GUIAS.find((g) => g.id === 'divergencia');
    const reconciliar = conferir?.passos.find((p) => p.permissao === 'conferencia.reconciliar');
    expect(reconciliar && podeExecutar(reconciliar, ['conferencia.registrar'])).toBe(false);
    expect(reconciliar && podeExecutar(reconciliar, ['conferencia.reconciliar'])).toBe(true);
  });

  it('glossário cobre os termos pedidos e usa exemplos fictícios', () => {
    const termos = GLOSSARIO.map((t) => t.termo.toLowerCase());
    for (const t of ['palete', 'endereço', 'sku', 'lote', 'conferência', 'reconciliação', 'claim', 'liberação', 'janela', 'reserva', 'expedição']) {
      expect(termos.some((x) => x.startsWith(t)), t).toBe(true);
    }
    expect(DUVIDAS.length).toBeGreaterThan(5);
    expect(INDISPONIVEIS.length).toBeGreaterThan(0);
  });

  it('docs/GUIA-DO-OPERADOR.md está igual ao conteúdo da ajuda (npm run guia:gerar)', () => {
    expect(guiaNoRepositorio.replace(/\r\n/g, '\n')).toBe(guiaMarkdown());
  });
});
