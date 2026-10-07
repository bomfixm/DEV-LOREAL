# Praça Reversa — inventário enviado, seleção do cliente e conciliação

Use este complemento no Claude que está desenvolvendo o aplicativo existente. Ele amplia a importação/busca da etapa 06 e a preparação de janelas da etapa 08, com orientação integrada ao tutorial da etapa 10.

## 1. Processo informado e objetivo

A operação confere os paletes, gera um inventário e envia ao cliente. **O cliente escolhe o material que deve ser devolvido.** A equipe precisa ler essa seleção e identificar os paletes/NFs solicitados, seus endereços atuais e as pendências de informação, principalmente NF sem vínculo com palete.

Implemente o percurso: **inventário de referência → seleção do cliente → conciliação com os registros → revisão de pendências → lista de separação → reserva/expedição existente**.

Continue o projeto e preserve as regras já entregues. Leia `AGENTS.md`, `README.md`, `docs/ESTADO.md`, os documentos de dados/regras/interfaces e as implementações das etapas 04/05/06/08/10. Inspecione código, contratos, serviços, modelos e testes antes de editar. Não afirme que uma etapa está implementada apenas porque há um prompt.

Reutilize TypeScript, React, Fastify, PostgreSQL/Prisma, leitores CSV/XLSX, busca, auditoria, permissões, movimentos, reservas e exportações existentes. Consulte documentação oficial da versão utilizada quando necessário; não refaça o aplicativo ou acrescente um serviço externo de IA para cruzar identificadores.

**A nomenclatura informada abaixo está agora autorizada.** Aplique essa atualização aos blocos existentes. Preserve a geometria do mapa, os IDs das posições/paletes, os QR codes, os movimentos e as áreas desativadas. Confirmações ainda necessárias sobre a sequência dentro de cada faixa são tratadas como configuração pendente, sem gerar endereços presumidos.

Se a etapa 10 estiver em andamento, preserve a prioridade do tutorial. Entregue este complemento como incremento integrado, sem abandonar ou reconstruir o trabalho existente.

### 1.1. Nomenclatura real da praça

O operador informou a correspondência entre os blocos provisórios e as fileiras reais. O PDF de referência define a geometria, e a tabela abaixo define os nomes operacionais:

| Bloco existente | Nome operacional | Faixas no desenho | Posições desenhadas |
| --- | --- | --- | --- |
| FB01 | Fileira 11 | F01, única | 17 |
| FB02 | Fileira 12 | F02/F03, dupla | 34 |
| FB03 | Fileira 13 | F04/F05, dupla | 34 |
| FB04 | Fileira 14 | F06/F07, dupla | 34 |
| FB05 | Fileira 15 | F08/F09, dupla | 30 |
| FB06 | Fileira 16 | F10/F11, dupla | 30 |
| FB07 | GR — Grade | F12, única | 15 |

São 194 posições ativas desenhadas. Isso descreve o mapa de referência, sem declarar 194 paletes ocupados ou validar fisicamente todos os endereços. Preserve a exclusão das 300 posições desativadas da capacidade ativa. Verifique a estrutura existente antes de migrar os rótulos; não duplique posições se o projeto já aplicou parte da alteração.

Nas fileiras duplas, os endereços A ímpares ficam no lado esquerdo e os pares no lado direito, na vista de referência da praça. Exemplos: A101/A103/A105 à esquerda e A102/A104/A106 à direita. Essa regra não define, sozinha, o início/fim da sequência nem os endereços das duas faixas únicas.

O endereço é composto: **fileira ou GR + código local**. Por exemplo, “15 - A120” é uma posição da fileira 15. “13 - A120” é outra posição. Não busque, atualize ou crie vínculos usando apenas A120. Normalize separadores/espaços/caixa com regras registradas, preservando o texto original. Não complete prefixos ausentes ou corrija números silenciosamente.

Separe a identidade permanente do palete, o número de palete informado pela operação, a posição física e os rótulos provisórios F/P do desenho. P01 representa apenas a primeira posição visual no PDF; não equivale automaticamente a A101 ou ao número do palete.

Use uma tabela explícita de correspondência entre posição existente, fileira, lado, ordem visual e endereço real. A partir de uma sequência confirmada, é possível gerar uma proposta e revisar essa tabela. Não dependa de uma fórmula fixa que pressuponha todas as faixas começando em A101/A102, pois podem existir numerações próprias ou intervalos irregulares.

Antes de confirmar a vinculação no mapa, obtenha os endereços inicial/final e o sentido de crescimento de cada faixa, especialmente Fileira 11 e GR. É possível avançar com leitura dos arquivos, prévia, busca e conciliação documental enquanto esse mapeamento estiver pendente. Um endereço ainda sem posição visual pode aparecer na lista com essa pendência; não o coloque em um retângulo por aproximação.

### 1.2. Arquivos operacionais para adaptar a importação

O operador informou que o inventário definitivo acabou de ser conferido e está organizado. Utilize a versão que ele identificar como definitiva para o carregamento. O modelo “Inventario L'oreal novo.xlsx” consultado para conhecer a estrutura não deve ser escolhido automaticamente como essa versão nem usado para gravar estoque sem essa identificação.

O modelo consultado tem uma aba de inventário, uma aba de resumo e uma aba oculta. Sugira a aba de inventário; não importe resumos nem abas ocultas automaticamente. Os cabeçalhos observados são:

| Coluna do modelo | Uso na importação |
| --- | --- |
| DELIVERY | Referência de entrega/processo, preservada como texto. |
| TIPO | Tipo documental a confirmar no contexto da operação. |
| NUMERO | Número documental/NF associado ao tipo e às demais referências necessárias. |
| VOLUMES | Quantidade de volumes informada, cuja unidade e abrangência devem ser confirmadas. |
| REMETENTE | Remetente informado. |
| MÊS AGENDA | Mês informado; não inventar o ano ou a data exata. |
| JANELA | Referência de janela informada; relacionar com uma janela cadastrada mediante regra explícita. |
| RUA | Endereço completo, por exemplo “15 - A120”. |
| N° Pallet | Número de palete informado; confirmar se é identificador do palete ou numeração da posição. |
| DOCUMENTAÇÃO | Situação documental informada; não equivale a liberação física automática. |
| PALLET FULL | Marcador de composição/fracionamento a preservar e interpretar conforme regra confirmada. |
| PF/CNPJ | Categoria informada, respeitando o escopo de acesso existente. |

Trate esse quadro como sugestão editável, validada contra os cabeçalhos do arquivo definitivo. Preserve também os demais campos úteis existentes no arquivo, em estrutura consultável; não descarte informações só porque o resumo do palete mostra menos colunas.

NFD, NF ou outros tipos precisam de uma definição operacional antes de serem tratados como origem/devolução. Não inferir essa definição apenas pela sigla. VOLUMES não se converte automaticamente em unidades de produto, SKU ou saldo validado por produto. Um valor como “01\\07” em PALLET FULL não cria sete paletes nem multiplica volumes por sete.

Se houver convenções por cor, mapeie-as por coluna e significado operacional confirmado. A convenção de endereço livre indicada por fonte verde em RUA, quando vigente no arquivo, deve virar situação explícita e impedir ocupar aquele endereço com dados remanescentes. Preserve essas linhas como referência histórica/pendente conforme a regra da operação. A cor verde de DOCUMENTAÇÃO pode ter outro significado. Não derive situação pela presença de qualquer célula verde na linha; CSV exige coluna textual equivalente quando a cor for essencial.

Arquivos com muitas células apenas formatadas exigem leitura com limites de tempo/memória/descompactação. Processe os registros com valores relevantes; não gere um milhão de linhas de importação por causa da dimensão formatada da aba. Zero é um valor válido, não uma linha vazia. Não use totais de fórmulas em uma aba de resumo como prova de que os registros foram conferidos pelo aplicativo.

## 2. As duas fontes e a base atual

Suporte o inventário enviado e a seleção devolvida pelo cliente. Eles podem ser arquivos diferentes ou uma cópia do inventário com coluna de escolha. O sistema também consulta estoque, vínculos e movimentos atuais.

| Fonte | Uso |
| --- | --- |
| Inventário enviado ao cliente | Fotografia do que foi informado, com referências, conteúdo, alocações e data daquela versão. |
| Seleção do cliente | Solicitações explícitas, com identificação do pedido/versão, abrangência e quantidades quando informadas. |
| Registros atuais da aplicação | Paletes, endereços, vínculos, quantidades, reservas e situação após conferências/movimentos/saídas. |

Se o inventário for produzido na aplicação, reutilize a exportação e registre um identificador de versão/snapshot, filtros, data e referências das linhas. Preserve a fotografia enviada, mesmo após movimentos.

Se ele tiver sido produzido fora da aplicação, permita importá-lo pelo fluxo CSV/XLSX existente como referência ou como inventário conferido. Os vínculos NF–palete–endereço aparecem com sua fonte/data e situação de validação. A leitura e a prévia não aprovam saldo físico. Para o inventário já conferido informado pelo operador, ofereça uma confirmação explícita de importação/vinculação e reutilize o processo de conferência/reconciliação para registrar observações externas e aprovar apenas o que a base realmente comprova. Não invente estoque nem exija automaticamente uma nova contagem só por o registro ter vindo de planilha.

Apresente separadamente **alocação informada no inventário** e **alocação confirmada nos registros atuais**. Um arquivo antigo pode apontar uma posição histórica; isso não substitui uma movimentação confirmada mais recente. Se só houver a referência antiga, informe a necessidade de confirmar a localização.

Documento sem vínculo físico continua documental. Um palete desconhecido citado no arquivo pode ter seu cadastro/vinculação proposto na prévia, com o endereço e os dados disponíveis. A confirmação revisada pelo responsável pode criar/vincular os registros pelo serviço existente e reconhecer uma conferência externa com evidência suficiente. Não criar paletes conferidos/ocupados durante a leitura nem inventar conteúdo para suprir campos ausentes. Quando faltar a associação ou a identidade, encaminhe ao fluxo de resolução e preserve o histórico da correção.

### 2.1. Carregar o inventário conferido nos paletes

Crie a ação **“Importar inventário conferido”** no fluxo de inventário existente. O usuário escolhe o arquivo definitivo, a aba e o mapeamento, informa a referência da conferência e revisa a proposta antes de confirmar. Registre responsável, data de importação, data/fonte da conferência quando informadas e identidade do arquivo; não presuma data de conferência a partir da data de upload ou do nome da aba.

A prévia deve mostrar, por linha: documento/tipo/DELIVERY, número de palete informado, palete permanente resolvido ou proposto, endereço completo, posição visual resolvida ou pendente, volumes e sua unidade/base, documentação e ação proposta. Distinga “vincular”, “criar cadastro proposto”, “atualizar informação”, “já importado”, “referência histórica/endereço livre” e “requer resolução”.

Agrupe no detalhe de cada palete todas as NFs/documentos e informações correspondentes. Uma NF em vários paletes deve aparecer em todos os vínculos comprovados. Várias NFs no mesmo palete não criam vários paletes. Não deduplique linhas apenas por número de NF nem some volumes sem verificar se são parcelas distintas ou repetição do mesmo total.

Confirme o significado/escopo de N° Pallet antes de usar o valor como chave. Se for numeração de posição, mantenha-a na posição e resolva/crie a identidade permanente do palete separadamente. Preserve códigos/QR já existentes. Se a identificação for insuficiente, solicite resolução na prévia em vez de criar paletes duplicados.

Não considere endereço ausente no arquivo como endereço inexistente ou livre, nem apague conteúdo atual por omissão. O arquivo pode conter apenas posições ocupadas. Uma substituição integral de inventário exige escopo e revisão explícitos, incluindo o impacto em reservas e movimentos. A importação normal é uma atualização por registros, não um reset da praça.

Conflitos como um palete atual em duas posições, posição já ocupada por outro palete, mapeamento incompatível ou movimentação confirmada posterior à conferência precisam aparecer na revisão. Não sobrescreva o estado atual silenciosamente. Apenas registrar um endereço no inventário externo não substitui uma movimentação física posterior. Não libere nem altere reservas/claims/saídas existentes por este carregamento.

Se o arquivo comprovar apenas NF, palete, endereço e volumes, carregue essas informações nesse nível. O detalhe do palete e a busca por NF ficam úteis mesmo sem composição por SKU. SKU, lote, condição e quantidade de peças ainda não fornecidos permanecem desconhecidos; não monte produtos fictícios para preencher a interface.

Na confirmação, revalide escopo, permissões, versões e vínculos, e persista pelo serviço transacional existente com identidade de lote/linha e auditoria. Reenviar o mesmo inventário não duplica NF, vínculo, palete ou saldo. Alterações de uma versão nova aparecem numa revisão com diferenças. Registre a aprovação da conferência externa separadamente da importação documental; aumente saldo validado somente quando os dados, a unidade, a conferência e a autorização existentes sustentarem esse aumento.

Permita selecionar explicitamente o conjunto válido para confirmar enquanto as linhas com pendências permanecem registradas como não aplicadas. A gravação desse conjunto deve ser integral ou revertida, sem aplicar parcialmente de modo silencioso. Depois, permita corrigir e reapresentar somente as pendências, com rastreabilidade.

## 3. Importar a seleção com prévia

Crie uma entrada clara **“Seleção do cliente”**, com ação **“Importar seleção”**, histórico de listas e acesso às pendências. Reutilize os estados e controles da etapa 06: arquivo, escolha da aba, mapeamento, interpretação, prévia, validação e confirmação.

Ofereça duas modalidades de entrada:

- **Lista já selecionada:** cada linha representa uma solicitação do cliente.
- **Inventário com marcação:** o usuário identifica a coluna de decisão e quais valores significam seleção. Mostre as linhas incluídas/excluídas e a regra antes de confirmar; não presuma que um campo vazio ou qualquer texto seja aprovação.

O mapeamento deve acomodar os cabeçalhos reais. Campos possíveis: referência do inventário, pedido/versão, janela, código do palete, referência/chave de NF, contexto documental, devolução, linha, SKU, lote, quantidade solicitada, unidade, marcação e observação. Não exija todos em qualquer modalidade; exija os componentes necessários para identificar a solicitação e sua abrangência.

Esclareça o significado da coluna NF: origem, devolução ou outra referência usada pela operação. Não trate referências de tipos diferentes como equivalentes por coincidência do número. Preserve identificadores como texto e zeros à esquerda; sinalize precisão já perdida pelo Excel. Registre valores originais e normalizações documentadas.

Registre ou confirme a abrangência de cada solicitação:

| Abrangência | Tratamento |
| --- | --- |
| Palete inteiro do inventário | Identificar o palete e o conteúdo que o cliente selecionou naquela referência; revisar diferenças no conteúdo atual. |
| Material de uma NF/devolução | Localizar o material correspondente informado no inventário, inclusive quando distribuído em vários paletes. |
| Linha/produto e quantidade | Identificar a origem/linha e a quantidade/unidade solicitadas; respeitar lote e demais restrições informadas. |

Uma seleção por NF sem quantidade pode representar todo o material daquela devolução que constava no inventário, quando esse significado estiver explicitamente configurado. Não use automaticamente a quantidade fiscal original como quantidade física devolvida. Ausência de quantidade não significa zero nem permite enviar uma quantidade arbitrária.

Erros de leitura, campos obrigatórios ausentes e interpretações conflitantes bloqueiam a confirmação até correção. **NF válida sem alocação é uma pendência de conciliação**, não um erro de formato: a lista pode ser registrada com essa pendência, sem torná-la apta a reservar/expedir.

Não execute fórmulas/macros/links; mantenha limites de arquivo, linhas, descompactação e processamento no servidor. Preserve o arquivo/mapeamento e resultados por linha conforme a política de retenção existente.

Reenvio do mesmo lote retorna o resultado existente. Use o escopo, referência de pedido/versão, hash e identidades de negócio pertinentes para evitar duplicar solicitações. Linhas aparentemente repetidas podem exigir revisão: não some quantidades nem descarte linhas distintas por coincidência de NF/SKU. Registre a decisão de agrupamento/duplicidade e preserve a origem de cada linha.

Uma lista corrigida do cliente gera revisão rastreada da mesma solicitação quando identificada como substituição. Mostre inclusões, exclusões e quantidades alteradas. Não cancele reservas, acrescente demanda ou desfaça saídas automaticamente por importar uma versão nova; revise o impacto com os fluxos existentes.

## 4. Conciliação e situações

Execute o cruzamento no servidor, no escopo autorizado de unidade/cliente. Priorize referências explícitas do inventário/pedido, ID permanente do palete, identidade documental e linha/origem. Número isolado de NF e SKU isolado não devem resolver uma identidade ambígua. Correspondência aproximada serve como sugestão para revisão, sem criar vínculo aprovado.

Use os vínculos atuais e a rastreabilidade de movimentos, fracionamentos e consolidações para localizar o material. Uma NF comprovadamente distribuída em vários paletes é um resultado válido com múltiplas localizações; isso é diferente de várias NFs/origens possíveis para um identificador insuficiente.

Apresente **vínculo/localização**, **base de quantidade** e **elegibilidade para expedição** como aspectos separados. Um produto pode estar localizado e ainda estar bloqueado ou reservado.

| Situação | Significado e orientação |
| --- | --- |
| Localizado | Vínculo resolvido; exibir todos os paletes/endereço(s), fonte, horário e bases disponíveis. |
| NF/documento sem palete | Referência encontrada, mas sem alocação física identificada; encaminhar para investigação/vinculação. |
| Palete sem endereço | Palete identificado, com localização atual pendente; abrir detalhe sem inventar uma posição no mapa. |
| Não encontrado na base consultada | Não houve registro correspondente naquele inventário/escopo; registrar a base pesquisada e revisar a referência. |
| Identificação ambígua | Há candidatos incompatíveis; exibir os candidatos pertinentes e solicitar resolução explícita. |
| Apenas referência histórica | Material aparece no inventário/histórico, sem posição atual confirmada; não apresentar o endereço antigo como atual. |
| Quantidade não atendida | Quantidade solicitada excede a quantidade correspondente identificada/comprovada, quando ambas forem comparáveis. |
| Informação ainda pendente | Conferência, unidade/fator, origem, conteúdo ou quantidade insuficientes para concluir. |
| Localizado com restrição | Localização conhecida, mas material bloqueado, sem liberação, reservado ou incompatível com a janela. |

Não transforme “sem palete”, “não encontrado” ou diferença de quantidade em produto perdido/claim confirmado. Trata-se de ausência/divergência de registros até a investigação pertinente.

Quando houver histórico comprovado de saída, mostre o que já foi expedido e a referência da saída, separado do estoque atual. Não use uma localização histórica para propor nova expedição da mesma quantidade.

Compare separadamente quantidade solicitada, declarada no inventário, observada, validada atual, reservada e disponível. Agregue apenas unidades compatíveis e sem duplicar o mesmo material por várias linhas/documentos. Base incompleta permanece pendente; não conclua diferença física como se todas as posições já estivessem reconciliadas.

Se dois pedidos/linhas apontarem para a mesma quantidade física, registre o possível conflito de demanda. O cruzamento pode mostrar a localização nas duas linhas, mas não cria duas disponibilidades. Reserve somente pelo controle único da etapa 08.

Exemplo fictício: seleção de 10 unidades de uma origem, com 3 em um palete e 5 em outro, ambas validadas e na mesma unidade. Mostrar dois paletes, 8 unidades identificadas e 2 ainda não atendidas pelos registros. Não criar as 2 unidades restantes nem declarar um claim. Se parte das 8 estiver reservada, mostre a disponibilidade menor separadamente.

Movimentos confirmados atualizam a localização consultada. Mudanças relevantes depois da prévia invalidam sua revisão para reserva. Uma seleção de palete inteiro cujo conteúdo mudou desde o inventário exige revisão do material correspondente; não inclua automaticamente novas NFs/produtos adicionados ao palete.

## 5. Tela, mapa e relatórios

Mostre uma tabela com linha/referência do pedido, NF/devolução, produto quando aplicável, quantidade/unidade solicitada, paletes, endereços atuais, bases das quantidades, situação/motivos e próximo passo.

Ofereça filtros para localizados, sem palete, sem endereço, não encontrados, ambíguos, divergência de quantidade e restrições. Preserve seleção/contexto ao abrir detalhes. Resumos distinguem número de linhas solicitadas, documentos resolvidos e paletes físicos distintos; esses números não são somados como uma volumetria única.

Ao selecionar uma linha, mostrar todos os paletes correspondentes e permitir centralizar cada um no mapa. Uma seleção de várias linhas destaca as posições conhecidas, usando Fileiras 11–16/GR e os endereços reais confirmados, sem redesenhar a praça ou inventar posições para pendências. Reaproveite a lista como alternativa ao mapa. Clicar numa posição ocupada abre o palete e todas as NFs/informações importadas, com fonte e situação; buscar uma NF revela todas as suas alocações conhecidas.

Permita exportar:

- **Lista de separação por palete/endereço**, com NFs/produtos/quantidades selecionados, situação e identificação do pedido/versão.
- **Relatório de pendências**, com linha original, referência, motivo, fonte/base e ação necessária.
- **Conciliação completa**, preservando solicitado versus encontrado/validado/disponível.

Identifique horário, inventário de referência, versão da seleção, filtros e base da consulta. A lista de separação anterior à reserva é uma proposta; não represente material como expedido ou reservado por ter sido exportado. Reutilize a lista de preparação efetiva da etapa 08 depois da reserva.

Use CSV existente e XLSX quando já suportado. Aplique autorização nos downloads, limites, proteção contra interpretação de texto como fórmula e preservação dos códigos. Não invente ganhos financeiros ou percentual de atendimento quando a unidade/base não permitir calcular.

## 6. Encaminhar para a janela existente

Depois da revisão, permita **“Preparar para a janela”** com a seleção resolvida. Essa ação monta uma proposta para o fluxo de reserva existente; exige revisão explícita antes de confirmar.

A solicitação do cliente identifica o material pedido. Reutilize o registro de fonte/autorização aplicável, sem assumir que essa escolha também resolveu condição, liberação física, documentação ou todas as medidas da carga.

Na confirmação da reserva, revalide no servidor versão da seleção e da janela, vínculo/origem, liberação, saldo disponível, localização/pendências pertinentes e todas as capacidades configuradas. Use as transações, versões e idempotência da etapa 08. Importar/conciliar a lista não altera estoque, reserva capacidade, libera material ou confirma saída.

Se houver pendências, o usuário pode montar uma proposta explícita apenas com as linhas elegíveis, mantendo as demais visíveis como não atendidas. A confirmação da reserva dessa proposta continua integral ou é revertida: não omita uma linha que falhou silenciosamente nem declare o pedido inteiro atendido.

Preserve saldos residuais e NFs não escolhidas em paletes mistos. Se somente uma parte foi solicitada, a preparação física segue os movimentos/fracionamentos e medições existentes. Não expedir o conteúdo inteiro de um palete por localizar nele uma NF selecionada.

Relacione pedido/versão/linha às reservas e saídas para acompanhar solicitado, reservado ativo, expedido e pendente sem dupla contagem. Respeite a política vigente de saída parcial da etapa 08; não crie uma nova baixa ou um saldo paralelo para este módulo.

## 7. Tutorial, regras de acesso e documentação

Inclua no tutorial da etapa 10 a tarefa **“Localizar o que o cliente pediu”**: escolher inventário → importar/mapear seleção → revisar resultados → abrir palete no mapa/lista → consultar pendências → revisar proposta para a janela.

Use dados fictícios isolados e elementos reais da interface. O tutorial não confirma reserva/expedição automaticamente. Ensine a diferença entre “localizado”, “sem vínculo”, “validado” e “liberado para saída”, com exemplos curtos. Em lista vazia/falta de dados/permissão, ofereça orientação válida.

APIs, consultas, histórico, anexos e exportações aplicam escopo/permissão no servidor. Auditoria registra importação, mapeamento, resolução manual, revisões, correções e encaminhamento. Não grave dados operacionais/tokens em armazenamento acessível do navegador nem crie fila offline de mutações críticas.

Atualize `docs/DESCOBERTA.md` com perguntas ainda abertas: versão definitiva do inventário, colunas reais da seleção do cliente, tipo de NF, significado/escopo de N° Pallet, seleção total/parcial, unidades, convenções por cor/marcação, referência/versão do inventário e quem resolve pendências. Para os endereços, registre separadamente sequências da Fileira 11/GR, início/fim/sentido das faixas e a referência visual para os lados. Sem um dado necessário, avance no restante com configuração explícita e fixtures identificadas; não invente regras do cliente.

Documente o uso em README/manual do operador, decisões de identificação/duplicidade e situação real em `docs/ESTADO.md`. Registre a nomenclatura já confirmada e as correspondências de endereços ainda pendentes, sem apresentar a geometria de referência como praça fisicamente validada.

## 8. Verificação e entrega

Execute typecheck/lint/build e testes pertinentes à mudança. Use PostgreSQL real para persistência, vínculos, revisão/idempotência e integração com reservas. Reutilize os testes relevantes das etapas 06/08, sem repetir toda a aplicação sem necessidade. Verifique pelo menos:

1. Seleção por palete, NF distribuída em vários paletes e linha com quantidade parcial produzem as abrangências corretas.
2. NF sem vínculo, palete sem endereço e NF ausente ficam em situações distintas, sem criação de estoque/alocação presumida.
3. Números iguais de contextos documentais diferentes geram resolução correta ou ambiguidade; SKU isolado não resolve origem.
4. Importação de inventário externo registra fonte/quantidade/alocação informadas sem aumentar saldo validado.
5. Reenvio, duplicidade e versão substitutiva não duplicam pedido, reserva ou quantidade expedida. Mudanças com reservas existentes exigem revisão de impacto.
6. Arquivo completo com marcação seleciona apenas os valores configurados; mapeamento inválido bloqueia confirmação, mas pendência de alocação permite registrar a solicitação com pendências.
7. Código com zeros, unidade incompatível, quantidade desconhecida e identificador truncado pelo Excel recebem tratamento correto.
8. Exemplo 3 + 5 versus 10 apresenta 8 identificadas e 2 não atendidas; reservas reduzem disponível, sem alterar quantidade física nem declarar perda.
9. Transferência após o inventário mostra endereço atual e mantém a fotografia enviada; revisão antiga não confirma uma reserva desatualizada.
10. Palete com conteúdo alterado, referência histórica/saída anterior e material compartilhado entre solicitações exigem revisão adequada; não há saída de NFs adicionais.
11. Lista resolvida encaminha à reserva existente, respeitando saldo/liberação/capacidade e concorrência. Seleção com pendências não vira atendimento total.
12. Relatórios/mapa/tutorial correspondem às linhas e bases consultadas; permissões negam chamadas diretas de outro escopo.
13. Os sete blocos mantêm IDs/QR/histórico e recebem os nomes Fileiras 11–16/GR. O mapa preserva as 194 posições ativas desenhadas e as áreas desativadas; endereços desconhecidos não geram novas posições.
14. “15 - A120” e “13 - A120” resolvem posições distintas. Paridade funciona nas faixas duplas; Fileira 11/GR e o sentido visual usam a tabela confirmada, sem pressupor A101 como início universal.
15. Inventário conferido com várias NFs no mesmo palete mostra todas no detalhe e na busca. NF distribuída mantém todos os vínculos, sem duplicar paletes, documentos ou volumes repetidos.
16. Importação documental, aprovação de conferência externa e saldo por SKU ficam distintos. Um arquivo com apenas volumes/NF/endereço produz vínculos úteis sem inventar peças/SKUs nem exigir contagem repetida automaticamente.
17. Endereço livre por regra vigente de RUA, N° Pallet com significado de posição, endereço não mapeado e conflito de posição recebem as ações corretas. Situação DOCUMENTAÇÃO não libera estoque automaticamente.
18. Ausência de posições no arquivo não apaga saldo nem cria disponibilidade. Reenvio, importação de versão nova e movimento posterior não duplicam ou sobrescrevem estoque/reservas; falha na gravação reverte o conjunto confirmado.
19. Aba de resumo/oculta não entra automaticamente; um arquivo com muitas linhas apenas formatadas não cria registros vazios. Identificadores e marcadores como PALLET FULL conservam seu significado original.

Demonstre somente com dados fictícios: **inventário → seleção → resultados com uma NF localizada, uma distribuída em dois paletes e uma sem vínculo → relatório de pendências → proposta de separação → reserva pelo fluxo existente**.

Relate implementação e verificações realmente executadas. Não declare piloto físico, planilha real do cliente ou resultado financeiro validados sem execução. Entregue um resumo curto das funções disponíveis, exemplos de uso, limitações e próximos dados necessários para adaptar o mapeamento ao arquivo operacional.
