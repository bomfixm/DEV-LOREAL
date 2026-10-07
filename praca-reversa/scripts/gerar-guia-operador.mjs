// Gera docs/GUIA-DO-OPERADOR.md a partir do conteúdo da ajuda do aplicativo
// (apps/web/src/features/ajuda/conteudo.ts), para que o guia impresso e a
// ajuda da tela digam a mesma coisa. Uso: npm run guia:gerar
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tsImport } from 'tsx/esm/api';

const raiz = resolve(import.meta.dirname, '..');
const modulo = await tsImport('../apps/web/src/features/ajuda/guia-markdown.ts', import.meta.url);
const destino = resolve(raiz, 'docs/GUIA-DO-OPERADOR.md');
writeFileSync(destino, modulo.guiaMarkdown(), 'utf8');
console.log(`Guia do operador gerado: ${destino}`);
