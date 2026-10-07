# Prompt inicial

Quero criar do zero o aplicativo Praça Reversa, para controlar paletes e devoluções na operação DHL / L’Oréal. O projeto deve evoluir até um piloto operacional, com mapa clicável, conteúdo por palete, conferência, movimentações, busca de produtos, claims, janelas e histórico.

O pacote nesta pasta contém a especificação. Leia `AGENTS.md`, `README.md`, `docs/ESTADO.md`, `docs/ESCOPO.md`, `docs/ARQUITETURA.md` e `prompts/01-base-e-mapa.md`. Consulte os demais documentos apenas quando forem relevantes. Trabalhe nesta pasta como projeto novo e independente.

A stack proposta é TypeScript, React com Vite, Node.js com Fastify, PostgreSQL e Prisma. Verifique as versões estáveis compatíveis e uma versão LTS suportada de Node.js, fixe o lockfile e registre as escolhas. A interface deve ser uma PWA responsiva para computador e celular, com idioma português e identidade visual simples baseada em amarelo/vermelho da operação.

Execute somente a etapa 01. Crie a estrutura real, os scripts que funcionam no ambiente, a API de saúde e um mapa navegável com dados fictícios. Inclua zoom pelos botões e roda do mouse, arraste da visão, pinça em dispositivos de toque, visão geral e centralização do palete selecionado. Use Leaflet com CRS.Simple dentro do React, com versões compatíveis verificadas. Leia também `docs/MAPA-ZOOM.md`. A base é o desenho interno da praça, com coordenadas próprias. Selecionar um palete mostra o conteúdo correto; paletes ainda não conferidos mostram conteúdo desconhecido. Entregue também uma lista acessível representando os mesmos paletes e permitindo centralizar a seleção. O modo demonstração deve ser claramente visível. Navegar pelo mapa nunca modifica endereços ou estoque.

Prepare manifest, ícones e base da instalação PWA. A aplicação deve funcionar localmente; informe exatamente quais aspectos de instalação foram verificados. Não apresente uma simulação de persistência como controle de estoque real. Funções das etapas seguintes ficam planejadas e não recebem botões que fingem executar operações.

Complete correções reversíveis necessárias e execute typecheck, lint, build e os testes pertinentes. Verifique computador e celular; capture a interface se o ambiente permitir. Se alguma verificação não puder ser executada, registre a limitação sem declarar sucesso.

Atualize o README com os comandos reais de instalar, iniciar e verificar. Atualize `docs/ESTADO.md` e `docs/DECISOES.md` com a entrega, versões, verificações e pendências. Termine com um relato curto do que funciona, como executar e qual é o próximo passo. As etapas 02 a 10 permanecem planejadas. Não publique o aplicativo ou dados da operação nesta etapa.
