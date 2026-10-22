# Retomada — nomes/endereços do mapa, carga e reconferência após 20 dias (CONCLUÍDA no desenvolvimento local, 13 out. 2026 — restam as respostas da Rua 11/Grade)

Arquivo de continuação (troca de conta/sessão). **Sem dados reais nem credenciais.** Ler também `AGENTS.md`, `docs/ESTADO.md` e `docs/RETOMADA-CARGA-INVENTARIO-13-10.md`.

## Pedido

- Prompt: `C:\Users\Administrator\Downloads\PROMPT-IMPORTACAO-AUTOMATICA-NFD (2).md` (substitui o anterior). A **imagem anotada não veio**; a única imagem recente (`Imagem do ChatGPT 13 de out. de 2026, 14_10_05.png`) é o desenho SEM anotações. Usar a tabela transcrita no prompt.
- ZIP `Importacao-Praca-Reversa (1).zip`: `dados-importacao.json` idêntico (SHA-256 4792749…) ao já carregado como **INV-000002** (13/10). Reenvio = idempotente; só registra posições que passarem a resolver.

## Fatos do banco (escopo real, layout revisão 1)

- FB01 F01 única 17 pos.; FB02–FB04 duplas 17+17 (F02–F07); FB05/FB06 duplas 15+15 (F08–F11); FB07 F12 única 15. P01 no topo (y cresce para baixo). x crescente da esquerda para a direita: FB01…FB07.
- Hoje: FB05 = "Fileira 15"/prefixo 15; FB06 = "Fileira 16"/16 → **trocar** (Rua 16 = FB05, Rua 15 = FB06). Índice único (layout, prefixo): trocar em duas fases.
- 0 sequências/endereços. 184 paletes, 0 com posição.
- Nomes/prefixos vêm de `examples/layout-desenho-aprovado.json` (aplicados por `POST /layout/nomenclatura-aprovada`, `aplicar-desenho.ts`).

## Plano

1. Mapa: atualizar nomenclatura (Rua 11…Rua 14, Rua 16, Rua 15, Grade (GR)); troca de prefixo em duas fases; confirmar sequências inequívocas: F02/F04/F06 `A101-A133/2`, F03/F05/F07 `A102-A134/2`, F08/F10 `A101-A129/2`, F09/F11 `A102-A130/2`, todas P01 = primeiro (topo). **Pendentes (perguntar)**: Rua 11 (A42→A68 não dá 17 posições; planilha A42–A58) e Grade (GR1→GR13 não dá 15; planilha tem GR14/GR15). Rótulo principal no mapa = endereço operacional ("15 - A120", "GR9").
2. Reenvio do pacote (registra posições das faixas confirmadas; **não pode reiniciar o relógio**).
3. Reconferência 20 dias: campos próprios no palete (migração), eventos que reiniciam (movimento, transferência origem+destino, correção física, retirada, entrada de material, conferência COMPLETA concluída, reconferência completa registrada na conferência de volumes), não reiniciam (consulta, renomear, reenvio, carga registrando posição, parcial/rascunho, reserva). API calcula com o relógio do servidor; mapa laranja + "Reconferência necessária"; legenda/filtro; detalhe/lista com datas; atualização periódica.
4. Testes com relógio controlado; checks; build; reiniciar porta 3000; verificar no navegador; docs (D226+), memória.

## Feito

- Mapa aplicado no escopo real pela API (`.dados/aplicar-mapa-13-10.tmp.mjs`, backup `…20261013-174443Z…` antes): nomes Rua 11…14, Rua 16 (FB05/16), Rua 15 (FB06/15), Grade (GR); 10 faixas confirmadas (162 endereços), revisão 29. Pendentes: Rua 11 e Grade.
- Prévia da carga: 140 paletes passam a ter posição; 42 pendentes (Rua 11 17, GR 15, Rua 12 fora de A101–A134 10). **Reenvio ainda NÃO executado** (esperando o relógio).
- Relógio: contrato `reconferencia.ts` (cálculo puro), migração `20261015090000_reconferencia_palete` (campos no palete + backfill + tabela imutável), `paletes/relogio.ts`; ligado em movimentos (registrarLocalizacao, moverPalete com `{ relogio: false }` na carga), transferências (origem+destino), conclusão de conferência COMPLETA, registrar conteúdo, bipagem, expedição parcial, retorno físico; rota `POST /paletes/:id/reconferencias`; `cadastrarPalete` recebe `agora`; resumo/detalhe com `reconference`. API compila.
- Testes: `packages/contracts/src/reconferencia.test.ts`, `apps/api/test/banco/reconferencia.test.ts` (6), caso da carga em `carga-lote.test.ts` — aprovados. Web: `PrazoReconferencia.tsx` (detalhe/resumo/lista), `ReconferenciaCompleta.tsx` (conferência de volumes), mapa laranja + rótulo, legenda, filtro "Precisam de reconferência" (servidor: `reconferencia=sim`), rótulo principal = endereço (GR9), atualização a cada 60 s/foco.
- Feito também: lint limpo, 127 unitários web/contratos, `npm test` 561/561, migração 20261015 no banco de dev (backup `…20261013-181509Z…`), reenvio (140 posições, relógio intacto), build, porta 3000 reiniciada, E2E `reconferencia.spec` aprovado com capturas, docs D226–D231, ESTADO, DESCOBERTA, memória.
- E2E completo: 115 aprovados + 1 falha de seletor (`computador.spec`) corrigida e repetida (aprovado).
- Pendente: respostas da Rua 11 e da Grade → confirmar F01/F12 (Grade com sentido "P01 recebe o último") e reenviar o mesmo pacote.
