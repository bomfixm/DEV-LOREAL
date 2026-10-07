# Retomada — complemento "seleção do cliente e conciliação"

**Concluído em 5 out. 2026** (segunda sessão). Este arquivo foi o roteiro de retomada entre as duas sessões; o estado atual, as verificações e as limitações estão em `docs/ESTADO.md`, as decisões em `docs/DECISOES.md` (D159–D170), as perguntas abertas em `docs/DESCOBERTA.md` e o uso no `README.md`.

Feito na segunda sessão (sobre a base da primeira: migração, contratos, layout do desenho aprovado, importação de inventário/seleção, módulo `selecao` e testes PostgreSQL):

- Regressões da suíte com o layout novo corrigidas nos testes (desenho aprovado no lugar do esquema de 96 posições; contratos com campos novos; relatório de importação sem a coluna "Ação" nos tipos antigos; operador consulta só lotes de seleção).
- Busca por NF: base `INVENTARIO` (vínculo NF × palete), exportação CSV e cartão na interface.
- Filtro `aplicaveis=true` nas linhas da importação (conjunto aplicável do inventário na confirmação).
- Interface: parâmetros da prévia (inventário e seleção), ação por linha e resumo, conjunto aplicado; telas `/selecoes`, `/selecoes/<id>` (conciliação, filtros, detalhe, resolução, mapa, exportações, proposta e reserva), `/inventarios`, `/inventarios/<id>` (linhas, conferência externa); documentos informados no detalhe do palete; mapa com área desativada e endereço real; layout com "Endereços reais", "Aplicar nomes operacionais" e "Criar do desenho aprovado"; menu "Seleção do cliente".
- Tutorial/ajuda: tarefa "Localizar o que o cliente pediu", glossário e dúvidas; `docs/GUIA-DO-OPERADOR.md` regenerado.
- Banco de desenvolvimento migrado e sincronizado; E2E `e2e/selecao.spec.ts` e capturas `docs/capturas/selecao-cliente/`.
