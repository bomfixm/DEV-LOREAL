# Relatório de verificação — termos, privacidade e segurança (27/10/2026)

Ambiente: Windows 11, Node 24, PostgreSQL 17 local. Bancos de **teste** (`vitest`) e de **E2E** (Playwright, Chrome), ambos recriados a cada execução, com dados fictícios. **Nada foi gravado no banco da instalação em uso**, e a migração nova **não foi aplicada nele** (decisão humana 11).

| Requisito | Implementado | Configurado | Testado | Evidência | Pendência |
| --- | --- | --- | --- | --- | --- |
| T01 Preservação | Migração só aditiva (2 tabelas + 1 gatilho); sem backfill | — | Sim, em bancos isolados; o banco real não foi migrado | `20261027100000_documentos_publicos/migration.sql`; suíte de banco verde | Aplicar no banco em uso com backup antes (decisão 11) |
| T02 Operação | Sem mudança nos fluxos | — | Sim | E2E `acesso`, `comum`, `pwa`, `paineis`, `caminho-base`, `palete-confirmar-enter`, `redesign`, `validacao-urgente`; banco `permissoes-e-praca`, `sessao`, `paineis`, `correcao-conteudos` | — |
| T03 Autorização | Existente + `documentos.administrar` | Sim (perfil) | Sim | `documentos.test.ts` (supervisor, operador e cliente recebem 403 na administração; operador e cliente não resolvem a validação pela API) | — |
| T04 Escopo | Existente (escopo da sessão) | — | Sim, nos testes existentes com dois escopos | `claims-acesso`, `janelas-acesso`, `selecao-cliente` | Documentos são globais da instalação, não por escopo |
| T05 Cliente | Existente | — | Sim | `documentos.test.ts`: `/validacao` e `/validacao/resumo` dão 403 ao cliente; `correcao-conteudos.test.ts` | — |
| T06 Minutas | Sim | — | Sim | `documentos.test.ts` (público responde `NAO_PUBLICADO` com minuta criada; ninguém bloqueado); E2E `documentos.spec.ts` | Textos aprovados (decisões 1–3) |
| T07 Publicação e aceite | Sim | Exigência **desligada** | Sim, com dados fictícios | `documentos.test.ts`: só administrador; aprovação sem referência recusada; minuta não publica; versão nova substitui; aceite da versão exata; repetição = mesmo horário; duplo clique simultâneo = 1 aceite e 1 evento; payload com outro usuário = 400; versão substituída recusa aceite; gatilhos recusam alterar o texto, a aprovação, a publicação e o aceite | Ligar a exigência (decisão 10) |
| T08 Privacidade | Aviso sem aceite (informativo); nenhum canal falso | — | Sim | `documentos.test.ts` (aceite do aviso recusado) | Canal de privacidade (decisão 8) |
| T09 Histórico | Existente + auditoria só acrescentada (gatilho novo) | — | Sim | `documentos.test.ts` (UPDATE/DELETE em `evento_auditoria` recusados); `conferencia-tabela.test.ts` (130 → 126 com anterior, novo e autor) | Limite: administrador do PostgreSQL pode desligar gatilho |
| T10 Backup | Existente (26/10) | Destino externo **não configurado** | Sim (26/10, destino isolado/falso) | `planilha.test.ts`, `recuperacao-*.test.ts` | Destino aprovado (decisão 4) |
| T11 Recuperação | Existente | — | Sim (26/10, banco temporário, tempo observado) | `docs/ESTADO.md` (Planilha automática e proteção) | — |
| T12 Retenção | Nenhum expurgo novo | — | Sim (revisão de código: nenhum agendamento novo) | Diagnóstico, seção Retenção | Prazos (decisão 3) |
| T13 Sessão e cache | Existente | — | Sim | `pwa.spec.ts`, `sessao.test.ts`; API `no-store`; sem `runtimeCaching` | — |
| T14 Acessibilidade | Links e páginas novas por teclado; rótulos; caixa sem marcação prévia; situação com texto e símbolo | — | Parcial: teclado, rótulos e largura de 320 px no E2E | `documentos.spec.ts` | Auditoria WCAG 2.2 AA do produto inteiro não feita |
| T15 Número do palete | Existente (commit `4ff561e`) | — | Sim | `palete-confirmar-enter.spec.ts` | — |
| T16 Entrega | Build, lint e tipos verdes | Código servido na porta 3000 (inerte sem a migração) | Sim | Seção abaixo | Migração e publicação na instalação em uso dependem de autorização |

## Comandos executados

Resultados detalhados em `docs/ESTADO.md` (seção "Termos, privacidade e segurança").
