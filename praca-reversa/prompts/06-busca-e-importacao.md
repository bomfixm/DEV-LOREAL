# Etapa 06 Busca e importação operacional

Continue o aplicativo Praça Reversa na pasta existente. Leia `AGENTS.md`, `README.md`, `docs/ESTADO.md` e `docs/ESCOPO.md`, `docs/DADOS-E-REGRAS.md`, `docs/INTERFACES.md`, `docs/VALIDACAO.md`. Confira as etapas anteriores e o código existente antes de editar.

## Escopo desta etapa

Implementar busca por palete, SKU/código de barras, lote, NF/devolução e situação, com paginação e filtros úteis. Importar cadastro de produtos e documentos de devolução de CSV/XLSX com prévia, mapeamento de colunas, unidades, erros por linha, hash e chave de negócio. Preservar zeros e referências textuais. Usar processamento no servidor e limite de arquivo. Mostrar registro documental separado do conteúdo físico. Registrar lote e resultados de importação.

Implemente somente esta etapa. Complete as correções reversíveis necessárias ao seu aceite, preservando funções já verificadas. Regras operacionais desconhecidas devem ser registradas em `DESCOBERTA.md`; não preenchê-las com suposições como se fossem regras do cliente.

## Critérios de aceite

- Testes T14 a T16 passam; mesmo registro em outro arquivo não duplica.
- Linha inválida tem erro específico e não é gravada silenciosamente.
- Importação documental não altera saldo físico.
- Busca informa endereço, origem e confiança/estado do resultado.
- Consultas/exportações respeitam escopo e permissão.

## Verificação e entrega

Execute typecheck, lint, build e os testes pertinentes que existirem no projeto. Acrescente testes necessários para as regras reais desta etapa. Use PostgreSQL para saldo/transações/concorrência. Verifique a interface em computador e celular quando ela for alterada. Não anuncie sucesso para comandos ou fluxos que não executou.

Atualize `docs/ESTADO.md` com o que foi implementado, verificações e resultados, limitações e próximo passo. Registre decisões novas em `docs/DECISOES.md`. Atualize o README se mudar a execução. Entregue um relato curto, comandos reais de iniciar e evidências proporcionais. As etapas posteriores permanecem planejadas. Publicação e uso de dados reais seguem o ambiente efetivamente definido para o piloto.
