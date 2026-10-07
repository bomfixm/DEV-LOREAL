# Retomada — publicação em Netlify Free + Neon Free (em andamento)

Arquivo de continuação (troca de conta/sessão). Sem credenciais. Iniciado em 6 out. 2026.

## Pedido

- Prompt: `C:\Users\Administrator\Downloads\PROMPT-NETLIFY-NEON.md` (ler inteiro; seções 1–6 e referências oficiais).
- Neon já criado pelo usuário: branch `production`, AWS US East 2, conexão com pooling. URL só por variável de ambiente.
- No GitHub, o projeto fica em `praca-reversa/` (base directory do Netlify = `praca-reversa`; publish = `apps/web/dist`; functions = `netlify/functions`, relativos à base). Esta pasta local **não é repositório git** (`LR LOREAL/praca-reversa`).

## Plano (decidido nesta sessão)

1. **Função da API** `netlify/functions/api.mts` (Functions API v2: `export default async (req, context)` + `config.path = '/api/*'`): adaptador sem dependência nova usando `app.inject()` do Fastify existente (método, caminho, query, corpo binário como Buffer, múltiplos `Set-Cookie`, IP por `context.ip`), app e Prisma criados uma vez por instância com cache de promessa que é **descartado se a inicialização falhar**; nunca `app.listen()` nem `$disconnect` por solicitação. Respostas de erro/404 de `/api/*` continuam JSON da API.
2. **Pool para Functions/Neon**: `criarBanco` com `max`, `connectionTimeoutMillis` e `idleTimeoutMillis` configuráveis (`DB_POOL_MAX`, `DB_CONEXAO_TIMEOUT_MS`); TLS pela URL do Neon (`sslmode=require`), sem desligar verificação. `DIRECT_URL` (sem pooler) só para `prisma migrate deploy` e comandos administrativos via `prisma.config.ts`.
3. **Empacotamento**: conferir leituras em runtime por `import.meta.url` (`config.ts` `lerVersao` → `apps/api/package.json`; `layout/desenho-aprovado.ts` → `examples/layout-desenho-aprovado.json`; cliente Prisma gerado em `apps/api/src/generated/prisma` e eventuais `.wasm`) e resolver por import estático ou `included_files` no `netlify.toml`.
4. **Build** `npm run build:netlify` (contratos + `prisma generate` + interface; a função é empacotada pela Netlify com esbuild) e `netlify.toml` (base `praca-reversa`, publish, functions, redirect SPA sem capturar `/api/*`, headers, Node 24).
5. **Limites da plataforma** (verificar nas docs atuais): 60 s por execução síncrona, ~6 MB de payload (≈4,5 MB binário). Importações de planilha aceitam até 40 MiB/120 s no código → **upload em partes** persistidas no PostgreSQL (envio, escopo, tamanho, checksum, expiração, limpeza) e processamento compatível; anexos/downloads grandes conferidos. O agendador da planilha (setInterval em `server.ts`) e a pasta local (`.dados/planilha`) **não funcionam** em Functions → avaliar função agendada e guardar o arquivo gerado no banco; backup/restauração rodam fora (máquina do responsável) contra o Neon.
6. **Docs**: `docs/PUBLICACAO-NETLIFY-NEON.md` (tutorial passo a passo), `.env.example`, relatório de compatibilidade, `docs/ESTADO.md`; ZIP sem `node_modules`, `.env`, `.dados`, banco local.

## Fatos conferidos (documentação Netlify, 6 out. 2026)

- Functions v2: `export default async (req: Request, context)`, `export const config = { path: '/api/*' }`; função com `path` tem **precedência** sobre redirects e estáticos e **não** fica em `/.netlify/functions/<nome>`. `context.ip`, `context.requestId`, `context.deploy.context`.
- Runtime: segue o Node do build (NODE_VERSION=24 no `netlify.toml`); `AWS_LAMBDA_JS_RUNTIME` só pela interface; fallback Node 24.
- Limites: síncrona **60 s**; agendada **30 s**; background **15 min**; payload bufferizado **6 MB** (binário ≈ **4,5 MB**); resposta em stream 20 MB; background 256 KB. Disponibilidade de background/agendada no plano Free **não confirmada** na página (ver https://www.netlify.com/pricing/).
- Prisma 7 gerado carrega o WASM por import (`query_compiler_fast_bg.postgresql.wasm-base64.mjs`): empacota sem arquivo extra.

## Feito

- `apps/api/src/db/cliente.ts`: `criarBanco(url, aoErro, { max, conexaoTimeoutMs, ociosoTimeoutMs })` (padrões locais inalterados).
- `apps/api/prisma.config.ts`: `url = DIRECT_URL ?? DATABASE_URL` (migrações pela conexão direta).
- `apps/api/src/config.ts`: `definirVersaoEmbutida()`; `apps/api/src/modules/layout/desenho-aprovado.ts`: `definirDesenhoAprovadoEmbutido()` (sem leitura de disco no pacote da função).
- `apps/api/src/netlify/adaptador.ts`: `criarObtentor` (cache descartado em falha), `criarAppFuncao(env)` (sem interface, agendador da planilha desligado, pool `DB_POOL_MAX`=3/`DB_CONEXAO_TIMEOUT_MS`=15000), `responderComFastify` (inject com corpo em bytes, `Host` da URL, IP de `context.ip`, `X-Forwarded-*` descartados, vários `Set-Cookie`), `respostaIndisponivel` (503 JSON).
- `netlify/functions/api.mts` (entrada fina; JSONs por import estático) e `netlify.toml` (comando, publish `apps/web/dist`, functions `netlify/functions`, esbuild, NODE_VERSION 24, SPA `/*`→`/index.html`, cabeçalhos de segurança e de cache do PWA). Raiz `tsconfig.json` inclui `netlify` (+ `allowImportingTsExtensions`). Script raiz `build:netlify` (contratos + `prisma generate` + interface) **aprovado**.
- Ensaio do **pacote esbuild** da função (`npx esbuild netlify/functions/api.mts --bundle --platform=node --format=esm --target=node24 --outfile=.dados/netlify-teste/api.mjs --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);"`, 10,9 MB, sem avisos) contra o banco de **teste** com dados fictícios (`cd apps/api && npx tsx ../../.dados/ensaio-funcao.tmp.ts`): 11/12 OK (404 JSON, login com cookie Secure/HttpOnly, mapa no-store, sem CSRF 403, outra origem 403, repetição idempotente sem duplicar, GET por ID do QR, download XLSX binário, upload binário com mesmo SHA-256, permissão negada 403 JSON, logout 204→401). O 12º usou caminho errado de saúde (`/api/v1/saude`; o certo é `/api/v1/health`, já corrigido no script — rodar de novo). Typecheck da raiz aprovado.

## Próximos passos

1. (feito: 12/12 OK) Ensaio refeito. Falta transformá-lo em teste automatizado (`apps/api/test/banco/netlify.test.ts`, chamando `responderComFastify` com `Request`) + caso de importação com prévia/confirmação e HEAD.
2. **Uploads grandes** (planilhas até 40 MiB/120 s em `IMPORTACAO_PLANILHA_*`; produtos/devoluções 5 MB; anexos de claim `CLAIMS_ANEXO_MAX_MB`): implementar envio em partes (≤ 4 MB) persistidas no PostgreSQL (tabela de envio com escopo, usuário, tamanho total, SHA-256, expiração, limpeza; rota de partes + conclusão que só entrega o arquivo completo e conferido ao `registrarEnvio` existente) e a interface enviando em partes quando o arquivo passar de ~4 MB. Processamento da prévia/confirmação dentro de 60 s (medir com a planilha real ≈ 61 KB/851 linhas; registrar limite real para 40 MiB e, se não couber, função background se o plano permitir — senão documentar como incompatível com evidência).
3. Downloads > 6 MB (exportações, anexos, relatórios): conferir tamanhos máximos; streaming (20 MB) ou documentar.
4. **Planilha única**: em Functions não há disco persistente nem processo contínuo — guardar o arquivo gerado no banco (ou desativar a geração local na função) e publicar por função agendada (30 s; se o plano permitir) ou só pelo botão "Tentar novamente"; download servido do banco. Registrar o que fica planejado.
5. Backup/restauração: rodar da máquina do responsável contra o Neon (`DIRECT_URL`); teste de restauração exige CREATEDB (verificar no Neon; alternativa: branch do Neon) — documentar.
6. (feito: `.env.example` e primeira versão de `docs/PUBLICACAO-NETLIFY-NEON.md` com compatibilidade honesta — completar quando os itens 2–4 mudarem) `.env.example` (variáveis Netlify/Neon: DATABASE_URL pooled, DIRECT_URL, APP_SEGREDO, APP_URL_PUBLICA, APP_AMBIENTE=producao, COOKIE_SEGURO=true, CAMINHO_BASE=/, PERSISTENCIA_LOCAL=desativada, DB_POOL_MAX, DB_CONEXAO_TIMEOUT_MS; nada com `VITE_`), `docs/PUBLICACAO-NETLIFY-NEON.md` (tutorial completo: base `praca-reversa`, build `npm run build:netlify`, publish `apps/web/dist`, functions `netlify/functions`; variáveis por escopo; `prisma migrate deploy` com DIRECT_URL por ambiente; `admin:criar` + supervisor; preview com banco/branch separado; migração de dados local→Neon com `backup:criar`/`backup:restaurar` ou não; rollback de código × restauração do banco), relatório de compatibilidade, `docs/ESTADO.md`, DECISOES.
7. Lint dos arquivos alterados, `npm test`, e ZIP do projeto sem `node_modules`, `.env`, `.dados`, `dist`, `test-results`.
