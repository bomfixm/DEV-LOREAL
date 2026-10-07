# Descoberta da operação

Preencher com a pessoa que conhece o processo e registrar fonte/data. Ausência de resposta não autoriza presumir a regra. O desenvolvimento de interface e dados fictícios pode avançar enquanto essas informações são coletadas.

| Pergunta | Registro |
| --- | --- |
| Qual sistema ou planilha guarda o conteúdo atual dos paletes? Há exportação? | A preencher. |
| Os paletes já têm ID permanente? Como é o endereçamento real da praça? | A preencher. |
| Existe planta, croqui ou imagem da praça? Quais zonas, ruas, docas, corredores, dimensões e posições devem aparecer no mapa? | A preencher. |
| Uma posição pode receber mais de um palete (empilhamento, blocado)? Há capacidade máxima por posição? | A preencher. |
| Qual é o formato do código de palete e do endereço usados hoje (ex.: rua-coluna, nível)? | A preencher. |
| Quais dados existem na lista de claims: produto, lote, NF, quantidade, valor, prazo? | A preencher. |
| Há registro da quantidade efetivamente recebida ou apenas da nota? | A preencher. |
| O mesmo palete mistura devoluções, produtos, lotes e condições? | A preencher. |
| Qual etapa da triagem forma o palete e como são registradas as transferências? | A preencher. |
| Quando um claim é aberto, validado e finalizado? Quem aprova regularização? | A preencher. |
| A janela limita paletes, caixas, unidades, peso, m³ ou mais de uma medida? | A preencher. |
| O cliente define também os tipos de produtos/devoluções que aceita na janela? | A preencher. |
| Quais documentos e aprovações liberam material para expedir? | A preencher. |
| Como tratar material avariado, sem origem, recusado ou retornado? | A preencher. |
| Há regra de lote, validade ou FIFO que limite a expedição? | A preencher. |
| Quanto material entra por semana/mês e quanto foi expedido nas últimas janelas? | A preencher. |
| Quantos usuários, paletes, produtos e movimentos devem ser suportados? | A preencher. |
| Quais computadores, celulares, coletores, leitores e impressoras serão usados? | A preencher. |
| A rede funciona em toda a praça? Há Wi-Fi, HTTPS interno e identidade corporativa? | A preencher. |
| Quem manterá o aplicativo, o banco, as contas e os backups? | A preencher. |
| Quais dados podem entrar no piloto e qual ambiente deve receber o aplicativo? | A preencher. |

## Layout físico da praça — informado e pendente (etapa 02)

**Atualização (5 out. 2026):** substituído na demonstração pelo desenho aprovado do PDF de referência e pela nomenclatura Fileiras 11–16/GR (ver `LAYOUT-PRACA.md` e a seção do complemento abaixo). Registro original:

Informado pelo usuário em 2 de outubro de 2026: a praça começa com fileiras de 15 posições e depois passa a fileiras de 17; há uma fileira única de 15 no início, pares de 15, pares de 17 e uma fileira única de 17 no outro extremo. O exemplo `[15, 15, 15, 17, 17, 17]` (96 posições) é só ilustração. Configuração atual em `examples/layout-praca-informado.json`; detalhes em `LAYOUT-PRACA.md`.

| Pendência de levantamento | Registro |
| --- | --- |
| Quantos pares de fileiras de 15 e quantos pares de 17 existem? | A levantar (exemplo usa 1 par de cada). |
| A fileira única de 17 no outro extremo existe de fato? | A confirmar (marcada "a confirmar" no mapa). |
| Qual lado é o "início" (orientação em relação a portões, docas e escritório)? | A levantar. |
| Distâncias e alinhamento entre fileiras do par, entre pares e entre blocos; as fileiras de 15 e de 17 alinham por qual extremo? | A levantar (geometria atual é esquemática). |
| Corredores, acessos, docas e áreas de circulação: onde ficam e quais devem aparecer? | A levantar (só existem como fictícios no cenário de navegação). |
| Há posições indisponíveis (pilar, extintor, passagem)? | A levantar. |
| Endereçamento oficial das fileiras e posições (substitui `F01-P01`, provisório). | A levantar. |
| Quantos paletes cabem por posição (empilhamento, profundidade)? Há capacidade total da praça? | A levantar (`totalCapacity` fica nulo). |
| Ocupação atual de cada posição. | Sem levantamento: o esquema informado mostra todas como "ocupação desconhecida". |

## Acesso e ambiente — pendente (etapa 02)

| Pergunta | Registro |
| --- | --- |
| Há provedor de identidade corporativo (OIDC/SAML, Entra ID) que deva substituir o login local? | A preencher. Implementado login local individual. |
| Política de senha da operação (tamanho, troca, bloqueio, recuperação)? | A preencher. Provisório: mínimo de 12 caracteres, sem troca/recuperação pelo próprio usuário. |
| Duração de sessão adequada aos turnos (inatividade e máximo)? Dispositivos compartilhados? | A preencher. Provisório: 120 min de inatividade e 12 h no máximo. |
| Quem administra contas e perfis em cada unidade/cliente? Quem aprova novas contas? | A preencher. |
| Quais perfis e permissões cada função realmente tem (consulta, operador, supervisor, analista de claims, administrador)? Quem aprova regularização financeira? | A preencher. Provisório em `packages/contracts/src/acesso.ts`; aprovação financeira de claims só por concessão explícita do administrador a um analista de claims (etapa 07). |
| Por quanto tempo guardar a auditoria de acesso e quem pode consultá-la? | A preencher. |
| Quais unidades e clientes entram no piloto (códigos oficiais)? | A preencher. Só existem escopos fictícios. |
| Servidor PostgreSQL do piloto: versão, hospedagem, backup e responsável. | A preencher. Desenvolvimento verificado em PostgreSQL 17.10 local. |
| HTTPS interno disponível (necessário para cookie `Secure` e instalação do PWA)? | A preencher. |

## Cadastro, layout e etiquetas — pendente (etapa 03)

| Pergunta | Registro |
| --- | --- |
| **Endereço estável do sistema na rede dos aparelhos** (nome/IP, HTTPS, porta) para `APP_URL_PUBLICA`. | A preencher. **Necessário antes de imprimir etiquetas definitivas**: o QR grava esse endereço; trocar depois exige reimprimir ou redirecionar. Hoje só há endereço local/de teste. |
| Os celulares da operação alcançam esse endereço (Wi‑Fi da praça, VPN, rede de convidados)? Quais modelos/câmeras leem o QR? | A preencher. Leitura física não testada. |
| Impressora e mídia das etiquetas (A4 em impressora comum, etiqueta adesiva em impressora térmica, tamanho, resolução, onde fixar no palete, filme plástico). | A preencher. Implementado só A4 (1 ou 2 por folha). |
| Já existe identificação física nos paletes (etiqueta, SSCC, número escrito)? Qual o formato? Deve ser usada como código no cadastro? | A preencher. O cadastro aceita a identificação existente; o gerado `PR-######` é provisório. |
| Quem gera códigos novos quando o palete não tem identificação, e com que prefixo/numeração? | A preencher. |
| Posições são individuais (um palete) ou há blocado/empilhamento/profundidade? | A preencher. Implementado como individual (D49); mudar exige migração. |
| Quem configura o layout e quem cadastra produtos (supervisor? outra função?) | A preencher. Provisório: supervisor de estoque. |
| De onde vem o cadastro de produtos (SKU, descrição, EAN/DUN, fator de caixa)? Há fonte oficial para importar? | A preencher. Importação é da etapa 06; hoje cadastro manual. |
| Fatores de embalagem conhecidos e aprovados por quem? | A preencher. O aplicativo exige o fator informado; não presume. |
| Quando um cadastro de palete pode ser arquivado e por quem? | A preencher. Provisório: supervisor, só sem conferência, com motivo. |
| Data de cadastro: basta a data do registro no sistema ou é preciso registrar a data de entrada física do palete na praça? | A preencher. Hoje: data/hora do cadastro e responsável (usuário da sessão). |

## Conferência e reconciliação — pendente (etapa 04)

| Pergunta | Registro |
| --- | --- |
| Quem valida (reconcilia) contagens e quem pode descartar uma contagem concluída? | A preencher. Provisório: supervisor de estoque (`conferencia.reconciliar`); operador registra, conclui e cancela a própria conferência em andamento. |
| Há tolerância ou limite que obrigue recontagem (unidades, %, valor, tipo de produto)? Há prazo para validar? | A preencher. O app mostra as divergências e permite recontagem justificada; **nenhuma tolerância, limite financeiro ou prazo foi aplicado**. |
| A operação conta por partes (camada, lado, caixa numerada)? Existe identificação física da parte que permita validar uma parcial sem dupla contagem? | A preencher. Implementado: parcial registra observações e pendências, com descrição livre da parte; não é reconciliada. |
| Como contar embalagem aberta ou fracionada? | A preencher. Provisório: embalagens são contadas inteiras; embalagem aberta é contada na unidade canônica. |
| Quem aprova o fator de cada embalagem e qual o documento de apoio (ficha técnica, cadastro do cliente)? | A preencher. Código com fator desconhecido é aceito no cadastro, mas a conversão fica bloqueada até alguém registrar o fator. |
| Mais de uma pessoa pode continuar a mesma conferência (troca de turno)? | A preencher. Provisório: sim, qualquer usuário com permissão de registrar no escopo; autoria por linha e por correção. |
| Quais leitores de código serão usados e como enviam o código (sufixo Enter, prefixos, GS1-128 com lote/validade embutidos)? | A preencher. O app usa o texto lido exato (código de barras ou SKU); identificadores de aplicação GS1 (lote, validade) não são decompostos. Leitor físico não testado. |
| Onde ficam as evidências (fotos, documentos) de uma conferência? | A preencher. Nesta etapa só há referência textual (observação/evidência por linha e observações gerais); anexos são de etapa posterior. |
| Critérios das condições saudável, avariado e em avaliação; a condição é decidida na contagem ou depois? | A preencher. Usados os estados existentes; condição é escolhida pelo operador antes das leituras. |
| A quantidade declarada deve ficar oculta para quem conta? | A preencher. Implementado: a tela de contagem não mostra quantidades esperadas (a comparação aparece depois de concluir); o detalhe do palete continua mostrando a declaração documental. |
| Reservas existentes (etapa 08) podem ser reduzidas por uma reconciliação? Quem trata o conflito? | A preencher. Implementado: a reconciliação é recusada e a pendência fica registrada na conferência. |

## Movimentações — pendente (etapa 05)

| Pergunta | Registro |
| --- | --- |
| Quem pode mover paletes e transferir produtos? Quem pode corrigir uma movimentação concluída? | A preencher. Provisório: operador e supervisor movem/transferem (`movimento.registrar`); só o supervisor de estoque corrige (`movimento.corrigir`). Consulta e administrador técnico só leem o histórico. |
| Há lista oficial de motivos de movimentação e de transferência? O motivo é obrigatório? | A preencher. Implementado: motivo obrigatório em texto livre (3 a 500 caracteres) com sugestões que **não** são regra do cliente (reorganização, liberar posição, consolidação, separação por devolução/condição). |
| Como a pessoa confirma a posição efetivamente atribuída? Há etiqueta física na posição para ler? | A preencher. Implementado: o destino é escolhido pelo código (digitado/lido) ou tocando numa posição livre, e a pessoa marca a confirmação "o palete está/ficará fisicamente na posição X"; o servidor confere o código. Leitura de etiqueta de posição não existe (posições sem etiqueta oficial). |
| Capacidade e limites físicos das posições (peso, altura, empilhamento) e da praça. | A preencher. Nenhum limite físico foi aplicado: só a regra de posição individual já existente (um palete por posição, D49) e a disponibilidade configurada. |
| Transferir é permitido entre paletes com liberação diferente? Quem libera material que mudou de palete? | A preencher. Provisório: material de palete não liberado **não** entra em palete liberado (a transferência o liberaria); o caminho inverso é aceito e avisado ("o material passa a seguir a liberação do palete de destino"). A correção segue a mesma regra. Liberação continua por ação própria (etapa 08). |
| Pode-se transferir de/para um palete com contagem completa aguardando validação? | A preencher. Implementado: permitido; a contagem fica desatualizada (não pode mais ser reconciliada) e a resposta avisa para pedir recontagem. Conferência **em andamento** bloqueia. |
| Um palete com dois registros pendentes do mesmo produto e condição (lote/origem desconhecidos, linhagens diferentes) — como contá-lo? | A preencher. Implementado: se a contagem completa achar a mesma soma, nada muda; se achar outra quantidade, a reconciliação é recusada e fica pendente, porque não há como saber de qual registro veio a diferença. Falta a regra operacional para separar/identificar essas linhagens. |
| Reservas (etapa 08): pode-se mover a parte reservada? Como realocar uma reserva para outro palete? | A preencher. Implementado: só a parte livre se move (disponível = saldo validado − reservas ativas); realocar reserva não existe e exige tratativa explícita a definir. |
| Até quando uma movimentação pode ser corrigida? Quem aprova? | A preencher. Implementado: correção de localização só do **último** movimento do palete (depois disso, novo movimento); correção de transferência até o que ainda não foi compensado e limitada ao disponível atual de quem recebeu; sem prazo. |
| Palete que ficou sem saldo validado depois de transferências: o que fazer com o palete físico (desmontar, arquivar, reutilizar a base)? | A preencher. Implementado: nada automático — cadastro, localização e ID continuam; zero de saldo conhecido não comprova palete vazio. |
| Material que chega por transferência a um palete não conferido: conta como "conferido" para algo? | Implementado: não. O palete continua não conferido no mapa e na lista; o detalhe mostra só o saldo recebido como conhecido. Confirmar com a operação. |

## Busca e importação — pendente (etapa 06)

| Pergunta | Registro |
| --- | --- |
| De onde vem o cadastro oficial de produtos (sistema, exportação, colunas, codificação, delimitador)? Há EAN/DUN e fatores de caixa nessa fonte? Quem aprova os fatores? | A preencher. Implementado: importação de produtos por CSV/XLSX com modelo próprio; fator vazio fica pendente; nada sobrescreve cadastro existente. |
| Quais documentos de devolução existem e em que formato? Qual o identificador da devolução e o da linha/item? A NF é por linha ou do cabeçalho? Há chave fiscal? | A preencher. Implementado: chave = referência da devolução + linha/item (texto); NF, lote e data opcionais por linha (vazios = pendentes). **Sem referência e linha a linha não é importada.** |
| A linha do documento "001" é a mesma que "1"? Referências diferem por maiúsculas/minúsculas ("DEV-1" e "dev-1")? | A preencher. Provisório: linha só com dígitos é comparada sem zeros à esquerda; referências e SKU são texto exato (maiúsculas importam); SKU que só difere em maiúsculas de outro é recusado como conflito. |
| Em que unidades os documentos declaram quantidades (peças, caixas, kg)? Há fatores diferentes para a mesma embalagem? | A preencher. Implementado: unidade canônica ou embalagem cadastrada com fator aprovado; fator pendente, ambíguo ou conversão inexata impedem a linha. |
| Formato de data dos documentos e fuso de referência. | A preencher. Implementado: DD/MM/AAAA, AAAA-MM-DD ou célula de data (sem hora). |
| Importação parcial (gravar as válidas e deixar as inválidas para depois) é desejável? | A preencher. Primeira versão: inválidas e conflitantes bloqueiam o lote inteiro; duplicatas idênticas são ignoradas e informadas. |
| Como corrigir um documento já importado (quantidade, lote, NF)? Quem aprova? | A preencher. Implementado: registros documentais imutáveis; conflito sempre bloqueia; correção exigirá fluxo explícito com histórico (não implementado). |
| Por quanto tempo guardar os arquivos importados e os relatórios? Quem pode consultá-los? | A preencher. Provisório: arquivo guardado no banco (privado, por escopo) sem expurgo; histórico e relatório com `importacao.consultar` (supervisor). |
| Quem importa e quem exporta resultados de busca? | A preencher. Provisório: supervisor importa; supervisor e analista de claims exportam; todos que consultam paletes buscam. |
| Os limites (5 MB, 5.000 linhas, 50 colunas, 20 s; exportação de 5.000 linhas) atendem aos arquivos reais? | A preencher. Configuráveis no `.env`. |
| Que buscas a operação mais faz (por SKU, por devolução, por NF, por lote)? Precisa de período, cliente final ou outros filtros? | A preencher. Implementado: palete, endereço, SKU, código de barras, lote, devolução/NF, descrição (aproximada) e situação. |
| Haverá carga de inventário inicial (saldo já conferido) por planilha? | A preencher. **Não faz parte desta importação** (documental): exigiria operação distinta, autorizada e reconciliada. |

## Claims e rastreabilidade — pendente (etapa 07)

Nada abaixo foi confirmado pela operação. O app permite avançar com dados fictícios e tratativas manuais documentadas (decisão por texto, tratativa de lote, encerramento com decisão), sem declarar homologação.

| Pergunta | Registro |
| --- | --- |
| Como chega a lista de claims (portal, planilha, e-mail)? Quais colunas, codificação e identificadores (número do claim, linha/item)? Há uma linha por produto? | A preencher. Implementado: importação "Lista de claims" (CSV/XLSX) com referência do claim + linha obrigatórias; dados do caso repetidos nas linhas; modelos fictícios. |
| Quais motivos existem além de falta/extravio, avaria e divergência documental? | A preencher. Implementado: só esses três; outros exigirão configuração documentada. |
| Quais provas o cliente aceita para recuperação (conferência, foto, documento assinado, sistema)? Precisa de foto sempre? | A preencher. Implementado: só material conferido com saldo reconciliado sustenta recuperação física; foto/PDF opcionais (até 5 MB). |
| A origem precisa ser a mesma devolução e linha? A NF basta em algum caso? | A preencher. Implementado: mesma devolução (tipo e referência exatos); NF isolada fica pendente e bloqueia a validação; linha do documento conferida quando o documento foi importado. |
| O lote precisa coincidir? Em quais produtos/clientes? Quem aprova exceção? | A preencher. Implementado: "lote exigido" por linha (padrão: não); divergente ou desconhecido só valida com tratativa documentada do validador. |
| Material encontrado avariado num claim de falta conta como recuperação? E material saudável num claim de avaria? | A preencher. Implementado: falta/divergência exigem material saudável; avaria aceita avariado/em avaliação sem resolver o motivo; saudável em avaria fica pendente. |
| Qual é o prazo real de cada claim (data limite do cliente, SLA interno)? Prazo contado em dias corridos ou úteis? | A preencher. Implementado: prazo só informado (nunca calculado); "vencido" e "próximos 7 dias" pela data no fuso da unidade. |
| Quem é responsável por tratar, quem valida a recuperação e quem aprova o resultado financeiro? A mesma pessoa pode solicitar e validar? | A preencher. Provisório: analista de claims trata e valida; aprovação financeira só por concessão explícita do administrador a um analista; solicitar e validar pela mesma pessoa é permitido (registrado). |
| Como tratar cobrança já finalizada no cliente (estorno, nota de crédito, abatimento)? Quem prova o resultado externo? | A preencher. Implementado: pendência até a referência do resultado externo; o app não altera nem consulta o sistema do cliente. |
| Valor estimado vem por unidade ou total? Em qual moeda e de qual fonte (tabela, nota, portal)? Há limite contratual de ressarcimento? | A preencher. Implementado: unitário ou total da linha (total nunca multiplicado), moeda por caso, fonte obrigatória com valor; nenhum limite presumido. |
| Quando um caso é considerado regularizado, perda confirmada ou encerrado? Quem decide e com que documento? | A preencher. Implementado: regularizado/perda confirmada exigem resultados cobrindo cada linha; encerrado exige decisão documentada; reabertura com motivo. |
| Material recuperado pode ser expedido de volta ao cliente ou deve ficar separado? Pode ser reservado para janela? | A preencher. Implementado (etapa 08): vínculo não é reserva; reservado e vinculado não se sobrepõem; material vinculado não é reservável (pendência "vinculado a claim"). |
| Qual prioridade a operação usa (prazo, valor, cliente)? | A preencher. Implementado: prioridade manual explícita; ordenação inicial configurável (`CLAIMS_ORDEM_PADRAO`). |
| Por quanto tempo guardar anexos e evidências? | A preencher. Provisório: no banco, privados por escopo, sem expurgo. |

## Janelas, liberação e expedição — pendente (etapa 08)

| Pergunta | Registro |
| --- | --- |
| Quais métricas o cliente usa em cada janela (peças, caixas, paletes, peso bruto/líquido, m³)? Há mais de uma ao mesmo tempo? | A preencher. Implementado: uma restrição por métrica, várias simultâneas; limite vazio = pendente; todas precisam caber. |
| As quatro janelas do mês têm datas fixas? Quem informa e com que antecedência? Há prazo de corte, tolerância ou dia da semana? | A preencher. Implementado: cada janela cadastrada com os dados informados; nada criado, datado ou distribuído automaticamente; saída fora do intervalo exige alterar o período com justificativa e fonte. |
| Que tipos de material/condição/origem cada janela aceita? Lote ou validade limitam a saída? | A preencher. Implementado: condições aceitas, tipos de origem (ou qualquer), lote/origem exigidos; validade não modelada. |
| Quais documentos a saída exige (romaneio, NF de devolução, autorização)? Há regra fiscal da L’Oréal aplicável? | A preencher. Implementado: lista de documentos exigidos por janela (referência textual ou anexo); nenhuma regra fiscal inventada; nenhum documento fiscal emitido. |
| Quem libera material para expedição e com que critério/registro? Quem bloqueia e desbloqueia? | A preencher. Provisório: supervisor de estoque libera/bloqueia com critério, fonte e motivo; conferência e claim não liberam. |
| Material recuperado de claim pode ser expedido na janela? Material avariado tem destino próprio? | A preencher. Implementado: vinculado a claim não é reservável (pendência); avariado só sai se a janela aceitar a condição. |
| Quais fatores e medidas valem (peso por palete, volume, caixas por embalagem)? Quem mede e com que instrumento? | A preencher. Implementado: medidas informadas por unidade de carga com fonte; nenhuma conversão presumida. |
| Unidade de carga é sempre o palete? Há consolidação/repaletização na doca? | A preencher. Implementado: unidade de carga = palete físico; separar parte usa a transferência existente. |
| Quem prepara, quem confirma a saída e quem pode registrar retorno? | A preencher. Provisório: operador prepara; supervisor reserva, confirma, cancela e registra retorno. |
| Como funciona a recusa/retorno do cliente (aviso, devolução física, nova NF)? O material volta ao mesmo segmento? | A preencher. Implementado: aviso documental não repõe saldo; recebimento físico vira declaração num palete novo e entra pela conferência/reconciliação; capacidade da janela não volta. |
| Envio parcial: o restante pode seguir em outra janela automaticamente? | A preencher. Implementado: uma confirmação conclui a reserva; o restante é liberado e precisa de nova reserva. |

## Aparelhos, rede, atualização e recuperação — pendente (etapa 09)

| Pergunta | Registro |
| --- | --- |
| Quais aparelhos serão usados na praça (modelo, sistema, navegador)? Há coletor com leitor integrado? | A preencher. Testado só no computador de desenvolvimento e em emulação; matriz em `ESTADO.md`. |
| Qual endereço HTTPS e certificado o piloto terá? Os aparelhos alcançam o servidor pela rede da operação? | A preencher (infraestrutura). Sem HTTPS fora do computador não há câmera nem instalação. |
| Quais formatos de código de barras existem nas embalagens reais (EAN-13, ITF-14, Code 128, DataMatrix)? Há códigos com dígito verificador inválido ou com zeros que somem em leitores? | A preencher. Implementado: QR, EAN-13/8, UPC-A/E, Code 128, Code 39, ITF e DataMatrix; o texto lido é usado exatamente como veio, sem normalização. |
| A política da empresa permite guardar no navegador o que ainda não foi enviado (só durante a falha)? | A preencher. Implementado conforme AGENTS.md: proibido em produção (só memória); ativado apenas em desenvolvimento/teste. |
| Fotos da conferência: quem pode tirar, quanto tempo ficam guardadas e quem pode ver? Há limite de armazenamento? | A preencher. Provisório: quem registra a conferência envia; quem consulta paletes vê; sem expurgo; até 20 por conferência e `CLAIMS_ANEXO_MAX_MB`. |
| Backup: frequência, retenção, destino, responsável, meta de perda de dados (RPO) e de tempo de recuperação (RTO)? | A preencher. Scripts prontos e ensaiados localmente; nenhum agendamento ativado. |
| Depois de uma restauração, quem apura o que aconteceu entre o backup e a falha (movimentos, saídas físicas) e com que registro? | A preencher. A restauração devolve o ponto do snapshot; nada é repetido automaticamente. |
| Quem publica versões novas e em que horário (para não coincidir com contagens)? | A preencher. A interface avisa e só atualiza por ação da pessoa. |

## Inventário enviado, seleção do cliente e endereços — pendente (complemento, 5 out. 2026)

Processo informado: a operação confere os paletes, gera um inventário e envia ao cliente; o cliente escolhe o material a devolver. Implementado: inventário de referência → seleção → conciliação → pendências → lista de separação → reserva pela janela. O modelo `Inventario L'oreal novo.xlsx` foi consultado **só pela estrutura** (abas, cabeçalhos, formatos, cores); nenhum dado dele foi gravado nem copiado para o projeto.

| Pergunta | Registro |
| --- | --- |
| Qual arquivo é a **versão definitiva** do inventário conferido (nome, data, quem conferiu)? | A preencher. Implementado: quem importa marca "versão definitiva", informa referência/data/fonte da conferência; nada é deduzido do nome da aba ou da data do envio. |
| Quais são as **colunas reais da seleção** devolvida pelo cliente? Ela vem como lista própria ou como cópia do inventário com uma coluna de escolha? Quais valores significam "selecionado"? | A preencher. Implementado: as duas modalidades; os valores de marcação são escolhidos na prévia (vazio ou outro texto não é aprovação). |
| O que significam **NFD** e **MI** na coluna TIPO? Qual deles é a NF de devolução e como se relaciona com a origem registrada nos paletes? | A preencher. Implementado: sem definição, a sigla não é relacionada à origem; a definição é informada na prévia (tipo → origem). Mesmo número com tipos diferentes = documentos diferentes. |
| A coluna NF da seleção é a NF do inventário, a origem da devolução ou outra referência? | A preencher. Escolha explícita por seleção. |
| **N° Pallet** identifica o palete físico (permanente) ou numera a posição? Pode repetir entre fileiras? | A preencher. Observado no modelo: ~1:1 com RUA (exceções existem) e 8 valores em formato de endereço ("GR - 12"). Implementado: escolha obrigatória na confirmação; valor fora do formato de código de palete fica para resolução. |
| A seleção pode ser **parcial** (parte de uma NF, parte de um palete) ou é sempre o palete/NF inteiro? NF sem quantidade = todo o material dela no inventário? | A preencher. Implementado: abrangência por linha (palete, NF, linha/produto); NF sem quantidade fica pendente, salvo configuração explícita "todo o material da NF que constava no inventário". |
| **VOLUMES**: é quantidade de caixas, de volumes de transporte ou outra unidade? Vale para a linha (NF × palete) ou para o palete inteiro? | A preencher. Implementado: guardado como "volumes" por linha, sem soma entre parcelas e sem conversão para peças/SKU. Fórmulas e "*" no modelo ficam como não informados. |
| **PALLET FULL** ("01\07"): significa palete 1 de 7 de uma NF, composição do palete ou outra coisa? | A preencher. Guardado como texto; não cria paletes nem multiplica volumes. |
| **Convenções de cor**: a fonte verde na RUA significa "endereço livre" (vigente)? A verde em DOCUMENTAÇÃO significa só "VALIDADA"? Há outras? | A preencher. Observado no modelo: fonte FF00B050 em 77 células da RUA e em DOCUMENTAÇÃO = VALIDADA; sem formatação condicional. Implementado: cor só ganha significado quando escolhida para a coluna RUA; CSV usa coluna textual. |
| **DOCUMENTAÇÃO** (VALIDADA/VALIDAR) tem efeito sobre a saída? | A preencher. Implementado: informativa; não libera material. |
| Como o inventário enviado é **identificado** (referência/versão) quando o cliente devolve a seleção? | A preencher. Implementado: inventário de referência escolhido na importação da seleção; versões substitutivas rastreadas. |
| **Quem resolve** as pendências (NF sem palete, ambiguidade, palete sem endereço) e com que prazo/registro? | A preencher. Provisório: supervisor de estoque resolve (com motivo, auditado); operador e analista consultam e exportam. |
| MÊS AGENDA e JANELA do inventário correspondem a qual janela cadastrada? | A preencher. Guardados como texto; nenhum vínculo automático com janela. |

### Carga do inventário real em lote (6 out. 2026)

O pacote preparado `Importacao-Praca-Reversa.zip` (schema `praca-reversa.importacao-inventario.v1`, aba `Inventario L'oreal - 28-09-09`) foi carregado no **escopo real local** `PRACA-REVERSA/LOREAL` (não demonstração) como `INV-000001`. Nenhum dado real foi copiado para o repositório, fixtures ou demonstração. Respostas que o pacote trouxe e o que continua aberto:

| Pergunta | Registro |
| --- | --- |
| Palete full | Definição do usuário: uma única identidade de NFD no endereço e registros suficientes = full; várias = misto; informação incompleta = não informado. O marcador "01\\02" da antiga coluna não garante full. |
| NFD × MI | NFD = nota de devolução. MI e tipo ausente ficam como "documento de tipo pendente/outro tipo" (não chamados de NFD): **confirmar o significado de MI** e o tipo dos documentos sem tipo. |
| N° Pallet | **Referência externa ainda sem significado confirmado** (o mesmo número aparece em dois endereços): não é ID nem código do palete. |
| Identidade documental | Tipo + número + DELIVERY (ou, sem DELIVERY, remetente normalizado). Mesmo número em outro contexto = candidato, não a mesma nota: **confirmar** se esses casos são a mesma NF. |
| Endereço verde (livre) | O material saiu dessa praça; o local atual não foi informado. As NFs ficam como referência fora da praça. **Onde está esse material hoje?** |
| Volumes pendentes | Vínculos com volumes ausentes ou repetidos em linhas iguais ficam pendentes (desconhecido ≠ zero): **confirmar** as quantidades (lista no relatório da carga em `.dados/cargas/`). |
| Cidade destino e produto na caixa | Vazios na carga; preenchidos no aplicativo. Não inferir cidade do remetente. |
| Posição no mapa | Sentido confirmado (menor número no topo, ímpares à esquerda nas fileiras duplas). **Faltam o código inicial/final de cada faixa** para confirmar as sequências; até lá os 123 paletes ficam com o endereço informado e "posição no mapa pendente". Depois de confirmar, rodar a carga de novo registra as posições. |

### Endereços reais por faixa (a confirmar no levantamento)

Nomenclatura confirmada: FB01–FB06 = Fileiras 11–16, FB07 = GR. Pendente por faixa: **endereço inicial, final e sentido** (P01 no topo do desenho recebe o primeiro ou o último código?) e lacunas/numerações próprias. Sequências **observadas no modelo** (pista para o levantamento, não confirmadas):

| Fileira / faixa | Observado no modelo (não confirmado) | Pendente |
| --- | --- | --- |
| Fileira 11 (FB01, F01, única) | códigos A42–A58 (17) | início/fim/sentido; confirmar que não há outros |
| Fileira 12 (FB02, F02/F03) | ímpares A79–A89 e A103–A123; pares A92–A124 | quebra entre A89 e A103; qual faixa é a esquerda; sentido |
| Fileiras 13 e 14 (FB03/FB04) | A101–A134 | ímpares à esquerda e pares à direita (informado); sentido |
| Fileiras 15 e 16 (FB05/FB06) | A101–A130 | idem |
| GR (FB07, F12, única) | 1–15 (endereço "GR - 5") | início/fim/sentido; formato com ou sem letra |
| Referência visual dos lados | — | de que ponto da praça se olha para "esquerda/direita" na vista de referência |

Variações de escrita observadas e tratadas pela normalização: "15- A120", "15 - A 120". Não corrigidas (ficam para resolução): "14 - 130" (sem letra), "A120" (sem fileira).

## Suposições usadas somente na demonstração (etapas 01 a 09)

Não são regras do cliente. Servem para exercitar a interface com dados fictícios e devem ser substituídas pelas respostas acima.

| Suposição | Onde aparece |
| --- | --- |
| Esquema informado com 1 fileira única de 15, 1 par de 15, 1 par de 17 e 1 única de 17 (96 posições), códigos `F01-P01`… | Escopo "Praça informada · demonstração". |
| Os 6 paletes da etapa 01 (endereços `A-01`…`B-03`) ocupam `F01-P01`…`F02-P03`, conforme `examples/mapeamento-fixtures-etapa-02.json`. | Mesmo escopo; IDs preservados. |
| Endereço no formato `RUA-COLUNA` (ex.: `C-01`), zonas Norte/Sul, 8 ruas × 24 colunas cada, corredores, 6 docas e 6 posições indisponíveis — todos fictícios. | Escopo "Cenário de navegação · fictício" (layout da etapa 01). |
| Uma posição recebe no máximo um palete. | Validação dos fixtures e, desde a etapa 03, índice único no banco (D49). |
| Códigos gerados `PAL-DEMO-###` (demonstração) e `PR-######` (demais escopos). | Cadastro de palete. |
| Unidades sugeridas UN, CX, PCT, KG, L; UN exige quantidade inteira. | Produtos e linhas declaradas. |
| Posição sem palete registrado não é tratada como fisicamente vazia: "sem registro" (levantada) ou "ocupação desconhecida" (não levantada). | Mapa, lista e legenda. |
| Quantidades em peças inteiras (UN), armazenadas com 3 casas decimais. | Conteúdo dos paletes de exemplo. |
| Fuso de exibição America/Sao_Paulo. | Datas na interface. |
| Produtos DEMO-101/102/103 em UN; códigos de barras fictícios de prefixo 2 (unidade, caixa de 12 de DEMO-101 e caixa de DEMO-102 com fator pendente). | Praça informada · demonstração (seed e migração da etapa 04). |
| Contagens e saldos dos paletes de exemplo (PAL-DEMO-001…006) tratados como conferência concluída e saldo inicial sem responsável, origem DEVOLUCAO. | Conversão da carga anterior (etapa 04). |
| Motivos sugeridos de movimentação e transferência (texto livre continua permitido). | Telas "Mover palete" e "Transferir produtos" (etapa 05). |
| Reservas dos testes das etapas 04/05 feitas pela operação real da etapa 08 (liberação + janela fictícia + reserva). | Testes PostgreSQL de conferência e movimentação. |
| Arquivos de importação, modelos (SKUs `000123`, `000456`, `MODELO-789`, `MODELO-KG`, devoluções `DEV-MODELO-…`), produtos `000777`/`000778` e devolução `DEV-DEMO-90` das capturas — todos fictícios. | Modelos da importação, testes e `docs/capturas/etapa-06/` (etapa 06). |
| Volumetria de teste (2.000 paletes, 6.000 saldos, 6.000 declarações, 10.000 linhas de documento) gerada direto no banco de testes. | `apps/api/test/banco/busca-volume.test.ts` (etapa 06). |
| Claims `CLM-DEMO-0701` (falta de 12 de `DEMO-777`, devolução `DEV-DEMO-701`, R$ 10,00 por unidade) e `CLM-DEMO-0702` (avaria de 2, `DEV-DEMO-703`), devoluções `DEV-DEMO-702/703`, regularização `REG-DEMO-0701` de R$ 30,00 e comprovante PDF — todos fictícios. Modelos `CLM-MODELO-0001/0002`. | `docs/capturas/etapa-07/`, modelos da importação e testes (etapa 07). |
| Janelas fictícias do mês (1ª com 20 UN e 3 paletes; 2ª com 12 m³ e 8 paletes; 3ª com 800 kg brutos; 4ª em rascunho com limite e critérios pendentes), autorizações `AUT-DEMO-08xx`/`00080x`, documento "Romaneio fictício" `000123`, produto `DEMO-808`, devoluções `DEV-DEMO-0801…0803`, liberação `LIB-DEMO-0801`, medidas e comprovante de retorno — todos fictícios. | `npm run capturas` (etapa 08). |
| Palete bloqueado da carga de demonstração com data de bloqueio fixa (1 out. 2026, fictícia). | Fixtures de demonstração (etapa 08). |
| Endereços **fictícios** confirmados na demonstração: F01 = `11 - A1`…`A17`, F08 = `15 - A101`…`A129` (ímpares), F09 = `15 - A102`…`A130` (pares). Inventário, seleção, NFs (`777D001`…, `5550001`…), paletes `E2E-D9101`/`9101`…, tipo `DEV` → origem DEVOLUCAO, pedido `PED-E2E-D` e janela da seleção — todos fictícios. | Seed de demonstração, testes PostgreSQL, `e2e/selecao.spec.ts` e `docs/capturas/selecao-cliente/` (complemento). |
| Câmera simulada (canvas e vídeo Y4M) com códigos gerados no teste; os EAN-13 da demonstração (`2000000001014` etc.) têm dígito verificador inválido e por isso são lidos em Code 128 nos testes e capturas; fotos de conferência com bytes aleatórios; volume do ensaio de backup (fotos e eventos de auditoria `ENSAIO_VOLUME_FICTICIO`) criado e apagado no próprio ensaio — tudo fictício. | `e2e/camera*.spec.ts`, `npm run capturas` (etapa 09), `scripts/recuperacao/ensaio-volume.mjs`. |

## Registro de decisão operacional

Para cada resposta: pergunta; regra acordada; responsável/fonte; data; documento de apoio; campos afetados; cenário de validação; status confirmado ou pendente.

## Piloto

Escolher um grupo delimitado e identificável de paletes e um responsável operacional. Registrar estado inicial, conteúdo encontrado, tempo de conferência, divergências, tratativas validadas e saídas. O tamanho do grupo depende das pessoas e do tempo disponíveis; dez paletes é um exemplo de início, não uma obrigação.

Entrada no piloto: ID e localização; acesso individual; saldo/histórico persistidos; contagem e movimentos testados; regra de unidade; responsável pela reconciliação; backup e procedimento de recuperação. Conferência dos demais paletes pode continuar pelo processo atual e ser incorporada gradualmente.

Saída do piloto: comparar mapa e registros com o físico, verificar movimentos, obter validação das tratativas e documentar ajustes antes de ampliar a praça. Uma melhora percebida deve ser acompanhada dos números e evidências que a sustentam.
