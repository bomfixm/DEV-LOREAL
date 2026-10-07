# Etapa 05 Movimentações com histórico

Continue o aplicativo Praça Reversa na pasta existente. Leia `AGENTS.md`, `README.md`, `docs/ESTADO.md` e `docs/DADOS-E-REGRAS.md`, `docs/ARQUITETURA.md`, `docs/VALIDACAO.md`. Confira as etapas anteriores e o código existente antes de editar.

## Escopo desta etapa

Implementar mudança de localização do palete e transferência de quantidades entre paletes. Preservar segmento, produto, lote, origem e condição. Criar serviço transacional de saldo e evento de estoque, controle de versão, idempotência e proteção de quantidade reservada. Correções concluídas geram eventos compensatórios autorizados e vinculados ao original. Testar pedidos simultâneos contra PostgreSQL real.

Implemente somente esta etapa. Complete as correções reversíveis necessárias ao seu aceite, preservando funções já verificadas. Regras operacionais desconhecidas devem ser registradas em `DESCOBERTA.md`; não preenchê-las com suposições como se fossem regras do cliente.

## Critérios de aceite

- Testes T08 a T13 passam, incluindo falha entre baixa e entrada.
- Dois pedidos de 8 e 6 sobre saldo 10 não confirmam mais de 10.
- Retry não duplica movimento; chave repetida com outro payload é rejeitada.
- Nenhum saldo negativo ou alteração entre unidades/clientes.
- Histórico mostra autor, horário, origem/destino e correções.

## Verificação e entrega

Execute typecheck, lint, build e os testes pertinentes que existirem no projeto. Acrescente testes necessários para as regras reais desta etapa. Use PostgreSQL para saldo/transações/concorrência. Verifique a interface em computador e celular quando ela for alterada. Não anuncie sucesso para comandos ou fluxos que não executou.

Atualize `docs/ESTADO.md` com o que foi implementado, verificações e resultados, limitações e próximo passo. Registre decisões novas em `docs/DECISOES.md`. Atualize o README se mudar a execução. Entregue um relato curto, comandos reais de iniciar e evidências proporcionais. As etapas posteriores permanecem planejadas. Publicação e uso de dados reais seguem o ambiente efetivamente definido para o piloto.
