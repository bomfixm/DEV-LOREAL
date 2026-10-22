# Retomada — Etapa 4: dashboard em uma tela (iniciada em 19 out. 2026)

Arquivo de continuação (troca de conta/sessão). Sem dados reais nem credenciais. Ver também `RETOMADA-ETAPA2-MENU-MAPA.md` (etapas 2 e 3).

## Pedido

- `C:\Users\Administrator\Downloads\04-DASHBOARD-EM-UMA-TELA.txt` (ler inteiro). Só a etapa 4.
- As imagens citadas (`atual/01-painel-escuro.png`, `atual/03-painel-claro.png`, `referencias/02-dashboard-compacto.png`) **não existem na máquina**: diagnosticar por capturas próprias e seguir a composição descrita no texto.

## Estado ao começar a etapa 4

- Etapas 1–3 com código pronto. Etapa 3: E2E corrigidos (todos os que falharam passaram na repetição); **suíte E2E completa final rodando** (log `e2e-final.log` no scratchpad da sessão). Falta: anotar o resultado, `npm run lint` completo, aplicar a seção do ESTADO (script `ed-estado23.cjs` no scratchpad; se a sessão mudou, escrever à mão a partir de DECISOES D253–D258 e do README "Mapa da praça"), capturas `@captura` da janela (`npx playwright test e2e/janela-palete.spec.ts --grep @captura`).

## Plano da etapa 4

1. Ler `features/paineis/*` (web), `modules/paineis/*` (API), `docs/INDICADORES.md` (seção Painéis), decisões D232–D239 e D247.
2. Painel da operação (`/painel`) em uma tela: cabeçalho único, linha de filtros (janela, período, atualizar), 4 cartões (Paletes na praça; Volumes registrados + notas/minutas; Sem endereço + NFs sem palete; Precisa conferir), linha central (janela selecionada com barras P/E e faltantes; situação da praça segmentada), linha inferior (volumes por rua; prioridades com "Ver todas"). Detalhes ao clicar. Mesmos números da API.
3. Painel do cliente (`/painel/cliente`) no mesmo padrão: 4 cartões do cliente, histórico recente no lugar das prioridades; projeção continua no servidor.
4. Verificar 1366×768, 1920×1080, 1280×720, menu compacto/expandido, claro/escuro, sem rolagem; cartões → lista com mesmos filtros; bipagem 47 volumes.
5. Testes, lint, build, E2E e capturas de página inteira; docs (INDICADORES, ajuda, DECISOES D259+, ESTADO) e resumo das 4 etapas.

## Feito

- Etapa 3 fechada: E2E completo 126 aprovados / 0 falhas / 79 pulados; `npm run lint` limpo; ESTADO com a seção das etapas 2 e 3; capturas `@captura` da janela geradas.
- Leitura feita: a API já entrega tudo (sem mudar contrato): `stock`, `positions`, `location`, `reconference`, `byStreet`, `windows`/`nextWindow` (progress com T/P/E, faltantes e %), `tasks` (itens limitados a 25 por tipo + totais). Cliente: `/painel/cliente` + `/painel/cliente/historico` (eventos permitidos).
- Novo E2E `e2e/painel-uma-tela.spec.ts` (3 tamanhos × menu × tema, sem rolagem, widgets na tela, nada cortado, fonte ≥ 12 px, sem zoom; vazio; nome longo; celular). `FASE_CAPTURA=antes` só fotografa (capturas "antes" em `docs/capturas/etapa4-dashboard/`).
- Novos `apps/web/src/features/paineis/resumo-dados.ts` (+ teste com T 8.000/P 4.500/E 2.000) e `resumo.tsx` (PaginaPainel, BarraFiltros, CartaoResumo, BlocoResumo, ResumoJanela, BarraSegmentada, VolumesPorRua, ListaPrioridades).
- Telas reescritas: `TelaPainelOperacao.tsx` e `TelaPainelCliente.tsx` (detalhes em `JanelaModal`); `textoVolumesRua` em `formato.ts`; hook `useLinhasResumo` em `resumo-dados.ts`; `inicial` retirado do cliente no `App.tsx`; CSS "Etapa 4" no fim de `redesign.css` (fontes em px: a raiz da tela é 15 px).
- Conferido no navegador (Vite 5173 → API 3100, demonstração): cabe em 1366×768, 1280×720 (menu expandido, ~40 px de folga) e 1920×1080; claro e escuro.
- Ajuda (`ajuda/conteudo.ts`, guias painel e painel-cliente) + `npm run guia:gerar`; E2E `paineis.spec.ts` atualizado; teste de banco da bipagem com o painel (+47 volumes, +41 notas, mesmo palete, relógio intacto) aprovado; DECISOES D259–D263; INDICADORES (seção "Apresentação em uma tela").
- Capturas "antes" (página inteira, altura solta): operação 2.422 px, cliente 1.892 px.

- E2E da etapa 4 (antes da correção do celular): 10 aprovados / 0 falhas. Depois: celular com filtros em grade (o `select` com opção longa alargava o `main`); teste do celular agora mede também o `main` e cobre o cliente; resumo conferido com janela real de teste (T 10, P 5, E 3 → 2, 7, 80%, 30%) em `paineis.spec.ts`.
- Bateria final rodando em sequência (logs no scratchpad da sessão: `build4c.log`, `e2e-etapa4.log`, `e2e-final4.log`, `test4.log`, `lint4.log`). Script pronto para o ESTADO: `ed-estado4.cjs` (recebe um JSON com `build`, `testes`, `e2e4`, `e2eTotal`, `lint`). Se a sessão mudou, escrever a seção à mão a partir de D259–D263.

## Situação

**Etapa 4 concluída** (19 out. 2026): build, typecheck, lint, npm test (592/592), E2E da etapa 4 (11/0) e E2E completo (132/0) aprovados; ESTADO, DECISOES D259–D263, INDICADORES, README e ajuda atualizados. Nada pendente desta etapa; próximo passo é o que o usuário pedir.
