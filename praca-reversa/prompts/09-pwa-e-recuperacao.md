# Etapa 09 Instalação e recuperação

Continue o aplicativo Praça Reversa na pasta existente. Leia `AGENTS.md`, `README.md`, `docs/ESTADO.md` e `docs/ARQUITETURA.md`, `docs/INTERFACES.md`, `docs/IMPLANTACAO.md`, `docs/VALIDACAO.md`. Confira as etapas anteriores e o código existente antes de editar.

## Escopo desta etapa

Completar instalação PWA, ícones, abertura standalone, atualização controlada e comportamento em falta de conexão. Implementar câmera somente em dispositivos compatíveis, mantendo teclado/entrada manual. Se houver rascunho local, isolar por usuário, identificá-lo como não enviado e resolver versões na reconexão; estoque não é confirmado offline. Concluir anexos privados com limite/tipo/permissões. Preparar e testar backup e restauração de banco/anexos. Registrar equipamentos e recursos realmente testados.

Implemente somente esta etapa. Complete as correções reversíveis necessárias ao seu aceite, preservando funções já verificadas. Regras operacionais desconhecidas devem ser registradas em `DESCOBERTA.md`; não preenchê-las com suposições como se fossem regras do cliente.

## Critérios de aceite

- Testes T28, T30, T31 e T32 passam conforme os dispositivos disponíveis.
- Atualização não perde contagem e não repete alteração de saldo.
- Modo sem conexão não apresenta estoque gravado como confirmado.
- Anexos não podem ser acessados por outro escopo.
- Restauração foi executada e comparada; limitações de instalação estão registradas.

## Verificação e entrega

Execute typecheck, lint, build e os testes pertinentes que existirem no projeto. Acrescente testes necessários para as regras reais desta etapa. Use PostgreSQL para saldo/transações/concorrência. Verifique a interface em computador e celular quando ela for alterada. Não anuncie sucesso para comandos ou fluxos que não executou.

Atualize `docs/ESTADO.md` com o que foi implementado, verificações e resultados, limitações e próximo passo. Registre decisões novas em `docs/DECISOES.md`. Atualize o README se mudar a execução. Entregue um relato curto, comandos reais de iniciar e evidências proporcionais. As etapas posteriores permanecem planejadas. Publicação e uso de dados reais seguem o ambiente efetivamente definido para o piloto.
