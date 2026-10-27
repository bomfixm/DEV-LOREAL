# Implantação e operação

## Ambientes

Desenvolvimento local com dados fictícios e PostgreSQL isolado. Piloto com escopo e responsáveis definidos. Uso operacional em ambiente da empresa com interface/API acessíveis, banco compartilhado, HTTPS, identidade e backups. A escolha do host depende da rede, manutenção e políticas efetivamente informadas; este pacote não contrata nem publica um serviço.

Manter configuração e banco de cada ambiente separados. O modo demonstração deve ser explícito e não carregar dados reais por padrão. A etapa 01 não expõe uma API de gravação de estoque sem autenticação.

## Configuração e implantação

Registrar variáveis em arquivo de exemplo sem valores secretos. Configurar URL do banco, origem da interface, cookie/sessão, armazenamento privado de anexos, fuso e ambiente. Não colocar credenciais padrão fixas em código ou documentação. O bootstrap de administrador recebe segredo por mecanismo local/seguro e não imprime senha em logs.

Preferir interface e API na mesma origem por reverse proxy. Usar HTTPS fora de localhost, manifest/ícones corretos, autenticação e acesso conforme unidade/cliente. O banco não é exposto diretamente ao navegador. Bibliotecas e versão de Node.js ficam fixadas e documentadas.

Aplicar migrações em uma base de teste, verificar diferenças e ter plano de recuperação antes de alterar o ambiente operacional. Não limpar o banco para atualizar o aplicativo. Publicar versão da interface e API compatíveis; serviço de atualização da PWA deve evitar troca durante uma contagem sem preservar o rascunho.

### PWA, origem segura e caminho-base (etapa 09)

- **HTTPS obrigatório** no ambiente dos aparelhos (câmera, instalação e service worker não funcionam em HTTP fora de `localhost`). Acessar `http://<IP>` pelo celular não é origem segura. Certificado e nome do host do piloto: **pendente** (responsável de infraestrutura).
- Interface e API na **mesma origem**. Com caminho-base, `CAMINHO_BASE` (ex.: `/praca/`) é o mesmo no build (`npm run build`) e no servidor; o proxy reverso repassa o caminho **completo** (sem remover o prefixo). O servidor recusa iniciar se o build for de outro caminho-base.
- `APP_URL_PUBLICA` = origem pública estável (só protocolo, host e porta); os QR saem como `APP_URL_PUBLICA` + caminho-base + `paletes/<id>`. Trocar a origem depois exige reimprimir etiquetas (a câmera não abre sozinha link de outra origem).
- `PERSISTENCIA_LOCAL` fica **desativada** em produção (o servidor recusa `ativada`): o não enviado fica só na memória da aba (AGENTS.md). Mudar isso exige decisão de política registrada.
- O service worker guarda só a casca; nada da API. Depois de publicar, a versão nova aparece como "Atualizar" para quem está com o app aberto; não é preciso pedir a ninguém que feche abas.

### Versões e retorno a uma versão compatível

- Interface e API são publicadas **juntas** a partir do mesmo build (mesma versão do `package.json` e mesmo `VERSAO_CONTRATO`). Mudança que quebra telas abertas aumenta `VERSAO_CONTRATO` (e, se for o caso, `CONTRATO_MINIMO_INTERFACE`): telas antigas param de gravar e pedem "Atualizar", sem perder o não enviado.
- Migrações são **só para frente** e aplicadas antes do servidor novo (`npm run db:migrar`), depois de ensaiadas numa cópia restaurada. Nunca reverter migrações, limpar o banco, redefinir cadastros nem reimportar para "voltar" uma versão: instalar/atualizar a PWA não altera ocupação, layout (inclusive áreas/fileiras desativadas) nem disponibilidade de posições.
- **Retorno**: reinstalar o build anterior só é seguro se ele tiver as mesmas migrações do banco (o backup registra a lista e o `restaurar-backup` recusa código com migrações diferentes). Se a versão nova já aplicou migração, o retorno é corrigir para frente (nova versão) ou, em incidente grave, restaurar um backup **num ambiente isolado** para apuração — nunca sobre o banco em uso.

## Backups e recuperação

**Método.** Banco e anexos ficam no mesmo PostgreSQL (anexos de claims, janelas e conferências e arquivos de importação em `bytea`), então um backup tirado num único snapshot `REPEATABLE READ` é coerente: dados, relações e arquivos do mesmo instante, sem pausar as gravações. Scripts (Node, sem dependência nova):

```bash
npm run backup:criar -- --origem=DATABASE_URL --destino=<pasta protegida fora do repositório>
```

```bash
npm run backup:restaurar -- --backup=<pasta do backup> --destino=praca_reversa_restauracao_AAAAMMDD --servidor=<VARIÁVEL do servidor isolado> --relatorio=<arquivo.json>
```

- **Conteúdo do backup**: `dados/NNN-<tabela>.ndjson.gz` (cópia lógica: JSON por linha na ordem da chave, compactado) ou `banco.dump` (`--metodo=pg_dump`, formato custom do `pg_dump` oficial no mesmo snapshot, exige `PG_BIN` com as ferramentas cliente da mesma versão maior do servidor ou mais nova); `configuracao.json` (só variáveis não secretas; segredos apenas nomeados); `manifesto.json` (id, data, instante do snapshot, duração, método, versão do aplicativo, versão do PostgreSQL, origem sem senha, migrações com checksum, tabelas com linhas e SHA-256, sequências, **inventário de anexos** com entidade, tamanho e SHA-256) e `manifesto.sha256`.
- **Proteção**: o backup contém dados pessoais e hashes de senha. Guardar fora do repositório (o script recusa a área versionada; `.dados/` é ignorado), com acesso restrito e cópia fora do servidor. URLs/senhas só por variável de ambiente (nunca em argumentos, logs ou manifesto).
- **Integridade**: o backup é reprovado se um anexo tiver hash gravado diferente do conteúdo; a restauração confere o hash do manifesto e de cada arquivo **antes** de criar qualquer banco e reprova anexo ausente/corrompido, linha a mais/a menos, conteúdo diferente, chave estrangeira órfã, regra de saldo/reserva/expedição violada ou migração diferente (código de saída ≠ 0, banco novo removido).
- **Destino**: sempre banco **novo** e isolado, nome com "restauracao" ou "ensaio", diferente da origem e dos bancos configurados; em produção, servidor isolado obrigatório (`--servidor` ≠ `DATABASE_URL`). O usuário do restaurador precisa de `CREATEDB` e de permissão para `SET session_replication_role` (superusuário ou `GRANT SET ON PARAMETER`, PostgreSQL ≥ 15); sem isso, usar o método `pg_dump`/`pg_restore`.
- **Papéis e extensões**: nem o backup lógico nem o `pg_dump` copiam papéis (usuários do PostgreSQL); o usuário da aplicação no destino vem da `DATABASE_URL` daquele ambiente (com senha do cofre). O banco novo é criado a partir de `template0` e o esquema vem das migrações do próprio código.
- **Depois de restaurar**: sessões antigas ficam revogadas (todos entram de novo; autoria preservada). Para que repetições de pedidos com a mesma chave sejam reconhecidas, o ambiente restaurado usa o **mesmo `APP_SEGREDO`** (com outro, a repetição é recusada — nunca vira segunda baixa). A restauração devolve o **ponto do snapshot**: o que aconteceu depois (movimentos, saídas físicas, conferências) precisa ser apurado pelo procedimento operacional e registrado de novo, sem repetição automática; não há promessa de perda zero.
- **Ensaio executado** (4 de outubro de 2026, computador de desenvolvimento, PostgreSQL 17.10 local, dados fictícios): teste automatizado `recuperacao-backup.test.ts` (fixtures completas, backup ≈ 0,8 s, restauração com verificação ≈ 2,7 s, comparação aprovada, aplicação apontada para o banco restaurado e cinco tipos de falha detectados) e restauração manual da base de desenvolvimento (61 tabelas, 1.043 linhas, 177 chaves estrangeiras, 9 sessões revogadas; ≈ 3 s). **Volume fictício** (`node scripts/recuperacao/ensaio-volume.mjs`: cópia da base de desenvolvimento + 300 fotos de 1 MB + 200.000 eventos de auditoria = banco de 398,5 MB, 201.346 linhas): backup 35,5 s (347,7 MB), restauração com verificação completa 33,4 s (integridade 0,4 s, carga 21,8 s, comparação 10,5 s), aprovada. O primeiro ensaio de volume reprovou (a carga lia a tabela de anexos inteira numa string) sem relatar sucesso; os scripts passaram a ler e gravar por fluxo. Tempos com volume e máquina de teste, não da operação.

| Item | Situação |
| --- | --- |
| Frequência e janela do backup | Diário automático pelo trabalhador da API e antes de cada substituição do inventário (26 out. 2026); janela de horário e destino externo **pendentes** (operação/infraestrutura). |
| Retenção e destino (cópia fora do servidor, criptografia em repouso) | **Pendente**. |
| Responsável pelo backup e pela restauração | **Pendente** (a definir com a operação). |
| Meta de perda de dados (RPO) e de tempo de recuperação (RTO) | **Pendentes**; o ensaio só mede o tempo observado com volume de teste. |
| Ferramentas cliente do PostgreSQL 17 no servidor (método `pg_dump`) | **Pendente**; método `pg_dump` implementado, não ensaiado neste computador. |
| Ensaio de restauração no ambiente do piloto (volume real, aparelhos na rede HTTPS) | **Pendente**. |

## Planilha automática e proteção dos dados (26 out. 2026; substitui a versão de 6 out.)

O aplicativo (PostgreSQL) é a fonte oficial; a planilha é **cópia de consulta**, atualizada só no sentido aplicativo → planilha. Editar o Excel não altera nada; importar dados é outro fluxo, com permissão e validação.

**Arquivo** (um por escopo, nunca misturando clientes): abas **Inventário** (as 13 primeiras colunas na ordem da planilha da operação — N° PALLET, DELIVERY, TIPO, NUMERO, VOLUMES, REMETENTE, MÊS AGENDA, JANELA, RUA, DOCUMENTAÇÃO, PALLET FULL, PF/CNPJ, INVENTÁRIO — e depois SITUAÇÃO, PENDÊNCIA, ORIGEM DOS VOLUMES, CONFERÊNCIA, FILEIRA, TIPO DO PALETE, PRODUTO NA CAIXA, ORIGEM DO REGISTRO, ID DO REGISTRO), **Movimentações** (auditoria operacional + histórico das ocorrências, contagens, troca de número do palete e volumes das janelas, com antes/depois; sem limite silencioso — acima de `PLANILHA_MOVIMENTOS_POR_ARQUIVO` as mais antigas vão para arquivos de apoio da mesma revisão) e **Proteção e ajuda** (escopo, revisão, lote ativo, instante da captura e da geração, fuso, última publicação comprovada, backup, teste de restauração, como recuperar; sem senha, token ou caminho do servidor).

- **Inventário = base ativa**: uma linha por registro — ocorrência ativa no palete (quantidade atual dos painéis: contagem mais recente ou informado, menos saídas), conteúdo sem documento, palete sem conteúdo registrado, ocorrência **em validação** (sem endereço, com motivo) e linha do **lote ativo pendente** (em revisão, repetida no arquivo ou sem registro ativo) sem endereço nem quantidade inventados. Linha do lote que sustenta uma ocorrência sai uma vez (na ocorrência, com a origem). VOLUMES: número só para quantidade conhecida do estoque; "Não informado" e pendências em texto, fora de qualquer soma. Saída total sai do Inventário (fica em Movimentações).
- **Fila durável**: gatilhos por instrução gravam `alteracao_planilha` na mesma transação de cada alteração (palete, vínculos, inventário, conteúdos, contagens, conferências, históricos, volumes das janelas, endereços, localização, estoque e auditoria operacional). Transação desfeita = nenhuma marca.
- **Revisão**: número crescente por escopo (`controle_planilha.revisao_dados`). Cada geração lê um snapshot `REPEATABLE READ READ ONLY`, monta, **valida relendo o XLSX** (abas, cabeçalhos, linha a linha N° PALLET/NUMERO/DELIVERY/RUA/ID, texto como texto, nenhuma fórmula, soma de VOLUMES, escopo e revisão, cada evento uma vez), grava na pasta local (temporário + troca atômica + releitura) e só então registra a revisão (`geracao_planilha`) e apaga as marcas que viu. Alteração confirmada depois do snapshot fica para a revisão seguinte.
- **Envio** (registro separado, `envio_externo`): só a revisão mais recente; o manifesto do destino é lido antes (revisão igual = idempotente; mais nova lá = recusa, nunca sobrescreve) → versões em `versoes/` (nome com revisão, data e lote) → arquivo de nome estável → manifesto por último; cada arquivo relido e conferido pelo SHA-256 antes de "CONFIRMADO".
- **Trabalhador** (`modules/protecao/trabalhador.ts`): no processo da API (`npm start`, mantido pela tarefa do Windows), a cada `PLANILHA_INTERVALO_S` (5 s) — gera depois de `PLANILHA_AGRUPAR_S` (10 s) sem novas alterações ou depois de `PLANILHA_ESPERA_MAXIMA_S` (60 s) com alterações contínuas; alvo `PLANILHA_ALVO_S` (30 s, não é garantia); "Atrasada" depois de `PLANILHA_ATRASO_S` (120 s). Concessão no banco por escopo (`PLANILHA_CONCESSAO_MIN`): reinício retoma, dois processos não trabalham o mesmo escopo. Falha: espera crescente (30 s, dobrando até 30 min), separada para geração e envio. Hospedagem sem processo contínuo: `npm run protecao:processar` (uma volta) pelo Agendador de Tarefas/cron/função agendada.
- **Retenção** (pasta local e destino): últimas `PLANILHA_VERSOES_MANTER` (50), uma por dia por `PLANILHA_DIARIAS_DIAS` (30) e as anteriores a substituições por `PLANILHA_PRE_SUBSTITUICAO_DIAS` (30, mínimo 30); nunca a atual publicada nem a mais nova.
- **Substituição do inventário** (tela de importação e `inventario:carregar --substitui`): antes da troca, revisão da base atual marcada "antes da substituição" (publicada se houver destino) e backup completo verificado (`PRE_SUBSTITUICAO`); sem as duas cópias verificadas a troca é recusada (`PROTECAO_PREVIA_FALHOU`). Falha só no envio externo não bloqueia (as cópias ficam no servidor e o trabalhador reenvia). A troca continua numa transação única: se for desfeita, a planilha atual continua a da base anterior.

**Destino independente** (`PLANILHA_DESTINO`; o dos backups é o mesmo, sob `backups/`, salvo `BACKUP_DESTINO_EXTERNO`):

| Valor | Uso |
| --- | --- |
| `s3://<bucket>/<prefixo>` | Armazenamento S3 compatível (AWS S3, Cloudflare R2, Backblaze B2, MinIO de outra máquina…). `PROTECAO_S3_ENDPOINT` (https), `PROTECAO_S3_REGIAO`, `PROTECAO_S3_ESTILO` (`caminho`/`virtual`), `PROTECAO_S3_CHAVE_ACESSO`, `PROTECAO_S3_SEGREDO` — só no `.env` do servidor (nunca no front, no repositório, no log ou no backup). Assinatura AWS SigV4 própria (sem dependência nova), conferida com os exemplos da AWS. |
| `pasta:\\servidor\compartilhamento\...` | Compartilhamento de rede de **outra máquina**. Pasta no disco deste servidor (inclusive a sincronizada pelo OneDrive) e serviço em localhost são aceitos, mas aparecem como **não independentes** (a subida não é comprovável pelo aplicativo). |

`PLANILHA_DESTINO_DESCRICAO` (e `BACKUP_DESTINO_EXTERNO_DESCRICAO`) é o texto mostrado na tela e na planilha (sem credencial). Conferir o acesso: `npm run protecao:verificar-destino` (grava, relê e apaga um arquivo de teste). **Nenhum destino foi configurado nesta máquina**: escolher o armazenamento autorizado pela operação (conta da empresa, acesso restrito a quem pode ver o inventário completo; backups só administradores) é decisão do responsável.

**Acesso com o aplicativo fora do ar**: pelo próprio destino (console do provedor, Explorer no compartilhamento ou ferramenta S3 com credencial de leitura da pessoa autorizada): `planilha/Praca-Reversa-<unidade>-<cliente>/` tem o arquivo atual e `…manifesto.json` (revisão, SHA-256, instante); `versoes/` as anteriores; `backups/<pasta>/` os backups completos (vale só a pasta com `concluido.json`). Nada é público; nenhum link com segredo é gerado.

**Backup completo** (separado da planilha; a planilha não substitui o backup: não tem usuários, permissões, anexos, auditoria completa nem estruturas técnicas):

- Automático pelo trabalhador: a cada `BACKUP_INTERVALO_HORAS` (24) e antes de cada substituição do inventário; usa `scripts/recuperacao/rotina-backup.mjs` (snapshot coerente, manifesto com SHA-256, conferência, registro VERIFICADO/FALHOU) num processo filho; envia ao destino (cada arquivo conferido; `concluido.json` por último). `BACKUP_AUTOMATICO=desativada` desliga.
- Pasta local `BACKUP_DESTINO` (padrão `.dados/backups`). Retenção local só nos backups criados por esta rotina (motivo registrado): `BACKUP_MANTER` (14), um por dia por `BACKUP_DIARIOS_DIAS` (30), anteriores a substituições por `BACKUP_PRE_SUBSTITUICAO_DIAS` (30); cópias manuais antigas nunca são apagadas automaticamente. A mesma regra no destino.
- Manual: `npm run protecao:backup`.
- **Teste de restauração com dados reais**: `npm run protecao:teste-restauracao [-- --origem=externo|local]` — baixa o último backup confirmado no destino (ou usa o último local), restaura num banco **novo e isolado** (`praca_reversa_restauracao_teste_…`) com comparação completa (manifesto, migrações, cada tabela, anexos, relações), conta inventário/pendências/relações, **remove o banco** e registra o resultado (dados da operação). Nunca toca o banco em uso. Teste com dados fictícios (`backup:teste-restauracao`) não conta como proteção atual. Repetir pelo menos a cada `RESTAURACAO_PRAZO_DIAS` (35).

**Tela "Planilha e proteção"** (menu da conta; `praca.consultar`, nunca o cliente): destino, última alteração confirmada e sua revisão, última revisão gerada, última publicada e quando, alterações aguardando e atraso, falhas recentes, revisões com download. Estados: **Atualizada, Atualizando, Aguardando, Atrasada, Falhou, Não configurado**, pela evidência registrada. **Tentar novamente agora** (`planilha.publicar`: supervisor e administrador) reprocessa geração, conferência, envio e backup pendente, ignorando a espera; **Baixar** (`planilha.baixar`: supervisor, analista e administrador) entrega o arquivo relido e conferido pelo SHA-256, com revisão e situação da publicação; **Atualizar** relê a situação. Situação por comando: `npm run protecao:situacao`.

| Item (26 out. 2026, computador de desenvolvimento, escopo real) | Situação |
| --- | --- |
| Geração automática local | **Funcionando**: trabalhador na porta 3000; revisão gerada ≈12 s depois de uma alteração registrada; ≈1,4 s por revisão (1.414 linhas, 924 movimentações) |
| Publicação no destino independente | **Não configurado** — falta escolher o armazenamento autorizado e pôr as credenciais no `.env` |
| Backup completo diário | **Funcionando no servidor** (automático; destino externo não configurado) |
| Teste de restauração | **Aprovado com dados reais** em 26/10/2026 (backup local do dia, banco isolado removido) |

## Situação do ambiente (etapa 10)

**Disponível de fato:** somente o computador de desenvolvimento (Windows 11, Node 24.20, PostgreSQL 17.10 local em 127.0.0.1:5433, dados fictícios). Nada foi publicado, nenhuma hospedagem foi contratada e nenhum ambiente da empresa foi alterado.

| Requisito do piloto/operação | Situação |
| --- | --- |
| Host da interface/API (mesma origem, proxy reverso) e nome estável | Pendente (infraestrutura) |
| HTTPS com certificado válido para os aparelhos | Pendente |
| PostgreSQL 17 compartilhado do ambiente, separado da demonstração, com ferramentas cliente | Pendente |
| Autenticação: contas individuais do próprio aplicativo (sem SSO nesta versão) | Implementado; contas reais pendentes |
| Escopos (unidade × cliente) reais e fuso | Pendente (definição da operação) |
| Anexos privados: ficam no próprio PostgreSQL (`bytea`), incluídos no backup; acompanhar o crescimento do banco | Implementado; capacidade pendente |
| Equipamentos (Android, iPhone, coletores) | Pendente (matriz em `ESTADO.md`) |

**Instalação reproduzível:** `npm ci` → `.env` a partir de `.env.example` (sem segredos no repositório; `APP_AMBIENTE=producao`, `DATABASE_URL`, `APP_SEGREDO`, `APP_URL_PUBLICA`, `COOKIE_SEGURO=true`, `CAMINHO_BASE` se houver) → `npm run build` → `npm run db:migrar` (antes, ensaiado numa cópia restaurada) → `npm start` → conferir `/api/v1/health/ready` (200) e `/api/v1/versao` → `npm run admin:criar`. **Nunca** rodar `db:semear-demo` no piloto/operação (o comando recusa `producao`).

**Atualização:** backup → restaurar numa cópia isolada → aplicar migrações e testar nela → publicar interface e API juntas → `db:migrar` → reiniciar → conferir saúde e versão; quem está com o app aberto recebe "Atualizar".

**Falhas:** registrar a referência da operação (chave mostrada no painel "Em confirmação", consultável em `GET /api/v1/operacoes/<chave>`), o `requestId` das mensagens de erro e o registro da auditoria (Administração de acesso). Corrigir por evento vinculado, nunca apagando.

**Responsáveis** (cadastro/conferência, validação de claims, liberação/expedição, contas, suporte, backup, manutenção): **todos pendentes** de confirmação — ver `ROTEIRO-DO-PILOTO.md`, seção 3. Critérios para ampliar o piloto: seção 10 do roteiro. Preparação técnica, autorização operacional e publicação são estados distintos.

## Operação diária

Na entrada, cadastrar identificação e localização. Na triagem, registrar conteúdo/conferência e separações. Na transferência, atualizar origem/destino e histórico. Na pendência, informar responsável e próximo passo. Na janela, reservar somente material elegível e confirmar o que realmente saiu.

Uma consulta não substitui contagem quando o registro físico ainda é desconhecido. O processo deve manter a informação atualizada durante a movimentação; atualização posterior informal prejudica a confiança do mapa.

## Entrada em uso

Realizar demonstração com dados fictícios, preencher `DESCOBERTA.md`, concluir os módulos do fluxo do piloto, testar equipamentos (matriz em `ESTADO.md`: Android/iPhone/coletores ainda não testados fisicamente) e restaurar um backup de teste no ambiente do piloto. Definir quem cadastra, quem reconcilia, quem valida claims e quem confirma expedição. Executar o piloto delimitado, corrigir divergências e ampliar gradualmente.

O procedimento atual permanece a referência operacional até a validação do novo fluxo pelo responsável. Resultados publicados internamente devem separar produto localizado, tratativa validada, valor confirmado e material efetivamente expedido.

## Manutenção

Definir responsável pelo código, banco, contas, backups, suporte e mudanças das regras do cliente. Registrar falhas por ID de operação, preservar evidências e fazer correção por evento quando necessário. Manter um histórico de versões e um procedimento de retorno à versão anterior compatível com o banco.

Integrações com sistemas atuais começam por importação/exportação. Escrita automática em sistemas corporativos será um desenvolvimento separado, baseado em APIs e acessos efetivamente disponíveis.
