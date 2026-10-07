# Estado do projeto

Atualizado em 6 de outubro de 2026.

## Implementação

| Etapa | Situação |
| --- | --- |
| 01 Base e mapa demonstrativo | Concluída (2 out. 2026) |
| 02 Banco e acesso (+ correção das fileiras do mapa) | Concluída (2 out. 2026) |
| 03 Cadastro e etiquetas | Concluída (2 out. 2026) |
| 04 Conferência e reconciliação | Concluída (2 out. 2026) |
| 05 Movimentações com histórico | Concluída (2 out. 2026) |
| 06 Busca e importação | Concluída (2 out. 2026) |
| 07 Claims e rastreabilidade | Concluída (2 out. 2026) |
| 08 Janelas e expedição | Concluída (3 out. 2026); conferida no início da etapa 09 |
| 09 PWA e recuperação | **Concluída** — desenvolvimento local com dados fictícios (4–5 out. 2026); aparelhos físicos, HTTPS e restauração no ambiente do piloto pendentes |
| 10 Indicadores e piloto | **Implementada** (5 out. 2026): ajuda por tarefa, tutorial, indicadores, relatórios, guia do operador e roteiro do piloto; o **piloto físico não foi executado** (roteiro em `ROTEIRO-DO-PILOTO.md`) |
| Complemento: seleção do cliente e conciliação | **Entregue** (5 out. 2026) — desenvolvimento local com dados fictícios; arquivo definitivo, seleção real e endereços reais por faixa pendentes (`DESCOBERTA.md`) |
| Carga do inventário real em lote | **Executada no banco de desenvolvimento** (6 out. 2026) no escopo real local `PRACA-REVERSA/LOREAL`; tela "Notas do palete" entregue. Piloto físico e ambiente do piloto não verificados |
| Publicação Netlify Free + Neon Free | **Em andamento** (6 out. 2026): Function da API (adaptador sobre a mesma aplicação Fastify), `netlify.toml`, `npm run build:netlify`, `DIRECT_URL` para migrações e tutorial `PUBLICACAO-NETLIFY-NEON.md` prontos; pacote esbuild da função verificado localmente (12/12 com PostgreSQL de teste); **faltam** envio de planilhas em partes (> ~4,5 MB), planilha única sem disco/processo contínuo, teste automatizado do adaptador, ZIP — plano em `RETOMADA-NETLIFY-NEON.md`. Nada publicado; nenhuma migração no Neon |
| Planilha única automática e proteção dos dados | **Implementada no desenvolvimento local** (6 out. 2026): geração local automática funcionando; destino independente e agendamento do backup **não configurados** (faltam pasta/compartilhamento e autorização); teste de restauração verificado com dados fictícios |

## Planilha única e proteção dos dados (6 out. 2026) — o que existe de fato

Pedido: `PROMPT-PLANILHA-UNICA-AUTOMATICA-E-BACKUP.md` + modelo fictício. Decisões D177–D183; ativação em `IMPLANTACAO.md` (seção "Planilha única e proteção dos dados"); retomada em `RETOMADA-PLANILHA-UNICA.md`.

- **Planilha** `Praca-Reversa-<unidade>-<cliente>.xlsx` por escopo: Inventário (11 colunas do modelo + Delivery, uma linha por vínculo NFD × palete, notas "Sem alocação", palete sem nota, indicadores do mesmo recorte e SUBTOTAL), Movimentações (eventos confirmados, um por ID, limite com período declarado), Proteção e ajuda (estados honestos + como consultar + termos). Gerador XLSX próprio (estilos DHL, tabelas com filtro, painéis fixos, tipos, proteção contra fórmula).
- **Automação**: gatilhos → `alteracao_planilha` (mesma transação) → agendador no `npm start` (agrupamento, reconciliação, concessão com expiração, versão crescente, validação por releitura, falha sem sobrescrever, espera crescente) → destino `pasta:` com versões ou geração local. Tela **Planilha e proteção** (estados, atraso, tentar novamente, baixar).
- **Backup**: `npm run backup:rotina` (criação + conferência + retenção + registro) e `npm run backup:teste-restauracao` (bancos de ensaio fictícios); agendamento documentado, não criado.
- **Executado neste computador**: planilha do escopo real gerada localmente (v2: 785 linhas = 745 vínculos + 40 sem alocação; 124 eventos; ≈1 s) e aberta no Excel por automação (3 abas, tabelas com filtro, painéis fixos, NFD texto, datas tipadas, SUBTOTAL), com capturas examinadas (arquivos reais só em `.dados/`); `npm run backup:rotina` → **VERIFICADO** (79 arquivos conferidos, ≈1 MB, destino no mesmo servidor ⇒ "Não configurado"); `npm run backup:teste-restauracao` → **APROVADO** (78 tabelas, 1.419 linhas iguais; bancos de ensaio removidos); exemplo fictício `examples/planilha/Praca-Reversa-EXEMPLO-FICTICIO.xlsx`.
- **Testes** `apps/api/test/banco/planilha.test.ts`: 9 aprovados (fila/gatilhos e transação desfeita, conteúdo do Inventário, Movimentações sem repetição, concorrência, destino indisponível/falha de leitura/arquivo defeituoso sem sobrescrever, reinício, ordem de versões e retenção, demonstração fora do destino e escopo vazio, tela/permissões/isolamento).
- **Verificações finais**: `npm run typecheck` aprovado; `npm run lint` completo: 11 apontamentos no código novo (`??`, asserção/condição desnecessárias, união redundante, `RegExp#exec`, prop sem uso), corrigidos e arquivos alterados relintados sem erros; `npm test` **55 arquivos, 511 testes aprovados**; `npm run build` aprovado. Tela **Planilha e proteção** conferida no navegador (servidor `--porta=3100`, `supervisor.praca`, escopo real): estados corretos e o agendador gerou sozinho a versão 3 depois dos registros de backup/restauração (o service worker antigo da origem precisou ser removido na aba, como já registrado). E2E não executado nesta etapa.
- **Limites**: cópia externa, backup fora do servidor e agendamentos dependem da infraestrutura do piloto (não configurados); atraso real não medido; Graph API não implementada; a planilha pode ficar desatualizada durante falhas (a tela mostra a situação viva).
- **Próximo passo**: com a infraestrutura do piloto, definir a pasta sincronizada/compartilhada e o responsável, configurar `PLANILHA_DESTINO*` e `BACKUP_*`, agendar `backup:rotina` e o teste de restauração, e medir o atraso real da planilha.

## Carga do inventário real em lote (6 out. 2026) — o que existe de fato

Pedido: `PROMPT-IMPORTACAO-AUTOMATICA-NFD.md` + `Importacao-Praca-Reversa.zip` (dados reais, fora do repositório). Decisões D171–D176; comando no `README.md`; perguntas em `DESCOBERTA.md`.

- **Escopo real** (não-demo) `PRACA-REVERSA/LOREAL` ("Praça da reversa — DHL · L'Oréal") com o desenho aprovado (194 ativas + 300 desativadas), contas `admin.praca` e `supervisor.praca` (senhas só em `.dados/teste-local/credenciais.md`). A demonstração continua só como tutorial.
- **Comando** `npm run inventario:carregar -- --arquivo "C:/Users/Administrator/Downloads/Importacao-Praca-Reversa.zip" --unidade PRACA-REVERSA --cliente LOREAL --usuario supervisor.praca --executar` → **INV-000001**: 851 linhas (755 aplicadas, 77 de endereço livre/referência, 19 repetidas agrupadas sem somar, 0 conflito); **745 vínculos** (700 NFD — 657 números distintos — e 45 de tipo pendente/MI); **123 paletes** cadastrados (`PR-000001`…, N° Pallet só como referência externa), todos com **posição no mapa pendente** (nenhuma sequência de endereço confirmada); 40 referências fora da praça; 22 vínculos com volumes pendentes; 0 saldo por SKU. Reenvio do mesmo pacote: "já importado como INV-000001", 0 criados, 745 já existentes. Relatórios em `.dados/cargas/`.
- **Palete full** recalculado dos vínculos atuais: 61 full, 51 mistos, 11 não informado (= fotografia do pacote).
- **Interface**: detalhe do palete com **Notas do palete** (sete campos; cidade destino e produto na caixa editáveis, descrições por caixa/grupo, pendências por nota, candidatos de outro contexto, metadados em *Origem*); cabeçalho com endereço informado + "Posição no mapa pendente"; lista agrupada por fileira do endereço (ordem numérica) e filtro por endereço; busca por NFD mostra todos os paletes da nota; tela do inventário mostra o N° Pallet como referência externa.

### Verificações executadas (6 out. 2026)

| Comando / verificação | Resultado |
| --- | --- |
| `npm run typecheck` | Aprovado (contratos, API, web e testes). |
| `npm run lint` | 1ª rodada: 3 erros no código da carga (BOM literal, 2 asserções desnecessárias), corrigidos; arquivos alterados relintados sem erros. |
| `apps/api/test/banco/carga-lote.test.ts` (novo, PostgreSQL, pacote fictício gerado no teste) | 7 testes: leitura/recusa do pacote, gravação (paletes com código gerado, posição só pela tabela confirmada, nenhum saldo), notas (misto, NF em dois endereços atual × fora da praça, candidato de outro contexto, full, volumes pendentes sem soma, N° Pallet repetido, tipo pendente/MI, conteúdo sem número), reenvio sem duplicar, cidade/produto preservados em versão nova (`--substitui`) e conflito de versão, posição ocupada → conflito não aplicado, escopo demo recusado. |
| `filtro.test.ts` (web) | Novo caso: agrupamento pelo endereço informado, ordem numérica, GR ao final. |
| `npm test` completo | 54 arquivos, 502 testes: **501 aprovados, 1 falha** (13,2 min) — a lista esperada de migrações em `banco-e-seed.test.ts` não tinha a migração nova; corrigida e reexecutada junto com `carga-lote.test.ts` (texto de pendência de volumes ajustado): 17 aprovados. |
| `npm run build` + servidor local na porta 3100 (escopo real, `supervisor.praca`) | Palete full com a mesma NFD em 3 paletes declarados (outros 2 endereços atuais com posição no mapa pendente), palete misto com 20 notas e volumes pendentes, lista com os 123 paletes em 7 grupos (Fileiras 11–16 e GR), busca da NFD → 3 paletes. Celular (375 px): sem rolagem horizontal; campos empilhados. Edição de cidade/produto **não** exercitada no escopo real (gravaria dado real); coberta pelos testes de banco. |

### Limitações materiais

- **Posição no mapa pendente para os 123 paletes**: faltam os códigos inicial/final de cada faixa para confirmar as sequências (sentido já confirmado). Depois de confirmar em Layout da praça → Endereços reais, rodar a carga de novo registra as posições (só de paletes nunca movimentados).
- Pendências do pacote (lista no relatório): 22 volumes pendentes, 45 documentos de tipo pendente/MI, 40 referências fora da praça sem local atual, 10 linhas de conteúdo sem número em 8 endereços, 22 números em contextos documentais distintos, N° Pallet repetido.
- A carga é por comando local (sem tela de importação para o pacote JSON). O título da aba do navegador continua "Praça Reversa · Demonstração" também no escopo real (texto fixo do `index.html`, anterior a esta tarefa).
- E2E: `PLAYWRIGHT_CANAL=chrome npm run test:e2e` (com build) **109 aprovados, 74 ignorados por perfil, 0 falhas** (7,7 min); nenhum spec E2E novo para as notas (cobertas pelos testes de banco e pela verificação no navegador).

**Conferência da etapa 08 antes de alterar o código** (4 out. 2026): `npm run db:status` (PostgreSQL local em execução), `npm run typecheck` e `npm run lint` aprovados; `npm test` 41 arquivos, 394 testes aprovados; `PLAYWRIGHT_CANAL=chrome npm run test:e2e` 77 aprovados, 63 ignorados por perfil (4,3 min). Nenhuma correção da etapa 08 foi necessária.

## Complemento: seleção do cliente e conciliação (5 out. 2026) — o que existe de fato

Percurso: **inventário de referência → seleção do cliente → conciliação → pendências → lista de separação → reserva da etapa 08**. Importar e conciliar não alteram estoque, não reservam, não liberam e não confirmam saída. Decisões D159–D170; uso no `README.md`; perguntas abertas em `DESCOBERTA.md`.

- **Desenho aprovado** (PDF de referência): FB01–FB07 = Fileiras 11–16/GR, 194 posições ativas; DB01–DB07, 300 desativadas (fora da capacidade, prontas para ativar). Demonstração sincronizada pelo código (IDs, QR e vínculos preservados). Ações "Criar do desenho aprovado" e "Aplicar nomes operacionais".
- **Endereços reais**: endereço = fileira/GR + código (`15 - A120` ≠ `13 - A120`), normalização N1–N4 sem completar nem corrigir; tabela por faixa (sequência + sentido + fonte → proposta → confirmação); só endereço confirmado posiciona; mapa mostra `15 - A101 · F08-P01`. **Nenhuma sequência real confirmada** (só fictícias em F01/F08/F09).
- **Inventário conferido** (importação CSV/XLSX, aba de dados escolhida; resumo e abas ocultas não entram; células só formatadas ignoradas; cores de fonte lidas): parâmetros explícitos (versão definitiva, conferência, N° Pallet, cor de endereço livre, tipos documentais), prévia com ação por linha, conjunto aplicado explícito (integral ou revertido), pendências reapresentáveis, versão nova com diferenças. Fotografia preservada; vínculos NF × palete por linha (parcelas sem soma); volumes nunca viram peças; conferência externa reconhecida à parte. Busca por NF (base própria) e documentos no detalhe do palete.
- **Seleção do cliente**: lista ou marcação, pedido/versão, inventário de referência, significado da NF, abrangência por linha, NF sem quantidade pendente (ou configurada), duplicidade decidida, versão substitutiva com diferenças e reservas a revisar.
- **Conciliação** no servidor (9 situações, bases de quantidade separadas, ambiguidade com resolução explícita e anulável, conflito de demanda, saídas anteriores), tela com resumo, filtros, tabela (cartões no celular), detalhe com todos os paletes, mapa com posições conhecidas, exportações CSV (separação, pendências, conciliação) e **Preparar para a janela** (proposta sem gravar → revisão → reserva integral pela etapa 08, com vínculo linha × reserva).
- **Ajuda**: tarefa "Localizar o que o cliente pediu" (guia, ajuda nas telas, próximos guias do tutorial), glossário (localizado, sem vínculo, validado × liberado) e dúvidas; `GUIA-DO-OPERADOR.md` regenerado.

### Verificações executadas (5 out. 2026, mesmo computador e versões da etapa 09)

| Comando / verificação | Resultado |
| --- | --- |
| Suíte inicial da retomada (`npx vitest run`) | 483 aprovados, **10 falhas** — testes que ainda descreviam o esquema de 96 posições (seed, praça, configuração do layout), a migração nova, o resultado de importação com campos novos, o relatório (coluna "Ação") e o operador que passou a consultar lotes de seleção. Corrigidos: testes atualizados ao desenho aprovado (mesmas regras), "Ação" só nos tipos novos, histórico do operador filtrado por tipo (verificado no teste). |
| `npm run typecheck` | Aprovado (fixtures dos testes de contrato e da web atualizadas; import não usado em `e2e/tutorial.spec.ts` removido). |
| `npm run lint` | Aprovado, 0 erros (18 apontamentos corrigidos: `??`/encadeamento opcional, BOM literal, literal numérico impreciso nos testes, funções fora do arquivo de componente). |
| `npm test` | **53 arquivos, 494 testes aprovados** (9,9 min). Inclui `selecao-cliente.test.ts` (15, PostgreSQL), `enderecos-layout.test.ts` (7), `desenho-aprovado.test.ts` (11) e a busca por NF (3 vínculos de NFD/MI, sem quantidade, filtros, mapa). |
| `PLAYWRIGHT_CANAL=chrome npm run test:e2e` (com build) | **109 aprovados, 74 ignorados por perfil, 0 falhas** (6,7 min). A rodada anterior teve 11 falhas, todas de specs que ainda usavam as áreas e a geometria do esquema antigo (`computador`, `celular`, `acesso`); corrigidos para "Fileira 11 · FB01"/"Fileira 12 · FB02" e para o desenho aprovado (194 posições desconhecidas + 300 desativadas). |
| E2E `e2e/selecao.spec.ts` | Computador: inventário pela tela → seleção → NF localizada (PAL-DEMO-004, saldo liberado), NF em dois paletes (`15 - A101`, `15 - A103`), NF sem vínculo, NF não encontrada → detalhe e mapa → filtro e CSV de pendências → proposta → reserva → lista de preparação → busca por NF (2 vínculos). Celular (Pixel 7 emulado): cartões e detalhe. Aprovados. |
| Capturas `docs/capturas/selecao-cliente/` | 15 imagens examinadas (computador, dados fictícios). A partir delas: a tela deixou de sumir durante a recarga (a mensagem da reserva se perdia) e os contadores da prévia do inventário passaram a dizer "requerem resolução (ficam registradas sem aplicar)". |
| Capturas da etapa 10 e da seleção (só `capturas-etapa10` e `selecao` com `--grep @captura`) | Seleção: 15 imagens refeitas. Etapa 10: **22 imagens** em `docs/capturas/etapa-10/` (15 computador, 7 celular), agora completas. A 1ª rodada falhou no computador por corrida do próprio spec (navegava antes da resposta de "Sair" e a sessão continuava); o spec passou a esperar "Você saiu.". Nas imagens do celular (412 px) o **menu da conta saía cortado** pela borda direita desde o botão "Ajuda" da etapa 10: até 420 px o nome da marca fica só para leitores de tela (o ícone permanece) e o menu encolhe o nome com reticências na mesma linha (o topo só quebra linha se não couberem 64 px). Imagens do celular reexaminadas depois da correção. |
| Rodada depois dessas correções | `npm run typecheck` aprovado; `npm run lint` aprovado, 0 erros (3 min 25 s); `npm run build`; E2E `celular`, `tutorial` e `acesso`: **24 aprovados**, 18 ignorados por perfil (1,5 min); depois `PLAYWRIGHT_CANAL=chrome npm run test:e2e` completo (com build): **109 aprovados, 74 ignorados por perfil, 0 falhas** (6,5 min). |
| Banco de desenvolvimento | `npm run db:migrar` (migração do complemento) e `npm run db:semear-demo`: 494 posições (300 desativadas), 2 posições livres do bloco antigo retiradas, 47 endereços fictícios confirmados. |

### Limitações materiais do complemento

- **Arquivo definitivo, seleção real e endereços reais não processados**: o modelo `Inventario L'oreal novo.xlsx` foi usado só pela estrutura. Antes de carregar: identificar o arquivo definitivo, confirmar NFD/MI, N° Pallet, VOLUMES, PALLET FULL e a convenção de cor, e informar/confirmar as sequências de endereço por faixa (Fileira 11 e GR primeiro). Sem a tabela confirmada, os paletes do inventário ficam com "posição visual pendente".
- Volumes e documentos não viram saldo por SKU: material sem conferência por produto fica "informação pendente" e não entra na proposta para a janela.
- A geometria do PDF não foi validada na praça; capacidade total continua desconhecida.
- Tabela da conciliação pagina 100 linhas por vez (exportações trazem todas); filtros de situação ficam na URL, o texto da busca não.

## Etapa 09 — o que existe de fato

**PWA e instalação**: manifest com `id`/`start_url`/`scope` relativos (com "/" o `id` continua "/"), ícones 192/512/maskable e Apple 180; **caminho-base** `CAMINHO_BASE` no build e no servidor (API, estático, SPA, service worker, links do QR; o servidor recusa build de outro caminho-base; "/" redireciona). Página **Aplicativo e aparelho** (`/aplicativo`, também antes do login): "Instalar aplicativo" só com `beforeinstallprompt`, senão instruções por navegador (iOS/iPadOS, Android Chrome/Firefox, Firefox/Safari no computador), origem segura, câmera, modo aplicativo, versões, política de rascunho e conexão. Registro próprio do service worker: aviso **Nova versão · Atualizar**, adiamento com motivos (gravação aguardando resposta, operação em confirmação, entrada que a recarga perderia), contagem aberta só pede confirmação e reabre no mesmo endereço; **outra aba é avisada e não recarrega**; parte da interface que não carrega mostra "Atualizar". Cache: só a casca (+ `.wasm` da câmera), sem runtimeCaching, fallback HTML só para navegações fora de `<base>api/` e sem extensão; limpeza de caches inadequados na abertura; o cliente recusa HTML no lugar de JSON e de downloads. Abertura sem conexão: tela própria, sem login nem dados.

**Câmera**: "Ler código (câmera)" no mapa/lista e no painel da conferência; só vídeo, traseira preferida; `BarcodeDetector` quando aceita todos os formatos, senão ZXing-C++/WebAssembly local (`barcode-detector` 3.2.2 / `zxing-wasm` 3.1.3, `.wasm` servido pela instalação); uma leitura → resultado → pausa; QR desta instalação abre o palete, de outra origem só por toque, externo/esquemas como texto; produto com SKU, embalagem e fator (fator desconhecido bloqueia), desconhecido sem cadastro, sem API "pendente de consulta"; na conferência a câmera só preenche o código e o painel confirma produto/unidade/quantidade; falhas com alternativa manual; câmera liberada ao fechar/sair/esconder a aba, inclusive permissão que chega depois do cancelamento. Leitor-teclado inalterado.

**Conexão e recuperação**: estados sem conexão / servidor sem resposta / servidor indisponível / banco indisponível / sessão expirada / em confirmação; gravação sem rede no aparelho bloqueada antes do envio; "banco indisponível" só some pela verificação de prontidão. **Operações incertas** (resposta perdida, HTML no lugar de JSON, 5xx): painel "Em confirmação", consulta autenticada `GET /api/v1/operacoes/<chave>` (somente leitura, só do usuário no escopo), "não registrada" só depois de 140 s, repetição com a mesma chave e corpo, outro pedido ao mesmo registro bloqueado até resolver. Conferência: entradas "não enviada" × "em confirmação" com "Verificar no servidor"; resultado gravado também na memória (sessão expirada no meio do envio não trava a entrada); divergência ao reconectar exige "Revisei". **Política de rascunho** `PERSISTENCIA_LOCAL`: produção sempre só memória; desenvolvimento/teste também `sessionStorage` por usuário × escopo × conferência, versão, data e rótulo "não enviado"; outro usuário apaga o anterior; sair avisa (também por outras abas) e limpa; contrato interface × API (`X-Praca-Contrato`, 409 `VERSAO_INCOMPATIVEL`).

**Anexos**: fotos/documentos na conferência (`anexo_conferencia`, migração `20261006090000_anexos_conferencia`, CHECK de SHA-256 do conteúdo e imutabilidade; aplicada nos bancos de desenvolvimento, teste e E2E), "Tirar foto" e "Escolher arquivo"; anexos de claims e janelas revisados sem mudança (privados, tipo pelo conteúdo, limite, auditados).

**Backup e restauração**: `npm run backup:criar` (snapshot único com banco e anexos; cópia lógica por fluxo ou `pg_dump` oficial), `npm run backup:restaurar` (só banco novo, integridade antes de tudo, comparação completa, sessões revogadas, relatório), `scripts/recuperacao/ensaio-volume.mjs`. Procedimento e pendências em `IMPLANTACAO.md`; decisões D142–D158.

**Demonstração (dados fictícios)**: `docs/capturas/etapa-09/` (13 computador, 2 celular), gerada por `e2e/capturas-etapa09.spec.ts` (`npm run capturas`): login com instalação → aparelho e versões → QR do palete pela câmera (simulada) → palete aberto → caixa com fator → câmera na conferência → confirmação com unidade → sem conexão "não enviada" → em confirmação e atualização adiada → verificado sem duplicar → foto na conferência → atualizado na mesma conferência → abertura sem conexão; celular: câmera com produto e "Aplicativo e aparelho". O ensaio de restauração com comparação é o teste `recuperacao-backup.test.ts`.

## Verificações executadas (4–5 out. 2026, Windows 11 Pro 10.0.26100, Node 24.20.0, PostgreSQL 17.10, Chrome 154.0.8037.57 via `PLAYWRIGHT_CANAL=chrome`)

| Comando / verificação | Resultado |
| --- | --- |
| `npm run typecheck` | Aprovado (rodada final). |
| `npm run lint` | Aprovado, 0 erros (2 min 37 s). O script reserva 4 GB ao Node: com o limite padrão o lint de tipos do monorepo esgotava a memória. Três apontamentos corrigidos na rodada final. |
| `npm test` | **48 arquivos, 439 testes aprovados** (eram 394): contratos de leitura/QR e contrato (8), interface (aplicativo/caminho-base 11, operações incertas 6, fila 5), API (caminho-base, versão, contrato, configuração), PostgreSQL: resultado de operação e resposta perdida (4), anexos da conferência (7), **ensaio de backup/restauração (5)**. Rodada final: 6,6 min. Uma rodada anterior durante suspensão da máquina (55 min) teve 1 falha em `admin-idempotencia` (causa não apurada: o detalhe do erro não foi guardado; a duração indica a suspensão); o arquivo isolado e a rodada completa seguinte passaram. |
| `PLAYWRIGHT_CANAL=chrome npm run test:e2e` (com build) | **92 aprovados, 69 ignorados por perfil** (5,4 min; eram 77). A rodada completa anterior teve 91 aprovados e 1 falha por corrida (resposta em trânsito desfazia o "sem conexão"), corrigida em `conexao.ts`; depois, `recuperacao`/`pwa`/`comum` repetidos 3×: 77 aprovados e 1 falha por tempo esgotado ao criar o contexto do navegador com a máquina suspensa (execução de 2,8 h); `pwa.spec` repetido 2× em seguida: 12 aprovados. |
| Capturas da etapa 09 | 2 aprovados (computador e celular), 15 imagens examinadas; a partir delas foram corrigidos textos da entrada em confirmação e do motivo de adiamento. |
| Banco de desenvolvimento | Migração aplicada; `prisma migrate diff` banco × schema vazio. |
| Restauração manual da base de desenvolvimento | Aprovada: 61 tabelas, 1.043 linhas iguais, 177 chaves estrangeiras sem órfãos, 9 sessões revogadas (2,9 s); banco de ensaio removido depois. |
| Ensaio de volume (`ensaio-volume.mjs`) | 1ª execução **reprovada** (string acima do limite do Node na carga da tabela de anexos; nenhum sucesso relatado, banco novo removido) → scripts por fluxo → **aprovado** (ver tempos abaixo). |
| `npm audit` | Inalterado: 4 altas no CLI `prisma` (D41). Dependências novas sem alerta. |

**Cobertura dos cenários do prompt** (computador = Chrome; celular = Pixel 7 **emulado**):

1. Manifest/ícones/rotas e QR profundo: `pwa.spec` (manifest relativo resolvendo "/", ícones, instalabilidade sem impedimentos pelo CDP com perfil persistente) e `caminho-base.spec` (manifest, escopo do service worker `/praca/`, login, QR `/praca/paletes/<id>` nas etiquetas e na rota profunda, API só sob o prefixo).
2. Câmera: leitura de QR e Code 128 com o decodificador local (o Chrome no Windows não tem `BarcodeDetector`); permissão negada, ocupada, contexto inseguro (simulado), sem recurso, cancelamento e permissão tardia liberada (`camera.spec`); `getUserMedia` real com o dispositivo falso do Chrome e vídeo Y4M (`camera-dispositivo.spec`).
3. Quadros repetidos não somam (1 resultado em 1,5 s de quadros iguais; soma só com o toque), leitura consciente seguinte soma; zeros preservados (`00079…`, `000…4560`), unidade e fator explícitos (CX = 12 UN; FD com fator desconhecido); desconhecido sem cadastro (404 mantido); QR externo só como texto.
4. Sem rede antes do envio → bloqueio sem pedido; resposta perdida depois da gravação → "em confirmação", outro pedido ao mesmo registro bloqueado (0 envios), verificação "confirmada" e um único evento; mesma chave com outro corpo → 422 (`recuperacao-operacoes.test`, `recuperacao.spec`).
5. Estados distintos (sem conexão, servidor sem resposta, banco indisponível, servidor indisponível, sessão expirada) e rascunho não enviado com divergência ao reconectar (`recuperacao.spec`, `comum.spec`).
6. Sair avisa e limpa `sessionStorage`; outro usuário não vê nem envia; inspeção: só a chave da conferência com rótulo "não enviado", versão e data, sem senha/token/CSRF, `localStorage` vazio, cookie de sessão inacessível a scripts; nenhum `/api/` no Cache Storage (`recuperacao.spec`, `pwa.spec`).
7. Nova versão durante a contagem: aviso, adiamento com motivo, verificação sem somar de novo, atualização na mesma conferência (2 linhas, sem duplicar); outra aba avisada sem recarregar; API de outro contrato: aviso e nenhuma gravação enviada, servidor responde 409 (`pwa.spec`, `interface.test`).
8. Abertura offline: tela própria, sem login; `fetch` da API e de anexo sem conexão falham (nunca HTML); API inexistente → JSON 404.
9. Anexos: foto válida privada e baixada (download com nome, `nosniff`, sandbox, `no-store`, hash, auditoria); HTML disfarçado e texto → 415; vazio → 400; acima do limite → 413; envio interrompido → nada gravado; nome com `../` sanitizado; outro escopo → 404; consulta não envia; CHECK de hash e imutabilidade no banco; limite por conferência e só durante a contagem.
10. Backup/restauração em banco novo com comparação; arquivo corrompido, anexo ausente (manifesto refeito), destino de trabalho/sem marca/existente, migrações diferentes, origem inacessível e destino versionado → falha sem sucesso falso (`recuperacao-backup.test`).
11. Na restauração: saldos, reservas, expedições, eventos, claims, recuperações, idempotência e vínculos de anexos iguais à fotografia de controle; repetir a expedição com a mesma chave → `idempotency-replayed`, outra chave recusada, nenhuma baixa nova; sessão antiga → 401.
12. Computador e celular emulado: câmera → palete, câmera → conferência, mapa/lista (aba Lista no celular), teclado (leitor simulado por digitação) e toque emulado.

## Matriz de equipamentos

| Equipamento | Tipo | Navegador | Origem | Instalação / standalone | Câmera e formatos | Leitor-teclado | Anexos | Rede | Atualização |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Computador de desenvolvimento, Windows 11 Pro 10.0.26100 | Físico | Chrome 154.0.8037.57 (Playwright, canal `chrome`) | `http://127.0.0.1` (localhost = seguro) e `/praca/` | Instalabilidade sem impedimentos pelo CDP; **instalação aceita e janela standalone não executadas** (exigem gesto humano) | Câmera **simulada** (canvas) e **dispositivo falso** do Chrome (Y4M); decodificador local; QR e Code 128 lidos; EAN/UPC/ITF/DataMatrix só configurados | Simulado por digitação + Enter | Seletor de arquivo (arquivos fictícios) | Offline do contexto, rotas abortadas, 502/503, resposta perdida | `sw.js` alterado → aviso → adiamento → atualização; duas abas |
| Pixel 7 | **Emulação** (Playwright) | O mesmo Chrome com perfil móvel | localhost | Não executado | Câmera simulada (canvas) | Digitação | Seletor | Offline | Não executado |
| Celular Android físico | — | — | Exige HTTPS (pendente) | **Não testado** | **Não testado** (é onde o `BarcodeDetector` nativo costuma existir) | Não testado | Não testado | Não testado | Não testado |
| iPhone/iPad físico | — | — | Exige HTTPS | **Não testado** | **Não testado** | Não testado | Não testado | Não testado | Não testado |
| Coletor com leitor integrado | — | — | — | **Não testado** | — | **Não testado** | — | — | — |
| Edge, Firefox, Safari | — | — | — | **Não testados** | — | — | — | — | — |

Para validar no piloto: abrir pelo endereço HTTPS em cada aparelho, "Aplicativo e aparelho" (origem segura, câmera, versões), instalar pelo navegador, abrir pelo ícone, ler o QR de uma etiqueta impressa e os códigos reais das embalagens (registrar formatos lidos), conferir com leitor-teclado, tirar foto na conferência, desligar a rede no meio de uma leitura e de uma confirmação, publicar uma versão de teste e atualizar com uma contagem aberta.

## Tempo de recuperação observado

| Ensaio | Dados | Backup | Restauração com verificação |
| --- | --- | --- | --- |
| Teste automatizado (`recuperacao-backup.test.ts`) | Fixtures de todas as etapas (3 anexos) | ≈ 0,8 s | ≈ 2,7 s |
| Base de desenvolvimento | 61 tabelas, 1.043 linhas | ≈ 1 s | 2,9 s |
| Volume fictício (`ensaio-volume.mjs`) | 398,5 MB: 300 fotos de 1 MB, 201.346 linhas | 35,5 s (347,7 MB) | 33,4 s (integridade 0,4 s, carga 21,8 s, comparação 10,5 s) |

Medidos neste computador com dados fictícios; não são metas nem o RTO da operação.

## Limitações materiais

- Desenvolvimento local com dados fictícios; não usar como controle de estoque. **Nenhum aparelho físico além deste computador**; sem HTTPS de rede, câmera e instalação só foram exercitadas por simulação/emulação e por localhost. O caminho `BarcodeDetector` nativo está implementado, mas não foi exercitado (o Chrome no Windows não o tem). Formatos além de QR e Code 128 não foram lidos em teste.
- Em produção não há rascunho no navegador (AGENTS.md): o não enviado fica só na memória da aba e se perde ao fechá-la ou recarregá-la (a tela avisa e a atualização é adiada).
- "Não registrada" só depois de 140 s; antes disso o caminho é repetir com a mesma chave. Envio de arquivo incerto não é repetido pelo painel (escolher o arquivo de novo). Operação em confirmação fica ligada ao escopo em que foi enviada.
- Backup: método `pg_dump` **não ensaiado** (sem ferramentas cliente nesta máquina); a restauração por cópia lógica exige `CREATEDB` e permissão de `SET session_replication_role`; papéis não são copiados; sem agendamento, retenção, responsável, RPO/RTO definidos; a restauração devolve o ponto do snapshot.
- `npm run lint` precisa de ~4 GB de memória (lint de tipos em todo o monorepo); o script já reserva.
- Bundle principal da interface em 494 kB (perto do aviso de 500 kB do Vite); leitor da câmera e página do aplicativo carregados sob demanda.

## Próximo passo

1. Com a operação: identificar o **inventário definitivo** e a **lista real da seleção**, responder as perguntas do complemento em `DESCOBERTA.md` e informar as **sequências de endereço** de cada faixa (início, fim, sentido; Fileira 11 e GR primeiro); confirmar a tabela em Layout da praça → Endereços reais.
2. Importar o inventário definitivo num ambiente do piloto (prévia revisada pelo responsável), depois a seleção, e revisar as pendências com quem as resolve.
3. Piloto físico da etapa 10 (`ROTEIRO-DO-PILOTO.md`): HTTPS e endereço estável, aparelhos reais (matriz acima), rotina de backup com responsável e restauração ensaiada no ambiente do piloto.

Versão de teste local no ar desde 5 out. 2026 (noite): `npm start` com este build na porta 3000 (janela de console "Praca Reversa - versao de teste"), banco de desenvolvimento migrado; contas de teste em `.dados/teste-local/credenciais.md` (fora do versionamento), conferidas por login/saída na API. Depois de um novo `npm run build`, reiniciar esse processo.

## Etapas anteriores (registro)

**Etapa 08** (3 out. 2026): janelas de devolução com capacidade por métrica e versões das regras, liberação por material, filas elegível (FIFO) e pendente, reserva transacional, preparação, expedição com baixa única (inclusive parcial), cancelamento e retorno rastreado. Verificado: 394 testes (219 em PostgreSQL), E2E 77 aprovados, 20 capturas em `docs/capturas/etapa-08/`.

**Etapa 07** (2 out. 2026): claims com casos e linhas, importação "Lista de claims", candidatos da busca com pistas, evidências e anexos privados, validação da recuperação física com vínculo ao material (sem dupla recuperação, inclusive em concorrência e transferências), resultado financeiro separado por concessão explícita, estornos, correções e reaberturas, resumo e CSV. Verificado: 356 testes (192 em PostgreSQL), E2E 75 aprovados, 15 capturas em `docs/capturas/etapa-07/`.

**Etapa 06** (2 out. 2026): busca operacional no servidor com bases separadas (saldo validado, observado, declarado, documento) e escolha que centraliza o palete; importação de produtos e documentos de devolução por CSV/XLSX (leitor próprio restrito), prévia versionada, duplicidade/conflito, confirmação transacional, relatório e exportação CSV protegidos. Verificado: 304 testes (158 em PostgreSQL), E2E 72 aprovados, capturas em `docs/capturas/etapa-06/`, volumetria local.

**Etapa 05** (2 out. 2026): mover palete (`evento_localizacao`), transferir saldo validado entre paletes (um evento com baixa e entrada, disponível = saldo − reservas), histórico, correções por eventos vinculados (supervisor), bloqueios em ordem fixa, idempotência e versões; segmentos com linhagem para lote/origem pendentes. Verificado: 245 testes (20 de movimentação em PostgreSQL: T08–T13, concorrência, reenvio, correções, escopo), E2E 68 aprovados, capturas em `docs/capturas/etapa-05/`.

**Etapa 04** (2 out. 2026): conferência parcial/completa com rascunho no servidor, leitor como teclado, conversão por fator aprovado, pendências, comparação declarado × observado × validado, recontagem vinculada, reconciliação por supervisor (saldo, evento, auditoria numa transação), proteção de conferência ativa por gatilhos. Verificado: 210 testes (110 em PostgreSQL), 63 + 5 E2E, 18 capturas em `docs/capturas/etapa-04/`, reinício real do banco, `npm run dev`.

**Etapa 03** (2 out. 2026): produtos (SKU e códigos textuais, fator explícito, unidade canônica travada quando usada), paletes (código existente ou gerado sem duplicar, posição inicial opcional e individual, linhas declaradas com origem por linha, arquivamento de cadastro por engano), configuração do layout com revisão e histórico, rota estável `/paletes/<ID>`, etiqueta A4 com QR real e emissão auditada. Verificado: typecheck, lint, 165 testes (87 em PostgreSQL), 59 E2E, 11 capturas em `docs/capturas/etapa-03/`, reinício do PostgreSQL, `npm run dev`/`npm start`.

**Etapa 02** (2 out. 2026): PostgreSQL 17.10 local com migrações Prisma 7.10; escopos unidade + cliente com chaves compostas; login individual com Argon2id, sessão no servidor (cookie HttpOnly/SameSite, CSRF por HMAC, limites de tentativa), perfis e permissões verificados no servidor, auditoria e idempotência; administração de acesso; seed explícito de demonstração (esquema informado 15 → 17 e cenário de navegação); correção das fileiras do mapa e dos títulos. Verificado: typecheck, lint, 121 testes (60 em PostgreSQL), 52 E2E, capturas em `docs/capturas/etapa-02/`, reinício do PostgreSQL, `npm run dev`/`npm start`.

**Etapa 01** (2 out. 2026): base TypeScript (npm workspaces, React/Vite PWA, Fastify, contratos Zod), mapa Leaflet CRS.Simple com zoom/arraste/pinça/visão geral/centralização, lista acessível, detalhe com conteúdo desconhecido/parcial, manifest e ícones. Capturas em `docs/capturas/etapa-01/`.

## Formato de atualização por etapa

Data; etapa; comportamento implementado; comandos realmente executados e resultados; capturas/evidências quando pertinentes; limitações; decisões novas; próxima etapa. Atualizar a tabela e manter o resumo curto.
