# Retomada — importação do inventário L’Oréal de 20/10/2026 (CONCLUÍDA)

**Concluída em 21 out. 2026 (UTC):** carregada como INV-000003 no escopo real; resultado e verificações em `docs/ESTADO.md` ("Inventário L'Oréal de 20/10/2026"), decisões D274–D279. Próximo pedido pendente: E2E da "Seleção cliente — teste".

Arquivo de continuação (troca de conta/sessão). **Sem dados reais nem credenciais.**

## Pedido

- Zip: `C:\Users\Administrator\Downloads\INVENTARIO-LOREAL-DADOS-E-PROMPT.zip` (prompt `PROMPT-CLAUDE-IMPORTAR-INVENTARIO.txt`, `RESUMO-DA-IMPORTACAO.txt`, `dados/inventario-preparado.json` formato "1.0", `inventario-origem.json`, `mapa-enderecos.json`, `pendencias.json`, `ferramentas/preparar_inventario_loreal.py`). Extrair fora do repositório (dados reais).
- Implementar e EXECUTAR a importação no banco que o app usa (desenvolvimento, escopo real `PRACA-REVERSA/LOREAL`), com prévia, relatório, verificação por SQL e na interface.

## Apurado (só leitura, `.dados/analisar-inventario-20-10.tmp.mts`)

- Escopo real: INV-000002 ATIVO (1.239 linhas, 13/10), INV-000001 SUBSTITUIDO; 1.153 vínculos ativos (636 gravados pelo INV-000001 e mantidos, 517 pelo INV-000002); 184 paletes (182 com posição); 0 conteúdos registrados. **Não há conteúdo DEMO no escopo real** (a demonstração é outro escopo; não mexer).
- Mapa já conforme o pacote: Rua 11 A42–A58 (com A57), Rua 12 34 endereços (ímpares A79–A89 + A103–A123; pares A92–A124, confirmados pelo usuário em 14/10), Ruas 13/14 A101–A134, **Ruas 15/16 A101–A130 (30 cada)**, Grade GR1–GR15. Nada a mudar no layout.
- Chave do vínculo do pacote v1 (13/10) = `sha256(JSON.stringify([endereço, chave_documento]))`; chave_documento = `hashContexto(contextoDocumental(tipo_origem, número, delivery, remetente))` com o **código de tipo original** (NFD/NFE/MI, vazio = TIPO_PENDENTE).
- 20/10: 1.115 registros = 753 candidatos + 362 em revisão (bloqueio: endereco_a_validar 44, numero_palete_ausente 17, endereco_fora_da_regra 10, duplicata_exata 18, palete_em_multiplos_enderecos 50, endereco_com_multiplos_paletes 229, possivel_recontagem 4, formula 1). Endereços "GR 1" precisam virar "GR - 1".
- Candidatos: 730 vínculos (endereço × documento; 8 com mais de uma linha → volumes não somados), **579 já ativos com a mesma chave, 151 novos**; todos os 142 endereços resolvem para posição confirmada.
- Ativos hoje ausentes dos candidatos: 574; ausentes de TODO o arquivo 20/10: 409 (165 aparecem só em linhas em revisão).

## Desenho decidido

1. Conversor `apps/api/src/modules/importacao/inventario-loreal.ts`: preparado 1.0 → pacote v1 (todas as 1.115 linhas em `linhas_fonte` com campos originais + classificação, INVENTÁRIO, etiquetas FULL, pendências); candidatos → vínculos/posições; sem número → `linhas_sem_numero_documento`; bloqueados → **`linhas_em_revisao`** (extensão do v1, default []).
2. Carregador: `linhas_em_revisao` gravadas como `REQUER_RESOLUCAO`, não aplicadas, sem palete/vínculo, motivos do pacote; **`--manter-ausentes`**: substituição sem encerrar vínculos ausentes da versão nova (continuam ativos e aparecem como "não consta do inventário atual").
3. CLI `inventario:carregar` aceita o zip/JSON preparado direto (prévia sem `--executar`).
4. Interface: janela do palete mostra FULL/FRACIONADO + etiquetas, conferência informada, "Inventário em validação", e marca vínculos "não consta do inventário de 20/10"; pendências agrupadas visíveis na consulta interna.
5. Execução: backup → prévia → `--executar --substitui INV-000002 --manter-ausentes` → reenvio (sem duplicar) → SQL → interface (porta 5173/3100, `supervisor.praca`).

## Próximos passos

Ver plano acima; depois atualizar `ESTADO.md`, `DECISOES.md` (D274+), README e memória. Depois disso: E2E da "Seleção cliente — teste" (pedido anterior, pendente).
