# Retomada — endereços da Rua 11, Rua 12 e Grade (CONCLUÍDA no desenvolvimento local, 14 out. 2026)

Arquivo de continuação. **Sem dados reais nem credenciais.** Ler antes: `AGENTS.md`, `docs/ESTADO.md`, `docs/RETOMADA-MAPA-RECONFERENCIA.md`, memória do projeto.

## Respostas do usuário (14/10/2026)

- **Rua 11** (FB01, F01, faixa única de 17): **A42 a A58, de 1 em 1, A42 no topo** → sequência `A42-A58`, sentido `P01_PRIMEIRO`.
- **Grade** (FB07, F12, faixa única de 15): **GR1 embaixo até GR15 em cima** ("pode seguir o GR15 e GR14 para cima, depois eu faço a movimentação") → sequência `1-15`, sentido `P01_ULTIMO` (P01 no topo recebe GR15).
- **Rua 12** (FB02): "é diferente, pode seguir o que está na planilha, começando pela A79". Planilha INV-000002 (33 endereços): ímpares A79–A89 e A103–A123 (17), pares A92–A124 (16; A96 sem linha). Proposta:
  - F02 (esquerda, 17): `A79-A89/2, A103-A123/2`, `P01_PRIMEIRO`.
  - F03 (direita, 17): `A92-A124/2`, `P01_PRIMEIRO` (A96 fica posição sem palete).
  - Bate com o que já estava em DESCOBERTA ("observado no modelo": ímpares A79–A89 e A103–A123; pares A92–A124).

## Ponto delicado (Rua 12)

23 paletes da Rua 12 já têm posição pela numeração antiga (A101–A133 / A102–A134, confirmada em 13/10). A carga não reposiciona palete que já tem posição ("localização atual prevalece"). Todas as posições da Rua 12 mudam de endereço.

Plano (script de manutenção `.dados/corrigir-ruas-14-10.tmp.ts`, rodar com `npx tsx`):
1. Backup (`npm run backup:criar`).
2. Para cada palete da Rua 12 com posição registrada pela carga: **correção de localização** do evento da carga para "sem posição" (`corrigirMovimento(..., { relogio: false })` — opção nova; não reinicia o prazo de 20 dias, é correção de dado de origem).
3. Substituir as sequências F02/F03 (motivo) e confirmar; confirmar F01 (Rua 11) e F12 (Grade).
4. Registrar a posição dos paletes da Rua 12 pela tabela corrigida (`moverPalete(..., { relogio: false })`, motivo como o da carga).
5. Reenviar o mesmo pacote (`npm run inventario:carregar -- --arquivo <abs>/.dados/cargas/pacote-2026-10-13/dados-importacao.json --unidade PRACA-REVERSA --cliente LOREAL --usuario supervisor.praca --executar`) para Rua 11 e Grade.
6. Conferir (paletes com posição, relógio intacto), build se houver código, reiniciar porta 3000, docs (D241+), ESTADO, DESCOBERTA, memória.

## Feito

- 14/10: backup `…20261014-225305Z-53c9aaec`; script `.dados/corrigir-ruas-14-10.tmp.ts --executar` aplicado: Rua 11, Rua 12 (substituída) e Grade confirmadas; Rua 12 com 33 paletes posicionados (23 corrigidos + 10 novos), relógio intacto. Falta: reenvio do pacote (Rua 11/Grade), conferência, docs.

- Reenvio do pacote: 32 localizações (Rua 11 e Grade). Conferência: 182/184 com posição, 0 divergências, 0 relógios alterados. Ordem das ruas no painel ajustada (D244). Testes, build, porta 3000 reiniciada, docs D241–D244, ESTADO, DESCOBERTA.
- Levantamento da planilha e das faixas (somente leitura).
- `apps/api/src/modules/movimentos/servico.ts`: `corrigirMovimento` ganhou `opcoes: { relogio?: boolean }` (padrão reinicia, como antes). tsc ok.
