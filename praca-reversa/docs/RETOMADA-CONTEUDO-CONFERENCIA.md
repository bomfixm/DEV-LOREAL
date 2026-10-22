# Retomada — cadastro de conteúdo e conferência de volumes (CONCLUÍDO no desenvolvimento local, 11 out. 2026)

Arquivo de continuação (troca de conta/sessão). Sem dados reais nem credenciais. Ler também `AGENTS.md`, `docs/ESTADO.md` (seção do redesign) e a memória do projeto.

## Pedido

- Prompt: `C:\Users\Administrator\Downloads\PROMPT-CADASTRO-CONFERENCIA-PRACA-REVERSA.md` (ler inteiro) + print do formulário "Novo produto" (rota `/produtos`; o print estava com o visual antigo porque o servidor do usuário não tinha o build do redesign — avisar o usuário: `npm run build` + reiniciar o servidor + Ctrl+Shift+R).
- Substituir o "Novo produto" por **Registrar conteúdo** (remetente obrigatório; NF/NFD/MI, número, Delivery e descrição opcionais; NF e Delivery podem ficar ambos vazios; nada de SKU/unidade/barcode/volumes no cadastro) e tratar volumes na **Conferência de volumes** ("Contar volumes" / "Registrar contagem já feita").

## Desenho decidido (não mudar sem motivo)

- Tabelas novas (migração aditiva `apps/api/prisma/migrations/20261013090000_conteudo_palete`): `conteudo_palete` (identidade própria por ID, versão, situação) e `contagem_volumes` (só acrescentada — gatilho bloqueia UPDATE/DELETE; alvo = conteúdo registrado **ou** vínculo importado; origem `CONTAGEM_FISICA`/`CONTAGEM_INFORMADA`; previsto opcional).
- Vínculo importado com volumes = contagem realizada (origem `IMPORTACAO`); sem volumes = aguardando; contagem registrada sobre vínculo não altera o vínculo (vale a mais recente na tela e na planilha).
- API `apps/api/src/modules/conteudos/{servico,rotas}.ts` (registrada em `app.ts`): `GET /paletes/:id/conteudos` (palete.consultar), `POST /paletes/:id/conteudos` e `PUT /paletes/:id/conteudos/:conteudo` (palete.cadastrar, versão), `POST /paletes/:id/conteudos/contagens` (conferencia.registrar). Contratos em `packages/contracts/src/conteudos.ts` (exportado no index). Auditoria: `CONTEUDO_REGISTRADO`, `CONTEUDO_ALTERADO`, `CONTAGEM_VOLUMES_REGISTRADA` (também em Movimentações da planilha).
- Busca: base nova `CONTEUDO` (contrato `busca.ts` com `contentLink`; SQL em `busca/consulta.ts`; CSV em `busca/rotas.ts`; rótulo e cartão na web).
- Planilha única (`planilha/dados.ts`): uma linha por conteúdo registrado ("Documento não informado", "Delivery não informado", "Aguardando conferência"); contagem vigente prevalece nos volumes dos vínculos.

## Feito (verificado)

- Backend completo. Testes aprovados: `apps/api/test/banco/conteudos.test.ts` (8 testes: combinações nota/Delivery/nenhum, NF/NFD/MI, zeros à esquerda, inválidos e permissões, dois vazios do mesmo remetente distintos, idempotência, completar identificação preserva contagem + conflito de versão, contagem física/já feita/previsto/histórico/imutável, palete arquivado, planilha, busca), bloco novo em `carga-lote.test.ts` (conteúdo importado), `busca.test.ts`, contratos (71 testes nos arquivos afetados). Typecheck da API ok.
- `apps/api/test/banco/apoio.ts`: tabelas novas na limpeza (TRUNCATE).
- Web, já escrito: rotas (`rotas.ts`: `catalogo-sku` = `/produtos/catalogo`, `novo-conteudo` = `/conteudos/novo?palete=<id>`, ação `volumes` = `/paletes/<id>/volumes`; `rotas.test.ts` aprovado), `features/conteudos/TelaRegistrarConteudo.tsx` (tela completa, ainda não ligada no App), `features/conteudos/textos.ts`, `features/paletes/volumes.ts` (regra nova: "Aguardando conferência", "10 volumes · previsto não informado", "8 / 10 volumes" + legenda; `volumesDoPalete` agora recebe itens `{count:{counted}}`), busca na web (`estado.ts`, `PainelBusca.tsx`, `Tutorial.tsx`).
- **Migração ainda NÃO aplicada no banco de desenvolvimento** (fazer backup antes, como nas etapas anteriores — ver `docs/ESTADO.md`, seção da posição livre — e só então `npm run db:migrar -w @praca-reversa/api`).

## Feito na web depois (11 out., noite)

- Itens 1, 2, 3, 4 e 6 abaixo FEITOS: testes unitários de volumes/documentos atualizados (26 aprovados); `App.tsx` liga `produtos`/`novo-conteudo` → TelaRegistrarConteudo, `volumes` → `features/conteudos/TelaConferenciaVolumes.tsx` (nova), `catalogo-sku` → TelaProdutos ("Catálogo de SKU", botão "Novo SKU"); menu (`paginas.ts`: "Registrar conteúdo" e "Catálogo de SKU"; seções), Navegação (Recebimento ativo); resumo usa `/conteudos`; recebimento com "Registrar conteúdo" como ação principal. `tsc` da web ok.
- Ainda falta: CSS das classes novas (`chip-opcao`, `conteudo-item`, `contador-volumes`, `lista-conteudos`), botões "Registrar conteúdo"/"Conferir volumes" no detalhe (Ver mais) e tabela unificada (item 5), guia (7), E2E (8), verificações (9), migração no banco de desenvolvimento.

## Situação no fim da sessão (11 out., noite)

- Também FEITOS: CSS novo (em `redesign.css`, dentro de @media screen), botão "Conferir volumes" no detalhe, E2E `e2e/conteudo.spec.ts` (aprovado) + ajustes em `cadastro.spec`/`pwa.spec` (catálogo de SKU) e `ajustes.spec` (texto do resumo), lint dos alterados limpo, `DECISOES.md` D215–D219.
- Rodada final disparada: build + E2E completo (log `.dados/verificacao/e2e-completo-conteudo.log`) + `npm test` (log `.dados/verificacao/npm-test-conteudo.log`). Conferir os logs; corrigir falhas.
- Tabela unificada do "Ver mais" FEITA depois do build da rodada: `features/conteudos/ConteudoDoPalete.tsx` (no `DetalhePalete`, antes das notas importadas; `TabelaDocumentos` removida de `DocumentosInformados`). tsc/eslint ok. **Falta rebuild da web e rerodar** `e2e/conteudo.spec.ts`, `e2e/ajustes.spec.ts` e (opcional) capturas `FASE=depois npx playwright test e2e/redesign.spec.ts`.
- Pendentes: `ESTADO.md` (seção nova com as verificações), migração no banco de desenvolvimento (com backup antes; `npm run db:migrar -w @praca-reversa/api`), relatório ao usuário (lembrar: print com visual antigo = servidor sem o build novo).

## Falta (nesta ordem — itens antigos)

1. **Testes unitários da web que quebraram com a regra nova**: `features/paletes/volumes.test.ts` (so-lidos → `sem-previsto`, textos novos, `volumesDoPalete` com `{count:{counted}}`) e `features/paletes/documentos.test.ts` (usa `volumesDoPalete` com o formato antigo).
2. **App.tsx**: `rota.tipo === 'produtos'` e `'novo-conteudo'` → `<TelaRegistrarConteudo sessao paleteInicial={rota.palete ?? null} aoNavegar aoGravar={dadosAlterados} />` (permissão `palete.cadastrar`; sem ela, SemPermissao); `'catalogo-sku'` → `<TelaProdutos …>` (a tela antiga; renomear o título para "Catálogo de SKU" e o formulário "Novo SKU (catálogo para claims e conferência por SKU)"); `'volumes'` → nova `TelaConferenciaVolumes`.
3. **`features/conteudos/TelaConferenciaVolumes.tsx`** (rota `/paletes/<id>/volumes`): cabeçalho com o palete (GET `/paletes/:id`), lista de `GET /paletes/:id/conteudos` com remetente, `textoDocumento`, `textoDelivery`, selo "Identificação pendente" separado do selo da conferência (`textoConferencia`), volumes (`textoVolumesConteudo`); ações por item: **Contar volumes** (contador −/+ e campo; "Concluir contagem" → POST contagens origem `CONTAGEM_FISICA`), **Registrar contagem já feita** (contados obrigatório, previsto opcional, referência opcional → `CONTAGEM_INFORMADA`), **Completar identificação** só para `REGISTRADO` (PUT com `expectedVersion`; conflito → recarregar). Botões "Registrar conteúdo" (→ `novo-conteudo` com palete) e "Voltar ao palete". Idempotência com `useChaves` (ver `TelaRegistrarConteudo`). data-testids: `conteudo-item` (data-id, data-kind), `contar-volumes`, `contagem-feita`, `contagem-contados`, `contagem-previstos`, `concluir-contagem`, `registrar-contagem`, `completar-identificacao`.
4. **Menu e navegação**: `components/paginas.ts` → item "Produtos" vira "Registrar conteúdo" (rota `novo-conteudo`, permissão `palete.cadastrar`) + item novo "Catálogo de SKU" (rota `catalogo-sku`, `produto.consultar`); `secaoDaRota`: `novo-conteudo`/`produtos`/`volumes` → "Recebimento"/"Conferência de volumes"; `components/Navegacao.tsx`: Recebimento ativo também em `novo-conteudo`, `produtos`, `volumes`; `JA_PRINCIPAIS` inclui "Registrar conteúdo".
5. **Resumo e "Ver mais"**: `features/paletes/ResumoSelecao.tsx` (Composicao) passa a usar `GET /paletes/:id/conteudos` (`documents`, `withoutDocument`, `volumesDoPalete(items)`, "N aguardando conferência", `full`); botão "Registrar conteúdo" e "Conferir volumes" no resumo/detalhe. Em `DetalhePalete.tsx`, seção nova "Conteúdo do palete" (tabela unificada: Documento | Delivery | Remetente | Volumes | Conferência; agrupar por tipo+número com `agruparDocumentos` generalizado em `documentos.ts`) no lugar de `TabelaDocumentos` (remover de `DocumentosInformados.tsx`; os cartões das notas importadas ficam).
6. **Recebimento** (`cadastro/TelaNovoPalete.tsx`): etapas "Palete e destino → Conteúdo → Conferência de volumes"; no sucesso, ação principal **Registrar conteúdo** (→ `novo-conteudo` com o palete) e secundária "Importar Excel da bipagem".
7. **Guia/ajuda** (`features/ajuda/conteudo.ts` + `docs/GUIA-DO-OPERADOR.md`, precisam ficar iguais; `guia.test.ts` confere nomes citados): passo do cadastro cita "Registrar conteúdo"/"Salvar conteúdo".
8. **E2E**: novo `e2e/conteudo.spec.ts` (operador no escopo de cadastro: palete por API → `/conteudos/novo?palete=` → salvar só com remetente → recarregar e ver na conferência "Aguardando conferência"/"Documento não informado"; segundo do mesmo remetente fica distinto; "Registrar contagem já feita" 10 → "10 volumes · previsto não informado"; com previsto 12 → "8 / 12"…; completar identificação mantém a contagem; `/produtos` mostra "Registrar conteúdo" e não "Novo produto"). Ajustar specs que usam o menu "Produtos" ou `Gravar produto` (`e2e/cadastro.spec.ts` linha ~55–65: ir para `/produtos/catalogo`), `ajustes.spec.ts` (texto do resumo "Nenhuma nota vinculada" muda) e capturas.
9. Verificações: `npm run typecheck`, eslint nos alterados, `npm test` (~16 min), `npm run build`, E2E completo (`PLAYWRIGHT_CANAL=chrome npx playwright test --grep-invert @captura`), capturas novas. Docs: `ESTADO.md`, `DECISOES.md` (D215+), memória.

## Comandos úteis

```bash
npm run build:contracts
npx vitest run apps/api/test/banco/conteudos.test.ts
npx tsc -p apps/web --noEmit
npm run build -w @praca-reversa/web
```

Scripts de edição: usar `t.replace(de, () => para)` (texto com `$` + crase corrompe arquivo) e normalizar CRLF.

## Fechamento (11 out. 2026)

- Rodadas finais aprovadas (ver `docs/ESTADO.md`): E2E completo 115/0; `npm test` 544 + 1 corrigido (lista de migrações) → 10/10; rebuild da web com a tabela unificada e `conteudo.spec` + `ajustes.spec` 4/4.
- Únicas pendências: aplicar a migração no banco de desenvolvimento (com backup) e, se quiser, regenerar capturas (`FASE=depois npx playwright test e2e/redesign.spec.ts`).

## Correção posterior (11 out. 2026, noite): catálogo de SKU retirado

- Pedido: `Downloads/PROMPT-CADASTRO-CONFERENCIA-PRACA-REVERSA (1).md`. Decisão D220 (substitui a parte de D217 sobre `/produtos/catalogo`).
- Feito: tela `features/produtos/TelaProdutos.tsx` removida; rotas `produtos`/`catalogo-sku` removidas (`/produtos` e `/produtos/catalogo` = endereços antigos → `/conteudos/novo`, barra substituída em `useRota`); menu/navegação/App sem o catálogo; estilos sem uso removidos de `base.css`; mensagens "cadastre o produto" trocadas. API `/produtos`, tabelas, permissões e importação "Cadastro de produtos" preservadas.
- Verificações e resultados: ver `docs/ESTADO.md` (seção "Remoção do catálogo de SKU").
