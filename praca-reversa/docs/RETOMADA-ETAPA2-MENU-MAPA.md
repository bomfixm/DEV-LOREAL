# Retomada — Etapa 2: menu recolhível e espaço do mapa (iniciada em 19 out. 2026)

Arquivo de continuação (troca de conta/sessão). Sem dados reais nem credenciais.

## Pedido

- `C:\Users\Administrator\Downloads\02-MENU-E-ESPACO-DO-MAPA.txt` (ler inteiro). Só a etapa 2; **não iniciar a etapa 3** (painel de detalhes da direita).
- A pasta `atual/` com as capturas de diagnóstico (ex.: `atual/04-mapa-sufocado.png`) **não existe na máquina**: usar capturas "antes" próprias.

## Estado da etapa 1 (bipagem real) — concluída no código

- Contrato `docs/IMPORTACAO-BIPAGEM.md`, decisões D249–D252, README/DESCOBERTA/ajuda atualizados; migração `20261019090000_bipagem_real` aplicada no banco de desenvolvimento (backup `.dados/backups/…20261019-171319Z-c17829f6`).
- Verificado: testes de banco da bipagem (8), leitor isolado + contratos (5), unidade (246), typecheck, build, lint completo limpo, E2E bipagem (2) e regressão (16).
- **Pendente**: anotar o resultado do `npm test` completo e aplicar a seção do ESTADO com o script `ed-estado.cjs` (scratchpad da sessão) — se a sessão mudou, escrever a seção "Importação da bipagem real no palete" em `docs/ESTADO.md` à mão a partir de `IMPORTACAO-BIPAGEM.md`.

## Plano da etapa 2

1. Capturas "antes" em 1366×768, 1280×720, 1920×1080 (escopo de demonstração).
2. Menu lateral com dois estados (compacto ~68 px por padrão no computador, expandido ~216 px), botão com `aria-expanded`, dica ao passar o mouse/focar, preferência só visual no navegador; principais: mapa, inventário, recebimento, agendas, painel; demais em "Mais" (lista ao clicar, por permissão); tema/escopo no rodapé. Celular: sem coluna (menu da conta).
3. `mostrarListaPaletesNoMapa = false` (configuração interna, componente preservado): sem coluna à esquerda; busca no cabeçalho com resultados em painel flutuante; botão de QR compacto; posições livres por ação compacta; sem trabalho exclusivo da lista.
4. Mapa ocupa a largura (redimensiona sem recarregar o layout); controles compactos; aviso de demonstração compacto com explicação ao abrir.
5. Testes/typecheck/lint/build/E2E e capturas da tela inteira nas 3 resoluções; documentar (DECISOES D253+, ESTADO, reativação).

## Feito (19 out. 2026, antes do limite de uso)

- **Etapa 1 fechada**: `npm test` completo 585 (1 falha esperada: lista de migrações do `banco-e-seed`, corrigida e repetida 10/10); lint completo limpo; seção no `ESTADO.md` escrita. Ajustar no ESTADO a frase "Etapa 2 não iniciada" quando a etapa 2 terminar.
- **Capturas "antes"**: `docs/capturas/etapa2-menu-mapa/antes-{1366x768,1280x720,1920x1080}-mapa.png` (a 1280 o menu da conta saía da tela; faixa de demonstração larga; lista ocupava ~1/4).
- **Código da etapa 2 (web, compila; build da web feito; NÃO conferido visualmente nem testado)**:
  - `components/preferencia-menu.ts` (compacto/expandido no navegador, padrão compacto); `components/Navegacao.tsx` reescrito (botão `alternar-menu` com `aria-expanded`, dica `data-dica`, "Mais" = `navegacao-mais-botao` + painel `navegacao-mais`, rodapé com escopo e tema); ícones novos em `Icones.tsx`; `SeletorTema` com `.seletor-tema-texto`.
  - `Moldura.tsx`: `AvisoDemo` (faixa) trocado por `IndicadorDemo` no cabeçalho (`selo-demo` abre a explicação `aviso-demo`); status com `.status-texto`. `App.tsx` sem a faixa.
  - `features/mapa/configuracao.ts`: `mostrarListaPaletesNoMapa = false as boolean` (reativação documentada no próprio arquivo).
  - `TelaPraca.tsx`: `comLista = compacto || mostrarListaPaletesNoMapa`; sem lista → `busca-flutuante` (resultados da busca do cabeçalho sobre o mapa, `fechar-busca`), QR "Ler QR" (`ler-codigo-praca`) nas `ferramentas-mapa`, posições livres no indicador (`Indicadores.tsx`, `posicoes-livres`), nota do layout na `Legenda` (`nota-layout`), aviso de falha acima do mapa, `data-lista` no `main`, margens do mapa menores; grupos/semEndereco só com lista. `PainelBusca`: `aoConfirmarTexto` (Enter com link/ID do QR abre o palete).
  - `ControlesMapa.tsx`: ícones compactos (nomes acessíveis "Visão geral"/"Centralizar" mantidos), `extra`, seletor "Ir para…" (rótulo "Ir para bloco ou zona" oculto visualmente).
  - CSS: bloco "Etapa 2" no fim de `estilos/redesign.css`.
- **Capturas "depois"** já geradas (ainda não examinadas): `depois-*-mapa.png`, `*-menu-expandido.png`, `*-mais.png`. Script: `node .dados/capturas-etapa2.tmp.mjs depois` (servidor de verificação `praca-reversa-3100`, escopo de demonstração, conta de `.dados/teste-local/credenciais.json`; reiniciar o servidor após `npm run build`).

## Atualização (sessão seguinte, 19 out.)

- Capturas "depois" examinadas nas 3 resoluções: menu compacto/expandido/Mais corretos, cabeçalho cabe em 1280, mapa na largura. Corrigido o ⓘ em maiúscula. typecheck ok, eslint dos arquivos limpo, unidade 251 aprovados. **E2E ficam para depois da etapa 3** (mesmo detalhe do palete). Etapa 3 iniciada (`Downloads/03-JANELA-DO-PALETE.txt`).

## Falta

1. ~~Examinar as capturas "depois" nas 3 resoluções (menu compacto/expandido, Mais, mapa ocupando a largura, cabeçalho cabendo em 1280, indicador de demonstração) e corrigir o CSS.
2. Testar no navegador: dicas no menu compacto (hover/foco), Esc/fora fecha "Mais", rotas, pesquisa do cabeçalho + resultados flutuantes, Enter com link do QR, botão "Ler QR", pan/zoom, posições livres, tema escuro.
3. `npm run typecheck`, `npm run lint`, `npm run build`, testes de unidade da web.
4. E2E: specs de computador que usavam a coluna da lista precisam de ajuste (`ajustes` posicoes-livres, `cadastro` contagem-lista, `camera*`/`capturas-etapa09` ler-codigo-praca no computador, `computador` nota-layout/filtros, `comum` aviso-demo, `reconferencia`, `selecao`, `busca-importacao`, `tutorial`). Rodar `PLAYWRIGHT_CANAL=chrome npm run test:e2e` e corrigir.
5. Documentar: DECISOES D253+ (menu recolhível, lista oculta por configuração e como reativar, demonstração compacta, controles compactos), ESTADO (etapa 2, comandos e resultados, capturas com resolução), README se citar a coluna.
6. Não iniciar a etapa 3.

## Etapa 3 — janela do palete (`Downloads/03-JANELA-DO-PALETE.txt`), mesma sessão, 19 out.

- Código: `features/paletes/JanelaPalete.tsx` (`JanelaModal` com `role="dialog"`/`aria-modal`, foco contido, Esc/fundo/botão; `JanelaPalete`), `janela.ts` (+ `janela.test.ts`), `DetalhePalete` com `embutido` (seção "Identificação" com posição e ID permanente), `TelaPraca` (sem coluna direita nem resumo; janela para palete, avulso e posição), `FiltroMapa.tsx` (filtro compacto que faltava desde a etapa 2), CSS "Etapa 3" e filtro no fim de `redesign.css`, tutorial/guia atualizados.
- Verificado: typecheck, eslint dos alterados, unidade, script `.dados/capturas-etapa3.tmp.mjs` (1366×768 e 390×844: foco no título, foco contido, Esc, pan/zoom/rota preservados, troca de palete, sem colunas) com capturas em `docs/capturas/etapa3-janela-palete/`.
- E2E: auxiliares (`apoio.ts` verMais/abrirPalete/resumo = janela) e specs ajustados; novo `janela-palete.spec.ts`. **Suíte completa rodando** — log `e2e-completo.log` no scratchpad da sessão; se a sessão mudou, rodar `npm run build` e `PLAYWRIGHT_CANAL=chrome npx playwright test --grep-invert @captura` e corrigir o que falhar.
- Decisões D253–D258 escritas; README com a seção do mapa. **Falta**: resultado do E2E, `npm run lint` completo, capturas finais da etapa 2 (com o filtro) e seção do ESTADO para as etapas 2 e 3. Não iniciar a etapa 4.
