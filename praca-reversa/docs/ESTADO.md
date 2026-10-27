# Estado do projeto

Atualizado em 26 de outubro de 2026.

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
| Dashboards: operação DHL e visibilidade do cliente | **Implementado e aplicado no desenvolvimento local** (13 out. 2026): Painel da operação, Volumes da janela (meta, separação e expedição por NF, sem SKU), Painel do cliente com perfil `CLIENTE_CONSULTA` (projeção no servidor), histórico e exportação; migração `20261016090000_paineis_volumes` aplicada com backup; conta de **teste** do cliente criada; sem janelas/metas reais ainda — ver seção abaixo |
| Endereços da Rua 11, Rua 12 e Grade | **Aplicado no desenvolvimento local** (14 out. 2026): Rua 11 A42–A58, Grade GR1–GR15 (de baixo para cima), Rua 12 pela planilha a partir de A79; 182 de 184 paletes no mapa, todos na posição do próprio endereço, sem reiniciar prazos — ver seção abaixo |
| Nomes reais do mapa + reconferência após 20 dias | **Implementado e aplicado no desenvolvimento local** (13 out. 2026): Ruas 11–16 (Rua 16 = FB05 à esquerda da Rua 15 = FB06) e Grade; 162 endereços confirmados (Ruas 12–16); **Rua 11 e Grade pendentes** (perguntas em DESCOBERTA.md); 140 paletes com posição; aviso laranja de reconferência por palete (20 dias, horário do servidor) — ver seção abaixo |
| Carga do inventário L’Oréal de 13/10/2026 | **Executada no banco de desenvolvimento** (13 out. 2026), que alimenta a versão de teste da porta 3000: **INV-000002** substitui o INV-000001 (1.239 linhas, 1.153 vínculos ativos, 184 paletes, 3 linhas sem RUA pendentes). **Nenhum palete com posição no mapa**: a tabela endereço ↔ posição do escopo real está vazia (sequências por faixa não informadas) — ver seção abaixo |
| Cadastro de conteúdo e conferência de volumes | **Implementado no desenvolvimento local** (11 out. 2026): "Registrar conteúdo" (remetente; NF/NFD/MI, número, Delivery e descrição opcionais) em `/conteudos/novo` (os endereços antigos `/produtos` e `/produtos/catalogo` levam a ele); "Conferência de volumes" (`/paletes/<id>/volumes`: contar ou registrar contagem já feita; previsto opcional); **catálogo de SKU retirado da interface** (D220). Migração `20261013090000_conteudo_palete` aplicada no banco de desenvolvimento em 13 out. 2026 (backup antes) |
| Redesign do front (+ ajustes de 08/10, 2ª rodada, e front aprovado) | **Implementado no desenvolvimento local** (8–11 out. 2026): nova moldura (menu lateral, cabeçalho com pesquisa em destaque, Inter, cores da prévia), indicadores reais, mapa restilizado na disposição real (verde = livre, lilás = agenda, neutro = estoque; conferência no contorno), seleção → resumo → "Ver mais" → "Recolher"/"Fechar", painel da seleção só após escolher, tabela de documentos × Deliveries, separação para agenda (solicitado × permanece), pesquisa também por remetente, recebimento em etapas. **Print da prévia aprovada não recebido**; pendentes de insumo: amostra real da bipagem, fonte dos volumes esperados, arquivo da agenda do cliente — ver seção abaixo |
| Ajustes operacionais de 08/10/2026 (1ª rodada) | **Implementados no desenvolvimento local** (8 out. 2026): palete livre em verde (confirmação no local ou por movimento/saída/retirada), posição clicável no mapa, legenda sem verde para conferência, painel esquerdo rolando inteiro, tela da bipagem simplificada. **Pendentes** (dependem de insumos): leitor fixo da bipagem (amostra real), volumes lidos × esperados, número do palete/sequência FULL, agenda do cliente — ver `RETOMADA-AJUSTES-2026-10-08.md` |
| Importação da bipagem real no palete (etapa 1 de `01-IMPORTACAO-BIPAGEM.txt`) | **Implementada no desenvolvimento local** (19 out. 2026): leitor fixo da exportação real (Tipo, Número, Lidos, CNPJ Remetente, Remetente reconhecidos pelo nome), prévia "com/sem volumes lidos" e volumes, gravação no cadastro de conteúdo + contagem informada de origem bipagem; verificada com a amostra real no banco de teste (63 registros, 47 volumes) — ver seção abaixo |
| Menu recolhível e espaço do mapa (etapa 2 de `02-MENU-E-ESPACO-DO-MAPA.txt`) | **Implementado no desenvolvimento local** (19 out. 2026): menu compacto/expandido com "Mais", coluna da lista desativada por `mostrarListaPaletesNoMapa = false` (reativação documentada), busca/QR/filtro/posições livres como ações compactas, mapa na largura toda, demonstração em indicador compacto — ver seção abaixo |
| Janela do palete (etapa 3 de `03-JANELA-DO-PALETE.txt`) | **Implementada no desenvolvimento local** (19 out. 2026): clicar no palete abre uma janela sobre o mapa (sem coluna à direita), conteúdo enxuto com tabela paginada, ações permitidas, detalhes completos recolhidos — ver seção abaixo |
| Vista inicial do mapa na L'Oréal (pedido de 20 out. 2026) | **Implementada no desenvolvimento local** (20 out. 2026): ao abrir, o mapa enquadra a área da L'Oréal (zona de baixo) com zoom calculado pelo espaço livre e endereços legíveis; "Focar L'Oréal" e "Ver praça completa"; navegação preservada; link/QR/busca localizam o palete onde ele estiver — ver seção abaixo |
| Seleção cliente — teste (pedido de 20 out. 2026) | **Implementada e ativada no desenvolvimento local** (20 out. 2026): simulação do cliente consultando o estoque (só leitura) e montando solicitações de teste para uma agenda (carrinho, revisão, envio bloqueado, alteração com aprovação/recusa, versões, histórico); acesso só por concessão explícita (`supervisor.praca`, `supervisor.teste`, `teste.supervisor`); migração aplicada com backup; **leitor da planilha do cliente aguarda o arquivo real** — ver seção abaixo |
| Painéis em uma tela (etapa 4 de `04-DASHBOARD-EM-UMA-TELA.txt`) | **Implementada no desenvolvimento local** (19 out. 2026): painel da operação e do cliente cabem numa tela no computador (1366×768, 1280×720, 1920×1080; menu compacto/expandido; claro/escuro) — filtros, quatro cartões, janela selecionada, situação da praça/etapas, volumes por rua e prioridades/histórico recente; detalhes, listas e definições ao clicar. Mesmos números da API (sem mudança de API, contrato ou permissão) — ver seção abaixo |
| Importação do Excel da bipagem no palete (versão de 8 out.) | **Substituída** pela etapa 1 acima (D249–D252). Histórico: implementada no desenvolvimento local (8 out. 2026): botão no detalhe do palete, página `/paletes/<id>/bipagem`, prévia com decisões e gravação transacional; testada com dados fictícios. **Layout real da bipagem não fornecido** (associação de colunas e formato na tela; pendências em `DESCOBERTA.md`) |
| Planilha automática e proteção dos dados (pedido de 23 out. 2026) | **Implementada e ativa no desenvolvimento local** (26 out. 2026): revisão por escopo, geração validada automática (≈12–15 s), backup diário automático e teste de restauração com dados reais aprovado; **destino independente não configurado** (falta o armazenamento autorizado e as credenciais) — ver seção abaixo |
| Palete × posição, validação sem endereço e conferência em tabela (pedido de 21 out. 2026) | **Implementado no desenvolvimento local** (21 out. 2026): número operacional, fila de validação interna, mover/validar/cancelar em lote, conferência do palete inteiro numa tabela (130 → 126 grava 126), estado e cor atualizados; migração aplicada com backup; correção dos dados reais simulada e aplicada — ver seção abaixo |
| Tema escuro + novo visual dos painéis | **Implementado no desenvolvimento local** (19 out. 2026): seletor Claro/Escuro (menu lateral e menu da conta), escuro DHL em todas as telas só na tela (impressão/etiquetas brancas); painéis com cartões grandes (apresentação substituída pela etapa 4, D259–D263), destaque amarelo, anel de ocupação, colunas por rua e anéis da janela — ver seção abaixo |

## Planilha automática e proteção dos dados — o que existe de fato (26 out. 2026)

Pedido `PROMPT-CLAUDE-PLANILHA-E-PROTECAO-AUTOMATICA.txt` (23/10); decisões D304–D310; configuração e procedimento em `IMPLANTACAO.md` (seção "Planilha automática e proteção dos dados"); retomada `RETOMADA-PLANILHA-PROTECAO.md`.

- **Entregue**: revisão crescente por escopo; geração validada (relê o XLSX) e envio ao destino registrados separadamente; aba Inventário com as 13 colunas da operação + situação/pendência/rastreabilidade (base ativa; validação e pendências do lote ativo identificadas, sem endereço nem quantidade inventados; "Não informado" fora da soma); Movimentações com antes/depois de auditoria, ocorrências, contagens, número do palete e volumes das janelas; Proteção e ajuda; destino `s3://` (SigV4 própria) ou compartilhamento de outra máquina, com gravação confirmada, revisão antiga nunca sobrescreve, retenção 50 + diária 30 d + pré-substituição 30 d; trabalhador no processo da API (fila/concessão no banco) e `protecao:processar` para agendador externo; backup completo diário e antes de substituições, enviado com `concluido.json`; teste de restauração com dados reais em banco isolado; proteção prévia obrigatória na substituição do inventário; tela com os seis estados, falhas, revisões e downloads; permissão `planilha.baixar`.
- **Banco de desenvolvimento (escopo real)**: backup antes (`…-20261026-133125Z-0f14b56c`); migração `20261026090000_planilha_protecao_automatica` aplicada. Ensaio somente leitura: 1.414 linhas (1.191 no estoque, 16 sem documento, 11 paletes sem conteúdo, 131 em validação, 65 pendentes do lote ativo INV-000005), 18.386 volumes conhecidos, 37 do estoque sem volume, 924 movimentações; snapshot + montagem + validação ≈ 1,4 s. Porta 3000 com o trabalhador: revisões 1 e 2 geradas (a 2 saiu ≈12 s depois da alteração registrada), backup diário automático `6d8702a8…` (local). **Teste de restauração real aprovado** (backup do dia, 96 tabelas, 17.904 linhas, 283 relações, banco isolado removido).
- **Não configurado (depende do usuário)**: destino independente (armazenamento autorizado da empresa + credenciais no `.env`). Sem ele, planilha e backup ficam só no servidor e a tela mostra "Não configurado" — verdadeiro, não verde.
- **Limites**: escopos de demonstração só por pedido manual; publicação S3 verificada contra serviço S3 local de teste (assinatura conferida com os exemplos oficiais da AWS), não contra um provedor real; arquivos grandes de backup são lidos inteiros na memória no envio (banco atual ≈ 5 MB por backup).

### Verificações (26 out. 2026)

| Comando / verificação | Resultado |
| --- | --- |
| Vitest `planilha.test.ts` (banco + S3 local de teste) e `protecao-destino.test.ts` (unidade) | **13 + 6 aprovados**: fila/revisão, trabalhador, Inventário reconciliável (validação, pendência do lote, "Não informado", texto literal), movimento/baixa parcial/complemento sem duplicar, publicação com versões e download, destino indisponível + retentativa, leitura adulterada recusada, reinício/concorrência/mesma revisão sem duplicar/revisão antiga não sobrescreve, retenção, substituição com proteção prévia (base anterior recuperável), sem backup = troca recusada, permissões (supervisor, operador, administrador, cliente, outro escopo), backup externo + restauração isolada a partir do destino, pasta local não independente; SigV4 = exemplos da AWS |
| `npm test` completo | 70 arquivos aprovados; os 7 com erro de conexão (rodada de 32 min concorrendo com o lint) **reexecutados sozinhos: 99/99**. Total: **658 testes aprovados** |
| E2E (Chrome) `e2e/planilha.spec.ts` | **2 aprovados** (supervisor reprocessa e baixa a revisão; operador só consulta); captura `docs/capturas/planilha/situacao-sem-destino.png` |
| `npm run lint` (completo), `typecheck` da API e da web, `npm run build` | Aprovados; porta 3000 reiniciada com o build |
| Banco de desenvolvimento | Backup antes + migração aplicada; ensaio de leitura com dados reais validado; revisões 1–3 geradas automaticamente (≈12–15 s depois da alteração registrada, ≈1,4 s cada); backup diário automático; `protecao:teste-restauracao` **aprovado com dados reais** |

## Palete × posição, validação sem endereço e conferência em tabela — o que existe de fato (21 out. 2026)

Pedido `CORRECAO-PALETES-CONFERENCIA-E-REFERENCIAS5.zip`; contrato `docs/CORRECAO-PALETES-CONFERENCIA.md`; decisões D289–D295.

- **Causa** (11 - A42 e dezenas de outros): a carga do inventário liga o palete pelo endereço; o palete 1 (06/10, 36 notas) e o 256 (20/10, NFD 9059802) ficaram no mesmo registro PR-000001. Recontagem: busca e notas liam o volume do inventário; a lista só via contagens feitas no próprio palete; o mapa pintava pela conferência por SKU.
- **Entregue**: número operacional como código ("Palete 256", PR-… legado e pesquisável); ocorrências VALIDACAO/CANCELADO com histórico; fila interna "Validação urgente — sem endereço" (cartão vermelho ao lado dos indicadores, página `/validacao`, resolver várias escolhendo o destino no mapa); na janela do palete, "Corrigir conteúdos" (um, vários ou todos: mover, enviar à validação, cancelar); conferência em tabela sobre o mapa (confirmar todos sem diferença com declaração física, registrar diferenças, parcial), que grava saldo e histórico juntos, fecha só depois de gravar e atualiza estado/cor; estado exibido único (Não conferido, Parcial, Conferido, Com diferença); indicador "Paletes com diferença na conferência"; comando `npm run paletes:corrigir`.
- **Banco de desenvolvimento (escopo real)**: backup antes da migração (`…-20261021-181208Z-fe420761`) e antes da correção (`…-20261021-185252Z-767f44b0`, em `.dados/backups/`); migração aplicada; `npm run paletes:corrigir … --usuario supervisor.praca --executar` (operação `97f6654e…`): **147 paletes com número operacional** (14 pendentes), **131 notas na validação** (2.199 volumes), **134 encerradas** (já em outro palete), **144 mantidas**. Relatório `.dados/correcoes/correcao-paletes-aplicada-20261021.md`. Conferido no banco: 11 - A42 = **Palete 256** (antes PR-000001), só a NFD 9059802 (117 volumes, FULL 3/9); as 36 notas antigas na validação, com histórico (a NFD 1102231 com a contagem 0 feita no piso).

### Verificações (21 out. 2026)

| Comando / verificação | Resultado |
| --- | --- |
| Vitest banco novos: `conferencia-tabela`, `correcao-conteudos`, `correcao-paletes` | 6 + 5 + 2 aprovados |
| `npx vitest run` completo (unidade + banco) | **75 arquivos, 644 testes aprovados** |
| E2E (Chrome) completo, `--grep-invert @captura` | **139 aprovados**, 0 falhas (92 pulados por projeto/celular); capturas da conferência em `docs/capturas/conferencia-tabela/` |
| `npm run typecheck`, lint dos alterados, `npm run build` | Aprovados; porta 3000 reiniciada com o build novo |

**Carga do inventário pelo N° Pallet** (D296, pedido seguinte): palete = N° Pallet único do endereço (o com esse número, ou o ainda sem número ligado a ele, que o recebe; senão um novo com o número); sem número único, vale o endereço. Não desfaz o aplicativo: palete movido fica onde está, posição com outro palete numerado → o novo entra sem posição, nota movida continua onde foi levada (e não é encerrada como ausente), nota em validação ou cancelada não é recriada; nota que a versão nova põe noutro palete encerra a cópia antiga. Testes `carga-numero-palete.test.ts` (4 cenários novos) e `carga-lote` / `correcao-paletes` / `selecao-teste` ajustados (códigos agora são o N° Pallet). Suíte completa: 637 de 648 na primeira rodada; as 11 falhas eram todas do `selecao-teste` esperando `PR-…` — ajustado, 13/13. Lint e `npm run build` aprovados. Nenhuma carga nova foi feita nos dados reais.

**Limites**: números com dois N° Pallet no endereço ficam PR-… até confirmação; a ajuda por tarefa ainda descreve só a conferência por SKU.

## Importação fixa da bipagem "Etiquetas" — o que existe de fato (21 out. 2026)

Pedido `IMPORTADOR-ETIQUETAS-PYTHON.zip`; contrato `docs/IMPORTACAO-BIPAGEM.md`; decisões D283–D288 (substituem D249–D252). README, seção "Importar bipagem "Etiquetas"".

- **Fluxo**: Recebimento → "Importar a bipagem e escolher a posição no mapa" (`/bipagem`) ou palete → "Importar bipagem". Arquivo → prévia (notas a importar, volumes, total; sem volumes e pendências à parte; CNPJ e Última Leitura em "Mais informações") → mapa (posição vazia = palete novo; palete = acrescentar) → notas repetidas (Revalidar / Importar separadamente) → confirmar → número definitivo.
- **Banco de desenvolvimento**: migração `20261021150000_bipagem_etiquetas` aplicada com backup antes (`.dados/backups/praca-reversa-backup-praca_reversa_dev-20261021-161802Z-a06dea60`); numeração do escopo real definida por `npm run paletes:numeracao … --ultimo 278 --reservar 1000-1015 --executar` (próximo **279**; registrado na auditoria). A amostra real **não** foi importada em nenhum escopo; nenhum palete foi criado no escopo real.
- **Python**: não é necessário (leitor reescrito em TypeScript; os 11 casos do `testar_leitor.py` rodam no Vitest). Os 11 testes Python originais também passaram contra a amostra (Python 3.14 da máquina), só como conferência.

### Verificações (21 out. 2026)

| Comando / verificação | Resultado |
| --- | --- |
| `python testar_leitor.py` (pacote, só conferência) | 11 OK |
| Vitest `packages/contracts/src/bipagem.test.ts` + `apps/api/test/unidade/bipagem-leitor.test.ts` | 7 + 7 aprovados (casos do Python portados) |
| Vitest `apps/api/test/banco/bipagem.test.ts` (PostgreSQL de teste, escopo de demonstração, amostra + fictícios) | **7 aprovados** (ver contrato, "Testes") |
| E2E `bipagem.spec.ts` (Chrome, computador e celular, com capturas em `docs/capturas/bipagem-etiquetas/`) e `janela-palete.spec.ts` | 4 + 6 aprovados |
| Typecheck (contratos, API com testes, web, raiz/E2E), lint dos alterados, `npm run build` | Aprovados |
| `npm test` completo | 72 arquivos, 631 testes: 628 aprovados; as 3 falhas eram listas/valores fixos antigos (migrações do `banco-e-seed`, resultado exato do `importacao.test`) e o guia rodado antes da ajuda nova — corrigidos e repetidos: **37/37**. |

**Limites**: verificação local (bancos de teste/E2E). Os paletes antigos mantêm o código PR-… (só os novos usam a série do piso). O mapa não pinta as posições livres de outra cor além do desenho atual (a ajuda da tela orienta: "posição vazia"). Lote de bipagem aberto antes desta versão precisa ser cancelado e reenviado.

## Versão de teste sempre ligada (21 out. 2026)

Pedido do usuário: manter banco e servidor (porta 3000) ligados, iniciando com o computador e reiniciando se cair. Tarefa do Windows **"Praca Reversa - servidor 3000"** (usuário atual, ao entrar no Windows + conferência a cada 15 min, sem duplicar) roda `scripts/manter-servidor.mjs`: sobe o PostgreSQL local quando parado (conferência a cada 30 s), mantém `apps/api/dist/server.js --porta=3000`, reinicia se cair (espera crescente até 60 s) e depois de um build novo (dist estável por 15 s). Instalação/remoção: `scripts/instalar-tarefa-servidor.ps1` (README). Verificado: tarefa "Running", http://127.0.0.1:3000 respondendo; servidor derrubado de propósito voltou em ~10 s; banco parado de propósito voltou em ~14 s. Limite: só sobe depois que alguém entra no Windows (subir antes do logon exigiria guardar a senha do Windows na tarefa).

## 15 - A22 = 15 - A122 — INV-000005 (21 out. 2026, ativo)

Decisão do usuário (D282): as 10 linhas de "15 - A22" (N° Pallet 1012) foram para o palete PR-000163 (15 - A122) com reconferência necessária. Backup antes (`…-20261021-025629Z-f5ea8d33`); carga `--substitui INV-000004 … --corrigir-endereco "15 - A22=15 - A122"` = **INV-000005**: 10 vínculos criados, 1.025 iguais, **45 linhas ainda em revisão** (RUA = VALIDAR 44, fórmula B344 1), **28 paletes com reconferência necessária**, 409 notas antigas "não consta". Teste fictício da correção no `inventario-loreal.test.ts` (5/5).

## Linhas em revisão nos paletes — INV-000004 (21 out. 2026)

Decisão do usuário (D280–D281): as linhas em revisão com endereço válido foram para o palete do endereço e esses paletes ficaram com **"Reconferência necessária"** (motivo na janela; sai com a reconferência completa). Backup antes (`.dados/backups/praca-reversa-backup-praca_reversa_dev-20261021-025016Z-668d7a9e`), migração `20261021120000_reconferencia_exigida` aplicada no banco de desenvolvimento, carga `--substitui INV-000003 --manter-ausentes --alocar-revisao … --decisao …` = **INV-000004** (relatório `.dados/cargas/INV-000004-2026-10-21T02-51-07-802Z.md`).

- 1.115 linhas: 305 aplicadas, 736 já importadas, 19 repetidas agrupadas sem somar; **55 continuam em revisão** (RUA = VALIDAR 44, 15 - A22 10, fórmula B344 1).
- 165 endereços com palete (1 palete novo, 164 com ID preservado, todos no mapa); **27 paletes com reconferência necessária** (filtro "Precisam de reconferência" = 27).
- Vínculos: 130 criados, 159 atualizados (anteriores encerrados), 736 iguais; notas antigas "não consta" caíram de 574 para **409**; 19 com volumes a confirmar (linhas repetidas).
- Interface (3100, `supervisor.praca`): PR-000063 (14 - A107) com 32 notas, 148 volumes, "Precisa conferir" e o motivo.
- Verificações: `vitest` unidade (relógio e janela, 9/9), banco `inventario-loreal` (4/4) e módulos afetados (`banco-e-seed`, `carga-lote`, `conteudos`, `paineis`, `permissoes-e-praca`, `reconferencia`: 71/71); typecheck e lint aprovados; build refeito e 3100 reiniciada.

## Inventário L'Oréal de 20/10/2026 — carregado (INV-000003, em validação)

Pedido do usuário (pacote `INVENTARIO-LOREAL-DADOS-E-PROMPT.zip`). Decisões D274–D279; README, "Inventário L'Oréal preparado". **Base real e provisória**: "Inventário em validação", nada certificado ao cliente.

- **Executado no banco de desenvolvimento** (PostgreSQL local 127.0.0.1:5433, `praca_reversa_dev`, escopo real `PRACA-REVERSA/LOREAL`; o mesmo da versão de teste da porta 3000), em 21 out. 2026 01:02 UTC, com backup antes (`.dados/backups/praca-reversa-backup-praca_reversa_dev-20261021-004730Z-a7bdcc2a`). Comando: `npm run inventario:carregar -- --arquivo "<zip>" --unidade PRACA-REVERSA --cliente LOREAL --usuario supervisor.praca --substitui INV-000002 --manter-ausentes --executar`. Relatório (dados reais): `.dados/cargas/INV-000003-2026-10-21T01-02-09-488Z.md`.
- **Resultado**: 1.115 linhas guardadas (todas recuperáveis); 753 candidatas alocadas provisoriamente (707 aplicadas + 38 já importadas + 8 repetidas agrupadas sem somar; 13.570 volumes); **362 em revisão sem alocação** (3.954 volumes, fora dos totais), agrupadas por causa: endereço com mais de um N° Pallet 229, mesmo N° Pallet em vários endereços 50, RUA = VALIDAR 44, linhas iguais 18, N° Pallet ausente 17, endereço fora da regra (15 - A22) 10, recontagem com quantidade diferente 4, fórmula inválida (B344) 1. Vínculos: 151 criados, 541 atualizados (PALLET FULL agora "FRACIONADO"; anteriores encerrados com histórico), 38 iguais; **574 de versões anteriores mantidos ativos** como "não consta do inventário atual". Paletes: 186 (2 novos, 140 reaproveitados com ID, **todos com posição no mapa**); 91 só com notas da versão atual, 42 com notas atuais e antigas, 44 só com notas antigas, 9 sem nota. 11 - A57 mantido (PR-000011). Relógio de 20 dias intacto (nenhuma movimentação registrada pela carga).
- **Reenvio** do mesmo comando: reconhecido ("já foi importado como INV-000003"), nada gravado; 1.304 vínculos ativos antes e depois.
- **Interface**: janela do palete com "Inventário: Em validação · base 20/10/2026", coluna Inventário (FULL n/m ou Fracionado, conferência informada por linha ou "a validar", "Não consta do inventário atual"), Delivery ao lado do documento, volumes e tipo do palete pelas notas da versão atual (as que não constam somadas à parte), origem/PF-CNPJ/documentação em "Informações adicionais"; tela do inventário com "Pendências agrupadas" (causa → endereço/N° Pallet, "ver linhas"); busca interna acha as linhas em revisão com a causa; painel do cliente com aviso de base provisória.

### Verificações (20–21 out. 2026)

| Comando / verificação | Resultado |
| --- | --- |
| `vitest --project banco inventario-loreal.test` (dados fictícios) | 3 aprovados: conversão (NF em dois FULL sem multiplicar, revisão, base em validação), gravação (revisão sem palete/vínculo, FULL/Fracionado/conferência na janela, FRACIONADO de uma nota não vira full, pendências agrupadas, busca com causa, reenvio sem duplicar), nova versão com ausentes mantidos e o mesmo comando repetido como reenvio. |
| `npm test` completo (antes do ajuste do reenvio) | 72 arquivos, 620 testes: 619 aprovados; a falha era ordem não garantida na busca do teste novo (corrigido); `carga-lote`, `inventario-loreal`, `paineis` repetidos: 29/29. |
| Typecheck (contratos, API, web) e lint das áreas alteradas | Aprovados. |
| SQL de reconciliação (`.dados/conferir-inventario-20-10.tmp.mts`) | Números acima; linhas por ação somam 1.115; volumes por estado separados. |
| Conferência visual (`.dados/capturar-inventario-20-10.tmp.mjs`, `supervisor.praca`, capturas em `.dados/capturas/inventario-20-10/`, fora do versionamento) | PR-000001 (11 - A42): 117 volumes, FULL 3/9, conferência 16/10/2026, +66 em 36 notas que não constam; PR-000002: FULL 1/9; inventário INV-000003 em validação com 8 grupos; busca de linha em revisão com a causa. Sem erro de console além do 401 antes do login. |

**Limites**: verificação local (banco de desenvolvimento). As 574 notas mantidas e as 362 linhas em revisão dependem da validação no piso; encerrar uma nota ausente ou resolver uma linha em revisão continua manual (nenhuma tela nova para isso nesta etapa). Os painéis não separam "não consta" (contam as notas mantidas). A coluna INVENTÁRIO das versões anteriores não foi guardada (não havia data anterior a preservar).

## Seleção cliente — teste — o que existe de fato (20 out. 2026)

Pedido do usuário de 20 out. (simulação do cliente consultando o estoque e montando uma solicitação para uma agenda de saída; prioridade: janela do palete compreensível no primeiro uso). Decisões D267–D273; README, seção "Seleção cliente — teste". **Ambiente de teste — não movimenta estoque.**

- **Acesso**: menu da conta → "Seleção cliente — teste", só com a concessão explícita no vínculo (Administração de acesso → "Liberar Seleção cliente — teste"; supervisor de estoque ou administrador). Desligar tudo: `SELECAO_CLIENTE_TESTE=desativada`.
- **Consultar e escolher** (`/selecao-teste`): agenda (janela existente só como referência, ou agenda própria do teste); lista pesquisável (palete, tipo + número, remetente, Delivery); "Ver mapa" (mapa em consulta, pesquisa e carrinho preservados ao voltar); janela do palete com palete inteiro × escolher notas, quantidade/Delivery/observação por nota, "Mais informações" só com dados existentes, prévia exata e "Adicionar à seleção".
- **Revisar** (`/selecao-teste/solicitacoes/<id>`): ajustar quantidades, Deliveries e observações; total só com quantidade definida; itens em análise destacados; conferência do estoque antes de enviar (antes/agora, "Usar dados atuais" sem trocar quantidade).
- **Enviar e acompanhar** (`/selecao-teste/solicitacoes`): bloqueio após envio (servidor), pedido de alteração com explicação, aprovação/recusa com resposta, revisão em nova versão (anterior guardada), solicitação adicional para a mesma agenda, aviso de conteúdo em outro pedido da mesma agenda, histórico.
- **Banco**: migração `20261021090000_selecao_cliente_teste` (coluna `vinculo.selecao_cliente_teste` + tabelas `selecao_teste_*`, versões e histórico imutáveis por gatilho, sem gatilho da planilha). **Aplicada no banco de desenvolvimento** em 20 out. 2026 com backup antes (`.dados/backups/praca-reversa-backup-praca_reversa_dev-20261020-231459Z-a8a6c010`). Concessão ligada para `supervisor.praca` (escopo real, consulta do estoque real), `supervisor.teste` e `teste.supervisor` (demonstração).

### Verificações (20 out. 2026)

| Comando / verificação | Resultado |
| --- | --- |
| `vitest --project banco selecao-teste.test` (PostgreSQL real, escopo operacional fictício) | **13 aprovados**: acesso (concessão, operador/cliente negados, funcionalidade desligada = 404), administração da concessão e CHECK do banco, consulta/pesquisa e janela do palete, palete full inteiro, nota de palete misto, 13 de 100 com Delivery, Delivery sem quantidade (análise, sem o total da nota), limites de quantidade e soma por Delivery, conflito palete inteiro × nota com troca, ajustes/remoção/versão desatualizada/outro usuário, envio com versão 1 e bloqueio no servidor, clique repetido (mesma chave = um envio), estoque alterado antes do envio, alteração recusada/aprovada com versões e histórico, solicitação adicional com aviso, **nenhuma tabela da operação alterada** (paletes, vínculos, conteúdos, contagens, eventos de volumes, metas, reservas, expedições, saldos, eventos, endereços, reconferências, seleções, fila da planilha e auditoria). |
| Vitest unidade web `escolha.test.ts` | 4 aprovados (quantidade inteira até o informado, Delivery não discriminada em análise, volume desconhecido não vira zero). |
| Typecheck (contratos, API, web), lint dos arquivos novos/alterados, `npm run build` | Aprovados. |
| Conferência visual (`.dados/capturar-selecao-teste.tmp.mjs`, 1366×768, demonstração do banco de desenvolvimento) | Menu → agenda → lista → janela do palete → carrinho → mapa e volta (pesquisa mantida) → revisão → confirmar → enviada; claro e escuro; sem erro de console além do 401 antes do login. Capturas em `docs/capturas/selecao-teste/`. |
| Consulta só de leitura no escopo real (`.dados/conferir-selecao-teste-real.tmp.mts`) | 184 paletes (82 mistos, 91 full, 11 sem composição), 1.153 notas, 36 sem volume, 348 com Delivery; primeira página em ~100 ms; busca por número encontra a nota. |
| `npm test` completo | 71 arquivos, 615 testes: **614 aprovados** na rodada completa (~16 min); a falha era a lista fixa de migrações em `banco-e-seed.test.ts` (faltava a nova), corrigida e o arquivo repetido: **10/10**. |
| E2E `e2e/selecao-teste.spec.ts` (21 out., `PLAYWRIGHT_CANAL=chrome`, computador, escopo de cadastro com dados fictícios) | **2 aprovados**: (1) operador sem a área (tela "Sem permissão", API 403, sem item no menu); administrador libera para o supervisor na Administração de acesso (operador não recebe a opção). (2) agenda de teste → pesquisa → nota de palete misto com 8 de 12 → palete inteiro recusado e trocado (17 volumes) → mapa e volta com a pesquisa mantida → palete full inteiro (37) → revisão → contagem muda antes do envio (diferença, "usar dados atuais") → envio e bloqueio no servidor (409 `SOLICITACAO_BLOQUEADA`) → alteração recusada (continua enviada) e aprovada (revisão, retirada de item, versão 2 com a 1 guardada) → solicitação adicional com aviso de conteúdo já pedido → lista com as duas → notas, contagens e situação dos paletes intactas. A concessão é retirada no fim. Celular: pulado (fluxo de computador). |
| E2E completo (21 out., `PLAYWRIGHT_CANAL=chrome`, sem `@captura`, com as mudanças do inventário de 20/10) | 135 aprovados, 89 pulados, 1 falha: `caminho-base.spec.ts` esperava "contrato 10" (o contrato passou a 11 em D267); corrigido e repetido: **1/1**. |

**Limites**: verificação local; a área de demonstração do banco de desenvolvimento não tem notas cadastradas (os paletes aparecem como "conteúdo não identificado") — o teste com notas reais é pelo escopo real (`supervisor.praca`). E2E específico desde 21 out. (`e2e/selecao-teste.spec.ts`, abaixo). Nenhuma janela real cadastrada no escopo real: a agenda usada será a agenda própria do teste. **O leitor da planilha enviada pelo cliente (seleção importada) não foi alterado: o ajuste aguarda o arquivo real.** Validade não existe no cadastro (não aparece). Responder alterações é feito pela mesma pessoa no teste (as duas permissões vêm juntas na concessão).

## Vista inicial do mapa na L'Oréal — o que existe de fato (20 out. 2026)

Pedido do usuário de 20 out. (a imagem de referência citada não chegou; a área foi identificada nos dados: zona `Z-ATIVA` "Praça da reversa · L'Oréal", igual no escopo real e na demonstração). Decisões D264–D266; `docs/MAPA-ZOOM.md`. Só interface: endereços, posições e dados inalterados.

- **Vista inicial**: área principal inteira (posições vazias incluídas) no maior zoom que cabe entre os controles sobrepostos medidos na hora (computador) ou as margens fixas (celular); zoom calculado, sem nível fixo; aplicada uma vez, depois que o layout e o tamanho do mapa existem.
- **Ações**: "Focar L'Oréal" (e Home) volta ao enquadramento inicial; "Ver praça completa" mostra as posições superiores (substitui "Visão geral"). Centralizar/link/QR/busca localizam o palete onde ele estiver; o link aberto com a página vence o enquadramento inicial.
- **Rótulos**: novo nível com endereço curto ("A120") para posições de 30–60 px; 60–112 px endereço completo; a partir de 112 px código e situação. No computador, ferramentas em coluna à esquerda e legenda estreita no canto inferior esquerdo.
- **Medido na demonstração**: 1366×768 — zoom −0,87, posição com 38 px, 194 endereços curtos em 11,5 px, área usando 91% da altura do mapa; 1920×1080 — zoom −0,19, 61 px, endereços completos em 11 px, 97% da altura; nenhum endereço cortado; abrir/fechar a janela e recolher/expandir o menu não mudaram zoom nem centro. Capturas em `docs/capturas/mapa-inicial/` (inicial e praça completa nos dois tamanhos).

### Verificações (20 out. 2026)

| Comando / verificação | Resultado |
| --- | --- |
| Vitest unidade da web (inclui `enquadramento.test.ts`: área principal, margens livres, endereço curto, níveis) | **17 arquivos, 84 aprovados**. |
| Typecheck da web e do E2E, `npm run lint` (árvore inteira), build da web | Aprovados. |
| E2E `mapa-inicial.spec.ts` (Chrome, computador) | **4 aprovados**: 1366×768 e 1920×1080 (área inteira na tela, fora dos controles, > 85% da altura, ≥ 194 endereços, nenhum cortado, fonte ≥ 10 px, superiores fora da vista; "Ver praça completa" mostra as 300 superiores; "Focar L'Oréal" volta ao mesmo zoom/centro); janela do palete e menu sem mudar a câmera; link do palete localiza o palete (zoom ≥ 0,75). |
| E2E completo (Chrome) | **134 aprovados, 0 falhas, 87 pulados por perfil** (8,9 min), com os testes que usavam "Visão geral" atualizados. |

**Limites**: verificação local (escopo de demonstração e banco do E2E), nada no ambiente do piloto. Na demonstração só a Fileira 11 tem endereços confirmados; as demais mostram o número da posição. As posições superiores do desenho aprovado estão desativadas, então o caso "palete fora da área principal" foi verificado pelo comportamento de centralizar (que não depende da área), não com um palete real lá. Versão de teste da porta 3000: `npm start` depois do build e recarregar a aba (Ctrl+Shift+R).

## Painéis em uma tela — o que existe de fato (etapa 4, 19 out. 2026)

Pedido: `Downloads/04-DASHBOARD-EM-UMA-TELA.txt` (as imagens `atual/` e `referencias/` não estavam na máquina; diagnóstico pelas capturas próprias). Decisões D259–D263; definições em `INDICADORES.md` ("Apresentação em uma tela"). Só interface: API, contratos, permissões e regras de cálculo inalterados.

- **Operação (`/painel`)**: título só no cabeçalho; linha de filtros (janela, período, Atualizar, hora da consulta, Detalhes, ?); cartões **Paletes na praça**, **Volumes registrados** (notas/minutas, sem volume), **Sem endereço** (NFs sem palete à parte), **Precisa conferir** (regra persistida de 20 dias); **Janela selecionada** (Solicitado, Separado, Expedido, Falta separar, Falta expedir; barras Preparação = (P+E)/T e Expedição = E/T só com meta válida); **Situação da praça** (barra segmentada: ocupadas, livres confirmadas, ocupação desconhecida); **Volumes por rua** (uma medida, "n/i" ≠ zero); **Prioridades** (uma de cada tipo; "Ver todas"). Detalhes/Comparar/Tabela/Ver todas abrem em janela; cartões abrem `/painel/estoque` com o mesmo filtro e o mesmo total.
- **Cliente (`/painel/cliente`)**: cartões Paletes, Volumes registrados, Solicitado e Expedido (janela escolhida; abrem a seleção), janela selecionada, etapas da seleção, volumes por rua ("Localização em atualização"), **histórico recente** no lugar das prioridades; "Estoque e histórico" abre a consulta completa e a exportação (`?aba=…`). Projeção no servidor sem mudança.
- **Antes × depois** (`docs/capturas/etapa4-dashboard/`, página inteira com o tamanho no nome): antes, a operação tinha 2.422 px de altura e o cliente 1.892 px (três telas em 768 px); depois, a página não rola em nenhum dos tamanhos pedidos.

### Verificações (19 out. 2026)

| Comando / verificação | Resultado |
| --- | --- |
| `npm run typecheck`, `npm run build` | Aprovados: `npm run build` completo; typecheck da web (`npm run typecheck -w @praca-reversa/web`) e do E2E (`tsc -p tsconfig.json`). |
| Vitest (`npm test`: unidade + banco; inclui `resumo-dados.test.ts` com T 8.000/P 4.500/E 2.000 → 1.500, 6.000, 81,25%, 25,00%, e a amostra real da bipagem no painel) | **68 arquivos, 592 aprovados** (15,6 min). Primeira rodada: 3 falhas — o teste "10 → 12" da bipagem dependia da ordem de dois conteúdos criados no mesmo instante (corrigido para comparar sem ordem) e `carga-lote` esperou bloqueio no banco de teste por 50 min (passou isolado e na rodada completa seguinte). |
| Bipagem no painel (banco de teste, amostra `amostras/Bipagem-real.xlsx`) | Depois de importar no palete de teste: volumes contados e "Volumes registrados" **+47**, notas/minutas **+41** (não 63), mesmo número de paletes, informado inalterado, relógio de 20 dias do palete intacto após abrir o painel. |
| E2E da etapa 4 (`painel-uma-tela.spec.ts` + `paineis.spec.ts`, Chrome, `CAPTURAR=1`) | **11 aprovados, 0 falhas** (7 pulados por perfil): operação e cliente em 1366×768, 1280×720 e 1920×1080 com menu compacto/expandido e claro/escuro (página e `main` sem rolagem, widgets inteiros na tela, nada cortado, fonte ≥ 12 px, sem transform/zoom); sem dados ("Não informado", sem "0 / 0", "Em dia" ou %); nome longo de janela com meta 8.000 em 1280×720 menu expandido; celular (operação e cliente sem rolagem lateral no documento nem no `main`); cartões → listas com o mesmo total; janela de teste T 10 / P 5 / E 3 no resumo (2, 7, 80,00%, 30,00%). Capturas em `docs/capturas/etapa4-dashboard/`. |
| E2E completo (Chrome) | **132 aprovados, 0 falhas, 85 pulados por perfil** (8,8 min). |
| `npm run lint` | Aprovado (árvore inteira, sem avisos). |
| Navegador (Vite 5173 → API 3100, escopo de demonstração) | 1366×768 claro/escuro, 1280×720 menu expandido (folga ~40 px), 1920×1080; janela "Detalhes" aberta e fechada. |

**Limites**: verificação local (demonstração e bancos de teste/E2E), nada no ambiente do piloto; o escopo de demonstração tem poucos dados (sem conteúdos/volumes e sem meta), então "Não informado" e "Sem meta" aparecem bastante nas capturas. Com mais altura útil (1080 px) as listas curtas mostram mais linhas (prioridades 8, histórico 7); em janelas muito baixas ou zoom de acessibilidade a página volta a rolar (nada é cortado). Versão de teste da porta 3000: `npm start` depois deste build e recarregar a aba (Ctrl+Shift+R).

## Menu recolhível, espaço do mapa e janela do palete — o que existe de fato (etapas 2 e 3, 19 out. 2026)

Pedidos: `Downloads/02-MENU-E-ESPACO-DO-MAPA.txt` e `Downloads/03-JANELA-DO-PALETE.txt` (as capturas `atual/` citadas na etapa 2 não estavam na máquina). Decisões D253–D258. Só interface: sem mudança de API, contrato ou banco.

- **Menu** (computador): compacto (68 px, ícones, padrão) ou expandido (216 px) pelo botão do topo; nome acessível e dica nos ícones; Mapa, Inventário, Recebimento, Agendas e Painel à vista, demais páginas em **Mais**; escopo e tema no rodapé; preferência só visual no navegador. Celular: páginas no menu da conta.
- **Lista de paletes à esquerda**: desativada por `mostrarListaPaletesNoMapa = false` em `apps/web/src/features/mapa/configuracao.ts` (reativar: `true` + `npm run build` + reiniciar). Componente preservado; no celular continua na aba "Lista". No computador: resultados da busca do cabeçalho flutuam sobre o mapa; Enter com link/ID do QR abre o palete; **Ler QR** e **Filtrar** (código/posição, conferência, "Precisam de reconferência", etiquetas do resultado) no canto do mapa; posições livres no indicador; nota do layout na legenda.
- **Espaço**: cabeçalho de 56 px (cabe em 1280 px; antes o menu da conta saía da tela), indicadores numa linha, controles do mapa em ícones, "Demonstração ⓘ" no cabeçalho com explicação ao abrir (sem a faixa larga). Capturas antes/depois em `docs/capturas/etapa2-menu-mapa/` (1366×768, 1280×720, 1920×1080; mapa, menu expandido e "Mais").
- **Janela do palete**: clicar no palete (mapa, busca, lista do celular, link/QR) abre a janela sobre a página; o mapa mantém tamanho, posição, zoom e pesquisa; fechar (botão, Esc, clique fora; voltar no celular) mantém a seleção e a rota. Cabeçalho "Palete <número>" + endereço real ou informado; resumo (volumes com a base, notas/minutas, Full/Misto, agenda, aviso de reconferência); tabela Tipo | Número | Remetente | CNPJ | Volumes (ordem por tipo e número, 50 por página); "Informações adicionais" e "Detalhes completos e outras ações" (detalhe existente inteiro, com posição e ID permanente) recolhidos; ações Conferir volumes, Importar bipagem, Registrar conteúdo, Centralizar, Etiqueta (por permissão). Posição sem palete e palete fora do mapa carregado também abrem em janela. Capturas em `docs/capturas/etapa3-janela-palete/` (1366×768 e 390×844, janela fechada e aberta).

### Verificações (19 out. 2026)

| Comando / verificação | Resultado |
| --- | --- |
| `npm run typecheck` (inclui E2E), `npm run build` | Aprovados. |
| Vitest unidade (contratos e web, inclui `janela.test.ts` e `guia.test.ts`) | **34 arquivos, 254 aprovados**. |
| Script de verificação `.dados/capturas-etapa3.tmp.mjs` (servidor 3100, escopo de demonstração, só leitura) | 1366×768 e 390×844: sem janela ao entrar, foco no título, foco contido no Tab, Esc fecha, zoom/centro iguais com a janela aberta e depois de fechar, rota mantida, troca de palete mostra o novo, sem coluna direita nem esquerda. |
| E2E completo (Chrome, primeira rodada após as mudanças) | **113 aprovados, 13 falhas, 79 pulados por perfil**: testes presos ao layout antigo (resumo/"Ver mais", "Registrar conteúdo" fora do "Mais", dois botões "Centralizar", janela cobrindo botões, ordem da tabela, balão do tutorial maior no celular). Corrigidos os testes; no código, a tabela da janela passou a ordem estável (tipo e número) e o texto do passo 3 do tutorial voltou ao tamanho anterior. |
| E2E dos specs que falharam, repetidos | Todos aprovados. **Suíte E2E completa final (Chrome): 126 aprovados, 0 falhas, 79 pulados por perfil** (7,5 min). Capturas `@captura` da janela: 2 aprovados (`docs/capturas/etapa3-janela-palete/e2e-*.png`). |
| `npm run lint` | Aprovado (árvore inteira, sem avisos). |

**Limites**: verificação local (escopo de demonstração e banco do E2E), nada no ambiente do piloto. Com a lista desativada, o percurso da lista com setas e a ajuda curta do mapa só existem no celular (no computador a ajuda fica em "Ajuda"). Versão de teste da porta 3000 parada: `npm start` e recarregar a aba (Ctrl+Shift+R) para ver as mudanças.

## Importação da bipagem real no palete — o que existe de fato (19 out. 2026)

Pedido: `Downloads/01-IMPORTACAO-BIPAGEM.txt` (só a etapa 1). Contrato: `IMPORTACAO-BIPAGEM.md`. Decisões D249–D252. Amostra: `amostras/Bipagem-real.xlsx` (cópia de `Etiquetas (1).xlsx`, md5 `da2d4901…`; pasta fora do versionamento por ser dado real).

- **Tela**: palete → **Importar bipagem** → `/paletes/<id>/bipagem` → arquivo → **Ler arquivo** → prévia ("com volumes lidos", "sem volumes lidos", "volumes", campos lidos com a coluna, documentos e situação no palete, conflitos, registros sem leitura, erros por linha) → **Importar para este palete**. `/bipagem` sem palete só pede o palete. Sem colunas, separador, datas, SKU, unidade, código de barras, embalagem ou fator na tela.
- **API**: o envio (`POST /importacoes?tipo=BIPAGEM&palete=`) já devolve a prévia; decisões por `PUT …/mapeamento` (`parameters.decisions`); confirmação transacional com o palete travado. Persistência: `conteudo_palete` (`origem = BIPAGEM`, CNPJ original e dígitos, tipo original, lote, linha) + `contagem_volumes` (`origem = BIPAGEM`, lote, linha, `chave_bipagem`); Lidos = 0 só no lote. Identidade tipo + número + CNPJ por palete (índice único). NF-e → NF, Minuta → MI (original preservado; NF-e nunca NFD).
- **Regras verificadas**: reenvio do mesmo arquivo recusado como já importado; mesmos dados em outra ordem = "sem mudança", nada a gravar; 10 → 12 substitui (vale 12, nunca 22); contagem à mão posterior mantida salvo "Usar a contagem do arquivo"; conteúdo sem CNPJ com o mesmo número pede "mesmo/outro documento"; zero não cria, apaga nem zera; ausência não apaga; Delivery/descrição/remetente editados preservados; só conteúdo novo reinicia o prazo de 20 dias.
- **Ajuda**: guia novo "Importar a bipagem no palete" (central de ajuda) e `GUIA-DO-OPERADOR.md` regenerado; textos do recebimento e da conferência de volumes atualizados.
- **Banco de desenvolvimento**: migração `20261019090000_bipagem_real` aplicada com backup antes (`.dados/backups/praca-reversa-backup-praca_reversa_dev-20261019-171319Z-c17829f6`). Conferido só por leitura: escopo real com 184 paletes, 1.153 vínculos, 0 conteúdos e 0 contagens (nada importado nele). A amostra real **não** foi importada no escopo real nem no de demonstração (demonstração exige dados fictícios).

### Verificações (19 out. 2026)

| Comando / verificação | Resultado |
| --- | --- |
| `apps/api/test/banco/bipagem.test.ts` (PostgreSQL de teste, escopo de demonstração) | **8 aprovados**. Amostra real: prévia 63/41/22/47, NF-e 55/35/40, Minuta 8/6/7, 61 identidades, colunas C/D/G/J/K; confirmação → API `/paletes/:id/conteudos` com 41 conteúdos, soma 47, NF-e 285987 = 5 (NF/NF-e, CNPJ 03.962.539/0002-09), Minuta 1379 = 1; **banco**: 41 `conteudo_palete` BIPAGEM, 41 contagens, vigente 47, 63 linhas no lote (22 `SEM_LEITURA`, 41 gravadas), relógio `ENTRADA_CONTEUDO`; reenvio do mesmo arquivo = já importado; reordenado (5 colunas, outra ordem, cabeçalhos em caixa/espaços diferentes) = 41 sem mudança, banco idêntico (inclusive o prazo); mesmo arquivo em outro palete permitido. Fictícios: 10 → 12 substitui sem renovar o prazo; edição + contagem à mão preservadas e conflito; zeros e ausência; identidade por CNPJ e tipo; CNPJ sem pontuação e CSV; erros por linha (vazio, 1.5, −1, CT-e, CNPJ/remetente vazios, repetido) e coluna ausente (nada gravado); "mesmo documento"/"outro documento"; consulta → 403; palete arquivado bloqueado. |
| `apps/api/test/unidade/bipagem-leitor.test.ts` (leitor isolado, sem banco) + `packages/contracts/src/bipagem.test.ts` | **5 aprovados** (amostra real: 63, 55/8, 47, 41, 35, 40/7, 22, 61; NF-e 285987 = 5; 1379 e 1376 com a linha zero; cabeçalhos em outra ordem/linha; coluna ausente). |
| `npm run typecheck`, `npm run build` | Aprovados. |
| `npm test` completo | **66 arquivos, 585 testes: 584 aprovados, 1 falha esperada** (lista de migrações do `banco-e-seed` sem a nova); lista atualizada e arquivo repetido: **10/10**. |
| `npm run lint` completo | Limpo. |
| E2E `bipagem.spec.ts` (Chrome, computador e celular, dados fictícios no layout real) | **2 aprovados**: palete → Importar bipagem → prévia (3 com leitura, 1 sem, 13 volumes, colunas C/D/G/J/K) → importar → conteúdo do palete (NF-e com 10 volumes, Delivery não informado); reenvio = já importado; 10 → 12 substituída (API: 12, origem BIPAGEM, 3 conteúdos); `/bipagem` pede o palete; celular sem rolagem horizontal. Capturas em `docs/capturas/bipagem-real/` (examinadas). |
| E2E `redesign`, `conteudo`, `ajustes`, `busca-importacao`, `tutorial` | **16 aprovados, 8 pulados por perfil**. O teste "nota com duas Deliveries" do `redesign.spec` passou a montar o cenário pelo cadastro de conteúdo (a bipagem real não traz Delivery). |

**Limites**: verificação local (banco de teste/E2E); nada no ambiente do piloto. A versão de teste da porta 3000 estava parada: depois deste build, iniciar/reiniciar (`npm start`) e recarregar a aba (Ctrl+Shift+R). Pendentes com a operação: arquivo com mais de um palete, outros tipos (CT-e…).

## Tema escuro e novo visual dos painéis — o que existe de fato (19 out. 2026)

Decisões D245–D248. Só interface (nenhuma mudança de API, contrato ou banco).

- **Tema**: seletor Claro/Escuro no fim do menu lateral (computador) e em "Tema da tela" no menu da conta (celular); escolha guardada no navegador, sem escolha segue o sistema; aplicado antes da primeira pintura. Escuro DHL (quase preto + amarelo #FFCC00 cheio nas ações, vermelho nos alertas) em todas as telas, mapa incluído (palete selecionado amarelo com texto escuro). **Impressão, etiquetas e prévia A4 continuam brancas** (cores do escuro só em `@media screen`).
- **Painéis** (operação e cliente; Volumes da janela herda barras e anéis): cartões grandes com um destaque amarelo, anel de ocupação das posições ativas, colunas de paletes e de volumes por rua (gráficos separados, "n/i" = não informado, tabela opcional), anéis de % preparados/expedidos quando há meta, tarefas com selo por tipo. Mesmos números e textos de antes nas barras e cartões.
- **Desenvolvimento**: proxy do Vite preserva o Host (login em `npm run dev` voltou a funcionar com a defesa de origem).
- **Verificações (19 out. 2026)**: typecheck da web e eslint dos arquivos alterados aprovados; `rotas.test.ts` (5) aprovado; `npm run build` aprovado; E2E `paineis`, `computador`, `celular`, `redesign` e `acesso` com `PLAYWRIGHT_CANAL=chrome`: **39 aprovados, 35 pulados por projeto (computador × celular), 0 falhas**. Conferência visual por capturas (claro e escuro, 1366 px e 390 px) no escopo de demonstração: painel, painel do cliente, mapa com palete selecionado, agendas, claims, inventário, recebimento e login. **Não verificado com dados de janela com meta** (o escopo de demonstração não tem meta): os anéis de % só aparecem com meta; o E2E de volumes da janela confirma os textos das barras.

## Endereços da Rua 11, Rua 12 e Grade — aplicado (14 out. 2026)

Decisões D241–D244. Retomada: `RETOMADA-RUAS-11-12-GR.md`.

- **Antes**: backup `.dados/backups/praca-reversa-backup-praca_reversa_dev-20261014-225305Z-53c9aaec`.
- **Mapa (escopo real, porta 3000)**: Rua 11 (A42–A58, A42 no topo), Grade (GR1 embaixo … GR15 em cima) e Rua 12 pela planilha (esquerda A79–A89 + A103–A123 ímpares; direita A92–A124 pares, A96 vazia) confirmadas pelos serviços de layout (revisão, histórico, auditoria). Todas as faixas ativas confirmadas (194 endereços).
- **Paletes**: Rua 12 — 23 posições registradas pela numeração antiga corrigidas (evento de correção ligado ao registro da carga) e 33 paletes registrados pela tabela nova; Rua 11 (17) e Grade (15) pelo reenvio do mesmo pacote (`npm run inventario:carregar … --executar`: 32 localizações, 0 cadastros, 0 conflitos; relatório `.dados/cargas/INV-000002-reenvio-2026-10-14T22-53-38-733Z.md`). **182 de 184 paletes com posição**; os 2 sem posição são dos endereços que saíram da planilha (13 - A102, 15 - A125). Conferido: todo palete no mapa está na posição do próprio endereço da planilha (0 divergências); **nenhum prazo de reconferência reiniciado** (0 paletes com movimentação); exemplos PR-000133 → F02-P10 = 12 - A109 (histórico: registro, correção, registro), PR-000012 → 12 - A79, PR-000001 → 11 - A42, PR-000123 → GR - 15 (topo), PR-000180 → GR - 1 (embaixo).
- **Painel**: 182 com endereço, 2 sem; por rua: Rua 11 17 pal./1.402 vol., Rua 12 33/3.155, Rua 13 30/1.886, Rua 14 29/2.613, Rua 15 29/3.807, Rua 16 29/2.979, Grade 15/1.328; posições ativas 182 ocupadas, 12 com ocupação desconhecida.
- **Verificações**: `reconferencia.test.ts` (7, inclui a correção sem reiniciar o prazo), `movimentacao.test.ts`, `carga-lote.test.ts`, `paineis.test.ts` (12) aprovados; typecheck da raiz, eslint dos alterados e build aprovados; porta 3000 reiniciada.

## Painéis da operação DHL e do cliente — o que existe de fato (13 out. 2026)

Pedido: `Downloads/PROMPT-DASHBOARDS-DHL-LOREAL.txt`. Decisões D232–D239; definições em `INDICADORES.md` (seção Painéis); perguntas em `DESCOBERTA.md` (Painéis DHL e do cliente); retomada em `RETOMADA-DASHBOARDS.md`.

- **Telas/rotas**: `/painel` (Painel da operação, menu lateral "Painel", todos os perfis DHL), `/painel/estoque` (lista dos cards, filtros na URL, abas Estoque agora/Histórico), `/painel/janelas/<id>` (Volumes da janela: meta, separação, expedição, estorno; também pelo botão "Volumes da janela" na tela da janela em Agendas) e `/painel/cliente` (Painel do cliente; o acesso do cliente abre direto nele). API: `GET /painel/operacao`, `/painel/operacao/estoque`, `/painel/operacao/historico`, `GET /janelas/:id/volumes` (+ `/conteudos?texto=`), `POST /janelas/:id/volumes/meta|separacoes|expedicoes|estornos`, `GET /painel/cliente`, `/painel/cliente/estoque`, `/painel/cliente/janelas/:id`, `/painel/cliente/historico`, `/painel/cliente/estoque/exportar`, `/painel/cliente/historico/exportar`.
- **Migração** `20261016090000_paineis_volumes` (perfil `CLIENTE_CONSULTA`, `meta_janela_volumes`, `evento_volumes_janela`, gatilhos de imutabilidade) **aplicada no banco de desenvolvimento** com backup antes (`.dados/backups/praca-reversa-backup-praca_reversa_dev-20261013-234619Z-13478624`). Nenhum dado existente alterado.
- **Banco real (escopo PRACA-REVERSA/LOREAL, versão de teste da porta 3000, reiniciada com o build novo)**, conferido pela API e no navegador: 184 paletes na praça (91 full, 82 mistos), 1.153 conteúdos NF × palete, **1.111 documentos** distintos, volumes informados **17.170** (base em 1.117 de 1.153; 36 sem volume), conferidos 0; 62 com identificação incompleta (18 sem NF, 44 sem tipo); posições: 140 ocupadas, 0 livres confirmadas, 54 com ocupação desconhecida, 300 desativadas fora da capacidade (base provisória); **44 paletes sem endereço** (Rua 11/Grade pendentes), **3 NFs sem palete**; reconferência: 0 vencidas, próximo vencimento 26/10/2026; por rua: Rua 12 23 pal./2.446 vol., Rua 13 30/1.886, Rua 14 29/2.613 (+18 sem volume), Rua 15 29/3.807 (+17), Rua 16 29/2.979, sem endereço 44/3.439. **Nenhuma janela nem meta no banco real** (o painel diz isso; nada foi criado para preencher). Card = soma da lista (volumes e paletes conferidos; Rua 15 → 29 paletes/3.807 vol.; sem endereço → 44/3.439).
- **Conta de teste do cliente**: `cliente.teste.loreal` (perfil CLIENTE_CONSULTA, escopo real local), criada pela API de administração; senha só em `.dados/teste-local/credenciais.md`. Não é a conta real do cliente: desativar quando a conta real for definida. Verificado: abre direto no Painel do cliente (menu: Painel do cliente, Aplicativo, Ajuda), NFD 1673427 → 1 documento, 2 paletes (100 + 235 = 335 vol., "Localização em atualização"), histórico só com os cadastros; 403 em `/painel/operacao`, `/praca`, `/paletes`, `/claims`, `/indicadores`, `/janelas` e na escrita de conteúdo; exportações 200 sem campos internos; "Sair" encerra a sessão (401 depois).
- **Fontes dos números**: estoque = paletes na praça + vínculos ativos do inventário e conteúdos registrados; volumes = contagem vigente senão informado − expedido pelos painéis; documentos = identidade fiscal; posições = layout ativo + `livre_confirmada_em`; reconferência = relógio persistido (D229–D230); janelas = `janela_devolucao` + `meta_janela_volumes` + `evento_volumes_janela`; histórico = palete, `evento_localizacao`, `evento_estoque` (transferências), `sessao_conferencia`, `contagem_volumes`, `reconferencia_palete`, `evento_volumes_janela`.
- **Eventos de preparação disponíveis**: separação (`expedicao.preparar`), confirmação de expedição (`expedicao.confirmar`), estorno de cada um (com motivo), meta (`janela.gerenciar`). Não existem: retorno físico por volumes (usar o retorno da etapa 08) e mudança automática do palete quando todo o conteúdo sai.

### Verificações (13 out. 2026, noite)

| Comando / verificação | Resultado |
| --- | --- |
| `apps/api/test/banco/paineis.test.ts` | **12 aprovados**: estoque (palete uma vez, NF em 2 paletes = 1 documento, mesmo número com remetentes distintos = 2, NF sem palete), cards × lista × filtros (rua, misto, sem endereço, sem volume), 8.000/2.000/4.500 → 81,25%/25%, +1.000 → P 3.500/E 3.000/falta 1.500/5.000, palete misto (só a NF escolhida; a outra separável em outra janela), pedido menor que a NF (restante), seleção/importação/reserva não contam, reenvio idempotente/reenvio do pacote/estorno/revisão da seleção, incompletos/T = 0/unidade não comparável, projeção do cliente sem campos internos (JSON e CSV, fórmula neutralizada), outro escopo e escritas negadas + logout, estoque por janela com etapas, reconferência persistida (criação antiga não vence; 20 dias vence; reconferência registrada reinicia). |
| `packages/contracts/src/paineis.test.ts`, `contratos.test.ts`, `cadastro.test.ts`, `apps/web/src/rotas.test.ts`, `features/ajuda/guia.test.ts` | Aprovados (contratos e web: 136). |
| `npm test` completo (final) | **64 arquivos, 582 testes aprovados**; `npm run lint` completo limpo. |
| `npm test` completo (antes dos ajustes finais) | **578 aprovados, 3 falhas** em testes que fixavam "todos os perfis veem a praça/produtos" e a lista de migrações — atualizados para o perfil do cliente e a migração nova, repetidos: aprovados. |
| typecheck (API, web, contratos, raiz com E2E), eslint dos arquivos alterados, `npm run build` | Aprovados. |
| E2E `e2e/paineis.spec.ts` (Chrome, banco do E2E, dados fictícios) | **5 aprovados, 1 pulado** (fluxo só de computador): painel da operação, card → lista com o mesmo total, filtro na URL e voltar; Volumes da janela pela tela (meta 10, separar 8, expedir 3 → "8 de 10 (80,00%) · falta separar 2", "3 de 10 (30,00%) · falta expedir 7"); cliente abre no painel, 403 na API interna, exporta histórico, sem rolagem horizontal no celular. Capturas em `docs/capturas/paineis/`. |
| Navegador (porta 3000, banco de desenvolvimento) | `supervisor.praca`: painel com os números acima; card "Paletes sem endereço" → `/painel/estoque?situacao=sem-endereco` (44 paletes/3.439 vol.); histórico e voltar; Rua 15 → lista filtrada. `cliente.teste.loreal`: visão do cliente conforme acima. |

**Contrato interface × API agora é 10** (D240): abas abertas com a versão anterior mostram "Versão incompatível — Atualizar"; quem vir "formato inesperado" no login deve recarregar ignorando o cache (Ctrl+Shift+R) ou tocar em Atualizar.

**Limitações**: sem janelas/metas reais ainda (cadastro e meta são da operação); seleção do cliente real ainda não importada no escopo real; Rua 11 e Grade sem endereço confirmado (44 paletes aparecem como "Localização em atualização"); nenhuma contagem de volumes registrada (conferidos = 0); conta real do cliente não definida.

## Nomes reais do mapa e reconferência após 20 dias — o que existe de fato (13 out. 2026)

Pedido: `Downloads/PROMPT-IMPORTACAO-AUTOMATICA-NFD (2).md` (a imagem anotada **não veio**; usada a tabela transcrita no prompt). Decisões D226–D231. Retomada: `RETOMADA-MAPA-RECONFERENCIA.md`. Perguntas em aberto em `DESCOBERTA.md` (endereços reais por faixa).

- **Mapa (escopo real, versão de teste da porta 3000)**: blocos renomeados pela API (revisão 2→29): Rua 11, Rua 12, Rua 13, Rua 14, **Rua 16 (FB05)**, **Rua 15 (FB06)**, Grade (GR); 10 faixas confirmadas (162 endereços: Ruas 12–14 com 17+17, Ruas 16 e 15 com 15+15; ímpares à esquerda, pares à direita, do topo para baixo). **Pendentes**: Rua 11 e Grade (divergência de quantidade/passo) — a ordem inversa da Grade (GR1 embaixo) entra com o sentido "P01 recebe o último" quando confirmada. Rótulo principal do mapa = endereço operacional ("15 - A120", "GR9").
- **Carga**: o ZIP é o mesmo pacote do INV-000002 (`dados-importacao.json` idêntico). Reenvio com `--executar` depois do mapa: **140 paletes ganharam posição**, 42 seguem com posição no mapa pendente (Rua 11: 17; Grade: 15; Rua 12 fora de A101–A134: 10), 0 paletes/vínculos criados, nenhum relógio reiniciado. Total: 184 paletes (44 sem posição, incluindo os 2 dos endereços que saíram da planilha). Conferido na tela pela API: Rua 16 (x 926) à esquerda da Rua 15 (x 1170); 16 - A101 = F08-P01, 16 - A102 = F09-P01, 15 - A101 = F10-P01, 15 - A120 = F11-P10 (PR-000162).
- **Reconferência após 20 dias**: migração `20261015090000_reconferencia_palete` (aplicada no banco de desenvolvimento com backup `…20261013-181509Z…`): campos no palete + `reconferencia_palete` (imutável); preenchimento pelo histórico (escopo real: 184 paletes com início = cadastro de 6/10 ou 13/10, nenhuma movimentação nem reconferência → os primeiros vencem em 26/10/2026). API: `reconference` no resumo/detalhe (horário do servidor), filtro `GET /paletes?reconferencia=sim`, `POST /paletes/:id/reconferencias` (conferência de volumes, `conferencia.registrar`). Tela: laranja + "⟳ Reconferência necessária", legenda, filtro, resumo/lista/detalhe com as datas e dias, **Conferir palete**, seção "Reconferência completa do palete" e atualização a cada 60 s/foco.

### Verificações (13 out. 2026, noite)

| Comando / verificação | Resultado |
| --- | --- |
| `apps/api/test/banco/reconferencia.test.ts` (relógio controlado) | **6 aprovados**: 1 ms antes não vence, exatamente 20 dias vence; mapa/lista/renomear bloco/editar observações não reiniciam; movimento válido reinicia, recusado e repetido (mesma chave) não; transferência reinicia origem e destino; parcial, rascunho e cancelamento não, completa sem diferença sim (dias sem movimentação continuam); reconferência de volumes reinicia sem mudar conferência/liberação/saldo/versão, exige "palete inteiro", consulta → 403, registro imutável; arquivado sem prazo; prazo persiste após reiniciar o servidor. |
| `carga-lote.test.ts` | Posição registrada pelo reenvio (faixa confirmada depois) não é movimentação: início e última movimentação intactos (+ 23 anteriores). |
| `packages/contracts/src/reconferencia.test.ts` + Vitest web/contratos | Aprovados (127). |
| typecheck (API, web, contratos), eslint nos alterados, `npm run build` | Aprovados. |
| `npm test` completo | **62 arquivos, 561 testes aprovados**. |
| E2E completo (Chrome, computador e celular, sem capturas) | **115 aprovados, 1 falha de seletor** (`computador.spec`: `getByLabel('Conferência')` também casava com o filtro novo "Precisam de reconferência"); seletor trocado pela caixa de seleção e o teste repetido: aprovado. eslint dos specs alterados: limpo. |
| E2E `e2e/reconferencia.spec.ts` (Chrome, dados fictícios; vencimento marcado só no navegador do teste) | **1 aprovado**: classe laranja no palete, legenda, selo e dias no resumo, rótulo "Reconferência necessária", Conferir palete → conferência de volumes → reconferência registrada (real), filtro enviado ao servidor. Capturas em `docs/capturas/reconferencia/`. |

## Carga do inventário L’Oréal de 13/10/2026 — o que existe de fato

Pedido: `Downloads/PROMPT-IMPORTACAO-AUTOMATICA-NFD (1).md` + `Importacao-Praca-Reversa (1).zip` (extraído em `.dados/cargas/pacote-2026-10-13/`, fora do versionamento). Decisões D221–D225. Retomada: `RETOMADA-CARGA-INVENTARIO-13-10.md`.

- **Ambiente**: banco de desenvolvimento local (`.env` → `DATABASE_URL`, o mesmo do comando e do servidor da versão de teste, porta 3000, só `127.0.0.1`); escopo `PRACA-REVERSA/LOREAL` (não-demo); usuário `supervisor.praca`. A cópia congelada (`.dados/versao-teste-congelada`, porta 3200, banco restaurado de 8/10) **não** foi alterada.
- **Antes da carga**: backups `.dados/backups/…20261013-150451Z…` e `…20261013-151006Z…`; migrações `20261013090000_conteudo_palete` e `20261014090000_numero_documento_composto` aplicadas (`npm run db:migrar`). Primeira tentativa revertida inteira (restrição de 64 caracteres no número — D222).
- **Comando**: `npm run inventario:carregar -- --arquivo ".dados/cargas/pacote-2026-10-13/dados-importacao.json" --unidade PRACA-REVERSA --cliente LOREAL --usuario supervisor.praca --substitui INV-000001 --descricao "…" --executar` (prévia antes, sem `--executar`, com e sem `--substitui`). Relatórios: `.dados/cargas/INV-000002-*.md`, diferenças em `.dados/cargas/diferencas-INV-000001-pacote-13-10.json`.
- **Gravado (conferido no banco)**: INV-000002 ATIVO, 1.239 linhas (564 aplicadas, 636 já importadas, 36 repetidas agrupadas, 3 sem RUA); INV-000001 SUBSTITUÍDO. Vínculos ativos 1.153 = 1.066 NFD (997 números) + 43 MI + 44 tipo pendente; 498 criados, 19 atualizados, 636 mantidos; 109 do INV-000001 encerrados com motivo (19 atualizados + 90 que não constam: 26 com outra identificação no mesmo endereço, 13 em outro endereço, 51 ausentes). 184 paletes (61 novos, 121 reaproveitados, 2 dos endereços que saíram — 13 - A102 e 15 - A125 — preservados sem vínculo), **0 com posição no mapa**. Volumes: soma das 1.239 linhas = **18.662** (18.413 numéricos + 249 em texto), sem alteração; 36 vínculos com volume pendente (linhas repetidas não somadas). Nenhum saldo por SKU, reserva, liberação, claim ou expedição.
- **Reenvio** do mesmo pacote com `--executar`: "já foi importado como INV-000002", 0 criados, 1.153 já existentes, 184 paletes, 2 lotes (nada duplicado). Depois da correção D223, a prévia do reenvio reconhece os 182 paletes dos endereços (0 a cadastrar).
- **Na versão de teste (porta 3000, reiniciada com o build novo)**, conferido no navegador com `supervisor.praca`: lista com 184 paletes, cada um com "endereço · mapa pendente"; PR-000001 "Endereço 11 - A42 (informado no inventário)" com 36 documentos, entre eles NFD 966860 (Delivery não informado, Drogaria Sao Paulo S.A, 1 volume, palete misto, produto na caixa vazio e editável); pesquisa "1673427" → NFD 1673427 / Delivery 89415536 em GR - 9 (PR-000118, 100 vol., INV-000002 linha 1047) e GR - 10 (PR-000119, 235 vol., linha 1046); pesquisa "55312" → "Origem do inventário sem alocação", INV-000002 linha 1240, "Sem alocação / endereço não informado"; inventário INV-000002 → "Requerem resolução" com as 3 linhas sem RUA; PR-000046 (13 - A114) com conteúdo sem número (linha 222); PR-000115 (GR - 4) com a lista "5026, 1625294, … 5042" inteira, tipo não informado, 15 volumes.

### Verificações (13 out. 2026)

| Comando / verificação | Resultado |
| --- | --- |
| `npm run typecheck` (+ `tsc` da API com testes e da web) | Aprovados. |
| Vitest com PostgreSQL: `carga-lote` (linhas sem RUA, pacote antigo, número composto > 64, endereço só proposto, substituição com diferenças na prévia, conteúdo registrado e movimento preservados, endereço informado e linha atual do vínculo mantido, próxima versão sem paletes novos), `busca`, `conteudos`, `bipagem`, `planilha*`, `selecao*`, `banco-e-seed` | **65 + 23 aprovados** nas rodadas finais. |
| Vitest web + contratos | 19 arquivos, 124 aprovados. |
| `npm test` completo (depois de todas as mudanças) | **60 arquivos, 551 testes aprovados**. |
| E2E (Chrome): `bipagem`, `busca-importacao`, `selecao`, `conteudo`, `ajustes`, `claims`, `tutorial` | **23 aprovados, 0 falhas** (13 pulados = variantes que os specs pulam). |
| eslint nos alterados | Limpo. |
| `npm run build` e build da API | Aprovados; servidor da porta 3000 reiniciado (janela "Praca Reversa - versao de teste"). |
| Prévia/execução/reenvio com dados reais e conferência por SQL (`.dados/conferir-carga-13-10.tmp.mjs`) | Ver acima. |

### Pendências

- **Posição no mapa**: o escopo real não tem nenhuma correspondência endereço ↔ posição (0 sequências). Informar início/fim/sentido de cada faixa em **Layout da praça → Endereços reais**, confirmar, e reenviar o mesmo pacote (registra as posições dos paletes nunca movimentados, sem duplicar). Geometria do desenho não comprova endereço.
- Revisar com a operação: 51 vínculos do INV-000001 que não constam da planilha nova, os paletes PR-000035 (13 - A102) e PR-000095 (15 - A125) sem vínculo ativo, as 3 linhas sem RUA, 36 volumes pendentes (linhas repetidas), 87 documentos de tipo pendente/MI, 36 números em contextos documentais distintos.
- A carga e a conferência são do desenvolvimento local; ambiente do piloto e Netlify/Neon não foram tocados.

## Cadastro de conteúdo e conferência de volumes — o que existe de fato (11 out. 2026)

Pedido: `Downloads/PROMPT-CADASTRO-CONFERENCIA-PRACA-REVERSA.md`. Decisões D215–D219. Retomada: `RETOMADA-CONTEUDO-CONFERENCIA.md`.

- **Registrar conteúdo** (`/conteudos/novo?palete=<id>`; `/produtos`, que antes tinha o "Novo produto", leva a ele): remetente obrigatório; tipo NF/NFD/MI (NF em destaque), número, Delivery e descrição (em "Informações adicionais") opcionais; salva com NF e Delivery vazios; nada de SKU, unidade, código de barras ou volumes. Depois de salvar: *Ir à conferência*, *Registrar outro conteúdo*, *Conferir depois*. Recebimento: palete → *Registrar conteúdo* (ou bipagem) → conferência.
- **Conferência de volumes** (`/paletes/<id>/volumes`, botão *Conferir volumes* no detalhe): por conteúdo (registrado ou importado), *Contar volumes* (contador) ou *Registrar contagem já feita* (contados, previsto opcional, referência); *Completar identificação* mantém a contagem; identificação pendente em selo próprio. Sem contagem = "Aguardando conferência". Volumes importados = contagem realizada.
- **Consulta**: resumo e "Ver mais" pelo conteúdo unificado (tabela Documento | Delivery | Remetente | Volumes | Conferência | FULL); "Documento não informado"/"Delivery não informado"; "8 / 10 volumes", "10 volumes · previsto não informado".
- **Busca** (base *Conteúdo registrado*: remetente, número, Delivery), **planilha única** (linhas de conteúdo registrado; contagem vigente) e **auditoria/Movimentações**.
- ~~Catálogo de SKU em `/produtos/catalogo`~~ — **retirado da interface** na correção abaixo (D220).

### Remoção do catálogo de SKU (correção, 11 out. 2026, noite)

Pedido: `Downloads/PROMPT-CADASTRO-CONFERENCIA-PRACA-REVERSA (1).md`. Decisão D220.

- **Retirado da interface**: página/formulário "Catálogo de SKU" ("Novo SKU", SKU, unidade canônica, "Ativo", códigos de barras, embalagens e fatores) — `features/produtos/TelaProdutos.tsx` removida; entrada do menu (lateral e da conta), título de seção, rota `catalogo-sku` e estilos sem uso (`codigos-barras`, `linha-codigo`, `lista-produtos`, `produto-linha`, `produto-sku`, `produto-codigos`).
- **Uma entrada "Registrar conteúdo"** (`/conteudos/novo`). Endereços antigos `/produtos` e `/produtos/catalogo` abrem essa tela e a barra passa a mostrar `/conteudos/novo` (substituição no histórico; também vale como retorno do login).
- **Preservado**: tabelas e dados de produtos, API `/produtos`, permissões, importação "Cadastro de produtos" (claims e conferência por código), conferência por código com pendência, bipagem, inventário. Nenhum passo de conteúdo, conferência de volumes ou recebimento exige SKU (o SKU das linhas declaradas do palete continua opcional).
- **Textos**: mensagens que mandavam "cadastrar o produto" (recebimento, conferência por código, reconciliação, claims, devoluções) agora indicam deixar o SKU pendente ou a importação "Cadastro de produtos".

| Comando / verificação | Resultado |
| --- | --- |
| `npm run typecheck` | Aprovado (contratos, API, web, raiz). |
| Vitest web (`apps/web`, inclui `rotas.test.ts` com rotas antigas e retorno do login) | **15 arquivos, 88 testes aprovados**. |
| Vitest API com PostgreSQL local (`conteudos`, `conferencia`, `cadastro`, `importacao`, `claims*`, `unidade`) | **17 arquivos, 206 testes aprovados** (log `.dados/verificacao/api-remocao-catalogo.log`). |
| eslint nos arquivos alterados e `npm run lint` completo | Limpos. |
| `npm run build` | Aprovado. |
| `prisma migrate status` (banco de desenvolvimento, só leitura) | `20261013090000_conteudo_palete` **ainda não aplicada** (pendência anterior; não foi aplicada nesta correção). |
| E2E (Chrome): `conteudo`, `cadastro`, `pwa`, `conferencia`, `camera`, `ajustes`, `claims`, `busca-importacao` | **34 aprovados, 0 falhas** (28 pulados = variantes de celular que os specs pulam). `conteudo.spec` novo: menu lateral e da conta com "Registrar conteúdo" uma vez e sem "Catálogo de SKU"; `/produtos` e `/produtos/catalogo` → `/conteudos/novo` sem SKU/código de barras/unidade canônica; voltar não reabre o endereço antigo; salvar só com remetente, recarregar, contagem já feita, previsto e completar identificação mantendo a contagem. `pwa.spec` (versão incompatível) usa agora o formulário de conteúdo. |
| Captura `FASE=depois` (`redesign.spec`, computador) | `docs/capturas/redesign/depois-computador-09-registrar-conteudo.png` (rota antiga do catálogo → tela aprovada; menu sem catálogo). |

### Verificações executadas (11 out. 2026)

| Comando / verificação | Resultado |
| --- | --- |
| `apps/api/test/banco/conteudos.test.ts` (PostgreSQL) | **8 aprovados**: combinações nota/Delivery/nenhuma; NF/NFD/MI; zeros à esquerda; inválidos, consulta → 403, outro escopo; dois vazios do mesmo remetente distintos; mesma chave não duplica; completar identificação preserva contagem + conflito de versão; contagem física/já feita/previsto/histórico, contagem imutável no banco; nada muda em estoque/posição; palete arquivado recusado; planilha; busca. |
| `carga-lote.test.ts` (bloco novo) | Conteúdo importado: volumes importados = contagem realizada; volume vazio = aguardando; contagem já feita sobre vínculo sem alterá-lo. |
| `npm test` completo | **60 arquivos, 545 testes**: 544 aprovados; 1 falha esperada (lista de migrações do `banco-e-seed` sem a nova) corrigida e reexecutada: 10/10. |
| typecheck (API e web), eslint nos alterados | Aprovados. |
| E2E completo (Chrome, computador e Pixel 7) | **115 aprovados, 0 falhas** (inclui o novo `conteudo.spec.ts`: `/produtos` sem "Novo produto"; salvar só com remetente; recarregar; dois sem nota distintos; NF 000777 + Delivery; contagem já feita 10 → "previsto não informado"; contador 2; 8 / 10; completar identificação NFD 000123 mantendo os 10 volumes; resumo "2 documentos", "20 volumes contados"). Depois da tabela unificada do "Ver mais": build da web e `conteudo.spec` + `ajustes.spec` de novo: 4 aprovados. |

### Limites e pendências

- ~~Migração no banco de desenvolvimento não aplicada~~ — aplicada em 13 out. 2026 (backup `.dados/backups/…20261013-150451Z…`).
- O print do usuário mostrava o visual antigo: o servidor dele não tinha o build do redesign. Usar `npm run build`, reiniciar o servidor e recarregar a aba (Ctrl+Shift+R).
- Amostra real da bipagem, fonte dos volumes previstos nos arquivos e arquivo da agenda continuam pendentes (leitores não alterados).

## Redesign do front e ajustes de 08/10 (2ª rodada) — o que existe de fato (8–11 out. 2026)

Pedidos: `Downloads/AJUSTES-PRACA-REVERSA-2026-10-08 (1).md`, `Downloads/PROMPT-FRONT-PRACA-REVERSA.md` e `Downloads/PROMPT-FRONT-PRACA-REVERSA (1).md` (redesign completo, com a imagem do dashboard Lodgify como referência; **o print da prévia aprovada não veio anexado**). Decisões D197–D214. Sem migração. Dependência nova: `@fontsource-variable/inter@5.3.0`.

- **Moldura**: menu lateral (marca, "DHL / L’Oréal", Operação: Mapa da praça · Inventário · Recebimento · Agendas; Mais páginas), cabeçalho com título da seção, pesquisa (mapa), situação do servidor, *Receber palete*, Ajuda e conta. Estilos novos em `apps/web/src/estilos/redesign.css` (só tela; a impressão continua a de `base.css`).
- **Mapa da praça**: indicadores (posições livres confirmadas, em estoque, para agenda; divergência "Sem dado" enquanto não houver volumes esperados; contagem do filtro). Painel esquerdo (paletes/filtros, posições livres, nota do layout ou resultados da pesquisa), mapa amplo, painel da seleção só depois de escolher. Mapa: superfície, posições, rótulos, controles, legenda e seleção redesenhados; lilás + "AGENDA" para palete reservado; disposição física, endereços, zoom e movimento inalterados.
- **Consulta**: nada selecionado ao entrar; clique/pesquisa/rota/QR → resumo (número, endereço "16 - A101 · posição …", situação, documentos, volumes, FULL); "Ver mais" → detalhe com tabela de documentos × Deliveries (1 NFD com 2 Deliveries = 1 documento, 2 parcelas), Delivery, remetente, volumes da parcela, FULL/sequência, mês de agenda, janela, cidade e produto, e "Separação para agenda" (solicitado = reservado × permanece no palete; reserva não é saída); "Recolher detalhes" e "Fechar". Posição livre → "Receber palete aqui".
- **Pesquisa**: caixa única no topo (computador) / aba Busca (celular); número da NFD/minuta, Delivery, palete, endereço, **remetente** (novo na API), SKU, código de barras e lote; resultados destacados no mapa; nunca abre o palete sozinha.
- **Recebimento**: etapas Destino → Notas da bipagem → Completar o que faltar; textos de implementação retirados; após salvar, *Importar Excel da bipagem* é a ação principal. Leitor da bipagem inalterado (amostra real pendente).
- **Volumes**: regra lidos × esperados em `features/paletes/volumes.ts`; sem fonte dos esperados, a tela mostra só os lidos.
- **Correção**: no celular, uma marca antiga de "detalhe aberto" no histórico impedia o "Voltar ao mapa" depois de voltar de outra página.

### Verificações executadas

| Comando / verificação | Resultado |
| --- | --- |
| `npm run typecheck` / `tsc` da web | Aprovado. |
| eslint nos 82 arquivos TS alterados/novos | Sem erros. |
| Testes novos/ajustados: `volumes.test`, `documentos.test` (1 NFD com 2 Deliveries), `rotas.test`, `carga-lote.test` (mês/janela nas notas; busca por remetente e Delivery) | Aprovados. |
| `npm test` completo | **59 arquivos, 536 testes**: 535 aprovados na rodada completa (16,5 min); 1 falha real em `guia.test` (o guia citava rótulos antigos do recebimento) corrigida no guia e no `GUIA-DO-OPERADOR.md`, arquivo reexecutado: 5/5. |
| E2E completo (`playwright test --grep-invert @captura`, Chrome, computador e Pixel 7) | **113 aprovados, 1 falha intermitente** (posição do balão do tutorial medida durante o redimensionamento); a verificação passou a esperar o balão assentar e o `tutorial.spec` passou 3 vezes seguidas. Specs alterados: `ajustes` (menu, indicadores, resumo/Ver mais/recolher/fechar, receber palete, agenda), `janelas` (separação parcial 8 de 12: solicitado 8 / permanece 4), `computador`, `cadastro` (impressão A4 continua 1 página), `tutorial`, demais com o passo "Ver mais". |
| Capturas antes/depois (`FASE=antes|depois npx playwright test e2e/redesign.spec.ts`) | 13 pares em `docs/capturas/redesign/`, comparação em `docs/capturas/redesign/comparacao.html` (dados fictícios do E2E; "antes" = build anterior ao redesign, já com o resumo/"Ver mais"). |

### Limites e pendências

- **Print da prévia aprovada não recebido**: o visual segue as especificações escritas e a referência Lodgify; não houve comparação com a prévia.
- **Volumes esperados**, **arquivo da agenda do cliente** (pedido por nota/Delivery) e **amostra real da bipagem** continuam pendentes; a divergência aparece como "Sem dado".
- Telas fora das quatro principais (claims, relatórios, conferência, layout…) recebem o novo sistema visual pelos estilos comuns, sem reorganização própria.
- Para ver no servidor local: `npm run build` e reiniciar o servidor; o service worker do PWA pode manter o bundle antigo até recarregar a aba (Ctrl+Shift+R) ou atualizar em "Aplicativo e aparelho".

## Ajustes operacionais de 08/10/2026 — o que existe de fato

Pedido: `Downloads/AJUSTES-PRACA-REVERSA-2026-10-08.md`. Decisões D192–D196.

- **Palete livre**: posição verde com "PALETE LIVRE" no rótulo e na legenda; só com desocupação confirmada — "Registrar como palete livre" no detalhe da posição (clicar na posição sem palete; exige marcar "Conferi no local") ou automaticamente quando um movimento, saída integral ou retirada de palete vazio é registrado (gatilho adiado, no fim da transação). Palete que ocupa a posição desfaz a marcação; desativada nunca é livre; "sem palete registrado" continua não comprovando vazio. Lista de posições livres no painel de detalhe vazio. Migração `20261012090000_posicao_livre` aplicada no banco de desenvolvimento (backup antes, `.dados/backups/…20261008-221350Z…`).
- **Legenda**: verde só para palete livre; "Reconciliado" em lavanda.
- **Painel esquerdo**: rola inteiro (filtros, ajuda e lista) em qualquer altura de tela.
- **Bipagem**: tela sem ID técnico nem textos de implementação; leitura/colunas recolhidas; tipo NFD/MI obrigatório.

### Verificações executadas (8 out. 2026)

| Comando / verificação | Resultado |
| --- | --- |
| `npm run typecheck` | Aprovado (fixtures de posição dos testes de contrato/web com `freeConfirmed`). |
| eslint nos arquivos alterados | Sem erros. |
| `apps/api/test/banco/posicao-livre.test.ts` + `banco-e-seed` | **13 aprovados**: movimento libera a origem e não o destino; palete cadastrado limpa; confirmação exige a declaração, recusa ocupada/desativada (também no banco), consulta → 403, auditoria sem duplicar; correção de movimento não marca. |
| `e2e/ajustes.spec.ts` + `e2e/bipagem.spec.ts` (Chrome; computador e Pixel 7 emulado) | **Aprovados** (ajustes 5 + 1 ignorado no celular; bipagem 4). Capturas em `docs/capturas/ajustes-2026-10-08/` examinadas. A 1ª rodada mostrou que o mapa não refletia a posição recém-marcada (o layout era mantido pela revisão): o mapa passou a atualizar o estado das posições sem se recriar. |
| `npm test` completo | **57 arquivos, 525 testes aprovados** (8,8 min). |
| E2E completo (`npm run test:e2e`) | **Não executado nesta rodada** (limite de uso); rodar antes de commitar. |

## Importação do Excel da bipagem (8 out. 2026) — o que existe de fato

Pedido: `PROMPT-IMPORTACAO-EXCEL-BIPAGEM.md` (sem Excel real). Decisões D184–D191; uso no `README.md`; perguntas para o arquivo real em `DESCOBERTA.md`; retomada em `RETOMADA-IMPORTACAO-BIPAGEM.md`.

- **Fluxo**: detalhe do palete → *Importar Excel da bipagem* → `/paletes/<id>/bipagem` (palete, endereço e ID permanente fixos no topo) → arquivo (.xlsx/.csv, leitor próprio) → aba, colunas (sinônimos sem acento/maiúsculas/espaços) e formato → prévia → *Adicionar notas ao palete* → volta ao palete com **Notas do palete** atualizadas; cancelar descarta sem gravar; importação aberta pode ser retomada.
- **Servidor**: tipo `BIPAGEM` na esteira de importação (lote ligado ao palete pelo ID, prévia versionada, confirmação com bloqueio por escopo, releitura, revalidação e assinatura; falha desfaz tudo e fica no histórico). Grava inventário `BIP-…` (origem BIPAGEM, fora da lista de inventários), linhas da fotografia e vínculos NF × palete (o modelo das Notas do palete, da busca por NF, da planilha e da conciliação). Formatos uma linha por nota (quantidade do palete × total da nota) ou por volume (etiquetas distintas); identidade delivery → remetente → chave NF-e → emitente/série → número; chave NF-e conferida; decisões explícitas (já cadastrada, mesmo número em outro contexto, repetidas, volumes sem etiqueta, outro destino); cidade/produto só preenchem vazios. Nada de saldo por SKU, movimento ou conferência.
- **Migração** `20261011090000_importacao_bipagem`: aplicada no banco de **desenvolvimento** (backup antes, `.dados/backups/…20261008-160941Z…`; `INV-000001` preservado); os bancos de teste e E2E são recriados a cada rodada.

### Verificações executadas (8 out. 2026)

| Comando / verificação | Resultado |
| --- | --- |
| `apps/api/test/banco/bipagem.test.ts` (PostgreSQL) | **11 aprovados**: importação válida (etiquetas distintas, leitura repetida, zeros à esquerda, só documental), reimportação (mesmo arquivo/palete, outro arquivo com as mesmas notas, outro palete), nota em vários paletes e total da nota, opcionais ausentes (volume vazio pendente, zero continua zero), volumes sem etiqueta e linhas repetidas (decisões), destinos divergentes, nota já cadastrada/mesmo número (substituir com histórico), chave NF-e incompleta/corrompida/trocada e aba escolhida no XLSX, erro de gravação (gatilho de falha: nada parcial, falha registrada, nova confirmação grava) e cancelamento, clique duplo/mesma chave/confirmações concorrentes, permissões/escopo/palete arquivado. |
| `npm run typecheck` | Aprovado. |
| `eslint` nos arquivos alterados/novos | 4 apontamentos (template desnecessário, encadeamento opcional) corrigidos; relint sem erros. |
| `rotas.test.ts` (web) | Rota `/paletes/<id>/bipagem` acrescentada ao teste das ações do palete; aprovado. |
| `npm test` completo | **56 arquivos, 522 testes: 520 aprovados, 2 falhas** (12,9 min), ambas em `importacao.test.ts`: o resultado da gravação ganhou campos da bipagem (expectativa exata do teste atualizada) e, com o operador passando a ter um tipo de importação (bipagem), `PUT /importacoes/:id/mapeamento` validava o corpo antes da permissão do tipo do lote (400 em vez de 403) — rotas de mapeamento, confirmação e descarte passaram a conferir a permissão do tipo antes do corpo. O histórico de lotes da bipagem ficou com quem pode importá-la (o perfil de consulta continua sem histórico de importações). Reexecutados: `importacao` + `bipagem` **28 aprovados**; `busca`, `claims-acesso`, `selecao-cliente` **35 aprovados**. |
| `PLAYWRIGHT_CANAL=chrome npm run test:e2e` (com build) | **111 aprovados, 74 ignorados por perfil, 0 falhas** (7,1 min; eram 109 + os 2 funcionais novos da bipagem). |
| `npm run build` + `e2e/bipagem.spec.ts` (Chrome; computador e Pixel 7 emulado) | **4 aprovados** (funcional + capturas): botão no detalhe → página com o palete fixo → arquivo → formato → prévia com nota ambígua e linha de outro destino (confirmação bloqueada) → decisões → nova prévia → adicionar → notas no detalhe; reenvio do mesmo arquivo recusado; cancelamento sem gravar; celular sem rolagem horizontal (documento e página). 16 capturas em `docs/capturas/bipagem/` examinadas: a 1ª rodada mostrou a tabela recolhida (classe `.amostra` é também a amostra de cor da legenda, 22×14 px) e a página do celular mais larga que a tela; corrigidos (região própria `.bipagem-rolagem` e trilhas da grade limitadas) e reconferidos. |

### Limitações materiais

- **Sem Excel real**: o layout é associado na tela; títulos reais, formato, etiqueta, significado da quantidade e coluna de destino precisam ser confirmados (`DESCOBERTA.md`).
- Verificação visual feita no E2E (escopo de cadastro do E2E, dados fictícios); **não exercitada no escopo real** (gravaria dado real). O servidor de teste da porta 3000 (outra sessão) usa o build anterior: reiniciar depois de `npm run build` para ver o botão (e remover o service worker antigo da aba, se a tela não mudar).
- A tela genérica de importação (`TelaImportacao`) usa a mesma classe `.amostra` na amostra do mapeamento — a amostra aparece recolhida lá também (problema anterior a esta tarefa, não alterado).

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
