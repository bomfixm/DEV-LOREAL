# Praça Reversa

Projeto de aplicativo para controlar paletes, conteúdo físico, devoluções, divergências, claims e janelas de expedição na operação DHL / L’Oréal.

Este repositório contém a especificação (arquitetura, regras, critérios de teste e prompts em dez etapas) e o código das etapas já executadas. Regras particulares do cliente devem ser preenchidas em `docs/DESCOBERTA.md` antes de serem automatizadas.

## Situação atual

**Etapas 01 a 10 implementadas e complemento "seleção do cliente" entregue, em desenvolvimento local com dados fictícios.** O app tem PostgreSQL com migrações, login individual, permissões por perfil e por unidade/cliente, auditoria e idempotência; cadastro de produtos e de paletes, configuração do layout, mapa/lista/detalhe pela mesma API, rota estável do palete e etiqueta A4 com QR; e, na etapa 04, **conferência parcial ou completa** com rascunho no servidor, leitor que digita como teclado, conversão de embalagem por fator aprovado, pendências explícitas, comparação declarado × observado × validado, recontagem vinculada e **reconciliação** por perfil autorizado (saldo, evento de estoque e auditoria numa transação); e, na etapa 05, **mover palete** de endereço e **transferir produtos** entre paletes (saldo validado − reservas, transação única com bloqueios, idempotência e versões), **histórico** de localização e conteúdo e **correções** autorizadas por eventos vinculados; e, na etapa 06, **busca operacional** no servidor (palete, endereço, SKU, código de barras, lote, devolução/NF, descrição e situação), com a base de cada resultado separada (saldo validado, observado, declarado no palete, documento importado) e escolha que centraliza o palete certo no mapa, e **importação** de produtos e de documentos de devolução por CSV/XLSX com prévia, validação por linha, duplicidade/conflito e confirmação transacional; e, na etapa 07, **claims**: cadastro e importação de casos (falta/extravio, avaria, divergência documental) com linhas, candidatos com pistas concretas (produto, lote, origem, condição) a partir da busca, evidências e anexos privados, **validação da recuperação física** com alocação ao material rastreável (a mesma quantidade nunca sustenta duas recuperações, nem em concorrência, nem depois de transferências), **resultado da regularização** separado e por concessão explícita, estornos, correções e reaberturas com histórico, valores estimado/evitado/perda sempre separados; e, na etapa 08, **janelas de devolução** (visão mensal, cadastro com campos pendentes, autorização registrada, restrições de capacidade em peças, caixas, paletes, peso com base e m³, critérios versionados), **liberação do material** por palete × segmento (ação autorizada, parcial, com bloqueio do material ou do palete inteiro), filas de material **elegível (FIFO) e pendente**, **reserva** de estoque e capacidade numa transação (todas as restrições juntas, concorrência protegida no material e na janela), **lista de preparação** (imprimível, CSV, palete no mapa e volta), **confirmação da expedição** com baixa única (inclusive parcial, com o restante liberado explicitamente), cancelamento/liberação de reservas, encerramento de janelas e **retorno físico** rastreado sem apagar a saída original; e, na etapa 09, **PWA instalável** com instruções por navegador e caminho-base configurável, **leitura por câmera** (QR do palete e códigos de produto/embalagem, decodificação no aparelho, uma leitura por vez), **estados reais de conexão**, **operações com resultado incerto** consultadas pela chave sem duplicar, rascunho não enviado conforme política (nunca no navegador em produção), **atualização controlada** sem troca silenciosa em outras abas e com bloqueio de versão incompatível, **fotos privadas na conferência** e **backup/restauração** do banco com anexos testados em banco novo. Etapa 10: ajuda por tarefa, tutorial de primeiro uso, indicadores e relatórios. Complemento: **inventário conferido** (NF × palete × endereço × volumes, sem saldo validado), **seleção do cliente**, **conciliação** por situação, pendências, lista de separação e **proposta → reserva** pela janela; **desenho aprovado** da praça (Fileiras 11–16/GR, 194 posições ativas e 300 desativadas) e **endereços reais** por tabela confirmada. Painéis: **Painel da operação** (estoque, localização, reconferência, janelas em volumes e tarefas), **Volumes da janela** (meta, separação e expedição por NF) e **Painel do cliente** (perfil de consulta, projeção restrita no servidor). O aplicativo **não está pronto para uso operacional**. Detalhes e limitações em `docs/ESTADO.md`.

## Requisitos

- Node.js 24 LTS (verificado com 24.20.0). `.nvmrc` = 24; `engines` exige `^24.11.0` com `engine-strict`.
- npm 11 (verificado com 11.19.0).
- PostgreSQL: o projeto inicia um PostgreSQL 17 local **sem instalação no sistema e sem Docker**, usando binários oficiais empacotados no npm (`embedded-postgres`). Para usar um servidor PostgreSQL próprio, aponte as variáveis `DATABASE_URL*` para ele e não use `db:iniciar`.
- Testes de interface: Chromium do Playwright (`npx playwright install chromium`) **ou** um navegador instalado indicado em `PLAYWRIGHT_CANAL` (`chrome` ou `msedge`).

## Primeira execução

```bash
npm ci
```

```bash
npm run env:local
```

Cria o `.env` (não versionado) a partir de `.env.example`, com senha do PostgreSQL local e `APP_SEGREDO` aleatórios. Nenhum valor é exibido.

```bash
npm run db:iniciar
```

Cria (na primeira vez) e inicia o PostgreSQL local em `127.0.0.1:5433`, com os bancos `praca_reversa_dev`, `praca_reversa_teste` e `praca_reversa_e2e`. Dados em `.dados/postgres`; os binários são copiados para `.dados/pg-bin/`, então `npm ci` funciona mesmo com o banco ligado. Pare com `npm run db:parar`; consulte com `npm run db:status`.

```bash
npm run db:migrar
```

Aplica as migrações versionadas (`prisma migrate deploy`).

```bash
npm run db:semear-demo
```

Seed explícito da demonstração: dois escopos fictícios ("Praça informada · demonstração" e "Cenário de navegação · fictício"). Repetível — insere só o que falta e não altera registros existentes. Recusa-se a rodar com `APP_AMBIENTE=producao` (ou sem `APP_AMBIENTE`). **Não cria usuários.**

```bash
npm run admin:criar -- --login seu.login --nome "Seu Nome"
```

Cria o primeiro administrador. A senha (mínimo de 12 caracteres) é digitada duas vezes sem eco; sem terminal, é lida da primeira linha da entrada padrão. Sem `--unidade/--cliente`, o administrador recebe acesso a todos os escopos existentes; com `--unidade CÓDIGO --cliente CÓDIGO [--unidade-nome … --cliente-nome …]`, a um escopo específico (criado se não existir). Recusa-se se o escopo já tiver administrador ativo. As demais contas são criadas pela tela **Administração de acesso** (menu da conta).

O administrador cuida de contas; cadastro, layout e conferência pedem outros perfis. Crie na Administração de acesso um usuário **Supervisor de estoque** (produtos, layout, paletes, arquivamento, etiquetas, conferência e **reconciliação**) e/ou **Operador** (paletes, etiquetas e conferência, sem reconciliar) no escopo desejado.

## Iniciar

Desenvolvimento (API com recarga + Vite com proxy de `/api`):

```bash
npm run dev
```

Abra http://127.0.0.1:5173 e entre com a conta criada. A API fica em http://127.0.0.1:3000.

Build de produção na mesma origem (interface, API e service worker na porta 3000):

```bash
npm run build
```

```bash
npm start
```

**Versão de teste sempre ligada (Windows)**: a tarefa "Praca Reversa - servidor 3000" roda `scripts/manter-servidor.mjs` ao entrar no Windows e confere a cada 15 minutos. O script sobe o PostgreSQL local quando ele está parado (por exemplo, depois de o computador dormir), mantém o servidor da porta 3000 no ar, reinicia se cair e usa sozinho o build novo depois de `npm run build`. Registro em `.dados/servidor/servidor.log`. Instalar ou remover:

```bash
powershell -ExecutionPolicy Bypass -File scripts/instalar-tarefa-servidor.ps1
```

```bash
powershell -ExecutionPolicy Bypass -File scripts/instalar-tarefa-servidor.ps1 -Remover
```

Saúde e prontidão (sem autenticação, sem expor configuração):

```bash
curl http://127.0.0.1:3000/api/v1/health
```

```bash
curl http://127.0.0.1:3000/api/v1/health/ready
```

`/health` responde se a API está no ar; `/health/ready` responde 200 se o banco responde e 503 se não.

## Fluxo da etapa 03: cadastrar → localizar no mapa → imprimir etiqueta → abrir pelo QR

1. Entre como supervisor ou operador. Em escopo sem layout, o supervisor cria o layout em **Layout da praça** (menu da conta) e acrescenta os blocos na ordem da praça (fileira única de 15, pares de 15, pares de 17…).
2. (Opcional) **Produtos**: não há formulário de produto na interface (o conteúdo recebido é registrado em **Registrar conteúdo**, sem SKU); o catálogo por SKU usado por claims e pela conferência por código entra pela importação **Cadastro de produtos**. SKU e códigos de barras são texto (zeros à esquerda preservados); cada embalagem tem fator explícito.
3. **Cadastrar palete** (menu ou botão "Novo palete" na lista): código gerado (`PAL-DEMO-###` na demonstração, `PR-######` nos demais escopos) ou identificação existente; posição inicial livre ou "sem posição"; observações; linhas declaradas em documento (opcionais). O palete nasce com conteúdo desconhecido.
4. **Ver no mapa** abre `/paletes/<ID>`: o palete aparece selecionado no mapa e na lista, com o detalhe.
5. **Imprimir etiqueta**: prévia em folha A4 (1 ou 2 etiquetas por folha) e impressão pelo navegador. A lista filtrada oferece "Etiquetas do resultado" (até 50).
6. O QR contém só o link `APP_URL_PUBLICA/paletes/<ID>`. Aberto pela câmera do celular, pede login (se preciso) e volta ao palete. A busca da lista também aceita o código escrito, o ID ou o link lido.

## Fluxo da etapa 04: abrir palete → iniciar conferência → registrar → salvar/concluir → revisar/recontar → reconciliar

1. Abra o palete pelo mapa, pela lista, pelo código ou pelo link do QR (`/paletes/<ID>`). Na seção **Conferência** do detalhe, **Iniciar conferência** (operador ou supervisor) e escolha o escopo: **Completa** (todo o conteúdo físico; ao concluir, você confirma que nada ficou de fora) ou **Parcial** (só uma parte, descrita; o restante continua pendente e nada é declarado ausente). Só uma conferência em andamento por palete.
2. A tela `/conferencias/<ID>` mostra responsável, horários, situação e **quando o rascunho foi salvo no servidor** (cada entrada é gravada na hora). Escolha o **modo de entrada** — quantidade manual, uma unidade por leitura ou uma embalagem por leitura —, a condição, o lote e a origem (vazios = pendentes).
3. Leia o código com o leitor que digita como teclado (ou digite) e Enter: produto e unidade aparecem para confirmar antes da primeira soma; leituras seguintes do mesmo código somam (duas leituras = duas peças). Caixa com fator aprovado converte exatamente (1 CX = 12 UN, fator gravado na linha); fator desconhecido ou código não cadastrado não convertem e só viram **pendência** se você pedir.
4. Linhas podem ser corrigidas ou removidas no rascunho (com autor e revisão). Sem conexão, as entradas ficam como "não enviadas" e concluir fica bloqueado; ao reconectar, o rascunho é consultado de novo e você reenvia (sem duplicar). O rascunho pode ser retomado depois, em qualquer aparelho, pelo link da conferência ou pelo detalhe do palete.
5. **Concluir**: a contagem completa fica aguardando validação (não cria saldo nem libera nada); a parcial registra observações e pendências e não substitui o saldo do palete. Depois de concluir aparece a comparação: declarado (documento), observado (contagem) e validado (saldo atual), com diferença só quando as duas quantidades existem.
6. **Solicitar recontagem** cria uma nova conferência vinculada, com justificativa; a original fica preservada. **Cancelar** exige motivo.
7. **Reconciliar conferência** (supervisor): prévia dos efeitos, justificativa e confirmação. A primeira vez grava o saldo inicial; depois, ajustes contra o saldo atual. Não muda a liberação (bloqueado continua bloqueado), não fecha claim e não confirma expedição. Mapa, lista e detalhe se atualizam pela mesma API; o histórico de conferências e eventos fica no detalhe do palete.

Na praça de demonstração há produtos e códigos fictícios para experimentar: `2000000001014` (DEMO-101, unidade), `12000000001011` (DEMO-101, caixa de 12), `2000000001021` (DEMO-102, unidade), `12000000001028` (DEMO-102, caixa com fator pendente) e `2000000001038` (DEMO-103, unidade). O PAL-DEMO-003 tem uma contagem completa aguardando validação (12 declaradas, 9 observadas).

## Fluxo da etapa 05: mover palete → transferir parte do conteúdo → consultar histórico → corrigir

1. Abra o palete pelo mapa, pela lista, pelo código ou pelo QR. Na seção **Movimentações** do detalhe: **Mover palete**, **Transferir produtos** (operador ou supervisor) e **Histórico de localização e conteúdo** (todos que consultam paletes). Com conferência em andamento, mover e transferir ficam bloqueados.
2. **Mover palete** (`/paletes/<ID>/mover`): digite/leia o código da posição ou toque numa posição livre, informe o motivo, revise a prévia (de → para, responsável) e marque a confirmação da posição física. O ID, o código, o QR e o conteúdo não mudam; mapa, lista e detalhe mostram o novo endereço depois da resposta do servidor. Arrastar o mapa continua mexendo só na visão.
3. **Transferir produtos** (`/paletes/<ID>/transferir`): escolha o item (segmento: produto, lote, origem, condição; saldo validado, reservado e disponível), a quantidade (até o disponível = saldo validado − reservas), o palete de destino (código, lista ou link do QR) e o motivo; a prévia mostra antes/depois dos dois paletes (o total não muda). Desde a etapa 08 a liberação é por material: o que é transferido chega pendente de liberação ao destino, e bloqueado se vinha bloqueado (D127). Um palete não conferido que recebe continua não conferido: só o item recebido passa a ser conhecido.
4. Se outra pessoa alterou o palete, ocupou o destino ou reservou parte do saldo, a tela avisa (conflito, destino indisponível, saldo insuficiente), consulta os dados de novo e pede nova revisão. Sem resposta do servidor, aparece **Reenviar com a mesma chave** (não duplica). Sem conexão, nada é confirmado nem guardado para depois.
5. **Histórico** (`/paletes/<ID>/historico`): localização e conteúdo com autor, horário de Brasília (gravado em UTC), motivo, origem/destino, produto, quantidade e unidade. O supervisor de estoque vê **Corrigir movimentação** (só o último movimento, contra a ocupação atual) e **Corrigir transferência** (devolve até o ainda não compensado e o disponível atual de quem recebeu). A correção é um novo evento vinculado; o original continua.

Demonstração com dados fictícios: `npm run capturas` refaz, na praça de demonstração, PAL-DEMO-001 F01-P01 → F03-P05, transferência de 10 UN de DEMO-101 para o PAL-DEMO-002 (não conferido), histórico e correção de 4 UN pelo supervisor (capturas em `docs/capturas/etapa-05/`).

## Fluxo da etapa 06: importar produtos → revisar uma devolução → confirmar dados documentais → buscar SKU → escolher um palete → centralizar no mapa

**Importação** (menu da conta → **Importações**; perfil Supervisor de estoque):

1. **Nova importação**: escolha o tipo — **Cadastro de produtos** ou **Documentos de devolução** — e o arquivo (CSV ou XLSX). O servidor confere formato e limites antes de criar o lote; a tela só mostra "recebido" depois da resposta. O mesmo arquivo (SHA-256) já confirmado não é importado de novo: a tela mostra o lote existente.
2. **Planilha e colunas**: escolha a aba (XLSX com várias abas), a linha do cabeçalho, a codificação e o delimitador (CSV; detectados e mostrados), o separador decimal (vírgula ou ponto) e a coluna de cada campo (sugerida pelos títulos; você confirma). A amostra mostra as primeiras linhas com o tipo de cada célula (texto, número, data, fórmula).
3. **Prévia**: o servidor lê o arquivo inteiro e classifica cada linha como **válida nova**, **duplicada** (já existe igual: será ignorada), **inválida** (motivo por campo) ou **conflitante** (mesma identidade com dado diferente: nada é sobrescrito). Inválidas e conflitantes bloqueiam a confirmação até você corrigir o arquivo de origem (ou o mapeamento) e enviar de novo. **Relatório de erros e duplicidades (CSV)** para corrigir a origem. Mudar planilha, decimal ou colunas gera nova versão da prévia; a anterior deixa de valer.
4. **Confirmação**: marque que revisou a versão da prévia e confirme. O servidor relê o arquivo guardado, revalida tudo contra os dados atuais e grava numa transação; se algo mudou desde a revisão (outra importação ou cadastro), nada é gravado e uma nova prévia é gerada para revisão. Sem resposta do servidor, **Reenviar com a mesma chave** não duplica.
5. **Resultado**: lote confirmado com gravadas e duplicadas ignoradas por linha; o histórico mostra situação real, contadores e a última falha (uma falha reverte tudo).

| Tipo | Campos (* obrigatório) | Regras |
| --- | --- | --- |
| Cadastro de produtos | SKU*, Descrição*, Unidade canônica*, Código de barras, Embalagem do código, Fator | Identidade: SKU (texto exato; zeros à esquerda preservados). Repita o SKU para outro código de barras. Embalagem obrigatória com código; embalagem igual à unidade canônica tem fator 1; fator vazio de outra embalagem fica **pendente** (código reconhecido, conversão bloqueada). Produto igual → duplicata; descrição/unidade diferente, SKU que só difere em maiúsculas, ou código de outro produto/embalagem/fator → conflito. Não cria saldo. |
| Documentos de devolução | Referência da devolução*, Linha/item do documento*, SKU*, Quantidade declarada*, Unidade declarada*, NF, Lote, Data do documento | **Chave**: referência da devolução + linha (linha só com dígitos é comparada sem zeros à esquerda: "001" = "1"); SKU ou NF sozinhos não identificam a linha. SKU cadastrado e ativo; unidade canônica ou embalagem com fator aprovado (guarda quantidade/unidade originais, fator e quantidade convertida). Mesma chave e conteúdo → duplicata; conteúdo diferente → conflito. **Não cria recebimento, contagem, saldo, ocupação nem liberação.** |

Formatos: CSV em UTF-8 (com ou sem BOM), UTF-16 com BOM ou Windows-1252 (escolha na prévia — é o "CSV" comum do Excel em português); delimitador `;` `,` tabulação ou `|`; campos entre aspas. XLSX (inclusive Strict Open XML). Quantidade: até 3 casas, separador decimal escolhido, **sem separador de milhar**, nada é arredondado. Data: DD/MM/AAAA, AAAA-MM-DD ou célula de data (sem hora). Identificadores gravados como número pelo Excel (ex.: SKU `000123` digitado num campo "Geral" vira `123`), em notação científica ou por fórmula ficam **inválidos** com o pedido de corrigir a origem — nada é reconstruído. Macros, fórmulas e vínculos externos nunca são executados; `.xls`, `.xlsm`, `.xlsb` e arquivos protegidos por senha são recusados.

**Modelos** (dados fictícios, aceitos pelo próprio fluxo): na tela de nova importação, `produtos.csv`, `produtos.xlsx`, `devolucoes.csv` e `devolucoes.xlsx` (também em `GET /api/v1/importacoes/modelos/<arquivo>`). No XLSX, as colunas de identificadores já estão formatadas como Texto e há uma aba "Instruções"; importe os produtos do modelo antes das devoluções. Não abra e salve o CSV no Excel antes de importar: o Excel converte `000123` em `123`.

**Busca** (mapa → **Buscar conteúdo** no computador; aba **Busca** no celular): digite palete, endereço, SKU, código de barras, lote, devolução ou NF (igual ou começo, a partir de 3 caracteres, sem diferenciar maiúsculas) ou um trecho da descrição (marcado como aproximado); "Buscar em" restringe o campo e **Filtros** escolhem a base, a situação da conferência, a liberação, a condição, a localização (com posição ou pendente) e "em conferência". Cada resultado mostra a base — **saldo validado** (com reservado e disponível), **observado em conferência** (sessão, escopo, pendências; não validado), **declarado no cadastro do palete** ou **documento importado** (sem palete) —, produto, lote/origem (ou pendente), palete e endereço atuais (ou localização pendente) e situação. O **resumo** soma só dentro de cada base e unidade (observações não são somadas). **Ver no mapa** centraliza o palete certo e abre o detalhe; voltar do detalhe ou do histórico mantém a busca. **Exportar resultado (CSV)** (supervisor e analista de claims) aplica os mesmos filtros no servidor, até 5.000 linhas, e informa filtros, horário e base das quantidades.

Demonstração com dados fictícios: `npm run capturas` refaz, na praça de demonstração, a importação de produtos (com uma duplicata), uma devolução com linha inválida e depois corrigida, a confirmação documental (100 UN de DEMO-101 sem palete), a busca de DEMO-101 (saldo validado de PAL-DEMO-001 separado do documento) e a centralização no mapa, no computador e no celular (capturas em `docs/capturas/etapa-06/`).

**Versão nova do app instalado.** Desde a etapa 09 a versão nova aparece como aviso com a ação *Atualizar* (ver o fluxo da etapa 09).

**Endereço das etiquetas.** Sem `APP_URL_PUBLICA`, o QR aponta para `127.0.0.1` e só abre no próprio computador; a prévia avisa. Para ler com um celular, configure `APP_URL_PUBLICA` com um endereço que o celular alcance (por exemplo, o IP do computador na rede local com `HOST=0.0.0.0`, se a rede permitir). Etiquetas definitivas exigem o endereço estável do ambiente do piloto, ainda não definido.

## Fluxo da etapa 07: importar um claim → ver candidatos → conferir o material compatível → validar recuperação → registrar o resultado

**Perfis** (provisórios, `docs/DESCOBERTA.md`): o **analista de claims** cadastra, importa, investiga, registra evidências e valida/rejeita recuperações, encerra e reabre casos; o **resultado financeiro** só é registrado por quem recebeu a concessão **"aprovação financeira de claims"** (Administração de acesso → usuário analista → *Conceder aprovação financeira de claims*); o supervisor de estoque consulta; operador e consulta não acessam claims.

1. **Cadastrar ou importar** (menu da conta → **Claims** → *Novo claim* ou *Importar lista*): motivo e, por linha, identificador, SKU, quantidade e unidade são o mínimo; lote (e se é exigido), origem (devolução e linha), prazo, responsável, prioridade, valor estimado (unitário ou total da linha), moeda e fonte, situação externa e cobrança são opcionais — vazio fica **pendente** (o caso aparece "em triagem"; nada é presumido).
2. **Lista** (`/claims`): resumo com bases separadas, filtros no servidor (texto, motivo, situação, responsável, prazo, pendência, prioridade), ordenação (padrão configurável em `CLAIMS_ORDEM_PADRAO`), páginas e **Exportar CSV** com os mesmos filtros.
3. **Caso** (`/claims/<ID>`): dados, totais (em análise, recuperação física validada, sem recuperação validada, estimado — que **não** é valor evitado —, valor evitado e perda confirmados, em tratativa), pendências e ações conforme o perfil. A linha e a seção ficam no endereço.
4. **Candidatos**: saldo validado, observado não reconciliado, declarado no palete, documento importado e histórico, cada um com a base; selos de produto, lote, origem e condição (compatível / incompatível / pendente / não exigido), pistas e bloqueios — sem porcentagem. **Ver no mapa** centraliza o palete; **Voltar ao claim** reabre a linha. *Investigar* registra o candidato; *Solicitar conferência* registra o pedido (a conferência segue o fluxo da etapa 04).
5. **Evidência e validação**: *Registrar evidência (material conferido)* no candidato de saldo validado → *Solicitar validação* com a quantidade → o validador *Valida* (justificativa; tratativa documentada se o lote exigido divergir) ou *Rejeita*. O servidor recusa outra origem, lote exigido sem tratativa, condição incompatível, quantidade acima do elegível (saldo − reservado − vinculado) ou do restante da linha, e evidência antiga (linha ou saldo alterados). Validar **não** mexe no estoque, na condição, na liberação nem na localização.
6. **Resultado** (perfil com aprovação financeira): tipo (regularização ou perda/avaria confirmada), data, linhas e quantidades cobertas, valor e moeda, fonte, referência, evidência ou anexo (foto/PDF até 5 MB, privados); valor diferente da estimativa exige justificativa; cobrança já finalizada exige a prova do resultado externo. Correção cria um resultado novo vinculado; anulação libera a cobertura; nada é apagado.
7. **Encerrar** (regularizado, perda confirmada ou encerrado, com decisão que trata as pendências) e **Reabrir** (motivo; não desfaz resultados nem libera material). **Histórico** do caso com autor, horário e registro relacionado.

Material vinculado a uma recuperação aparece no detalhe do palete como "vinculado a claim" (continua no estoque). Numa transferência, sai primeiro a parte sem vínculo; se passar dela, o vínculo acompanha o material (nenhuma cota nova no destino). Uma recontagem que deixaria o saldo abaixo do vinculado é recusada com pendência; o caminho é estornar a recuperação no claim (com motivo).

**Lista de claims** (Importações → *Nova importação* → *Lista de claims*; mesmo fluxo da etapa 06): uma linha do arquivo = uma linha de um caso. Campos: Referência do claim*, Linha do claim*, Motivo* (FALTA ou EXTRAVIO, AVARIA, DIVERGENCIA DOCUMENTAL), SKU*, Quantidade em análise*, Unidade*, Descrição do produto, Lote, Lote exigido (SIM/NAO), Tipo da origem (DEVOLUCAO, NOTA_FISCAL, MANIFESTO, OUTRO — obrigatório com referência), Referência da origem, Linha da origem, Data de abertura, Data da ocorrência, Prazo, Responsável (login), Prioridade (URGENTE, ALTA, NORMAL, BAIXA), Valor estimado (até 2 casas, sem milhar nem símbolo), Base do valor (TOTAL ou UNITARIO), Moeda (BRL…), Fonte do valor, Situação externa, Referência da cobrança, Cobrança finalizada (SIM/NAO), Observações. Referência + linha identificam a linha (sem uma delas, a linha é inválida; SKU sozinho não identifica); os dados do caso se repetem iguais em todas as linhas do mesmo caso. Mesma linha com o mesmo conteúdo → duplicata ignorada; com conteúdo diferente → conflito (nada é sobrescrito; casos encerrados não recebem linhas). SKU fora do cadastro, unidade diferente da canônica e origem/prazo não informados ficam como **avisos** (triagem). Importar **só cria casos e linhas de investigação**. Modelos fictícios `claims.csv` e `claims.xlsx` na tela de nova importação.

Demonstração com dados fictícios: `npm run capturas` refaz, na praça de demonstração, a importação de um claim de falta de 12 unidades → dois candidatos do mesmo SKU (um de outra devolução, bloqueado) → palete compatível no mapa → evidência de 3 → validação → 9 sem recuperação física validada → regularização parcial de R$ 30,00 com comprovante fictício pelo perfil com aprovação financeira → histórico; e uma avaria localizada que continua em avaliação (capturas em `docs/capturas/etapa-07/`).

## Fluxo da etapa 08: janela autorizada → material elegível → reserva → preparação → confirmar saída → retorno

**Perfis** (provisórios, `docs/DESCOBERTA.md`): o **supervisor de estoque** cadastra/confirma/altera/encerra janelas, libera e bloqueia material, reserva, cancela reservas, confirma expedições, registra retornos e exporta; o **operador** consulta e registra a preparação; **consulta** e **analista de claims** só consultam; o administrador técnico não acessa janelas. Tudo é conferido no servidor, também em chamada direta à API.

1. **Liberar o material** (detalhe do palete → *Liberação para expedição*): conferência e recuperação de claim **não** liberam. *Liberar* acrescenta uma quantidade à parte liberada daquele material (palete × produto × lote × origem × condição), com critério, fonte e motivo; liberar uma linha não libera o palete misto. *Revogar* reduz (nunca abaixo do reservado). *Bloquear/Desbloquear* (material ou **palete inteiro**, que vale também para o que chegar depois) exige motivo. O palete aparece como "Liberado" só quando reconciliado e com todo o saldo liberado. Material transferido chega **pendente** de liberação ao destino; vindo de palete/linha bloqueada, chega **bloqueado**. Histórico em *Histórico de liberação e bloqueios*.
2. **Cadastrar a janela** (menu da conta → **Janelas de devolução** → *Nova janela*): nome, mês de referência, intervalo de saída autorizado e prazo de preparação (horário de Brasília; gravados em UTC), restrições (métrica, unidade em quantidade, base bruto/líquido no peso, limite: **vazio = pendente**, nunca ilimitado; **0 = sem capacidade**), critérios (condições aceitas, tipos de origem, lote/origem exigidos, documentos exigidos) e o registro da autorização (fonte, referência — texto, zeros preservados —, data, responsável). Rascunho aceita pendências; **Confirmar** exige a autorização e o intervalo. A quantidade de janelas por mês é a cadastrada: nada é criado, datado ou distribuído automaticamente.
3. **Alterar** uma janela confirmada: mudar limite, período ou critérios exige justificativa e fonte e cria nova **versão das regras**; reservas e saídas anteriores mantêm a fotografia. Reduzir abaixo de reservado ativo + expedido é recusado até as reservas serem tratadas.
4. **Material** (aba *Material elegível e pendente*): a fila **elegível** mostra, por palete × material, saldo físico, liberado, reservado (todas as janelas), vinculado a claim e **disponível** = liberado − reservado (sem a parte vinculada), em **FIFO pela primeira entrada física validada** (data documental à parte; sem data, no fim). A fila de **pendências** mostra bloqueios, conferência pendente/em andamento, critério da janela não atendido, parte não liberada e parte vinculada a claim — com motivo, quem registrou e próximo passo.
5. **Reservar**: marque linhas e quantidades; se a janela limita caixas, peso ou volume, informe a medida de cada unidade de carga (o palete físico) e a fonte. *Revisar medidas e capacidade* consulta o servidor: por métrica, limite, reservado, expedido, restante, quanto esta reserva usa e a base (fator/fonte); **todas as restrições precisam caber**; medida desconhecida fica pendente; unidade diferente não é convertida por suposição; paletes contam unidades físicas distintas. *Confirmar reserva* revalida tudo numa transação (integral ou nada). A reserva **não baixa estoque**.
6. **Preparação** (`/reservas/<ID>`): lista com palete, endereço atual × endereço na reserva, produto, lote, origem, quantidade, condição, medidas e impedimentos atuais; *Imprimir*, *CSV* e o código do palete abre o **mapa** com a faixa **Voltar à preparação**. *Registrar separação/preparação* (responsável, data/hora, quantidades separadas; medidas novas revalidam a capacidade): diferença fica registrada para recontagem ou correção da reserva — o saldo não é ajustado.
7. **Confirmar expedição** (supervisor): data/hora da saída (dentro do intervalo autorizado; nunca no futuro), responsável, quantidade enviada por linha, medidas reais, documentos exigidos (referência ou anexo privado da janela) e, se o palete inteiro saiu, *O palete físico inteiro sai* (só aceito sem saldo restante; libera a posição). Enviar menos que o reservado mostra **"quantidade enviada e restante a liberar"** e exige confirmação: a parte enviada sai do saldo (evento de estoque **EXPEDICAO**, uma vez por palete) e o restante é liberado; a reserva fica *Consumida · conclusão parcial*. Exemplo: saldo 12, reserva 8, saída 6 → saldo 6, reservado 0, expedido 6, restante da janela 14 (limite 20). Repetir a confirmação (mesma ou outra chave, ou depois de perder a resposta) nunca gera segunda baixa.
8. **Cancelar reserva** antes da saída (motivo): estoque disponível e capacidade voltam; a reserva fica no histórico; repetir não libera de novo. **Encerrar/cancelar a janela** com reservas ativas exige liberá-las explicitamente na mesma operação; janela com expedição não é cancelada (é encerrada).
9. **Expedição concluída** (`/expedicoes/<ID>`): não há botão de desfazer; *Corrigir informação* (observações/documentos) gera nova versão com motivo, sem efeito físico. *Registrar retorno físico*: **aviso documental** não repõe saldo; **recebimento físico** (com evidência anexada) limita-se ao enviado − já retornado e vira declaração no palete que recebeu (cadastrado, não conferido e sem saldo), preservando produto, lote e origem; a entrada no estoque acontece pela **conferência e reconciliação** desse palete. A capacidade da janela original não volta; a saída original continua.

Anexos das janelas (autorização, documentos, evidência de retorno) são privados, PDF ou foto, com o mesmo limite de `CLAIMS_ANEXO_MAX_MB`. Exportações (`/janelas/exportar` e a lista de preparação) seguem os mesmos filtros e protegem células contra fórmulas.

Demonstração com dados fictícios: `npm run capturas` refaz, na praça de demonstração, a liberação de um palete → o cadastro e a confirmação de uma janela autorizada (limite fictício de 20 UN e 3 paletes; outras três janelas do mês, uma com dados pendentes) → material elegível e pendente → reserva de 8 → lista de preparação e palete no mapa → outra reserva que passaria do restante (recusada) → saída de 6 com 2 liberados → baixa única e restante 14 → uma reserva cancelada antes da saída → um retorno físico ligado à expedição original → histórico, no computador e no celular (capturas em `docs/capturas/etapa-08/`). Todas as autorizações, datas, documentos e medidas são fictícios.

## Fluxo da etapa 09: abrir pelo ícone → ler o QR → conferir pela câmera → falha de rede sem duplicar → atualizar → restaurar

**Instalar** (menu da conta → **Aplicativo e aparelho**, ou na tela de login *Instalar o aplicativo e ver este aparelho*). O botão **Instalar aplicativo** só aparece quando o navegador oferece a instalação (Chrome/Edge no computador e no Android); nos demais casos a página mostra as instruções do navegador: iPhone/iPad (Safari) → *Compartilhar → Adicionar à Tela de Início*; Android (Chrome, Edge, Samsung Internet) → menu ⋮ → *Instalar aplicativo*; Firefox no computador não instala (use pelo navegador, com todas as funções). Instalar só abre a interface no aparelho: dados, login e confirmações continuam no servidor. A página mostra também origem segura, câmera, versões (interface, servidor e contrato), política de rascunho e conexão — útil para registrar a matriz de equipamentos.

**Origem segura.** Câmera, instalação e service worker exigem **HTTPS** (ou `localhost`/`127.0.0.1` no próprio computador, exceção de desenvolvimento). Um celular que abre `http://<IP do computador>:3000` **não** está em origem segura: a câmera aparece como indisponível e a instalação não é oferecida; use o leitor-teclado ou digite. Para testar em aparelhos pela rede é preciso um endereço HTTPS válido do ambiente do piloto (pendente; `docs/IMPLANTACAO.md`). **Caminho-base**: com `CAMINHO_BASE=/praca/` no build e no servidor (mesmo valor; o proxy repassa o caminho completo), a interface, a API (`/praca/api/v1`), o service worker, o manifest e os links do QR ficam sob `/praca/`; o servidor recusa iniciar se o build for de outro caminho-base. No Git Bash do Windows, use `MSYS_NO_PATHCONV=1` antes de `CAMINHO_BASE=/praca/` (ou o PowerShell), senão o shell converte o caminho.

**Ler código (câmera).** Botão *Ler código (câmera)* na lista de paletes do mapa e no painel de entrada da conferência; a câmera só abre depois do toque, pede **somente vídeo** e prefere a traseira. A decodificação é no aparelho: `BarcodeDetector` do navegador quando aceita todos os formatos pedidos; senão, o decodificador local ZXing-C++ em WebAssembly (pacote `barcode-detector` 3.2.2 / `zxing-wasm` 3.1.3), servido pela própria instalação — nenhuma imagem sai do aparelho. Formatos: QR (palete) e EAN-13/8, UPC-A/E, Code 128, Code 39, ITF e DataMatrix (produtos). Cada leitura **mostra um resultado e pausa**: nada novo é lido até *Ler próximo*, *Usar* ou *Fechar* (quadros repetidos não somam). No mapa: QR deste sistema → *Abrir palete* (a API confere sessão e escopo); link de palete de outro endereço só abre por toque; endereço externo, outro esquema ou texto qualquer aparece só como texto (nada é aberto); código de produto mostra SKU, embalagem e fator (*fator desconhecido: conversão bloqueada*); código desconhecido não cria produto; sem acesso à API fica *pendente de consulta*. Na conferência, *Usar este código* passa o código para o painel, que confirma produto, unidade e quantidade antes de somar (*Somar 1 UN de …* quando é o mesmo item confirmado — um toque, uma soma); QR de palete não vale como produto. Valores são texto: zeros à esquerda preservados. Permissão recusada, câmera ausente/ocupada, origem insegura e navegador sem recurso têm mensagem própria e *Fechar e digitar o código*. Fechar, sair da tela ou esconder a aba **libera a câmera**; uma permissão concedida depois do cancelamento é liberada na hora. O leitor que digita como teclado continua igual.

**Estados de conexão** (selo no topo): *Servidor disponível*, *Sem conexão* (aparelho sem rede: nada é enviado), *Servidor sem resposta*, *Servidor indisponível*, *Banco indisponível*; *Sessão expirada* volta ao login com aviso. A faixa vermelha diz quando os dados exibidos são da última consulta. Confirmações críticas (reconciliar, mover, transferir, validar recuperação/regularização, reservar, expedir) exigem o servidor; não há fila automática de gravações.

**Resposta perdida ≠ recusa.** Se o pedido saiu e a resposta não voltou (rede, proxy, erro 5xx), aparece o painel **Em confirmação**: a interface consulta o resultado autenticado pela chave (`GET /api/v1/operacoes/<chave>`, somente leitura) e mostra *confirmada pelo servidor* (os dados são relidos), *não registrada* (depois do tempo-limite das transações, ~2 min 20 s) ou *recusada*; *Repetir (mesma chave)* reenvia o mesmo pedido, que nunca grava duas vezes. Enquanto um pedido ao mesmo registro estiver em confirmação, outro pedido diferente para ele é **bloqueado sem envio** (*Pedido anterior em confirmação*). Entradas da conferência têm o mesmo tratamento na própria tela (*em confirmação* → *Verificar no servidor*).

**Rascunho não enviado.** O rascunho oficial continua no servidor (cada entrada é gravada na hora). O que não chegou fica na **memória da aplicação** (sobrevive à sessão expirada do mesmo usuário) e, só quando a política permite (`PERSISTENCIA_LOCAL`: **sempre desativada em produção**; ativada em desenvolvimento/teste com dados fictícios), também no `sessionStorage` da aba, por usuário, unidade/cliente e conferência, com versão, data e o rótulo **"não enviado"** — nunca token, senha ou arquivo. Ao reconectar, o rascunho é relido; se mudou (outra pessoa registrou), a tela mostra a divergência e só permite reenviar depois de *Revisei*. Trocar de usuário não mostra nem envia o anterior; trocar de escopo guarda os itens para o escopo de origem; **Sair** avisa quando há algo não enviado (nesta e em outras abas) e descarta tudo do navegador.

**Atualização controlada.** Uma versão nova publicada aparece como *Nova versão disponível · Atualizar*; nada é ativado sozinho. *Atualizar* é adiado (com o motivo) enquanto houver confirmação aguardando resposta, operação em confirmação ou entrada só na memória; contagem aberta com rascunho salvo só pede confirmação, e a página volta ao mesmo endereço. Outra aba aberta é avisada (*Outra aba ativou a nova versão*) e **não recarrega sozinha**. Interface e API trocam o número do contrato (`x-praca-contrato`): com versão incompatível, a tela mostra *Versão incompatível com o servidor* e **não envia gravações** (o servidor também recusa com 409 `VERSAO_INCOMPATIVEL`); entrar e sair continuam possíveis. O service worker guarda só a casca da interface (e o decodificador da câmera); respostas da API, downloads e anexos nunca entram no cache, e a API nunca recebe o `index.html` como resposta. Sem conexão, a abertura mostra *Sem conexão* sem dados e sem login.

**Fotos na conferência.** Seção *Fotos e documentos*: *Tirar foto* (câmera do aparelho pelo seletor) ou *Escolher arquivo* (JPEG, PNG, WebP ou PDF até `CLAIMS_ANEXO_MAX_MB`, no máximo 20 por conferência, só durante a contagem). Privados, tipo conferido pelo conteúdo, SHA-256 conferido também pelo banco, imutáveis, download autenticado e auditado. Sem conexão o arquivo não é enviado; falha ou cancelamento não aparecem como anexo.

**Backup e restauração** (responsável técnico; não há botão na interface). Backup coerente do banco **com os anexos** (que ficam no próprio PostgreSQL) num único snapshot, mais a configuração não secreta:

```bash
npm run backup:criar
```

Opções: `--origem=<VARIÁVEL>` (nome da variável com a URL; padrão `DATABASE_URL`), `--destino=<pasta>` (padrão `.dados/backups`; recusa a área versionada do repositório) e `--metodo=pg_dump` (usa o `pg_dump` oficial no mesmo snapshot quando `PG_BIN` ou o `PATH` têm as ferramentas cliente; **não ensaiado neste computador**, que não tem essas ferramentas). Restauração **só em banco novo**, com nome contendo `restauracao` ou `ensaio`, diferente dos bancos configurados:

```bash
npm run backup:restaurar -- --backup=.dados/backups/<pasta> --destino=praca_reversa_restauracao_AAAAMMDD
```

A restauração confere os hashes antes de qualquer alteração, exige as mesmas migrações do código, cria o banco, carrega, compara contagem e conteúdo de cada tabela, relações, anexos (hash e vínculo) e regras de estoque/expedição, revoga as sessões antigas e grava o relatório (`--relatorio=<arquivo>`). Falha → código de saída ≠ 0 e o banco novo é removido (`--manter-em-falha` para análise). Procedimento, responsáveis e pendências em `docs/IMPLANTACAO.md`.

Demonstração com dados fictícios: `npm run capturas` refaz também a demonstração da etapa 09 na praça de demonstração (`docs/capturas/etapa-09/`): instalação e aparelho → QR do palete pela câmera (simulada) → caixa com fator → conferência pela câmera com unidade explícita → leitura sem conexão "não enviada" → resposta perdida "em confirmação", verificada pela chave sem somar de novo → foto na conferência → nova versão adiada e depois aplicada na mesma conferência → abertura sem conexão; e câmera e "Aplicativo e aparelho" no celular. O ensaio de backup/restauração com comparação é o teste `apps/api/test/banco/recuperacao-backup.test.ts` (roda no `npm test`); o ensaio com volume fictício (cópia da base de desenvolvimento + fotos e eventos fictícios, bancos de ensaio removidos no fim) é `node scripts/recuperacao/ensaio-volume.mjs [--anexos=300] [--anexo-kb=1024] [--eventos=200000]`.

## Complemento: inventário conferido → seleção do cliente → conciliação → pendências → proposta → reserva

Menu da conta → **Seleção do cliente** (consulta: supervisor, operador e analista de claims; importar, resolver e reservar: supervisor de estoque). Importar e conciliar **não reservam, não liberam e não alteram estoque**.

1. **Inventário de referência** (*Importar inventário conferido*, tipo "Inventário conferido" na importação): escolha o arquivo **definitivo**, a aba de dados (abas de resumo e ocultas não entram) e a linha do cabeçalho; confira as colunas sugeridas (DELIVERY, TIPO, NUMERO, VOLUMES, RUA, N° Pallet, DOCUMENTAÇÃO, PALLET FULL…; demais colunas ficam guardadas). Informe a versão, a referência/data/fonte da conferência, se o **N° Pallet** identifica o palete ou numera a posição, a cor de fonte da RUA que significa **endereço livre** (as cores encontradas aparecem com a contagem) e a definição de cada tipo documental (ex.: `DEV` → origem DEVOLUCAO). A prévia mostra por linha a ação — *vincular*, *criar cadastro proposto*, *atualizar informação*, *já importado*, *referência histórica / endereço livre*, *requer resolução* —, a posição visual (pela tabela de endereços **confirmada**; sem ela, "pendente") e o resumo. Na confirmação, o conjunto aplicável é explícito (pode deixar linhas de fora); o restante fica registrado como não aplicado e pode ser reapresentado (*Reapresentar pendências corrigidas de*). Volumes ficam como volumes (nunca peças nem saldo validado). Em *Inventários de referência*: fotografia, linhas aplicadas/pendentes/históricas e **Reconhecer conferência externa** (evidência separada; não muda saldo).
2. **Importar seleção**: lista já selecionada ou inventário com marcação (valores que significam seleção, ex.: SIM); pedido e versão; inventário de referência; significado da coluna NF; NF sem quantidade (pendente ou "todo o material da NF que constava no inventário"); linhas repetidas (agrupar sem somar ou manter). NF sem alocação é pendência, não erro. Uma lista corrigida entra como **versão substitutiva** (diferenças e reservas a revisar; nada é cancelado).
3. **Conciliação** (*Ver a conciliação da seleção*): resumo com linhas, documentos resolvidos e paletes distintos (não se somam), filtros (localizados, sem palete, sem endereço, não encontrados, ambíguos, divergência de quantidade, restrições, histórico/pendente) e tabela com NF/devolução, produto, quantidade, paletes e endereços atuais (≠ informado quando mudou), bases e próximo passo. O número da linha abre o **detalhe**: todos os paletes, alocação informada × atual, documentos, material validado/reservado/liberado/disponível, restrições, saídas anteriores, conflitos de demanda e **Resolver a identificação** (só os candidatos mostrados, com motivo; anulável). O mapa da seleção destaca as posições conhecidas das linhas marcadas (ou da linha aberta); *Ver no mapa* centraliza cada palete. No celular a tabela vira cartões.
4. **Exportar (CSV)**: *Lista de separação (proposta, por palete/endereço)*, *Relatório de pendências* e *Conciliação completa*, com horário, inventário, versão da seleção e filtros.
5. **Preparar para a janela**: marque as linhas elegíveis, escolha a janela confirmada, *Montar proposta (nada é gravado)* — mostra o que entra, o que fica de fora e a verificação da janela (critérios, liberação, disponível, capacidade) —, revise e *Confirmar reserva* (tudo ou nada pelo fluxo da etapa 08; registros mudados depois da revisão exigem nova proposta). A reserva abre a lista de preparação da etapa 08.

**Busca por NF**: o painel de busca tem a base *Vínculo informado no inventário (NF × palete)*, que mostra todas as alocações da NF (com inventário, linha, endereço informado e volumes) e as destaca no mapa. O detalhe do palete mostra **Notas do palete**: para cada NF, NFD, remetente, cidade destino (editável, vale para a NF em todos os paletes), volumes (pendente = desconhecido, não é saldo), palete full (full/misto/não informado, calculado dos vínculos atuais), mesma NFD em mais de um palete (paletes declarados, outros locais atuais e referências fora da praça) e produto na caixa (descrição livre editável, com descrições por caixa/grupo); fonte e linha ficam em *Origem*. Palete sem posição mostra no cabeçalho o endereço informado e "Posição no mapa pendente"; a lista agrupa esses paletes pela fileira do endereço e o filtro aceita o endereço (`15 - A120`).

**Carga do inventário em lote** (pacote preparado `praca-reversa.importacao-inventario.v1`, ZIP com `dados-importacao.json` ou o JSON): comando local, sem rota HTTP. Sem `--executar` só lê, confere e mostra o resumo e as pendências; com `--executar` grava tudo numa transação (integral ou nada). Escopo de demonstração é recusado e nenhum escopo é escolhido por suposição; o usuário precisa poder importar inventário no escopo (supervisor de estoque). O reenvio do mesmo pacote não grava de novo; uma versão nova usa `--substitui <INV anterior>` — a prévia mostra os vínculos do anterior mantidos, atualizados e encerrados e os endereços que saíram (e avisa quando há inventário ativo e a substituição não foi indicada); paletes dos endereços são reaproveitados de qualquer versão e vínculos mantidos passam a citar a linha da planilha atual. Linhas sem RUA (`linhas_sem_endereco`, opcional) ficam pendentes, sem palete nem posição ("Sem alocação / endereço não informado" no inventário; base *Origem do inventário sem alocação* na busca). Números compostos (listas por vírgula) são conservados inteiros, até 200 caracteres. O relatório (dados reais) vai para `.dados/cargas/`, fora do versionamento.

```bash
npm run inventario:carregar -- --arquivo "<pacote.zip>" --unidade <UNIDADE> --cliente <CLIENTE> --usuario <supervisor>
```

```bash
npm run inventario:carregar -- --arquivo "<pacote.zip>" --unidade <UNIDADE> --cliente <CLIENTE> --usuario <supervisor> --executar
```

**Inventário L'Oréal preparado** (formato "1.0", ZIP com `dados/inventario-preparado.json` + `pendencias.json` + `inventario-origem.json`, ou o `inventario-preparado.json` com os irmãos na mesma pasta): o comando converte para o pacote v1 e segue o mesmo caminho. Linhas com bloqueio ficam "em revisão" (sem palete nem vínculo; lista agrupada por causa → endereço/N° Pallet na tela do inventário e na busca). Base provisória aparece como **Inventário em validação**. Para um arquivo novo do mesmo inventário (conferência concluída), rode a prévia com `--substitui <INV ativo>` e, enquanto a conferência não terminar, `--manter-ausentes` (o que não consta continua ativo e marcado "não consta do inventário atual"; nada é encerrado). `--alocar-revisao <causa,…> --decisao "<texto>"` leva ao palete do endereço as linhas em revisão dessas causas (endereço válido) e marca o palete com "Reconferência necessária" até a reconferência completa; `--corrigir-endereco "<lido>=<correto>"` lê um endereço da planilha como outro (o texto original fica guardado). Decisões D274–D282.

```bash
npm run inventario:carregar -- --arquivo "<INVENTARIO-LOREAL….zip>" --unidade PRACA-REVERSA --cliente LOREAL --usuario <supervisor> --substitui <INV ativo> --manter-ausentes
```

Palete identificado pelo **N° Pallet** (21 out. 2026): o N° Pallet único do endereço é o número operacional — o palete com esse número (ou o ainda sem número ligado a ele, que passa a usá-lo) recebe as notas; sem palete, um novo é cadastrado com esse número. Sem número único (vazio, dois números no endereço ou o número em dois endereços), vale o endereço, com código `PR-…` gerado. A carga não desfaz o que foi feito no aplicativo: palete movido fica onde está (aviso de endereço divergente), posição com outro palete numerado → o novo entra sem posição (registre a saída do outro e reenvie), nota movida continua no palete para onde foi levada, nota em validação ou cancelada não é recriada. Endereço livre não cria palete (as NFs dele ficam como referência fora da praça). A posição no mapa só é registrada pela tabela de endereços **confirmada** (Layout da praça → Endereços reais); depois de confirmar sequências, rodar a carga de novo registra as posições que passaram a resolver.

**Endereços reais** (Layout da praça → *Endereços reais*): blocos FB01–FB07 = Fileiras 11–16/GR (*Aplicar nomes operacionais*), estado de cada faixa, *Informar a sequência* (códigos locais na ordem, sentido e fonte) → proposta → *Confirmar*. O endereço é fileira/GR + código (`15 - A120` ≠ `13 - A120`). Detalhes e o que falta em `docs/LAYOUT-PRACA.md` e `docs/DESCOBERTA.md`.

Demonstração com dados fictícios: `npx playwright test e2e/selecao.spec.ts --grep @captura` (depois de `npm run build`) grava `docs/capturas/selecao-cliente/`: inventário (parâmetros, prévia, conjunto aplicado, fotografia) → seleção → resultados com uma NF localizada (palete de demonstração com saldo liberado), uma NF em dois paletes e uma sem vínculo → detalhe e mapa → filtro de pendências → proposta → reserva → lista de preparação.

## Mapa da praça: menu, espaço e janela do palete (etapas 2 e 3, out. 2026)

- **Menu lateral**: compacto (ícones, padrão) ou expandido pelo botão no topo do menu; a escolha fica neste navegador. Mapa, Inventário, Recebimento, Agendas e Painel à vista; as demais páginas em **Mais**. No celular, as páginas ficam no menu da conta.
- **Mapa na largura toda**: a coluna de lista/filtros à esquerda está **desativada** por `mostrarListaPaletesNoMapa = false` em `apps/web/src/features/mapa/configuracao.ts` (para reativar: `true`, `npm run build` e reiniciar o servidor). Pesquisa no cabeçalho (Enter com o link do QR abre o palete), **Ler QR** e **Filtrar** (código/posição, conferência, "Precisam de reconferência", etiquetas do resultado) ficam no canto do mapa; posições livres abrem no indicador. No celular a lista continua na aba "Lista".
- **Vista inicial na L'Oréal** (20 out. 2026): ao abrir, o mapa enquadra a área principal da L'Oréal (a zona de baixo, com as posições vazias) no maior zoom que cabe entre os controles, com o endereço em cada posição (curto, "A120", quando a posição é estreita). **Focar L'Oréal** (ou Home) volta a esse enquadramento; **Ver praça completa** mostra também as posições superiores. Abrir/fechar a janela do palete ou recolher o menu não muda o zoom; link, QR e busca localizam o palete onde ele estiver. Decisões D264–D266; detalhes em `docs/MAPA-ZOOM.md`.
- **Janela do palete**: clicar num palete (ou abrir pelo QR/busca) abre uma janela sobre o mapa com o número, o endereço, os volumes (com a base), notas/minutas e a tabela Tipo | Número | Remetente | CNPJ | Volumes (50 por página); "Informações adicionais" e "Detalhes completos e outras ações" ficam recolhidos. Fechar (botão, Esc ou clique fora) mantém mapa, pesquisa e seleção. Decisões D253–D258.

## Painéis em uma tela (etapa 4, out. 2026)

`/painel` (operação) e `/painel/cliente` cabem numa tela no computador (1366×768, 1280×720, 1920×1080; menu compacto ou expandido; claro ou escuro): linha de filtros (janela, período, **Atualizar**), quatro cartões (operação: Paletes na praça, Volumes registrados, Sem endereço, Precisa conferir; cliente: Paletes, Volumes registrados, Solicitado, Expedido), janela selecionada (Solicitado, Separado, Expedido, Falta separar, Falta expedir, barras de preparação e expedição só com meta), situação da praça (cliente: etapas da seleção), volumes por rua e prioridades (cliente: histórico recente). Cartões abrem a lista com o mesmo filtro e total; **Detalhes**, **Comparar**, **Tabela** e **Ver todas** abrem em janela; a consulta completa do cliente fica em **Estoque e histórico**. Mesmos números da API; decisões D259–D263, definições em `docs/INDICADORES.md`.

## Indicadores em dashboard (22 out. 2026)

`/indicadores` usa toda a largura ao lado do menu (compacto ou expandido; no celular, uma coluna com rolagem vertical): cabeçalho com escopo, período aplicado e horário da consulta, filtro De/até, **Atualizar**, **Imprimir** e **Sobre os números** (base de posições, período e fuso, regras de leitura e indicadores sem base). Visão geral com quatro indicadores (paletes na praça, posições livres com "Base provisória", não conferidos, mudanças de localização no período), uso das posições (ocupadas × livres da mesma base), conferência por estado, movimentação, estoque e idade e pontos de atenção; detalhes em abas (`?aba=movimentacoes|conferencias|estoque|claims`, período preservado). Mesmos números da API, sem curva ou percentual inventado; a impressão leva todas as abas e a metodologia. Decisões D297–D303; definições em `docs/INDICADORES.md` ("Apresentação em dashboard"); capturas em `docs/capturas/indicadores-dashboard/`.

## Palete livre (onde guardar o próximo palete)

No mapa, verde = **PALETE LIVRE**: posição cuja desocupação foi confirmada. Clique numa posição sem palete para ver o detalhe; quem estiver no local marca "Conferi no local: a posição está vazia" e usa **Registrar como palete livre**. Mover, expedir ou retirar um palete vazio já marca a posição de origem como livre; registrar um palete na posição desfaz a marcação. "Sem palete registrado" não é livre (pode haver palete sem endereço). Com nada selecionado, o painel da direita lista as posições livres.

## Importar bipagem "Etiquetas" (um palete por arquivo)

**Recebimento → Importar a bipagem e escolher a posição no mapa** (`/bipagem`), ou, num palete aberto, **Importar bipagem** (`/paletes/<id>/bipagem`, destino = esse palete). Operador e supervisor de estoque.

1. **Arquivo**: o Excel exportado da bipagem (planilha "Etiquetas", .xlsx; .csv também) → **Ler arquivo**. O servidor reconhece pelo nome **Tipo, Número, Lidos e Remetente** (e **CNPJ Remetente** e **Última Leitura**, se houver); Status, Baixa indevida, Série, Leituras, Destino, Posicao, Area e outras não entram em regra. Faltando uma coluna obrigatória, a mensagem diz qual e pede para exportar de novo no padrão (sem mapeador).
2. **Prévia** (nada gravado): notas a importar, volumes e total; linhas sem volumes (Lidos = 0) e pendências (linhas com erro, que impedem a importação) à parte; CNPJ e Última Leitura em "Mais informações".
3. **Onde está este palete?**: no mapa, posição vazia = **palete novo** (número da série do piso, gerado só na confirmação); palete = **acrescentar** ("Este palete já contém notas…", com o que ele já tem e o que vai receber). Também dá para procurar o palete pelo número.
4. **Revisar e confirmar**: nota repetida no palete ou no próprio arquivo (mesmo tipo, número, CNPJ e remetente; ou identificação incompleta) pede **Revalidar** (não entra; nada muda) ou **Importar separadamente** (nova entrada; as duas contam). Arquivo já importado antes pede "É uma nova operação". Depois de gravar, aparece o número definitivo do palete.

Nada é somado, fundido ou substituído; erro, só zeros ou cancelamento não criam palete; confirmação repetida não duplica; posição ocupada por outra pessoa entre a prévia e a confirmação refaz a prévia. Revalidar não é conferência e não reinicia os 20 dias. Contrato em `docs/IMPORTACAO-BIPAGEM.md` (D283–D288). Leitor em TypeScript no servidor (o leitor Python de referência foi reescrito e seus 11 casos de teste portados): **não precisa de Python** no computador, no servidor nem na hospedagem.

**Numeração dos paletes novos** (série do piso, sem prefixo): o próximo número parte do último informado pela operação e pula faixas reservadas e números já usados (palete ou N° Pallet da planilha). Ver ou definir:

```bash
npm run paletes:numeracao -- --unidade PRACA-REVERSA --cliente LOREAL --usuario <supervisor> --ultimo 278 --reservar 1000-1015
```

(sem `--executar` só mostra; com `--executar` grava e registra na auditoria.) Demonstração com dados fictícios (depois de `npm run build`): `PLAYWRIGHT_CANAL=chrome npx playwright test e2e/bipagem.spec.ts --grep @captura` grava `docs/capturas/bipagem-etiquetas/`.

## Conferência em tabela, correção de conteúdos e validação sem endereço (21 out. 2026)

- **Conferir volumes** (janela do palete no mapa): uma tabela com todos os conteúdos — atual (referência) e contado. **Confirmar todos sem diferença** (com a declaração "Conferi fisicamente todos os …"), **Concluir com as diferenças** (só o que mudou vira contagem nova: 130 → 126 grava 126 e guarda −4) ou **Só parte** (não renova o prazo). Fecha só depois de gravar, mostra o resultado e atualiza estado e cor do palete no mapa (Não conferido, Parcial, Conferido, Com diferença).
- **Corrigir conteúdos** (supervisor ou administrador): na janela do palete, selecione um, vários ou todos e escolha **Mover** (destino no mapa; palete com conteúdo pede confirmação; posição vazia cria palete pela série do piso), **Enviar para validação** (motivo) ou **Cancelar registro incorreto** (motivo + confirmação). Histórico com autor, data e motivo.
- **Validação urgente — sem endereço** (`/validacao`, cartão vermelho ao lado dos indicadores; operador, supervisor e administrador): conteúdos sem local conhecido, com último palete (histórico), origem e histórico real; resolva várias de uma vez escolhendo o destino no mapa. O cliente não vê.
- **Número do palete**: o código passa a ser o N° Pallet da operação ("Palete 256"); o PR-… antigo continua pesquisável ("antes PR-000001") e a etiqueta QR continua valendo (link pelo ID).

Correção dos dados já cadastrados (simula por padrão; faça backup antes de `--executar`):

```bash
npm run paletes:corrigir -- --unidade PRACA-REVERSA --cliente LOREAL --usuario <supervisor>
```

Contrato em `docs/CORRECAO-PALETES-CONFERENCIA.md` (D289–D295).

## Seleção cliente — teste (simulação do cliente, out. 2026)

Área para o **responsável interno** simular o cliente consultando o estoque e montando uma solicitação para uma agenda de saída. **Ambiente de teste — não movimenta estoque**: o estoque real é só lido; carrinho, solicitações, versões, pedidos de alteração e respostas ficam em tabelas próprias (`selecao_teste_*`), sem baixa, reserva, mudança em paletes/notas/endereços/conferências/agendas reais nem disparo da planilha única.

- **Acesso**: menu da conta → **Seleção cliente — teste**. Só aparece para quem recebeu a concessão em **Administração de acesso** → "Liberar Seleção cliente — teste" (supervisor de estoque ou administrador). Desligar a funcionalidade inteira: `SELECAO_CLIENTE_TESTE=desativada` no `.env` e reiniciar.
- **Consultar e escolher** (`/selecao-teste`): agenda de referência (janela existente, só como referência, ou agenda própria do teste), lista pesquisável por palete, tipo e número da nota, remetente e Delivery; **Ver mapa** abre o mapa em consulta. Abrir um palete: **Selecionar palete inteiro** ou **Escolher notas deste palete**, quantidade (até o informado), Delivery pedida e observação por nota, prévia exata e **Adicionar à seleção**.
- **Revisar o carrinho** (`/selecao-teste/solicitacoes/<id>`): ajustar quantidades, Deliveries e observações; total só dos itens com quantidade definida; itens sem quantidade (Delivery não discriminada, nota sem volume) ficam "em análise" e fora do total. **Conferir e enviar** compara com o estoque atual: se algo mudou, mostra antes/agora e pede revisão (nada é trocado sozinho).
- **Enviar e acompanhar** (`/selecao-teste/solicitacoes`): enviada, a solicitação fica bloqueada (também no servidor); **Solicitar alteração** com explicação; o responsável aprova ou recusa com resposta; aprovada, a revisão gera uma nova versão e a enviada fica guardada. Solicitação adicional para a mesma agenda com número próprio, com aviso quando o mesmo conteúdo já está em outro pedido.

Decisões D267–D273; testes em `apps/api/test/banco/selecao-teste.test.ts`. O importador da planilha do cliente (seleção importada) **não mudou**: o ajuste do leitor aguarda o arquivo real.

## Planilha única e proteção dos dados

Com `npm start`, o servidor gera `Praca-Reversa-<unidade>-<cliente>.xlsx` (abas Inventário, Movimentações e Proteção e ajuda) depois das alterações confirmadas e a cada reconciliação. Sem `PLANILHA_DESTINO` a cópia fica só no servidor (`.dados/planilha/`) e a tela **Planilha e proteção** (menu da conta) mostra "Não configurado"; com uma pasta sincronizada do SharePoint/OneDrive ou compartilhamento fora do servidor, publica o arquivo atual e guarda versões anteriores. Backup verificado: `npm run backup:rotina`; teste de restauração isolado (dados fictícios): `npm run backup:teste-restauracao`; exemplo fictício: `npm run planilha:exemplo`. Ativação e agendamento em `docs/IMPLANTACAO.md`.

## Variáveis de ambiente

Ver `.env.example` (sem segredos). Principais: `APP_AMBIENTE` (`desenvolvimento`, `teste` ou `producao`; padrão `producao`), `DATABASE_URL`, `DATABASE_URL_TESTE`, `DATABASE_URL_E2E`, `APP_SEGREDO` (≥ 32 caracteres; usado no hash de idempotência), `COOKIE_SEGURO` (padrão `true` em produção; `false` no `.env` local porque o desenvolvimento é em http), `APP_URL_PUBLICA` (endereço usado no QR das etiquetas; obrigatório em produção; padrão local `http://127.0.0.1:5173` no `npm run dev` e `http://127.0.0.1:<PORT>` no `npm start`), `HOST` (`127.0.0.1`), `PORT` (3000), `SESSAO_INATIVIDADE_MINUTOS` (120), `SESSAO_DURACAO_MAXIMA_HORAS` (12). A API registra no início qual endereço de etiquetas está em uso (`urlEtiquetas`).

Limites da importação e da exportação (padrões entre parênteses): `IMPORTACAO_ARQUIVO_MAX_MB` (5), `IMPORTACAO_LINHAS_MAX` (5000 linhas de dados), `IMPORTACAO_COLUNAS_MAX` (50), `IMPORTACAO_CELULA_MAX_CARACTERES` (1000), `IMPORTACAO_DESCOMPACTADO_MAX_MB` (50, soma das partes do XLSX), `IMPORTACAO_ZIP_ENTRADAS_MAX` (300 partes no XLSX), `IMPORTACAO_TEMPO_MAX_S` (20 s de leitura), `BUSCA_EXPORTACAO_MAX_LINHAS` (5000, também para a exportação de claims). Planilhas operacionais (inventário conferido e seleção do cliente, que costumam ter milhares de linhas só formatadas): `IMPORTACAO_PLANILHA_ARQUIVO_MAX_MB` (40), `IMPORTACAO_PLANILHA_DESCOMPACTADO_MAX_MB` (320), `IMPORTACAO_PLANILHA_LINHAS_MAX` (10000 linhas com dados) e `IMPORTACAO_PLANILHA_TEMPO_MAX_S` (120); células vazias só formatadas não contam como linhas. Acima do tamanho, a API responde 413 antes de ler o arquivo; acima dos demais, 400 com a explicação. Claims: `CLAIMS_ORDEM_PADRAO` (`PRIORIDADE`; ou `PRAZO`, `VALOR`, `RECENTES`) e `CLAIMS_ANEXO_MAX_MB` (5, foto ou PDF; vale também para os anexos das janelas e, desde a etapa 09, das conferências). Etapa 09: `CAMINHO_BASE` (`/`; caminho público da instalação, o mesmo no build e no servidor), `PERSISTENCIA_LOCAL` (`ativada`/`desativada`; padrão ativada fora de produção e **sempre desativada em produção** — o servidor recusa iniciar com `ativada` em produção), `WEB_DIST` (pasta do build da interface; relativa à raiz) e `PG_BIN` (pasta das ferramentas cliente do PostgreSQL para `backup:criar --metodo=pg_dump`). A API registra no início o caminho-base, a política de rascunho e a versão. `SELECAO_CLIENTE_TESTE` (`ativada`/`desativada`; padrão ativada; o acesso continua só por concessão explícita).

Desenvolvimento local: cookie de sessão `pr_sessao` HttpOnly, SameSite=Strict, sem Secure (http). Com `COOKIE_SEGURO=true` o nome passa a `__Host-pr_sessao` e exige HTTPS.

## Verificar

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run test:e2e
```

`npm test` roda os testes de unidade e os de banco em PostgreSQL real (`DATABASE_URL_TESTE`, recriado a cada execução); o banco local precisa estar ligado. `npm run test:unidade` roda só os que não usam banco. `npm run test:e2e` gera o build, recria o banco de E2E (migração, seed, um administrador dos escopos de demonstração e outro de um escopo de teste não demonstrativo, ambos pelo próprio `admin:criar` com senha aleatória), cria os demais usuários e o layout do escopo de teste pela API e roda o Playwright nos perfis "computador" e "celular" (Pixel 7 emulado) e, desde a etapa 09, no perfil "caminho-base" (um segundo servidor na porta 4311 com o build em `apps/web/dist-praca` e `CAMINHO_BASE=/praca/`). A câmera é simulada (canvas no lugar do `getUserMedia` e, num teste, o dispositivo falso do Chrome com vídeo Y4M); os códigos são gerados pelo gravador do `zxing-wasm`. Os testes de etiqueta decodificam o QR da captura de tela (`jsqr`) e geram o PDF de impressão. Para usar o Chrome instalado:

```bash
PLAYWRIGHT_CANAL=chrome npm run test:e2e
```

No PowerShell: `$env:PLAYWRIGHT_CANAL='chrome'; npm run test:e2e`. `npm run verify` executa typecheck, lint, test e test:e2e em sequência. `npm run capturas` atualiza `docs/capturas/etapa-08/` e `docs/capturas/etapa-09/` e é também a demonstração passo a passo das janelas/expedição e da etapa 09 com dados fictícios (as capturas das etapas anteriores ficam como registro).

Os testes da importação usam planilhas gravadas pelo próprio Microsoft Excel em `apps/api/test/fixtures/excel/` (dados fictícios). Para regenerá-las é preciso o Excel instalado:

```bash
powershell -ExecutionPolicy Bypass -File scripts/gerar-fixtures-excel.ps1
```

Depois de `npm run build`, **reinicie** um `npm start` que já estava rodando: os arquivos novos de `/assets` só passam a ser servidos depois do reinício.

## Estrutura

| Pasta | Conteúdo |
| --- | --- |
| `apps/web` | Interface React + Vite (PWA): login, rotas (`/paletes/<ID>`, `/paletes/<ID>/{mover,transferir,historico}`, `/conferencias/<ID>`, `/paletes/novo`, `/conteudos/novo` (Registrar conteúdo; os endereços antigos `/produtos` e `/produtos/catalogo` levam a ele), `/paletes/<ID>/volumes`, `/importacoes`, `/importacoes/nova`, `/importacoes/<ID>`, `/claims`, `/claims/novo`, `/claims/<ID>`, `/claims/<ID>/editar`, `/janelas`, `/janelas/nova`, `/janelas/<ID>`, `/janelas/<ID>/editar`, `/reservas/<ID>`, `/expedicoes/<ID>`, `/layout`, `/etiquetas`, `/acesso`, `/aplicativo`, `/ajuda`, `/indicadores`, `/relatorios`, `/selecoes`, `/selecoes/<ID>`, `/inventarios`, `/inventarios/<ID>`, `/painel`, `/painel/estoque`, `/painel/janelas/<ID>`, `/painel/cliente`, `/entrar`; com caminho-base, todas sob ele), mapa Leaflet CRS.Simple, lista, busca no painel lateral (`src/features/busca`), detalhe, cadastros, etiquetas com QR, conferência (`src/features/conferencia`), movimentações (`src/features/movimentos`), importação (`src/features/importacao`), claims (`src/features/claims`), janelas, liberação, reservas e expedição (`src/features/janelas`), seleção do cliente, conciliação e inventários (`src/features/selecao`), painéis da operação e do cliente (`src/features/paineis`), câmera (`src/features/camera`), PWA, atualização, abas e instalação (`src/pwa`), conexão, versão e operações em confirmação (`src/api`). |
| `apps/api` | API Fastify + Prisma 7: `prisma/` (schema e migrações), `src/modules/{acesso,admin,aplicativo,auditoria,busca,claims,conferencia,estoque,etiquetas,idempotencia,importacao,janelas,layout,movimentos,paletes,praca,produtos,saude}` (leitura restrita de CSV/ZIP/XML/XLSX em `importacao/arquivo`), `src/demo` (fixtures), `src/cli` (seed e administrador). |
| `packages/contracts` | Contratos Zod compartilhados: layout e configuração, paletes e cadastro, produtos, conferência e reconciliação, eventos de estoque, movimentações, busca, importação, claims, janelas e expedição, quantidades e valores decimais exatos, etiquetas, códigos, sessão, perfis e permissões, administração, saúde. |
| `e2e` | Testes Playwright. |
| `examples` | Dados fictícios e a configuração central do esquema informado (`layout-praca-informado.json`). |
| `scripts` | `.env` local, PostgreSQL local, preparação do E2E, ícones, planilhas de teste pelo Excel (`gerar-fixtures-excel.ps1`), backup e restauração (`recuperacao/`). |
| `docs`, `prompts` | Especificação, estado, decisões, layout e prompts das etapas. |

Rotas da API (prefixo `/api/v1`, sob o caminho-base quando configurado): `GET /health`, `GET /health/ready`, `GET /versao` (público: versão, contrato, política de rascunho, origem das etiquetas, caminho-base); `GET /operacoes/:chave` (resultado de um pedido com chave de idempotência, só do próprio usuário no escopo ativo); `POST /sessao` (login), `GET /sessao`, `DELETE /sessao` (logout), `PUT /sessao/escopo`; `GET /praca`, `GET /paletes` (filtro com limite), `GET /paletes/:id`, `GET /paletes/:id/escopo`; `POST /paletes`, `PATCH /paletes/:id` (observações), `POST /paletes/:id/arquivar`; `GET|POST /produtos`, `PUT /produtos/:id`, `GET /produtos/identificar?codigo=`; `GET|POST /paletes/:id/conferencias`, `GET|PATCH /conferencias/:id`, `POST /conferencias/:id/observacoes`, `PATCH /conferencias/:id/observacoes/:linhaId`, `POST /conferencias/:id/observacoes/:linhaId/remover`, `POST /conferencias/:id/{concluir,cancelar,recontagem,reconciliar}`, `GET /conferencias/:id/reconciliacao` (prévia), `POST /conferencias/:id/anexos` (`application/octet-stream`), `GET /conferencias/:id/anexos/:aid`; `POST /paletes/:id/movimentos`, `POST /movimentos/:id/correcao`, `POST /transferencias`, `POST /transferencias/:id/correcao`, `GET /paletes/:id/historico`; `GET /busca`, `GET /busca/exportar` (CSV); `POST /importacoes?tipo=` (arquivo em `application/octet-stream`, nome em `X-Arquivo-Nome`), `GET /importacoes`, `GET /importacoes/limites`, `GET /importacoes/modelos/:arquivo`, `GET /importacoes/:id`, `GET /importacoes/:id/estrutura`, `GET /importacoes/:id/linhas`, `PUT /importacoes/:id/mapeamento` (gera a prévia), `POST /importacoes/:id/confirmar`, `POST /importacoes/:id/descartar`, `GET /importacoes/:id/relatorio.csv`; `GET|POST /claims`, `GET /claims/resumo`, `GET /claims/responsaveis`, `GET /claims/exportar` (CSV), `GET|PUT /claims/:id`, `POST /claims/:id/{situacao,encerrar,reabrir}`, `GET /claims/:id/historico`, `GET /claims/:id/linhas/:linhaId/candidatos`, `POST /claims/:id/candidatos`, `POST /claims/:id/candidatos/:cid/{conferencia,descartar}`, `POST /claims/:id/anexos` (`application/octet-stream`), `GET /claims/:id/anexos/:aid`, `POST /claims/:id/evidencias`, `POST /claims/:id/evidencias/:eid/{solicitar-validacao,validar,rejeitar}`, `POST /claims/:id/recuperacoes/:rid/estornar`, `POST /claims/:id/resultados`, `POST /claims/:id/resultados/:rid/anular`; `GET|POST /paletes/:id/liberacao`; `GET /material-expedicao` (filas elegível/pendente); `GET|POST /janelas`, `GET /janelas/responsaveis`, `GET /janelas/exportar` (CSV), `GET|PUT /janelas/:id`, `POST /janelas/:id/{confirmar,encerrar,cancelar}`, `GET /janelas/:id/historico`, `POST /janelas/:id/anexos` (`application/octet-stream`), `GET /janelas/:id/anexos/:aid`, `POST /janelas/:id/reservas/previa`, `POST /janelas/:id/reservas`; `GET /reservas/:id`, `POST /reservas/:id/{cancelar,preparacao,expedicao}`, `GET /reservas/:id/preparacao.csv`; `GET /expedicoes/:id`, `POST /expedicoes/:id/{correcao,retornos}`; `POST /layout`, `POST /layout/blocos`, `PATCH /layout/elementos/:codigo`, `POST /layout/zonas`, `PATCH /layout/posicoes/:id`, `POST /layout/posicoes/:id/retirar`, `GET /layout/historico`; `GET /etiquetas?ids=…`; `GET|POST /admin/usuarios`, `PUT /admin/usuarios/:id/vinculo`, `PATCH /admin/usuarios/:id/conta`, `GET /admin/auditoria`. Tudo exceto saúde, versão e login exige sessão; mutações exigem `X-CSRF-Token` e `Idempotency-Key`; a interface envia `X-Praca-Contrato` e a API recusa gravações de contrato fora da faixa aceita (409 `VERSAO_INCOMPATIVEL`; sem o cabeçalho, como ferramentas e testes de API, segue normalmente); alterações de palete, produto, layout, conferência e movimentação exigem a versão/revisão vista (`expectedVersion`/`expectedRevision`/`expectedPalletVersion`/`expectedSourceVersion`/`expectedDestinationVersion`); a confirmação da importação exige a versão da prévia revisada (`previewVersion`); ações de claim exigem a versão do caso, da evidência, da recuperação ou do resultado (`expectedVersion`); janelas, reservas, expedições e liberação exigem a versão da janela, da reserva, da expedição ou do palete (`expectedVersion`, `expectedWindowVersion`, `expectedPalletVersion` por linha).

## Continuar o desenvolvimento

Use `PROMPT-RETOMADA.md`. A próxima etapa é a 10 (`prompts/10-indicadores-e-piloto.md`): indicadores, relatórios, piloto físico e preparação da implantação.

## Tecnologia

TypeScript estrito; React e Vite na interface; Node.js e Fastify na API; PostgreSQL 17 e Prisma 7 (driver adapter `pg`); QR gerado na interface com `qrcode` 1.5.4; leitura pela câmera com `barcode-detector` 3.2.2 (ponyfill do `BarcodeDetector` sobre `zxing-wasm` 3.1.3, WebAssembly servido pela instalação); PWA com `vite-plugin-pwa` 1.3.0 (Workbox 7); leitura e escrita de CSV/XLSX no servidor sem biblioteca externa (só `node:zlib`; avaliação em `docs/DECISOES.md`, etapa 06). A interface é uma PWA. Versões e motivos em `docs/DECISOES.md`; layout em `docs/LAYOUT-PRACA.md`.

## Documentos

| Arquivo | Finalidade |
| --- | --- |
| `AGENTS.md` | Regras para o agente de programação e preservação das decisões. |
| `docs/ESCOPO.md` | Funcionalidades e limites do projeto. |
| `docs/ARQUITETURA.md` | Tecnologia, organização do código e contratos da API. |
| `docs/DADOS-E-REGRAS.md` | Modelo de dados, estados e regras de estoque. |
| `docs/INTERFACES.md` | Telas, fluxos, acessibilidade e identificação dos paletes. |
| `docs/MAPA-ZOOM.md` | Navegação da praça, coordenadas, níveis de detalhe e validação. |
| `docs/LAYOUT-PRACA.md` | Esquema informado da praça, configuração e pendências de levantamento. |
| `docs/ROADMAP.md` | Dez etapas, dependências e entregas. |
| `docs/VALIDACAO.md` | Testes de operação, permissões, concorrência e instalação. |
| `docs/IMPLANTACAO.md` | Ambiente local, piloto, acesso, backups e entrada em uso. |
| `docs/DESCOBERTA.md` | Perguntas e regras operacionais que ainda precisam ser registradas. |
| `docs/DECISOES.md` | Decisões, versões fixadas e mudanças de direção. |
| `docs/ESTADO.md` | Progresso real, verificações, pendências e próximo passo. |
| `docs/REFERENCIAS.md` | Documentação técnica oficial consultada. |

## Regras centrais

- Cada palete possui um identificador permanente, separado de sua localização.
- Quantidade declarada, quantidade contada e saldo validado são conceitos diferentes.
- Conteúdo não conferido continua desconhecido; uma posição desenhada não comprova ocupação.
- Nenhum claim é encerrado automaticamente por localizar o mesmo SKU.
- O estoque é alterado por operações transacionais com histórico e controle de duplicidade.
- Quatro janelas por mês descrevem o processo informado; datas, capacidades e critérios de aceitação são configuráveis.
- Produto localizado e prejuízo evitado confirmado são indicadores diferentes.

Nome de trabalho: Praça Reversa. A identificação visual (amarelo e vermelho como referência da operação) não representa homologação oficial.
