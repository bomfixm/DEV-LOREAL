import { DUVIDAS, GLOSSARIO, GUIAS, INDISPONIVEIS } from './conteudo';

/** Texto de uma célula de tabela Markdown (sem quebrar a tabela). */
function celula(texto: string): string {
  return texto.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * docs/GUIA-DO-OPERADOR.md, gerado do mesmo conteúdo da central de ajuda
 * (npm run guia:gerar). Primeiro as tarefas, depois o glossário e as dúvidas.
 */
export function guiaMarkdown(): string {
  const linhas: string[] = [
    '# Guia do operador — Praça Reversa',
    '',
    '<!-- Gerado por `npm run guia:gerar` a partir de apps/web/src/features/ajuda/conteudo.ts. Não edite à mão: altere o conteúdo e gere de novo. -->',
    '',
    'Este guia é o mesmo conteúdo da **Ajuda** do aplicativo (botão **Ajuda** no topo da tela). Para aprender a primeira tarefa — encontrar um produto e saber em qual palete e endereço ele está — use **Começar aqui** na Ajuda: o tutorial aponta os botões reais da tela, passo a passo, sem gravar nada.',
    '',
    'Os exemplos são fictícios. Na demonstração (selo **Demonstração** no topo), nada é estoque real. Cada passo diz **o que fazer**, **onde** e **o que deve aparecer**; os passos marcados com um perfil só aparecem para quem tem essa permissão.',
    '',
    'Instruções de servidor, banco, migrações e backup ficam no material técnico (`docs/IMPLANTACAO.md`), não aqui.',
    '',
    '## Tarefas',
    '',
  ];
  for (const g of GUIAS) {
    linhas.push(`### ${g.titulo}`, '', `**Para quê:** ${g.objetivo}`, '', `**Quem faz:** ${g.quem}`, '');
    linhas.push('| # | O que fazer | Onde | O que deve aparecer |', '| --- | --- | --- | --- |');
    g.passos.forEach((p, i) => {
      linhas.push(`| ${String(i + 1)} | ${celula(p.fazer)}${p.permissao ? ' *(perfil autorizado)*' : ''} | ${celula(p.onde)} | ${celula(p.aparece)} |`);
    });
    linhas.push('', '**Atenção:**', '', ...g.atencao.map((a) => `- ${a}`), '', `**Sem permissão:** ${g.semPermissao}`, '');
  }
  linhas.push('## Glossário', '', '| Termo | O que é | Exemplo (fictício) |', '| --- | --- | --- |');
  for (const t of GLOSSARIO) linhas.push(`| ${celula(t.termo)} | ${celula(t.explicacao)} | ${celula(t.exemplo)} |`);
  linhas.push('', '## Dúvidas frequentes', '');
  for (const d of DUVIDAS) linhas.push(`**${d.pergunta}**`, '', d.resposta, '');
  linhas.push('## O que esta versão ainda não faz', '', ...INDISPONIVEIS.map((i) => `- ${i}`), '');
  return linhas.join('\n');
}
