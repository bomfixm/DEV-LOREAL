# Praça Reversa na Vercel + Supabase

Situação em 5 nov. 2026. Supabase: projeto `praca-reversa` (ref `dblmzpsrktqxbpiihwkp`, sa-east-1), 25 migrações aplicadas. Vercel: time `bomfixm1`, projeto ligado ao GitHub `bomfixm/DEV-LOREAL`, **Root Directory = `praca-reversa`**.

## Como funciona

- `vercel.json` → `node scripts/vercel-build.mjs`: contratos, cliente Prisma, interface e função da API (`vercel/entrada.ts`, mesma aplicação Fastify do restante do projeto) em `.vercel/output`.
- **Migrações automáticas só em produção** (`VERCEL_ENV=production`): `prisma migrate deploy` usa `DIRECT_URL`. Ele apenas aplica migrações novas; nunca apaga, recria nem semeia dados. Preview não toca o banco.
- Atualizar = `git push` na `main`. O banco e os segredos continuam os mesmos.

## Variáveis (Vercel → Settings → Environment Variables)

| Variável | Valor | Escopo |
| --- | --- | --- |
| `DATABASE_URL` | pooler de transação, porta 6543: `postgresql://praca_app.<ref>:<senha>@aws-1-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true` | Production |
| `DIRECT_URL` | pooler de sessão, porta 5432 (mesmo host/usuário), usado só nas migrações | Production |
| `APP_SEGREDO` | 64 hex, exclusivo; **nunca trocar** depois de usar | Production |
| `APP_URL_PUBLICA` | URL final (vai no QR das etiquetas) | Production |
| `APP_AMBIENTE` | `producao` | Production |
| `COOKIE_SEGURO` | `true` | Production |
| `CAMINHO_BASE` | `/` | Production |
| `PERSISTENCIA_LOCAL` | `desativada` | Production |
| `PLANILHA_AUTOMATICA` | `desativada` | Production |
| `DB_POOL_MAX` | `3` | Production |

Segredos locais (fora do git): `.dados/producao-segredos.json`. O usuário `praca_app` foi criado porque o Supabase não deixa trocar a senha do `postgres` pelo painel de SQL; ele é dono das tabelas.

## Regras para não perder dados

- Nunca rodar `migrate reset`, `db push` nem `db:semear-demo` contra o Supabase.
- Migração nova = arquivo novo em `apps/api/prisma/migrations` (só acrescentar; nunca editar migração já aplicada).
- Restauração do banco é outra operação (Supabase: backups do projeto; plano grátis não tem backup diário gerenciado → usar `npm run backup:criar` com `DIRECT_URL`).
- Rollback de código: Vercel → Deployments → Promote/Instant Rollback. Não desfaz migrações.

## Limites

- Corpo de requisição na Vercel: 4,5 MB (planilhas maiores ainda não passam; envio em partes não implementado).
- Planilha automática e pasta local ficam desativadas (sem disco persistente).
- Plano Hobby da Vercel é de uso não comercial; para uso comercial, plano Pro.
- Projeto Supabase grátis pausa após 7 dias sem uso.

## Primeira conta

Com `DIRECT_URL` na sessão do terminal: `npm run admin:criar -- --login ... --nome ... --unidade ... --cliente ... --unidade-nome ... --cliente-nome ...` (a senha é digitada sem aparecer).
