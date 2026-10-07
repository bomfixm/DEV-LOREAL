# Publicar o Praça Reversa na Netlify (Free) com banco Neon (Free)

Situação em 6 out. 2026: **preparação parcial**. A API já roda como Netlify Function (verificada localmente com o pacote gerado pelo mesmo empacotador da Netlify), mas **ainda não publique para a operação**: importações de planilhas acima de ~4,5 MB e a planilha automática ainda não são compatíveis (ver "Compatibilidade"). Nada foi publicado e nenhuma migração foi executada no Neon.

## Valores do painel da Netlify

| Campo | Valor |
| --- | --- |
| Base directory | `praca-reversa` (o código está nessa pasta do repositório) |
| Build command | `npm run build:netlify` (já está no `netlify.toml`) |
| Publish directory | `apps/web/dist` (relativo à base; o painel mostra `praca-reversa/apps/web/dist`) |
| Functions directory | `netlify/functions` (relativo à base) |
| Node | 24 (`NODE_VERSION` no `netlify.toml`; npm 11 vem junto) |

Não repita `praca-reversa/` nos campos de publish e functions. Se o repositório tiver o projeto na raiz (sem a pasta externa), deixe Base directory vazio.

## Variáveis de ambiente (Site configuration → Environment variables)

Nenhuma usa prefixo `VITE_` e nenhuma vai para a interface. Marque todas como **secretas/privadas** quando o painel oferecer.

| Variável | Valor | Escopo |
| --- | --- | --- |
| `DATABASE_URL` | URL **com pooling** do Neon (host com `-pooler`), com `sslmode=require` | Functions (runtime) |
| `DIRECT_URL` | URL **direta** (sem `-pooler`) do Neon | Só na sua máquina, para migrações e comandos (não precisa na Netlify) |
| `APP_SEGREDO` | 64 caracteres aleatórios, **exclusivo**; nunca trocar depois de publicado | Functions |
| `APP_URL_PUBLICA` | `https://<seu-site>.netlify.app` (ou domínio próprio) — vai nos QR das etiquetas | Functions |
| `APP_AMBIENTE` | `producao` | Functions |
| `COOKIE_SEGURO` | `true` | Functions |
| `CAMINHO_BASE` | `/` | Build e Functions |
| `PERSISTENCIA_LOCAL` | `desativada` | Functions |
| `DB_POOL_MAX` | `3` (conexões por instância da função) | Functions |
| `DB_CONEXAO_TIMEOUT_MS` | `15000` (o Neon pode levar alguns segundos para acordar) | Functions |
| `PLANILHA_AUTOMATICA` | `desativada` (ainda não compatível; ver abaixo) | Functions |

**Previews**: os deploys de pull request usam as mesmas variáveis por padrão. Defina valores diferentes para o contexto *Deploy Previews* (um branch separado do Neon, por exemplo `preview`) ou desative os previews: **nunca** deixe um preview usar o banco de produção. O build não executa migrações nem seed, então um preview não altera o banco.

## Passo a passo

1. **Subir o código** para o GitHub (pasta `praca-reversa/` com `netlify.toml`, `package-lock.json` e sem `.env`/`.dados`).
2. **Neon**: no projeto, branch `production`, copie as duas conexões (com e sem pooling). Guarde-as num gerenciador de senhas.
3. **Migrações** (na sua máquina, uma vez por ambiente e a cada atualização que traga migração nova):
   ```bash
   npm ci
   ```
   Defina só nesta janela de terminal `DIRECT_URL` (conexão direta do Neon) e rode:
   ```bash
   npm run db:migrar
   ```
   Nunca use `migrate reset`, `db push` nem `npm run db:semear-demo` no banco de produção.
4. **Primeira conta** (mesmo terminal, com `DATABASE_URL` = conexão direta do Neon): 
   ```bash
   npm run admin:criar -- --login <seu.login> --nome "<Seu nome>" --unidade <CÓDIGO-UNIDADE> --cliente <CÓDIGO-CLIENTE> --unidade-nome "<nome>" --cliente-nome "<nome>"
   ```
   A senha é digitada sem aparecer. Depois, no aplicativo, **Administração de acesso** → criar a conta da operação com perfil **Supervisor de estoque**.
5. **Netlify**: *Add new site → Import an existing project* → GitHub → escolha o repositório → preencha os valores da tabela do painel → *Environment variables* → *Deploy*.
6. **Verificar**: abra `https://<site>/api/v1/health` (deve mostrar `{"status":"ok"}`) e `https://<site>/api/v1/health/ready` (banco disponível); entre com a conta criada; abra um palete pelo endereço `/paletes/<ID>`; imprima uma etiqueta e confira que o QR aponta para `APP_URL_PUBLICA`.
7. **Importar o inventário**: o pacote JSON do inventário é carregado por comando local (`npm run inventario:carregar`, ver README) com `DATABASE_URL` = conexão direta do Neon e o escopo/supervisor criados no passo 4. Planilhas até ~4 MB podem ser importadas pela tela; maiores ainda não (ver abaixo).

## Dados locais × banco publicado

Publicar **não** copia os dados do PostgreSQL deste computador. Para levar registros já existentes: `npm run backup:criar` (origem local) e `npm run backup:restaurar` num banco **novo** — a restauração exige criar banco e `SET session_replication_role`, o que pode não existir no Neon Free; nesse caso, recarregar pelo comando de carga do inventário é o caminho mais simples. Faça isso uma vez, antes de começar a usar o banco publicado.

## Atualizar e voltar atrás

- **Atualizar**: envie o código novo ao GitHub; se houver migração nova, rode o passo 3 **antes** do deploy. Banco e segredos continuam os mesmos (nunca troque `APP_SEGREDO`).
- **Rollback de código**: na Netlify, *Deploys* → escolher um deploy anterior → *Publish deploy*. Isso não desfaz migrações nem dados.
- **Restauração do banco**: é outra operação (backup do Neon/branch de restauração ou `backup:restaurar` em banco novo) e devolve os dados ao instante do backup.

## Compatibilidade (conferida no código em 6 out. 2026)

| Função | Situação na Netlify Free | Evidência |
| --- | --- | --- |
| API completa por Function (rotas `/api/v1`, login, CSRF, perfis, escopo, idempotência, versões) | **Compatível — verificado localmente** com o pacote esbuild da função e PostgreSQL de teste: 12/12 verificações (saúde, 404 JSON, cookies Secure/HttpOnly, CSRF e outra origem 403, repetição sem duplicar, QR, upload/download binário com mesmo SHA-256, 403 por perfil, logout) | `.dados/ensaio-funcao.tmp.ts` (não versionado) |
| Interface, rotas diretas, PWA | Compatível por configuração (`netlify.toml`); service worker já não guarda `/api/` | Não verificado no site publicado |
| Upload de planilha > ~4,5 MB (inventário/seleção aceitam até 40 MiB) | **Incompatível ainda**: a Function aceita ~6 MB bufferizados (~4,5 MB binário) | Limite da documentação Netlify; envio em partes ainda não implementado |
| Prévia/confirmação de planilha muito grande (até 120 s no código) | **A verificar**: a Function síncrona para em 60 s. A planilha real (851 linhas, 61 KB) é processada em poucos segundos | Medição com 40 MiB não feita |
| Planilha única automática e download dela | **Incompatível ainda**: depende de processo contínuo e de pasta local; em Functions não há disco persistente | `PLANILHA_AUTOMATICA=desativada` até guardar o arquivo no banco |
| Backup completo e teste de restauração | Rodam **fora da Netlify** (máquina do responsável) contra o Neon; o teste de restauração precisa de permissão para criar banco | Não executado contra o Neon |
| Publicação no Neon | **Não executada** (sem credenciais neste computador) | — |

## Antes de usar na operação

Os itens "Incompatível ainda" estão no plano de `docs/RETOMADA-NETLIFY-NEON.md` (envio em partes persistidas no PostgreSQL, planilha guardada no banco, verificação no site publicado).
