# Etapa 01 Base e mapa demonstrativo

Continue o aplicativo Praça Reversa na pasta existente. Leia `AGENTS.md`, `README.md`, `docs/ESTADO.md` e `docs/ARQUITETURA.md`, `docs/INTERFACES.md`. Confira as etapas anteriores e o código existente antes de editar.

## Escopo desta etapa

Criar o projeto com TypeScript estrito, npm workspaces, React/Vite, API Fastify com health check e contratos compartilhados. Selecionar versões estáveis compatíveis e Node.js LTS suportado, fixar lockfile e registrar as versões. Usar os exemplos fictícios em examples/paletes-demo.json. Criar mapa e lista a partir de uma única fonte; selecionar um palete abre seu conteúdo e seus estados. Implementar navegação com Leaflet CRS.Simple: zoom pelos botões e roda do mouse, arraste da visão, pinça, visão geral e centralização pela seleção na lista. Ler `docs/MAPA-ZOOM.md`; acrescentar um layout maior fictício para demonstrar a navegação, mantendo dados desconhecidos como pendentes. Preparar manifest, ícones próprios e base PWA. Incluir indicação visível de demonstração. As operações de estoque das etapas posteriores não devem aparecer como se estivessem implementadas.

Implemente somente esta etapa. Complete as correções reversíveis necessárias ao seu aceite, preservando funções já verificadas. Regras operacionais desconhecidas devem ser registradas em `DESCOBERTA.md`; não preenchê-las com suposições como se fossem regras do cliente.

## Critérios de aceite

- Mapa e lista concordam e funcionam por clique, toque e teclado.
- Zoom, arraste da visão, pinça, visão geral e centralização da seleção funcionam sem alterar os dados. Arrastar não dispara seleção acidental; gestos cancelados deixam o mapa utilizável.
- Conversão de coordenadas e redimensionamento preservam o posicionamento; IDs ficam legíveis no nível de detalhe e a lista atende teclado e toque em visão geral.
- Palete desconhecido mostra conteúdo pendente; parcial não aparece completo.
- Aplicação e health check iniciam com comandos registrados e realmente executados.
- Tipos, lint e build passam; verificar layout desktop e celular.
- Registrar separadamente o que foi verificado sobre instalação PWA.

## Verificação e entrega

Execute typecheck, lint, build e os testes pertinentes que existirem no projeto. Acrescente testes necessários para as regras reais desta etapa. Use PostgreSQL para saldo/transações/concorrência. Verifique a interface em computador e celular quando ela for alterada. Não anuncie sucesso para comandos ou fluxos que não executou.

Atualize `docs/ESTADO.md` com o que foi implementado, verificações e resultados, limitações e próximo passo. Registre decisões novas em `docs/DECISOES.md`. Atualize o README se mudar a execução. Entregue um relato curto, comandos reais de iniciar e evidências proporcionais. As etapas posteriores permanecem planejadas. Publicação e uso de dados reais seguem o ambiente efetivamente definido para o piloto.
