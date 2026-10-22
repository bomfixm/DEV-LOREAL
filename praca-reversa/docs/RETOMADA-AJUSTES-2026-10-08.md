# Retomada — ajustes operacionais de 08/10/2026 (1ª e 2ª RODADAS FEITAS; restante depende de insumos)

Arquivo de continuação (troca de conta/sessão), criado com o limite de uso em 97%. Sem dados reais nem credenciais.

## Pedido

- Documento do usuário: `C:\Users\Administrator\Downloads\AJUSTES-PRACA-REVERSA-2026-10-08.md` (ler inteiro antes de agir). Ele registra requisitos e propostas; diz que o usuário ainda está testando e enviará mais mudanças, e que o prompt de importação anterior deve ser ajustado ao fluxo simplificado.
- O usuário só anexou o documento (sem instrução explícita). Antes de implementar algo grande, confirmar com ele o escopo desta rodada.

## Estado do código no momento

- A importação do Excel da bipagem (prompt anterior) está **implementada e verificada, mas não commitada** (git: arquivos `M`/`??` em `praca-reversa/`; último commit `ccd108e`). Resumo em `docs/ESTADO.md` (seção "Importação do Excel da bipagem"), decisões D184–D191 em `docs/DECISOES.md`, histórico em `docs/RETOMADA-IMPORTACAO-BIPAGEM.md`.
- Migração `20261011090000_importacao_bipagem` já aplicada no banco de desenvolvimento (backup em `.dados/backups/…20261008-160941Z…`).
- Verificações finais: `npm test` 520/522 → 2 ajustes → reexecutados aprovados; E2E completo 111 aprovados, 0 falhas.
- `.claude/launch.json` (raiz e projeto) aparece modificado, mas não foi alterado por esta sessão.
- Chip de tarefa separada sugerido: corrigir a amostra recolhida da tela genérica de importação (classe `.amostra` = amostra de cor da legenda, 22×14 px).

## O que o documento muda em relação ao entregue

A tela da bipagem entregue ficou **técnica demais** para o operador. O usuário confirmou que **cada exportação tem padrão fixo** — isso substitui o importador configurável:
- Tirar da tela: codificação, delimitador, linha do cabeçalho, decimal, escolha "uma linha por nota/por volume", ID permanente, explicações técnicas (identidade, saldo por SKU, movimentos).
- Leitor configurado **no código** a partir de uma **amostra real** (ainda NÃO recebida): aba, cabeçalho, campos e regra de contagem automáticos; arquivo fora do padrão → erro claro (sem assistente técnico).
- Pedir ao operador só: tipo **NFD/MI** e campos de negócio ausentes. Número do documento vem da bipagem; Delivery opcional (vários por palete e por nota; sem NFD, Delivery serve de referência provisória); **sequência FULL manual** ("1/5", "7/9"; nunca gerada/renumerada).
- Mostrar só o **número operacional do palete** (sequência única da praça; último 247, próximo 248; preservar números importados) e o endereço.
- Manter no backend: validação, reimportação sem duplicar, transação.
- Volumes **lidos × esperados** separados: igual → "10 volumes"; falta → "8 / 10 volumes"; excesso → "12 / 10 volumes"; ausente → pendência (nunca zero); nota em vários paletes = parcela de cada palete. Origem dos "esperados" ainda desconhecida.
- Dois usos: (1) inventário pronto em lote (aproveitar nº do palete, notas e endereços; completar só o que falta; explicar conflitos de alocação — hoje "124 paletes · 123 sem posição"); (2) recebimento/bipagem no contexto do palete ou numa tela de recebimento, cadastrando palete + notas juntos.
- Bipagem, inventário e agenda do cliente são esquemas diferentes: cada um com leitor próprio.

## Correções que NÃO dependem da amostra (candidatas a fazer primeiro)

1. **Rolagem do painel esquerdo** (filtros + lista de paletes inacessíveis abaixo da área visível): corrigir sem quebrar o painel direito nem o mapa; testar roda do mouse, teclado, toque e alturas de tela (E2E com viewport baixo). Arquivos prováveis: `apps/web/src/TelaPraca.tsx`, `features/paletes/ListaPaletes.tsx`, `estilos/base.css`.
2. **"PALETE LIVRE" em verde no mapa**: distinguir posição disponível × palete; posição desativada nunca é livre; falta de vínculo não prova posição livre (palete sem endereço); ação para registrar posição como livre após confirmar desocupação (com histórico); movimentação/saída confirmada atualiza a disponibilidade. Verde hoje = "Reconciliado" → mover conferência para selo/ícone próprio e reservar verde para posição livre; "Separação para agenda" com cor própria e legenda. Ver `features/mapa/Legenda.tsx`, `controlador-mapa.ts`, estados de posição em `modules/praca`.
3. **Endereço "16 - A101"** (fileira 16, A101 ímpar/esquerda, A102 par/direita): exibir o endereço real em consultas/detalhes (já existe normalização em `packages/contracts/src/enderecos.ts`).

## Dependem de insumo do usuário

- Amostra real do Excel/CSV da bipagem (registrar aba, cabeçalho, colunas/tipos, significado das linhas, identificação de documentos/volumes, origem das quantidades) → reconfigurar `apps/api/src/modules/importacao/bipagem.ts` + simplificar `apps/web/src/features/paletes/TelaBipagem.tsx`.
- De onde vem o total **esperado** de volumes (Excel, etiqueta/documento ou digitado na planilha de inventário).
- Formato do arquivo de agenda/seleção do cliente (palete inteiro, notas específicas ou Delivery específico; separação parcial não libera endereço).
- Não perguntar de novo o que o documento já respondeu (nº do palete, tipo NFD/MI, Delivery, agenda, FULL manual).

## Regras a manter (AGENTS.md e memória)

- Nunca gravar teste no escopo real `PRACA-REVERSA/LOREAL`; verificação visual pelo E2E (`npx playwright test <spec> --grep @captura`, `PLAYWRIGHT_CANAL=chrome`) ou escopo de demonstração/cadastro do E2E.
- Porta 3000 é de outra sessão: usar outra porta; reiniciar servidor após `npm run build`.
- Scripts com crases/`${}`: escrever em arquivo do scratchpad e rodar com `node <arquivo>` (não `node -e` no Bash).
- Fechar etapa: `npm run typecheck`, eslint dos arquivos alterados (ou `npm run lint`), `npm test`, `npm run build`, E2E; atualizar `docs/ESTADO.md`, `DECISOES.md`, `DESCOBERTA.md`.

## Feito na 1ª rodada (8 out. 2026, noite)

- Rolagem do painel esquerdo, palete livre em verde (+ ação no detalhe da posição, gatilhos, legenda, lista de livres) e tela da bipagem simplificada — D192–D196, `docs/ESTADO.md`.
- Verificação: typecheck, eslint dos alterados, testes `posicao-livre`/`banco-e-seed` (13), E2E `ajustes` + `bipagem` (computador e celular). `npm test` completo: 525 aprovados. **Falta rodar o E2E completo** (`PLAYWRIGHT_CANAL=chrome npm run test:e2e`) antes de commitar.

## Nova versão do documento (recebida em 8 out. 2026, noite) — implementada na 2ª rodada (ver abaixo)

Arquivo: `C:\Users\Administrator\Downloads\AJUSTES-PRACA-REVERSA-2026-10-08 (1).md` (substitui a versão anterior; ler a seção "Front: decisões posteriores"). Parado com o limite semanal em 92%.

O usuário retomou o front e aprovou a **direção visual de uma prévia externa** (dashboard com navegação lateral, fundo claro, cartões, menu simples, pesquisa por nota/minuta, Delivery, número do palete e endereço; amarelo discreto nas ações, verde para posições livres, cor própria para separação de agenda). Aplicar ao app existente, com as regras e dados atuais. **Não adotar o mapa simplificado da prévia**: manter a disposição física real e as correspondências de endereço já definidas; não inventar fileiras/posições.

Comportamento pedido (diferenças em relação ao app hoje):
1. Ao entrar na tela, **nenhum palete selecionado nem conteúdo aberto** automaticamente (hoje a rota `/paletes/<id>` e a busca abrem o detalhe; `TelaPraca.tsx`: `escolherNaBusca`, efeito "Rota → seleção").
2. Clique no palete → destacar e abrir **resumo compacto**: número operacional, rua/endereço, situação, quantidade de documentos e volumes, FULL quando informado (hoje abre o `DetalhePalete` inteiro).
3. Botão **"Ver mais"** → consulta completa: documentos NFD/MI, números, Deliveries, remetentes, volumes (regra lidos/esperados: iguais = um valor; diferentes = "lidos / esperados"; ausente = não informado), FULL e sequência, mês de agenda, janela; distinguir conteúdo solicitado para a agenda × o que fica no palete (inclusive pedido parcial por Delivery). Recolher detalhes / fechar seleção; outro palete abre primeiro o resumo.
4. **Pesquisa localiza sem abrir detalhes**; o operador escolhe o palete.
5. **Posição livre** abre a identificação do endereço e a ação de **receber um palete ali** (hoje: `DetalhePosicao.tsx` só registra livre; acrescentar "Receber palete aqui" → cadastro de palete com a posição já escolhida ou mover para cá), sem documentos inexistentes.

Dependências que continuam pendentes: amostra real da bipagem; origem dos volumes esperados; formato do arquivo de agenda do cliente; campos novos (sequência FULL manual, mês de agenda/janela, Delivery manual, número do palete 248+) ainda não existem no modelo das notas.

Sugestão para a próxima sessão (contexto novo): confirmar com o usuário se esta rodada é o **resumo compacto + "Ver mais" + pesquisa sem abrir + receber palete na posição livre** sobre o layout atual (sem o redesign completo do dashboard), e se há imagens/arquivo da prévia aprovada para referência visual. Rodar antes o E2E completo pendente da 1ª rodada.

## Feito na 2ª rodada (8 out. 2026, fim da noite) — D197–D201

- Resumo do palete ao selecionar (mapa, lista, busca, rota/QR, retornos); "Ver mais" abre o detalhe; "Recolher detalhes"/"Fechar"; nada abre sozinho ao entrar. Componente `features/paletes/ResumoSelecao.tsx` (computador e celular).
- Regra de volumes lidos × esperados em `features/paletes/volumes.ts` (+ testes); esperados sem fonte → só lidos.
- Notas: Delivery, sequência FULL ("1/7"), mês de agenda e janela (API `scheduleMonth`/`windowRef`).
- Posição livre → "Receber palete aqui" (`/paletes/novo?posicao=<id>`).
- Correção: marca de detalhe aberto antiga no histórico (celular) descartada ao voltar à praça.
- E2E ajustados ao passo "Ver mais" (helpers `verMais`, `abrirPalete`, `resumo` em `e2e/apoio.ts`); `ajustes.spec` cobre resumo/Ver mais/recolher/fechar e receber palete.
- Verificação: ver `docs/ESTADO.md`. Logs em `.dados/verificacao/*ajustes2*`.
- Não feito: redesign visual completo da prévia (arquivo da prévia não disponível no repositório).

## Próximo passo sugerido

1. Confirmar com o usuário o escopo desta rodada (provável: rolagem do painel esquerdo + posição livre em verde/legenda + simplificar a tela da bipagem tirando o que é técnico, deixando o leitor fixo para quando a amostra chegar).
2. Se o usuário quiser, commitar antes a entrega da bipagem (só com pedido explícito).
