# Referências técnicas

Documentação consultada em 1 de outubro de 2026. As decisões de arquitetura são recomendações para este projeto; os links sustentam capacidades técnicas, não regras contratuais DHL / L’Oréal.

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html): verificação estática de tipos antes da execução. A validação de dados externos continua necessária.
- [React com TypeScript](https://react.dev/learn/typescript): uso de componentes e contratos tipados na interface.
- [Leaflet: mapas sem coordenadas geográficas](https://leafletjs.com/examples/crs-simple/crs-simple.html): CRS.Simple, coordenadas do layout, imagem de base, limites e enquadramento do mapa.
- [Fastify Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/): validação por schemas definidos pela aplicação. Na implementação, consultar a versão fixada.
- [MDN Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable): manifest e requisitos de instalação; suporte varia por ambiente. Instalação não implica estoque operável sem conexão.
- [Prisma Transactions](https://www.prisma.io/docs/orm/fundamentals/transactions): operação com várias gravações que confirma ou reverte conjuntamente. Verificar a API e o tratamento de isolamento/conflitos da versão adotada.

Etapa 01 (2 de outubro de 2026): versões e compatibilidade conferidas no [registro npm](https://registry.npmjs.org/) (`dist-tags`, `peerDependencies`, `engines`) e no [índice de versões do Node.js](https://nodejs.org/dist/index.json); APIs de Leaflet 1.9.4, Fastify 5, @fastify/static 10, Zod 4, vite-plugin-pwa 1.3 e eslint-plugin-react-hooks 7 conferidas nas definições de tipos instaladas. Instalabilidade verificada com o protocolo do Chrome (`Page.getInstallabilityErrors`).

Etapa 02 (2 de outubro de 2026), consultadas para as versões fixadas:

- [Prisma: PostgreSQL](https://www.prisma.io/docs/orm/overview/databases/postgresql): conexão pelo driver adapter `@prisma/adapter-pg`.
- [Prisma: atualização para o Prisma 7](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7): gerador `prisma-client`, `prisma.config.ts`, `.env` não carregado automaticamente.
- [Prisma: geradores](https://www.prisma.io/docs/orm/prisma-schema/overview/generators): saída, formato de módulo e extensão de importação do cliente gerado.
- Documentação do módulo `crypto` do Node.js 24.20 (`doc/api/crypto.md` da versão): `crypto.argon2`, `timingSafeEqual`, `randomBytes`.
- [RFC 9106 — Argon2](https://www.rfc-editor.org/rfc/rfc9106): parâmetros e vetor de teste do Argon2id.
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): Argon2id com m = 19 MiB, t = 2, p = 1.
- Definições de tipos instaladas de Prisma 7.10, `@fastify/cookie` 11, Fastify 5 e `pg` 8 para as assinaturas usadas.

Etapa 03 (2 de outubro de 2026):

- README do pacote `qrcode` 1.5.4 (instalado; repositório [soldair/node-qrcode](https://github.com/soldair/node-qrcode)): `create(text, options)` devolve a matriz de módulos; níveis de correção L/M/Q/H (~7/15/25/30%); zona de silêncio padrão de 4 módulos. Definições `@types/qrcode` 1.5.6 e `lib/browser.js` para o uso na interface.
- Definições de `jsqr` 1.4.0 e `pngjs` 7.0.0 para decodificar o QR nas verificações.
- Definições instaladas de Prisma 7.10 (filtros de relação, `updateMany` com incremento, `Prisma.DbNull`) e do Playwright 1.63 (`page.emulateMedia`, `page.pdf`).

Etapa 04 (2 de outubro de 2026):

- [Prisma Client API — Prisma ORM v7](https://www.prisma.io/docs/orm/v7/reference/prisma-client-reference): opções da transação interativa (`maxWait` padrão de 2 s, `timeout` padrão de 5 s, `isolationLevel` do banco), `createMany` com `skipDuplicates` (`ON CONFLICT DO NOTHING`) e retorno de `updateMany`. A página atual de transações já descreve o Prisma 8 (sem `$transaction`), por isso foi usada a referência versionada da v7.
- Definições instaladas de Prisma 7.10 para `groupBy` com `_count`, contagem filtrada de relações, relações compostas e autorrelações nomeadas.
- Comportamentos do PostgreSQL 17 usados na etapa (bloqueio `SELECT … FOR UPDATE` em READ COMMITTED, índice único com nulos distintos em `(palete_id, ativa)`, gatilhos `BEFORE` em PL/pgSQL, `md5()`/`concat_ws()` nas funções auxiliares) não foram reconsultados na documentação nesta sessão: foram comprovados pelos testes contra o PostgreSQL 17.10 local (inícios e reconciliações simultâneos, gatilhos, igualdade das funções SQL e TypeScript).

Etapa 05 (2 de outubro de 2026):

- [Prisma ORM v7 — Transactions and batch queries](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions): transação interativa com `maxWait`/`timeout` (padrões de 2 s e 5 s) e `isolationLevel` (padrão do banco: READ COMMITTED no PostgreSQL); conflito de escrita ou impasse retorna `P2034` e a nova tentativa fica a cargo da aplicação. A página sem versão já descreve o Prisma 8 (sem essas opções), por isso foi usada a da v7.
- [PostgreSQL 17 — Transaction Isolation (Read Committed)](https://www.postgresql.org/docs/17/transaction-iso.html): `UPDATE`/`SELECT FOR UPDATE` que encontra linha alterada por transação concorrente espera a confirmação e reavalia o `WHERE` na versão atualizada da linha (base da reserva condicional e do bloqueio de saldo).
- [PostgreSQL 17 — Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html): evitar impasse adquirindo bloqueios de vários objetos em ordem consistente; repetir transações abortadas por impasse; conflitos entre `FOR UPDATE` e `FOR SHARE`.
- Comportamentos confirmados nos testes contra o PostgreSQL 17.10 local: `ALTER TYPE … ADD VALUE` na mesma migração que usa o tipo como texto, índice único decidindo a corrida pela mesma posição, gatilhos `BEFORE INSERT` para vínculos de correção.

Etapa 06 (2 de outubro de 2026). Consultados nesta sessão: o registro npm, o CDN da SheetJS, o GitHub Advisory Database e o README do `read-excel-file`. As especificações listadas depois serviram de base à implementação, **sem nova leitura nesta sessão**; o comportamento foi comprovado por testes (arquivos gravados pelo Microsoft Excel 16, PostgreSQL 17.10 local).

- Registro npm (`npm view`): `exceljs` 4.4.0, `xlsx` 0.18.5, `read-excel-file` 9.3.10 (README, seção "Formulas"), `fflate` 0.8.3, `write-excel-file` 4.1.1; [SheetJS CDN](https://cdn.sheetjs.com/) (`xlsx-latest` = 0.20.3); [GitHub Advisory Database](https://github.com/advisories?query=xlsx) para `xlsx` (GHSA-4r6h-8v6p-xvw6 / CVE-2023-30533, < 0.19.3; GHSA-5pgg-2g8v-p4x9 / CVE-2024-22363, < 0.20.2). Avaliação em DECISOES (etapa 06).
- [ECMA-376 Office Open XML, Parte 1 (SpreadsheetML)](https://ecma-international.org/publications-and-standards/standards/ecma-376/): pacote, relações, `sharedStrings`, `inlineStr`, estilos e `numFmtId` internos (49 = texto; formatos de data), `date1904`, escape `_xHHHH_` (ST_Xstring) e o formato Strict. Conferido na prática contra arquivos gravados pelo Microsoft Excel 16 (D106).
- [PKWARE APPNOTE.TXT](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT): estrutura do ZIP (diretório central, cabeçalho local, métodos 0 e 8, ZIP64, bit de criptografia).
- Documentação do Node.js 24 (`zlib`): `inflateRawSync` com `maxOutputLength`, `deflateRawSync` e `crc32`; `TextDecoder` com `fatal` e o rótulo `windows-1252` ([WHATWG Encoding](https://encoding.spec.whatwg.org/)).
- [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180): CSV com aspas, aspas duplicadas e quebras de linha em campos.
- [OWASP — CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection): prefixo de apóstrofo para células que começam com `=`, `+`, `-`, `@`, tabulação ou CR.
- PostgreSQL 17: [classes de operador para índices (`text_pattern_ops`)](https://www.postgresql.org/docs/17/indexes-opclass.html), [bloqueios consultivos (`pg_advisory_xact_lock`)](https://www.postgresql.org/docs/17/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS), [`GROUPING SETS`](https://www.postgresql.org/docs/17/queries-table-expressions.html#QUERIES-GROUPING-SETS), [lista de colunas do `WITH`](https://www.postgresql.org/docs/17/queries-with.html). Comportamentos comprovados nos testes contra o 17.10 local (concorrência, gatilhos, índice único parcial).

Etapa 07 (2 de outubro de 2026). **Nenhuma fonte nova foi lida nesta sessão** e nenhuma dependência foi adicionada. Recursos do PostgreSQL 17 usados com base na documentação oficial já referenciada acima e comprovados por testes contra o 17.10 local: [CHECK constraints](https://www.postgresql.org/docs/17/ddl-constraints.html), [CREATE CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED](https://www.postgresql.org/docs/17/sql-createtrigger.html) (conferência de totais no COMMIT), [ALTER TYPE … ADD VALUE](https://www.postgresql.org/docs/17/sql-altertype.html) (tipo de importação `CLAIMS`), `SELECT … FOR UPDATE` em ordem fixa e bloqueio consultivo (etapas 05 e 06). Na primeira aplicação da migração, a forma `IF valor <> CASE … THEN … END THEN` do PL/pgSQL falhou (o primeiro `THEN` encerra a condição do `IF`): a expressão passou a ser calculada antes numa variável.

Etapa 08 (3 de outubro de 2026). **Nenhuma fonte nova foi lida nesta sessão** e nenhuma dependência foi adicionada. Recursos usados com base na documentação já referenciada acima e comprovados por testes contra o PostgreSQL 17.10 local: CHECK de capacidade agregada (reservado + expedido ≤ limite) e de liberação (reservado ≤ liberado ≤ saldo), gatilhos imutáveis e gatilhos adiados (`DEFERRABLE INITIALLY DEFERRED`) para os totais de reservas, capacidade e retornos, `SELECT … FOR UPDATE` em ordem fixa (janela → reserva → paletes → saldo) e bloqueio consultivo para a numeração; reservas e saídas simultâneas exercitadas em testes de concorrência. Na interface, a conversão de data/hora digitada no fuso da operação usa `Intl.DateTimeFormat` (padrão ECMAScript, sem biblioteca) e foi conferida por testes de unidade.

Etapa 09 (4 de outubro de 2026). Lidos nesta sessão:

- [MDN — `MediaDevices.getUserMedia()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia): só em contexto seguro (em HTTP comum `navigator.mediaDevices` não existe), exceções `NotAllowedError`, `NotFoundError`, `NotReadableError`, `OverconstrainedError`, `AbortError`, `SecurityError`, `TypeError`, `InvalidStateError`, e `facingMode` como preferência (`ideal`) — base da classificação de falhas e do pedido "só vídeo, traseira preferida".
- [MDN — `BarcodeDetector`](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector): disponibilidade limitada (não Baseline), contexto seguro, `getSupportedFormats()` e `detect()` → `rawValue`/`format` — por isso a detecção de formatos em tempo de execução e o decodificador local de reserva.
- READMEs publicados no npm das versões fixadas: `barcode-detector` 3.2.2 (ponyfill × polyfill, formatos, `prepareZXingModule` para servir o `.wasm` fora da CDN padrão) e `zxing-wasm` 3.1.3 (subpacotes reader/writer, `locateFile`, `wasmBinary` em Node — usado no gerador de códigos dos testes).
- [MDN — Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable): membros do manifest exigidos pelo Chromium (ícones 192 e 512), HTTPS/localhost, `beforeinstallprompt` só no Chromium (não no iOS), diferenças de Safari (Dock no macOS; tela de início no iOS) e Firefox (sem instalação no computador; atalho no Android) — base das instruções por navegador.
- [MDN — Using Service Workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers): a versão nova espera até não haver páginas da antiga; `skipWaiting`/`clients.claim`; escopo — base da atualização só por ação ("Atualizar") e do aviso nas outras abas.
- Código-fonte instalado do `vite-plugin-pwa` 1.3.0 (`dist/client/build/register.js`, cliente `virtual:pwa-register` sobre `workbox-window` 7.4): eventos `waiting`/`controlling`, `onNeedRefresh`, `onNeedReload` (recarga em toda aba controlada quando não informado — por isso o `onNeedReload` próprio).
- PostgreSQL 17: [Backup e restauração por SQL dump](https://www.postgresql.org/docs/17/backup-dump.html) (restaurar em banco criado de `template0`, dump restaurável em versão mais nova, papéis fora do `pg_dump`), [`pg_dump`](https://www.postgresql.org/docs/17/app-pgdump.html) (cópia consistente com o banco em uso, `--snapshot` com `pg_export_snapshot()`, formato custom para `pg_restore`) e [`session_replication_role`](https://www.postgresql.org/docs/17/runtime-config-client.html) (`replica` não dispara gatilhos nem confere chaves estrangeiras; só superusuário ou quem tem `SET`) — por isso a restauração confere órfãos e conteúdo depois da carga.
- Comportamento do Node 24 verificado por teste local: `process.loadEnvFile` não sobrescreve variáveis já definidas.

A identificação única de paletes e o vínculo com produtos também são princípios da [GS1 Global Traceability Standard](https://www.gs1.org/standards/gs1-global-traceability-standard/current-standard). O QR interno proposto não cria uma identificação GS1 oficial nem substitui etiquetas existentes da operação.
