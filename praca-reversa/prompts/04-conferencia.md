# Etapa 04 Conferência e reconciliação

Continue o aplicativo Praça Reversa na pasta existente. Leia `AGENTS.md`, `README.md`, `docs/ESTADO.md` e `docs/DADOS-E-REGRAS.md`, `docs/INTERFACES.md`, `docs/VALIDACAO.md`. Confira as etapas anteriores e o código existente antes de editar.

## Escopo desta etapa

Implementar sessões completas e parciais, observações, rascunhos, leitura por teclado/entrada manual, unidade de embalagem e conversões aprovadas. Registrar lote/origem pendentes sem inventar valores. Separar declaração documental, observação e saldo validado. Implementar comparação, recontagem e reconciliação por perfil autorizado com evento e justificativa. Proteger sessão de movimentos conflitantes e preservar observações originais.

Implemente somente esta etapa. Complete as correções reversíveis necessárias ao seu aceite, preservando funções já verificadas. Regras operacionais desconhecidas devem ser registradas em `DESCOBERTA.md`; não preenchê-las com suposições como se fossem regras do cliente.

## Critérios de aceite

- Testes T02 a T07 e os de autorização pertinentes passam.
- Conferência parcial não declara ausência nem libera todo o palete.
- Conversão desconhecida é rejeitada; zeros e unidades são preservados.
- Versão desatualizada impede concluir contagem inconsistente.
- Reconciliação produz saldo/evento/auditoria conjuntamente.

## Verificação e entrega

Execute typecheck, lint, build e os testes pertinentes que existirem no projeto. Acrescente testes necessários para as regras reais desta etapa. Use PostgreSQL para saldo/transações/concorrência. Verifique a interface em computador e celular quando ela for alterada. Não anuncie sucesso para comandos ou fluxos que não executou.

Atualize `docs/ESTADO.md` com o que foi implementado, verificações e resultados, limitações e próximo passo. Registre decisões novas em `docs/DECISOES.md`. Atualize o README se mudar a execução. Entregue um relato curto, comandos reais de iniciar e evidências proporcionais. As etapas posteriores permanecem planejadas. Publicação e uso de dados reais seguem o ambiente efetivamente definido para o piloto.
