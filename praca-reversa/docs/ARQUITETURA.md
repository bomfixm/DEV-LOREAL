# Arquitetura proposta

## Decisão de tecnologia

Para este projeto, a escolha proposta é TypeScript no frontend e no backend. O usuário já trabalha com React/JavaScript e poderá compartilhar contratos de dados e validações estruturais entre as camadas. TypeScript ajuda a detectar inconsistências de tipos antes da execução; a API ainda precisa validar valores, permissões e regras de negócio.

| Camada | Tecnologia | Motivo |
| --- | --- | --- |
| Interface | React com TypeScript e Vite | Mapa, formulários e consulta em uma interface responsiva. |
| Navegação do mapa | Leaflet com CRS.Simple integrado ao React | Layout interno com zoom, arraste da visão e gestos de toque. |
| API | Node.js com TypeScript e Fastify | API modular, validação de solicitações e uma linguagem em toda a aplicação. |
| Persistência | PostgreSQL | Banco compartilhado, transações e controle de alterações concorrentes. |
| Acesso ao banco | Prisma | Contratos de dados e migrações; verificar API da versão fixada. |
| Instalação | PWA com manifest e service worker | Abrir como aplicativo nos dispositivos compatíveis. |
| Verificação | Verificador TypeScript, ESLint, Vitest e Playwright | Tipos, qualidade, regras operacionais e fluxos de uso. |

Python com FastAPI seria uma alternativa válida caso a equipe de manutenção priorize Python. Flutter faria sentido se surgirem requisitos nativos específicos. A proposta atual favorece a experiência do usuário com React e a manutenção de uma linguagem só.

Na etapa 01, escolher uma versão LTS suportada de Node.js e versões estáveis compatíveis das dependências. Registrar versões exatas e lockfile. Não usar referências a “latest” como configuração reprodutível. Verificar a sintaxe atual do Prisma; este documento não fixa APIs antigas de transação ou geração de cliente.

## Organização alvo

Usar um repositório com npm workspaces: `apps/web` para React, `apps/api` para Fastify, `packages/contracts` para contratos/validações compartilháveis, `docs` e `prompts` para o desenvolvimento e `infra` para a configuração local e operacional. Essa estrutura será criada na etapa 01.

Na interface, separar `features/mapa`, `paletes`, `conferencia`, `movimentos`, `busca`, `claims`, `janelas`, `selecao` (seleção do cliente, conciliação e inventários de referência) e `relatorios`; componentes comuns ficam em `components`. Na API, separar rotas, validações, serviços e acesso ao banco por domínio. Regras de saldo e expedição pertencem à API, e não a componentes React.

O banco guarda a fonte compartilhada dos dados. O navegador guarda somente o estado de interface e, quando implementado, rascunhos com escopo de usuário. Nunca usar localStorage como banco multiusuário de estoque.

## Atualização entre usuários

Começar com revalidação após cada operação e atualização periódica das consultas visíveis. Toda gravação crítica verifica a versão do registro no servidor. Caso outro usuário tenha alterado o saldo ou palete, a interface apresenta conflito e recarrega os dados antes de nova decisão. Atualização por SSE/WebSocket pode ser adicionada quando a necessidade justificar.

## API planejada

Prefixo: `/api/v1`. Rotas são propostas de contrato e podem ser ajustadas com registro da decisão.

| Domínio | Operações principais |
| --- | --- |
| Saúde e sessão | `GET /health`, sessão atual, entrar/sair e bootstrap administrativo restrito. |
| Praça | Consultar layout, posições e ocupação; alterar layout por perfil autorizado. |
| Paletes | Cadastrar, consultar, localizar, arquivar vazio e emitir etiqueta. |
| Conferências | Criar sessão; registrar observações; concluir parcial/completa; recontar e reconciliar. |
| Movimentos | Transferir itens, mudar localização do palete e consultar eventos. |
| Busca e importação | Buscar conteúdo; pré-validar arquivo; confirmar lote de importação e consultar resultado. |
| Claims | Criar/importar casos, listar candidatos, registrar evidências e validar resolução. |
| Janelas | Cadastrar capacidade; reservar, liberar reserva, confirmar expedição e consultar comprovantes. |
| Relatórios | Consultar métricas e exportar tabelas com período, unidades e permissões. |

Dados de entrada críticos são validados com schemas definidos pelo código. Arquivos importados não podem fornecer código ou schemas executáveis. IDs preservam zeros à esquerda e não devem ser convertidos silenciosamente em números.

## Operações críticas

Uma transferência atualiza origem, destino, registro de movimentação e auditoria na mesma transação. Expedição atualiza reserva, capacidade, saldo e comprovante transacionalmente. Aplicar bloqueio/atualização condicional ou estratégia de isolamento apropriada à versão adotada, com repetição limitada dos conflitos transitórios.

Cada operação crítica recebe uma chave de idempotência com escopo de unidade, usuário/operação e payload. Guardar resultado, identidade e hash do payload. A repetição do mesmo pedido retorna o resultado anterior; a mesma chave com payload diferente é rejeitada. A versão do registro também é verificada.

Testes devem usar duas requisições concorrentes contra PostgreSQL real. Exemplo: saldo 10, pedidos simultâneos de 8 e 6. O total confirmado não pode exceder 10; a tentativa incompatível recebe conflito/saldo insuficiente, e nenhum evento parcial permanece.

## Autenticação e acesso

Preferir identidade corporativa/OIDC quando disponível no ambiente de implantação. Para desenvolvimento e piloto isolado, autenticação individual com sessões no servidor, senha com hash adequado e contas criadas por administrador. A definição final depende da infraestrutura informada em `DESCOBERTA.md`.

Sessão em cookie HttpOnly, Secure em HTTPS e SameSite apropriado; proteger rotas mutáveis contra CSRF. Autorizar a operação no servidor e restringir unidade/cliente, inclusive em arquivos e exportações. Não armazenar token de sessão em localStorage. O deployment deve favorecer interface e API na mesma origem.

Perfis iniciais: consulta; operador; supervisor de estoque; analista de claims; administrador. Permissões financeiras são explícitas e não decorrem automaticamente de ser administrador técnico.

## PWA e conexão

Manifest com nome, start_url, display standalone e ícones próprios. Service worker gerencia arquivos da interface e atualização. Instalação e permissões variam por navegador e dispositivo; verificar os equipamentos reais.

A primeira versão exige conexão para registrar estoque, validar claims e confirmar expedições. Em falta de conexão, mostrar o estado e impedir confirmação dessas operações. Se houver rascunho local de contagem, mostrar que não foi enviado; reconectar exige verificação da versão e confirmação do usuário antes de concluir. Nunca reaplicar silenciosamente uma alteração de saldo.

## Desempenho e manutenção

Paginar consultas e pesquisar no servidor. Indexar identificação, SKU, código de barras, lote, origem, localização e status. Para praças grandes, renderizar somente os elementos visíveis do mapa ou dividir por zona. Medir com volumetria conhecida no piloto, sem presumir o tamanho atual do estoque.

Separar o layout e a ocupação resumida do conteúdo detalhado dos paletes. Ao afastar, reduzir rótulos ou agrupar elementos; ao aproximar, mostrar IDs legíveis e alvos de seleção adequados. O conteúdo completo é consultado ao selecionar. Cancelar buscas antigas e preservar versão/permissões dos registros. A documentação `MAPA-ZOOM.md` define coordenadas, conversão para Leaflet e critérios da navegação.

Usar logs de erro com identificadores de operação, sem expor senhas, documentos completos ou valores confidenciais desnecessários. Configuração por ambiente; segredos não entram no repositório. Migrações e restauração de backups fazem parte da entrada em uso.
