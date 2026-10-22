# Retomada — carga do inventário L’Oréal de 13/10/2026 (CONCLUÍDA no desenvolvimento local)

Arquivo de continuação (troca de conta/sessão). **Sem dados reais nem credenciais.** Resultado e verificações em `docs/ESTADO.md` (seção "Carga do inventário L’Oréal de 13/10/2026"); decisões D221–D225.

## Pedido

- Prompt: `C:\Users\Administrator\Downloads\PROMPT-IMPORTACAO-AUTOMATICA-NFD (1).md`.
- Pacote: `C:\Users\Administrator\Downloads\Importacao-Praca-Reversa (1).zip`, extraído em `.dados/cargas/pacote-2026-10-13/` (fora do versionamento).

## Feito

- Estado prévio (só leitura, `.dados/estado-banco-13-10.tmp.mjs`): escopo real, `supervisor.praca`; INV-000001 ATIVO (851 linhas, 745 vínculos, 123 paletes); **nenhuma correspondência endereço ↔ posição** (0 sequências) → todos os paletes com "posição no mapa pendente".
- Patch `suporte-sem-endereco.patch` aplicado (`git apply`; com `core.autocrlf=true` o arquivo virou CRLF e foi voltado para LF — conferir finais de linha com node).
- Código: `semEndereco` no resultado; prévia com diferenças da substituição e aviso sem `--substitui`; base de busca `ORIGEM_INVENTARIO`; inventário mostra "Sem alocação / endereço não informado"; número composto até 200 caracteres (migração `20261014090000_numero_documento_composto`); `importacao/linhas-vigentes.ts` (palete do endereço por qualquer versão, linha vigente, linha atual do vínculo mantido) usado em carregador, notas, resumo da praça, planilha, inventário, conteúdo e busca; testes novos em `carga-lote.test.ts`.
- Backups `.dados/backups/…20261013-150451Z…` e `…20261013-151006Z…`; migrações `20261013090000_conteudo_palete` e `20261014090000_numero_documento_composto` aplicadas no banco de desenvolvimento.
- Carga **INV-000002** (substitui INV-000001), reenvio sem duplicar, conferência por SQL (`.dados/conferir-carga-13-10.tmp.mjs`) e no navegador (porta 3000 reiniciada com o build novo).

## Próximos passos (dependem da operação)

1. Informar e confirmar as sequências de endereço por faixa (Layout da praça → Endereços reais) e reenviar o mesmo pacote para registrar as posições.
2. Revisar pendências listadas em `ESTADO.md` (51 vínculos ausentes da planilha nova, 2 paletes sem vínculo, 3 linhas sem RUA, volumes pendentes, tipo pendente/MI).

## Comandos úteis

```bash
npm run inventario:carregar -- --arquivo ".dados/cargas/pacote-2026-10-13/dados-importacao.json" --unidade PRACA-REVERSA --cliente LOREAL --usuario supervisor.praca
node .dados/conferir-carga-13-10.tmp.mjs
npx vitest run apps/api/test/banco/carga-lote.test.ts
```
