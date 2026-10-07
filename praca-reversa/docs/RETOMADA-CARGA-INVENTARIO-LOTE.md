# Retomada — carga do inventário real em lote (concluída em 6 out. 2026)

> **Concluída.** Testes, interface, verificações e documentação feitos; resultado e limitações em `docs/ESTADO.md` (seção "Carga do inventário real em lote"). Este arquivo fica só como registro.

Arquivo de continuação para trocar de conta/sessão no meio da tarefa. Atualizado em 6 out. 2026. **Não contém dados reais nem credenciais.**

## Pedido

- Prompt: `C:\Users\Administrator\Downloads\PROMPT-IMPORTACAO-AUTOMATICA-NFD.md` (ler inteiro).
- Pacote: `C:\Users\Administrator\Downloads\Importacao-Praca-Reversa.zip` (`dados-importacao.json`, schema `praca-reversa.importacao-inventario.v1`). Dados reais: não copiar para o repositório, fixtures ou demo.
- **Decisão do usuário (6 out.)**: a operação real fica **fora da demonstração**, num escopo real; a demonstração continua só como tutorial. O teste final deve mostrar a praça real carregada. Escopo proposto: unidade `PRACA-REVERSA` ("Praça da reversa — DHL") × cliente `LOREAL` ("L'Oréal"), não-demo, com o desenho aprovado.

## Desenho adotado (já implementado na API)

- Reuso: `LoteImportacao` (tipo INVENTARIO, formato novo `JSON`, CONFIRMADO, arquivo privado) → `InventarioReferencia` (N° Pallet = `REFERENCIA_EXTERNA`, nunca ID) → `LinhaInventario` (as 851 linhas) → `VinculoDocumentoPalete` (700 NFD + 45 tipo pendente/MI); paletes por `cadastrarPalete` (código gerado PR-xxxxxx), um por endereço ocupado (123); localização só por `EnderecoPosicao` CONFIRMADO (hoje nenhuma → "Posição no mapa pendente"); endereço livre (57) = referência, sem palete; 40 NFDs fora da praça = linhas REFERENCIA_HISTORICA.
- Identidade documental = SHA-256 de `JSON.stringify([tipo||'TIPO_PENDENTE', número, 'DELIVERY'|'REMETENTE', valor])` = `chave_documento` do pacote. Reenvio: mesmo `id_lote`/hash → não grava de novo (só registra posições que passaram a resolver). Chave externa do vínculo = `chave_vinculo` (índice único parcial ATIVO).
- Palete full recalculado dos vínculos ativos: 1 identidade NFD sem conteúdo sem número = FULL; ≥2 = MISTO; senão NÃO INFORMADO (reproduz 123/123 do pacote). "Mais de um palete" = declarado > 1 ou outros locais (bate 785/785).
- Cidade destino (por identidade documental, tabela `informacao_documento`) e produto na caixa (por palete × identidade, `conteudo_documento_palete` + `descricao_caixa_documento`) editáveis; reimportar vazio não apaga.

## Feito

- Migração `apps/api/prisma/migrations/20261009090000_carga_inventario_lote` (aplicada no banco de **desenvolvimento**; o de testes é recriado pelos testes) + `schema.prisma`.
- Contratos: `importacao.ts` (FormatoArquivo JSON, SignificadoNumeroPalete REFERENCIA_EXTERNA), `paletes.ts` (`informedAddress` opcional no resumo), `inventario.ts` (DocumentoPalete/DocumentosPalete com os 7 campos, schemas de edição).
- API: `modules/importacao/identidade.ts`, `modules/importacao/carga-lote.ts` (validação do pacote, plano, gravação, reenvio), `cli/carregar-inventario.ts` (+ scripts `inventario:carregar` na raiz e na API), `modules/paletes/notas.ts` (leitura das notas + edições) e rotas em `modules/paletes/rotas.ts`; GET `/paletes/:id/documentos` agora usa `notasDoPalete` (função antiga removida de `selecao/inventarios.ts`); `praca/consultas.ts` (endereço informado no resumo e no filtro); `importacao/inventario.ts` (grava identidade; REFERENCIA_EXTERNA não vira ID); `importacao/servico.ts` e `arquivo/ler.ts` (lote JSON não passa pela leitura de planilha); ações de auditoria novas em `auditoria/registrar.ts`.
- `npx tsc -p apps/api/tsconfig.json --noEmit` aprovado nesse ponto.

## Situação

- Remetente no contexto documental = NFKD sem marcas, espaços colapsados, maiúsculas (`normalizarRemetente` em `identidade.ts`): conferido nas 851 linhas. O pacote real **passa na validação** (`npm run inventario:carregar -- --arquivo "C:/Users/Administrator/Downloads/Importacao-Praca-Reversa.zip"` → "Pacote lido e conferido"; sem escopo operacional → "Escopos operacionais existentes: nenhum").

- **Escopo real criado e carga EXECUTADA** no banco de desenvolvimento (6 out. 2026, ~13:56 UTC):
  - Escopo `PRACA-REVERSA/LOREAL` ("Praça da reversa — DHL · L'Oréal", não-demo) com o desenho aprovado (194 ativas + 300 desativadas). Contas `admin.praca` e `supervisor.praca` (senhas só em `.dados/teste-local/credenciais.md`). Script usado: `.dados/preparar-escopo-real.tmp.ts` (fora do versionamento; não rodar de novo — recusa se o escopo existe).
  - Comando: `npm run inventario:carregar -- --arquivo "C:/Users/Administrator/Downloads/Importacao-Praca-Reversa.zip" --unidade PRACA-REVERSA --cliente LOREAL --usuario supervisor.praca --executar`
  - Resultado: **INV-000001**, lote `39f2623e…`; 851 linhas (755 aplicadas, 77 endereço livre/referência, 19 repetidas agrupadas, 0 conflito); **745 vínculos** (700 NFD — 657 números distintos —, 45 tipo pendente/MI); **123 paletes** cadastrados (todos com posição no mapa pendente: nenhuma sequência de endereço confirmada); 40 referências fora da praça; 22 volumes pendentes; 0 saldo por SKU. Relatório: `.dados/cargas/INV-000001-*.md`.
  - **Reenvio** do mesmo pacote com `--executar`: "já foi importado como INV-000001", 0 criados, 745 já existentes, 123 paletes preservados.
  - Conferência no banco: `node .dados/conferir-carga.tmp.mjs` (123 paletes, 0 com posição, 745 vínculos ativos, 700 NFD/657 distintas, 22 volumes pendentes, 851 linhas, 77 livres, 0 saldo, 1 lote).
  - Leitura das notas (`notasDoPalete`) conferida em paletes reais: `cd apps/api && npx tsx ../../.dados/conferir-notas.tmp.ts` → palete misto com 36 notas, palete full com 2 paletes declarados, NFD em dois endereços (outro local ATUAL com posição no mapa pendente), MI marcado como não-NFD com pendência, endereço com conteúdo sem número → "Não informado". Ajuste pequeno pendente: quando não há documento mas há conteúdo sem número, o motivo do palete full deve citar o conteúdo sem número (hoje diz "Nenhum documento vinculado").
- **Falta**: interface (passo 3), testes (passo 2), verificações completas (passo 6) e documentação (passo 7). Nada disso foi iniciado. `npm run typecheck` completo (contratos, API, web e testes) **aprovado sem erros** depois das mudanças; lint e `npm test` ainda não rodados. A sessão anterior parou por limite de uso da conta (5 h) em 92%.

## Próximos passos (em ordem)

1. (feito) validação do pacote; (feito) passos 4 e 5 abaixo.
2. Testes: acrescentar `informacao_documento`, `conteudo_documento_palete`, `descricao_caixa_documento` à lista `TABELAS` de `apps/api/test/banco/apoio.ts` (antes de `vinculo_documento_palete`/`palete`); criar `apps/api/test/banco/carga-lote.test.ts` com pacote **fictício** gerado no teste (validação, gravação, reenvio sem duplicar, cidade/produto preservados, 2 endereços da mesma NF, palete misto, volumes pendentes, N° Pallet repetido, posição ocupada → conflito não aplicado, escopo demo recusado).
3. Interface (`apps/web`): `features/paletes/DocumentosInformados.tsx` → seção "Notas do palete" com os 7 campos (NFD, Remetente, Cidade destino editável, Volumes, Palete full, Mesma NFD em mais de um palete com outros endereços atuais × fora da praça, Produto na caixa editável + descrições por caixa); cabeçalho de `DetalhePalete.tsx` com endereço completo + "Posição no mapa pendente"; `ListaPaletes.tsx`/`filtro.ts` mostrando e agrupando pelo endereço informado (fileira, número numérico); rótulo `REFERENCIA_EXTERNA` em `features/selecao/TelaInventario.tsx`; formato JSON nos rótulos de importações.
4. Escopo real no banco de desenvolvimento: `npm run admin:criar -- --login <admin> --nome "<nome>" --unidade PRACA-REVERSA --cliente LOREAL --unidade-nome "Praça da reversa — DHL" --cliente-nome "L'Oréal"` (senha gerada e guardada só em `.dados/teste-local/credenciais.md`); criar um supervisor pela Administração de acesso; aplicar "Criar do desenho aprovado" (POST `/api/v1/layout/desenho-aprovado`).
5. Carga real: prévia e depois `--executar` com `--unidade PRACA-REVERSA --cliente LOREAL --usuario <supervisor>`; repetir para provar que o reenvio não duplica. Relatório vai para `.dados/cargas/`.
6. Verificar: `npm run typecheck`, `npm run lint` (inclui testes; ~4 min), `npm test`, `npm run build`, abrir palete e buscar NFD (porta ≠ 3000; reiniciar servidor após build), capturas.
7. Atualizar `docs/ESTADO.md`, `docs/DECISOES.md` (próximas D171+), `README.md` (comando), `docs/DESCOBERTA.md`; relatar ao usuário comando, escopo, quantidades gravadas, pendências e falhas.

Ver também a memória `ambiente-local-praca-reversa` (PowerShell/Bash, porta 3000, CRLF, `node -e` com crases quebra no Bash).
