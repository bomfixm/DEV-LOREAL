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
| Frequência e janela do backup | **Pendente** (operação/infraestrutura). Nenhum agendamento foi ativado. |
| Retenção e destino (cópia fora do servidor, criptografia em repouso) | **Pendente**. |
| Responsável pelo backup e pela restauração | **Pendente** (a definir com a operação). |
| Meta de perda de dados (RPO) e de tempo de recuperação (RTO) | **Pendentes**; o ensaio só mede o tempo observado com volume de teste. |
| Ferramentas cliente do PostgreSQL 17 no servidor (método `pg_dump`) | **Pendente**; método `pg_dump` implementado, não ensaiado neste computador. |
| Ensaio de restauração no ambiente do piloto (volume real, aparelhos na rede HTTPS) | **Pendente**. |

## Planilha única e proteção dos dados (6 out. 2026)

**Planilha** `Praca-Reversa-<unidade>-<cliente>.xlsx` (abas Inventário, Movimentações, Proteção e ajuda), por escopo, nunca misturando clientes. O PostgreSQL continua sendo a fonte oficial; a planilha é cópia para consulta (sem edição de volta).

- **Fila durável**: gatilhos por instrução gravam `alteracao_planilha` na mesma transação de cada alteração exportada (palete, vínculos, inventário, cidade/produto, endereços, conferência, localização, estoque e auditoria operacional). Transação desfeita = nenhuma marca; publicação com falha não desfaz o cadastro.
- **Publicação** (`apps/api/src/modules/planilha`): agendador no processo da API (`npm start`) agrupa alterações próximas (`PLANILHA_AGRUPAR_S`), reconcilia periodicamente (`PLANILHA_RECONCILIAR_MIN`) e publica um escopo por vez com concessão no banco (`PLANILHA_CONCESSAO_MIN`; reinício retoma). Snapshot `REPEATABLE READ READ ONLY` → arquivo temporário → validação (o leitor de XLSX do projeto relê cabeçalhos, NFD/palete/Delivery linha a linha e IDs dos eventos) → publicação. Falha de leitura, tempo esgotado, arquivo defeituoso ou destino indisponível: nada é substituído, a falha fica registrada e a nova tentativa espera (30 s, dobrando até 30 min). Versão crescente por escopo; o destino recusa versão igual ou mais antiga (trabalho atrasado não sobrescreve).
- **Destino independente** `PLANILHA_DESTINO=pasta:<caminho absoluto>`: pasta de uma biblioteca do **SharePoint/OneDrive sincronizada** no servidor pelo cliente OneDrive, ou compartilhamento de rede de outra máquina, com permissão só para quem pode ver o arquivo completo do escopo. Arquivo atual com nome estável + `versoes/<nome>-v000123-<instante>.xlsx` + `<nome>.versao.json`; retenção `PLANILHA_VERSOES_MANTER` (as mais novas; nunca todas). A API Microsoft Graph **não** foi implementada nesta etapa (exige registro de aplicativo e permissões; consultar a documentação oficial antes). Sem destino: só **geração local** em `PLANILHA_PASTA_LOCAL` (padrão `.dados/planilha/<escopo>/`), mostrada como "Não configurado" — não protege contra perda do servidor. Escopos de demonstração nunca vão para o destino.
- **Tela** "Planilha e proteção" (menu da conta): estados `Atualizada`, `Atualização pendente`, `Falhou`, `Não configurado`, `Não testado`; atraso das alterações; versões recentes; **Tentar novamente agora** (`planilha.publicar`: supervisor e administrador); **Baixar a última planilha gerada** (`relatorio.exportar`, auditado).
- **Exemplo fictício**: `npm run planilha:exemplo` → `examples/planilha/Praca-Reversa-EXEMPLO-FICTICIO.xlsx`.

**Backup completo automático** (reaproveita `criar-backup.mjs`):

```bash
npm run backup:rotina
```

Cria o backup coerente, confere manifesto e hash de cada arquivo, aplica a retenção (`BACKUP_MANTER`, padrão 14) e registra em `registro_protecao` (VERIFICADO ou FALHOU, com tamanho, identificador e destino). O aplicativo mostra "Atualizada" só com backup verificado **fora do servidor** (`BACKUP_FORA_DO_SERVIDOR=sim`) dentro de `BACKUP_PRAZO_HORAS`; vencido → "Atualização pendente"; falha posterior → "Falhou"; sem registro ou no mesmo servidor → "Não configurado". Mensagens: o canal é a própria tela e a aba Proteção (nenhum e-mail ou mensagem externa é enviado); `BACKUP_RESPONSAVEL` identifica quem acompanha.

```bash
npm run backup:teste-restauracao
```

Cria dois bancos de ensaio **novos** (migrações + seed fictício), faz o backup do primeiro, restaura no segundo com comparação completa, registra TESTE_RESTAURACAO e apaga os bancos. Nunca toca o banco em uso. Exige `CREATEDB` e `SET session_replication_role` (pode não existir em PostgreSQL gerenciado: nesse caso, usar a recuperação oferecida pela infraestrutura e registrar o resultado verificado).

**Agendar** (não foi criado neste computador; depende de autorização e de conta de serviço):

```bash
schtasks /Create /TN "Praca Reversa - backup diario" /SC DAILY /ST 02:00 /TR "cmd /c cd /d C:\caminho\praca-reversa && npm run backup:rotina >> .dados\backups\rotina.log 2>&1"
```

Em Linux: `0 2 * * * cd /srv/praca-reversa && npm run backup:rotina >> /var/log/praca-backup.log 2>&1`. Teste de restauração: mensal ou antes de cada ativação (`RESTAURACAO_PRAZO_DIAS`, padrão 90).

| Item (6 out. 2026, computador de desenvolvimento) | Situação |
| --- | --- |
| Geração local da planilha | **Funcionando** (agendador com `npm start`; ≈1 s para o escopo real local, 785 linhas) |
| Cópia externa publicada (destino independente) | **Não configurado** — falta a pasta sincronizada/compartilhada e a descrição (`PLANILHA_DESTINO*`) |
| Backup agendado | **Não configurado** — rotina executada manualmente 1× (VERIFICADO, destino no mesmo servidor) |
| Teste de restauração | **Verificado** com dados fictícios em bancos de ensaio isolados (78 tabelas, 1.419 linhas iguais) |
| Atraso da planilha no ambiente real | **Não medido** (só com destino configurado no ambiente do piloto) |

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
