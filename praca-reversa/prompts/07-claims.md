# Etapa 07 Claims e validação de resultados

Continue o aplicativo Praça Reversa na pasta existente. Leia `AGENTS.md`, `README.md`, `docs/ESTADO.md` e `docs/DADOS-E-REGRAS.md`, `docs/INTERFACES.md`, `docs/DESCOBERTA.md`, `docs/VALIDACAO.md`. Confira as etapas anteriores e o código existente antes de editar.

## Escopo desta etapa

Implementar cadastro/importação de casos, motivos, prazos, responsáveis e valor estimado. Importar conforme validações da etapa 06. Sugerir candidatos com explicação da pista: SKU, lote, devolução, recebimento e histórico. Registrar evidências de localização, quantidade vinculada e validação por perfil autorizado. Limitar quantidade recuperada, evitar vínculos incompatíveis e preservar casos já encerrados. Separar localização, recuperação validada, regularização e valor confirmado. Regras contratuais ainda pendentes ficam configuráveis ou exigem tratativa manual documentada.

Implemente somente esta etapa. Complete as correções reversíveis necessárias ao seu aceite, preservando funções já verificadas. Regras operacionais desconhecidas devem ser registradas em `DESCOBERTA.md`; não preenchê-las com suposições como se fossem regras do cliente.

## Critérios de aceite

- Testes T17 a T20 passam; mesmo SKU de outra origem não fecha um claim.
- Localizar avaria não elimina automaticamente seu motivo.
- Quantidade validada não excede o caso nem justifica recuperações incompatíveis.
- Valor confirmado exige validador e evidência; estimativa continua separada.
- Prazos desconhecidos não recebem datas inventadas.

## Verificação e entrega

Execute typecheck, lint, build e os testes pertinentes que existirem no projeto. Acrescente testes necessários para as regras reais desta etapa. Use PostgreSQL para saldo/transações/concorrência. Verifique a interface em computador e celular quando ela for alterada. Não anuncie sucesso para comandos ou fluxos que não executou.

Atualize `docs/ESTADO.md` com o que foi implementado, verificações e resultados, limitações e próximo passo. Registre decisões novas em `docs/DECISOES.md`. Atualize o README se mudar a execução. Entregue um relato curto, comandos reais de iniciar e evidências proporcionais. As etapas posteriores permanecem planejadas. Publicação e uso de dados reais seguem o ambiente efetivamente definido para o piloto.
