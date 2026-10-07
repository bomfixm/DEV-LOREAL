# Etapa 02 Banco compartilhado e acesso

Continue o aplicativo Praça Reversa na pasta existente. Leia `AGENTS.md`, `README.md`, `docs/ESTADO.md` e `docs/ARQUITETURA.md`, `docs/DADOS-E-REGRAS.md`, `docs/IMPLANTACAO.md`. Confira as etapas anteriores e o código existente antes de editar.

## Escopo desta etapa

Implementar PostgreSQL, migrações e modelo lógico inicial. Adotar Prisma na versão fixada e verificar a documentação exata da geração de cliente e transações. Criar autenticação individual, sessão no servidor, autorização por ação/unidade/cliente, auditoria e base de idempotência. Preparar banco de desenvolvimento isolado e fixtures fictícias. Bootstrap administrativo sem senha padrão fixa em código. Implementar os estados de sessão na interface; não simular login como proteção de dados.

Implemente somente esta etapa. Complete as correções reversíveis necessárias ao seu aceite, preservando funções já verificadas. Regras operacionais desconhecidas devem ser registradas em `DESCOBERTA.md`; não preenchê-las com suposições como se fossem regras do cliente.

## Critérios de aceite

- Migração funciona em banco vazio e dados permanecem após reinício.
- API nega acesso sem sessão e sem permissão, inclusive por chamada direta.
- Sessão tem proteção adequada; nenhum token vai para localStorage.
- Banco de teste é PostgreSQL; tipo/lint/build e testes de acesso passam.
- Contas e segredos de desenvolvimento são documentados sem exposição.

## Verificação e entrega

Execute typecheck, lint, build e os testes pertinentes que existirem no projeto. Acrescente testes necessários para as regras reais desta etapa. Use PostgreSQL para saldo/transações/concorrência. Verifique a interface em computador e celular quando ela for alterada. Não anuncie sucesso para comandos ou fluxos que não executou.

Atualize `docs/ESTADO.md` com o que foi implementado, verificações e resultados, limitações e próximo passo. Registre decisões novas em `docs/DECISOES.md`. Atualize o README se mudar a execução. Entregue um relato curto, comandos reais de iniciar e evidências proporcionais. As etapas posteriores permanecem planejadas. Publicação e uso de dados reais seguem o ambiente efetivamente definido para o piloto.
