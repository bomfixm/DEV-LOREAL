# Retomada — front aprovado e redesign completo (CONCLUÍDO em 11 out. 2026)

Arquivo de continuação (troca de conta/sessão). Sem dados reais nem credenciais.

## Pedido

- Prompt: `C:\Users\Administrator\Downloads\PROMPT-FRONT-PRACA-REVERSA.md` (ler inteiro).
- Base: 2ª rodada dos ajustes de 08/10 já feita (D197–D201): resumo ao selecionar, "Ver mais"/"Recolher"/"Fechar", busca e rota sem abrir detalhe, "Receber palete aqui", Delivery/FULL/mês/janela nas notas, regra de volumes. Ver `RETOMADA-AJUSTES-2026-10-08.md`.

## Plano desta etapa

1. Falha em `e2e/conferencia.spec.ts:112` na rodada completa da 2ª rodada (log `.dados/verificacao/e2e-completo-ajustes2.log`) — investigar.
2. Visual: tokens (`--fundo #F4F7F5`, `--tinta #1E3028`, amarelo suave `#FFF0A3` nas ações principais e item ativo), menu lateral (Mapa da praça, Inventário, Recebimento, Agendas; demais páginas continuam no menu da conta), indicadores na praça com dados reais (posições livres, em estoque, para agenda; divergência = sem fonte, nunca zero; contagem do filtro identificada).
3. Mapa: fill neutro (estoque), lilás para agenda (fluxo RESERVADO), verde para livre; conferência no contorno + marcador do rótulo; legenda.
4. "Ver mais": tabela Documentos × Deliveries (agrupar por tipo+número: 1 nota com 2 Deliveries = 1 documento, 2 parcelas), seção agenda (reservado × permanece pelos itens atuais; agenda por nota/Delivery depende do arquivo do cliente).
5. Busca: acrescentar remetente (API `busca/consulta.ts`).
6. Recebimento: menu → cadastro; sucesso oferece "Importar Excel da bipagem" do palete criado.
7. Testes (unit + E2E), docs (ESTADO, DECISOES D202+), relatório.

## Feito

- Passos 1–6 implementados (D202–D209). Testes: documentos.test (agrupamento), carga-lote (remetente/Delivery na busca, mês/janela), ajustes.spec (menu, indicadores, agenda). Rodada completa E2E: log .dados/verificacao/e2e-completo-front.log. Falta: npm test completo, ESTADO.md, relatório.
- Redesign completo (prompt `PROMPT-FRONT-PRACA-REVERSA (1).md`, 11 out. 2026): D210–D214; estilos em `apps/web/src/estilos/redesign.css` (dentro de `@media screen`: fora dele, as regras novas anulavam as de impressão de `base.css` e a etiqueta A4 virava 3 páginas). Capturas antes/depois em `docs/capturas/redesign/` (`comparacao.html`). Verificação final em `docs/ESTADO.md`.
- Pendentes de insumo: print da prévia aprovada (não veio anexado), amostra real da bipagem, fonte dos volumes esperados, arquivo da agenda do cliente.
