# Etapa 08 Janelas e expedição

Continue o aplicativo Praça Reversa na pasta existente. Leia `AGENTS.md`, `README.md`, `docs/ESTADO.md` e `docs/DADOS-E-REGRAS.md`, `docs/INTERFACES.md`, `docs/DESCOBERTA.md`, `docs/VALIDACAO.md`. Confira as etapas anteriores e o código existente antes de editar.

## Escopo desta etapa

Implementar janelas configuráveis, capacidade/unidade/restrições do cliente, liberação do material, fila de preparação e reservas. Registrar métricas medidas e fotografia da carga. Validar saldo, reservas e capacidade no servidor, com transações e versionamento. Confirmar expedição física com quantidades/documentos reais e baixa única. Cancelar reserva antes da saída libera capacidade; expedição já concluída exige recebimento rastreado para retorno físico.

Implemente somente esta etapa. Complete as correções reversíveis necessárias ao seu aceite, preservando funções já verificadas. Regras operacionais desconhecidas devem ser registradas em `DESCOBERTA.md`; não preenchê-las com suposições como se fossem regras do cliente.

## Critérios de aceite

- Testes T21 a T26 passam, incluindo reservas concorrentes.
- Capacidade desconhecida não é ilimitada; unidade incompatível é rejeitada.
- Material bloqueado/pendente não é reservado ou expedido.
- Uma expedição repetida causa apenas uma baixa e consumo.
- Saldo disponível, volume reservado e volume expedido são distintos.

## Verificação e entrega

Execute typecheck, lint, build e os testes pertinentes que existirem no projeto. Acrescente testes necessários para as regras reais desta etapa. Use PostgreSQL para saldo/transações/concorrência. Verifique a interface em computador e celular quando ela for alterada. Não anuncie sucesso para comandos ou fluxos que não executou.

Atualize `docs/ESTADO.md` com o que foi implementado, verificações e resultados, limitações e próximo passo. Registre decisões novas em `docs/DECISOES.md`. Atualize o README se mudar a execução. Entregue um relato curto, comandos reais de iniciar e evidências proporcionais. As etapas posteriores permanecem planejadas. Publicação e uso de dados reais seguem o ambiente efetivamente definido para o piloto.
