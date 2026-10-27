# Diagnóstico: termos, privacidade e segurança (27/10/2026)

Pedido: `PROMPT-CLAUDE-PRACA-REVERSA-TERMOS-PRIVACIDADE-E-SEGURANCA.txt`. Descoberta feita no repositório `bomfixm/DEV-LOREAL` (branch `main`).

**Formato real:** aplicação web/PWA (React/Vite) servida pela própria API (Node 24, Fastify, Prisma 7, PostgreSQL 17) num servidor local da filial, porta 3000, mantido por uma tarefa do Windows. Não há APK. Há uma publicação alternativa preparada (Netlify + Neon), **não ativa**.

Estados usados: **existente e verificado** · **implementado nesta tarefa** · **precisa de configuração** · **depende de decisão humana** · **não testado** · **não se aplica** (com justificativa).

| Requisito | Evidência no código/configuração | Situação real | Alteração necessária | Dependência humana |
| --- | --- | --- | --- | --- |
| Permissões no servidor | `exigirPermissao` em cada rota; `PERMISSOES_POR_PERFIL` (`packages/contracts/src/acesso.ts`); `MATRIZ-DE-PERMISSOES.md` | Existente e verificado (`permissoes-e-praca.test.ts`, `documentos.test.ts`) | Nova permissão `documentos.administrar` (administrador) | Grupos autorizados (decisão 5) |
| Identidade e escopo da sessão | `autenticar`/`montarContexto` (`modules/acesso/contexto.ts`); escopo ativo vem da sessão no banco | Existente e verificado | — | — |
| Acesso ao objeto (palete, ocorrência, janela, anexo) | Consultas filtradas por `escopoId` da sessão nos serviços | Existente; verificado por amostra nos testes de claims, janelas, seleção e correção | — | — |
| Isolamento de escopos | Escopos (unidade × cliente), vínculos por escopo | Existente e verificado (testes com dois escopos: praça e navegação) | — | Novos clientes só com decisão 5 |
| Cliente sem validação/infos internas | `CLIENTE_CONSULTA` = só `painel.cliente`; rotas `/validacao*` exigem `validacao.consultar` | Existente e verificado (`correcao-conteudos.test.ts`; `documentos.test.ts`, T05) | — | — |
| Seleção do cliente não baixa estoque | Módulos `selecao`/`selecao-teste` geram solicitação/reserva; baixa só na expedição pelo operador | Existente (testes da seleção) | — | Liberação externa (decisão 5) |
| Sessão, cookie, expiração e revogação | Cookie httpOnly, SameSite=Strict, `Secure` por `COOKIE_SEGURO`; inatividade 120 min e máximo 12 h; revogação ao sair e ao desativar a conta | Existente e verificado (`sessao.test.ts`) | — | Produção com HTTPS: `COOKIE_SEGURO=sim` (já é o padrão em produção) |
| CSRF e origem | Token anti-CSRF por sessão em toda mutação; recusa de outra origem (`http/seguranca.ts`); só JSON | Existente e verificado | — | — |
| Abuso no login | Limite em memória por conta (5/15 min) e por IP (30/15 min) | Existente e verificado | — | Filial atrás de um único IP: limite por IP é 30 e o por conta é o principal |
| Cabeçalhos e cache da API | `nosniff`, `x-frame-options DENY`, `referrer-policy same-origin`; API com `cache-control: no-store` | Existente | CSP não configurada: recomendação (não é falha comprovada) | — |
| Erros sem detalhe interno | `setErrorHandler`: mensagem genérica + id da requisição | Existente | — | — |
| Segredos | `.env` fora do Git; `.env.example` sem valores; config secreta redigida nos scripts de recuperação | Existente; nenhum segredo encontrado nos arquivos versionados | — | Rotação, se algum dia houver exposição |
| PWA e cache privado | Service worker só com arquivos estáticos (sem `runtimeCaching`); `sessionStorage` só fora de produção; sair limpa operações locais | Existente e verificado (`pwa.spec.ts`) | — | — |
| Dependências e licenças | `DEPENDENCIAS-E-LICENCAS.md` (gerado); `npm audit --omit=dev` | 7 avisos: zod < 4.6.6 (alto), fastify 5.12.x (baixo), fast-uri (moderado), prisma CLI/mysql2/deepmerge-ts (alto, ferramenta de build) | Atualização dirigida do zod e do fastify **recomendada e não aplicada** (pede regressão completa); ver seção abaixo | — |
| Histórico operacional (quem, quando, antes/depois) | `historico_conteudo`, `contagem_volumes`/`conferencia_volumes` (130 → 126 com anterior, novo e autor), `evento_estoque`, `evento_localizacao`; gatilhos "só acrescentado" | Existente e verificado (`conferencia-tabela.test.ts`, `correcao-conteudos.test.ts`) | — | — |
| Histórico na mesma transação | Eventos gravados dentro das transações dos serviços; idempotência por chave | Existente | — | — |
| Auditoria de segurança imutável | `evento_auditoria` sem proteção no banco | **Implementado nesta tarefa**: gatilho `evento_auditoria_imutavel` | Migração 20261027100000 | Aplicar no banco em uso (decisão 11) |
| Logs sem credenciais | `redact` de cookie, CSRF e set-cookie; auditoria só com detalhes simples | Existente | — | — |
| Termos e aviso: minutas | — | **Implementado nesta tarefa**: `minutas/` (6 documentos, marcados como minuta) | — | Textos finais (decisões 1–3, 8) |
| Páginas públicas e links | — | **Implementado nesta tarefa**: `/termos`, `/privacidade`, links no login e no menu da conta | — | — |
| Versões, aprovação e publicação | — | **Implementado nesta tarefa**: `documento_publico` (hash SHA-256 conferido no banco, imutável, um publicado por tipo) | — | Referência da aprovação humana |
| Aceite | — | **Implementado e desligado**: `aceite_documento` (versão exata, idempotente, sem retroativo); `DOCUMENTOS_EXIGIR_ACEITE=desativada` | — | Decisão 10 |
| Cookies/banner | Só o cookie técnico de sessão e preferências locais | Não se aplica banner: não há cookies de análise, marketing ou de terceiros | — | — |
| Canal de privacidade | — | **Depende de decisão humana**: sem contato publicado; o aviso traz o campo | — | Decisão 8 |
| Fila de solicitações de titulares | — | Não implementada: sem canal aprovado, uma fila seria um formulário sem destino real | Se aprovada, registrar só protocolo, tipo, datas, responsável, situação e resposta | Decisão 8 |
| Incidentes | Auditoria e situação da proteção na tela | Procedimento em `PROCEDIMENTO-DE-INCIDENTES.md`; **sem alerta externo** (sem canal) | — | Decisão 8 |
| Backup completo × planilha | `rotina-backup.mjs` (banco completo, verificado), planilha por revisão | Existente e verificado (26/10) | — | — |
| Destino independente | `PLANILHA_DESTINO`/`BACKUP_DESTINO_EXTERNO` vazios | **Precisa de configuração**: tela mostra "não configurado" | — | Decisão 4 |
| Restauração testada | `protecao:teste-restauracao` em banco isolado | Existente e verificado (26/10, dados reais em banco temporário, apagado depois) | — | — |
| Retenção | Sem expurgo de dados, logs ou histórico; planilhas e backups automáticos com a retenção pedida em 23/10 | Nenhum cron novo; nada novo apaga dados | Campos para configurar retenção: categoria, prazo, base, impedimento de exclusão, tratamento de cópias | Decisão 3 |
| Acessibilidade (fluxos tocados) | Login, páginas de documentos, tela de administração, aceite | **Implementado e verificado parcialmente**: links por teclado, rótulos, caixa sem marcação prévia, situação com texto e símbolo, sem rolagem horizontal em 320 px | Auditoria WCAG completa do produto **não feita** | — |
| Número do palete só com Enter | `TelaRegistrarConteudo.tsx` (commit `4ff561e`, D314–D316) | Existente e verificado (`palete-confirmar-enter.spec.ts`) | — | — |
| Validação urgente fora do cliente | Ver acima | Existente e verificado | — | — |

## Avisos de dependências (npm audit, 27/10/2026)

| Pacote | Gravidade | Alcance neste projeto | Ação |
| --- | --- | --- | --- |
| `zod` < 4.6.6 | Alta | A API valida corpos com zod. O limite de corpo do Fastify restringe o tamanho, mas listas grandes com restrições podem consumir memória | Recomendado: subir o zod para 4.6.6 ou mais e rodar a suíte completa |
| `fastify` 5.12.2–5.12.5 | Baixa | Validação de cabeçalhos por schema. O projeto não valida cabeçalhos por schema do Fastify (lê e confere à mão) | Atualizar junto com o zod |
| `fast-uri` | Moderada | Usado pelo validador de formato URI do Fastify/ajv, que o projeto não usa | Atualizar com o fastify |
| `prisma`, `@prisma/config`, `mysql2`, `deepmerge-ts` | Alta | Ferramenta de linha de comando (gerar cliente, migrar). O servidor não carrega `mysql2` (banco é PostgreSQL) | Atualizar o Prisma numa janela própria (risco de migração de versão) |

Nenhuma atualização foi feita nesta tarefa: o pedido proíbe atualização em massa sem relação, e a do zod e do fastify mexe em todos os módulos. Fica como próxima tarefa, com regressão completa.
