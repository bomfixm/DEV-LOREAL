# Retomada — importação do Excel da bipagem no palete (CONCLUÍDA em 8 out. 2026)

> Entrega concluída no desenvolvimento local: ver `docs/ESTADO.md` (seção "Importação do Excel da bipagem"). Este arquivo fica como histórico.

Arquivo de continuação (troca de conta/sessão). Sem dados reais nem credenciais. Iniciado em 8 out. 2026.

## Pedido

- Prompt: `C:\Users\Administrator\Downloads\PROMPT-IMPORTACAO-EXCEL-BIPAGEM.md` (ler inteiro).
- Botão "Importar Excel da bipagem" no detalhe do palete → arquivo/aba/colunas → prévia → "Adicionar notas ao palete" → grava o lote e atualiza detalhe e mapa. Sem Excel real ainda: mapeamento de colunas e aba obrigatórios na tela.

## Desenho decidido

- **Reaproveita a esteira de importação** (`apps/api/src/modules/importacao/servico.ts`): tipo novo `BIPAGEM` (envio → estrutura/aba → `PUT mapeamento` com parâmetros → prévia versionada → `POST confirmar` com bloqueio consultivo por escopo, revalidação e assinatura → `registrarFalha` → `descartar` = cancelar).
- **Destino pelo ID permanente**: coluna nova `lote_importacao.palete_id` (obrigatória no tipo BIPAGEM, enviada em `POST /importacoes?tipo=BIPAGEM&palete=<uuid>`). Arquivo já confirmado vale por (hash + palete): o mesmo arquivo pode servir a outro palete; no mesmo palete devolve o resultado existente. Índice único de arquivo confirmado passa a incluir o palete.
- **Persistência no modelo atual**: cada lote confirmado cria um `inventario_referencia` com `origem = 'BIPAGEM'` e código `BIP-000001` (numeração própria; `INV-` continua a sua), `linha_inventario` só das linhas que formam vínculo e `vinculo_documento_palete` (um por nota/parcela) → busca por NF, planilha única, conciliação e "Notas do palete" funcionam sem mudança. Lista de inventários ignora `BIPAGEM`.
- **Formato escolhido pelo operador** (`layout`): `UMA_LINHA_POR_NOTA` (coluna de quantidade com significado `VOLUMES_NESTE_PALETE` ou `TOTAL_DA_NOTA`; total da nota nunca vira volume do palete) ou `UMA_LINHA_POR_VOLUME` (conta etiquetas distintas; sem etiqueta e várias linhas = ambiguidade com decisão `CONTAR_LINHAS`/`VOLUMES_PENDENTES`).
- **Identidade**: DELIVERY → REMETENTE (mesmo cálculo do inventário, `identidadeDocumento`) → chave NF-e → emitente+série → só número (aviso). Chave NF-e validada (44 dígitos + DV módulo 11; número da chave confere com a NFD).
- **Decisões explícitas nos parâmetros** (entram na assinatura da prévia e são revalidadas): `excludedRows`, `includedRows` (linhas de outro destino), `decisions[identidade]` = `MANTER_ATUAL`/`SUBSTITUIR`/`NOVA_PARCELA`/`REGISTRAR_SEPARADA`/`CONTAR_LINHAS`/`VOLUMES_PENDENTES`/`PARCELAS`. Sem decisão = linha CONFLITANTE (bloqueia).
- **Permissões**: executar = `palete.cadastrar` (mesma das edições de notas); consultar = `palete.consultar`.
- **Interface**: página `/paletes/<id>/bipagem` (como mover/transferir) com cabeçalho fixo do palete (código, ID, posição/endereço).

## Feito

- Contratos: `packages/contracts/src/bipagem.ts` (parâmetros, decisões, resumo) + `importacao.ts` (tipo `BIPAGEM`, campos, permissões, `palletId`, `palletImport`, `TIPOS_IMPORTACAO_GERAL`, modelos `bipagem.csv/xlsx`).
- Migração `apps/api/prisma/migrations/20261011090000_importacao_bipagem` + `schema.prisma` (ainda **não aplicada no banco de desenvolvimento**; o de testes é recriado a cada rodada).
- API: `importacao/bipagem.ts` (interpretar, classificar, gravar), `servico.ts`, `rotas.ts` (`?palete=`), `campos.ts` (sinônimos próprios), `modelos.ts`, `relatorio.ts`, `inventario.ts` (numeração INV sem BIP), `selecao/inventarios.ts` (lista sem BIP), `paletes/notas.ts` (textos de pendência), `planilha/dados.ts` e auditoria (`BIPAGEM_IMPORTADA`).
- Testes `apps/api/test/banco/bipagem.test.ts`: **11 aprovados** (42 s).

## Próximos passos

1. (feito) contratos, migração (aplicada também no banco de desenvolvimento, com backup antes), API, interface (`TelaBipagem.tsx`, botão no detalhe), estilos.
2. (feito) testes de banco (11), E2E `e2e/bipagem.spec.ts` (4, computador e celular) e 16 capturas em `docs/capturas/bipagem/`; typecheck; lint dos arquivos alterados; docs (ESTADO, DECISOES D184–D191, DESCOBERTA, README).
3. (feito: 520/522 → 2 ajustes → reexecutados aprovados; E2E 111 aprovados, 0 falhas) Conferir o resultado do `npm test` completo (log em `.dados/verificacao/npm-test-bipagem.log`) e rodar `PLAYWRIGHT_CANAL=chrome npm run test:e2e` (regressões no detalhe do palete e nas telas de importação); registrar em ESTADO.md.
4. Quando chegar o Excel real: ajustar `SINONIMOS_BIPAGEM` em `apps/api/src/modules/importacao/campos.ts` e as respostas de DESCOBERTA.md.
