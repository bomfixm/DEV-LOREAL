// Gera fonte/dados-mapa.js a partir do snapshot do layout (somente geometria e endereços, sem ocupação).
// Uso: node ferramentas/gerar-dados-mapa.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const m = JSON.parse(readFileSync(join(raiz, 'ferramentas/snapshot/mapa-escopo-real-2026-10-21.json'), 'utf8'));

const local = (endereco) => (endereco ? endereco.split(' - ').pop() : '');
const mapa = {
  origem: m.origem,
  lidoEm: m.lidoEm,
  layout: m.layout,
  zonas: m.elementos.filter((e) => e.tipo === 'ZONA').map((e) => ({ codigo: e.codigo, rotulo: e.rotulo, x: e.x, y: e.y, w: e.largura, h: e.altura })),
  blocos: m.elementos.filter((e) => e.tipo === 'BLOCO').map((e) => ({ codigo: e.codigo, nome: e.nome_operacional || '', x: e.x, y: e.y, w: e.largura, h: e.altura, ativo: !!e.prefixo_endereco })),
  corredores: m.elementos.filter((e) => e.tipo === 'CORREDOR').map((e) => ({ codigo: e.codigo, rotulo: e.rotulo, x: e.x, y: e.y, w: e.largura, h: e.altura })),
  // [x, y, largura, altura, rótulo local, endereço completo, desativada (0/1)]
  posicoes: m.posicoes.map((p) => [p.x, p.y, p.largura, p.altura, local(p.endereco), p.endereco || '', p.desativada ? 1 : 0]),
};

const saida = `// Gerado por ferramentas/gerar-dados-mapa.mjs — não editar à mão.
// ${mapa.origem} Lido em ${mapa.lidoEm}.
window.PR_MAPA = ${JSON.stringify(mapa)};
`;
writeFileSync(join(raiz, 'fonte/dados-mapa.js'), saida);
console.log(`dados-mapa.js: ${mapa.posicoes.length} posições (${mapa.posicoes.filter((p) => !p[6]).length} ativas), ${mapa.blocos.length} blocos.`);
