# Telas e fluxos

## Mapa da praça

A tela principal permite visão geral da praça e foco em uma zona, com ruas e posições identificadas, corredores e paletes em suas posições reais. O mapa tem zoom pelos botões e roda do mouse, arraste da visão, pinça no celular, visão geral e centralização do palete. Selecionar um palete abre o painel de conteúdo. Manter alternativa em lista para consulta por teclado, celular e praças grandes, com seleção que centraliza o palete. Paletes cadastrados sem endereço aparecem em uma lista de localização pendente. Detalhes de navegação, coordenadas e desempenho estão em `MAPA-ZOOM.md`.

Resumo do palete: ID, endereço, conferência, liberação, situação no fluxo e pendências. Cores representam categorias estáveis e vêm acompanhadas de texto. O painel detalhado mostra confiança/origem dos dados e última atualização.

A busca permite localizar e centralizar um palete diretamente ou mostrar candidatos a um produto. Vários resultados precisam permanecer disponíveis em lista; o usuário escolhe qual centralizar. Ao pesquisar produto, distinguir quantidade declarada de quantidade física validada e indicar origem pendente. O mapa não afirma que um item foi encontrado fisicamente porque ele aparece numa nota importada.

O layout é configurado por usuário autorizado. Alterar desenho de uma posição ocupada exige preservação do endereço e do histórico. Arrastar a visão altera somente a câmera do mapa. Arrastar paletes não faz parte do primeiro piloto; movimentações usam uma ação explícita com destino e confirmação.

## Cadastro e detalhe do palete

Campos: ID existente/interno, posição, data de cadastro, referências, condição de conferência e observações. Conteúdo é uma tabela de produto, código, lote, origem, unidade, quantidade observada/validada, condição e reserva. Múltiplas devoluções no mesmo palete precisam aparecer por linha.

Ações conforme permissão: iniciar conferência, consultar histórico, transferir itens, mover palete e imprimir etiqueta. Paletes desconhecidos apresentam o conteúdo como pendente; não renderizar uma tabela de quantidade zero como se estivesse conferida.

## Conferência

Escolher o palete e iniciar sessão completa ou parcial. Ler código com scanner que digita como teclado, digitar manualmente ou, na etapa correspondente, usar a câmera de dispositivo compatível. Confirmar produto e unidade antes de somar quantidade.

Guardar rascunho, associar lote/origem quando disponível, condição e evidências. Leitura repetida pode representar nova unidade ou repetição acidental: o comportamento precisa ser explícito. Contagem por unidade soma uma peça por leitura; contagem de caixa usa o fator cadastrado e mostra a unidade/fator. Não inferir isso pelo código sozinho.

Ao concluir, apresentar observações e divergências. Sessão completa pede confirmação do escopo físico conferido. Recontagem e reconciliação exigem permissão e justificativa. Se a versão do palete mudou, interromper a conclusão e apresentar os dados atuais.

## Movimentação

Escolher origem, item/segmento, quantidade e destino. Mostrar unidade, condição e origem documental. O servidor valida saldo disponível e destino; a tela só apresenta sucesso após confirmação do servidor. Mudança de localização do palete usa operação própria, sem transformar cada produto em uma nova entrada.

## Claims

Lista com motivo, referência, produto, quantidade em análise, prazo, responsável, situação e valor estimado. Filtros por prazo e situação; opção de ordenar por valor. Dados faltantes permanecem sinalizados.

O detalhe apresenta histórico e paletes candidatos, com a pista que motivou cada sugestão. Registrar localização, recontagem e evidência. Validar vínculo e resultado por ação específica. A tela separa candidato localizado, recuperação validada e regularização confirmada.

## Janelas

Calendário/lista das janelas cadastradas, capacidade e unidade. Cada janela mostra volume liberado, reservado e expedido. Material aguardando documentação tem fila própria, responsável e próximo passo.

Selecionar material elegível, verificar capacidade, reservar e emitir a lista de preparação. Confirmar a saída física com as quantidades reais e documentação. Cancelar reserva libera capacidade antes da expedição. Material retornado segue novo recebimento.

## Importação

Enviar CSV/XLSX, escolher o tipo e mapear colunas. A prévia apresenta linhas válidas, duplicadas e inválidas com seus motivos. Confirmar apenas depois da revisão; guardar o relatório do lote. Um arquivo de notas aparece como declaração documental e não como inventário conferido.

## Seleção do cliente (complemento)

Entrada própria no menu, com *Importar seleção*, *Inventários de referência* e *Importar inventário conferido* (conforme permissão) e o histórico das listas (versões substitutivas visíveis). A importação reutiliza a da etapa 06 com um painel de parâmetros do tipo: no inventário, versão definitiva, referência/data/fonte da conferência, significado do N° Pallet, cor de fonte da RUA para endereço livre (cores encontradas com contagem) e definição dos tipos documentais; na seleção, modalidade (lista ou marcação e valores), pedido/versão, inventário de referência, significado da coluna NF, NF sem quantidade, duplicidade e versão substituída. A prévia mostra a ação de cada linha e o resumo; a confirmação do inventário mostra o conjunto aplicável e permite deixar linhas de fora.

A conciliação mostra cabeçalho (pedido, versão, inventário, contexto da NF, base e horário da consulta, diferenças da versão), resumo (linhas, documentos resolvidos e paletes distintos, sem soma), filtros por situação e busca, e a tabela (linha, NF/devolução/palete, produto, quantidade, paletes e endereços atuais, bases, situação com marcador textual, próximo passo); no celular a tabela vira cartões. O detalhe da linha lista todos os paletes (informado × atual, documentos, material por base, restrições, elegibilidade, *Ver no mapa*, *Abrir palete*), saídas anteriores, conflitos de demanda e a resolução explícita de ambiguidades. O mapa embutido destaca as posições conhecidas das linhas marcadas; pendências sem posição ficam só na lista. Exportações CSV e *Preparar para a janela* (proposta sem gravar → revisão → reserva pela etapa 08) ficam na mesma tela. O detalhe do palete mostra os documentos informados no inventário; a busca tem a base "vínculo informado no inventário".

## Indicadores e relatórios

Período e unidade são visíveis. Mostrar estoque conhecido e quantidade de paletes ainda desconhecidos; claims por situação; valor em análise e evitado confirmado separados; entradas/saídas; preparação e ocupação das janelas. Exportação respeita o mesmo filtro e permissão da tela.

O número de paletes no mapa serve para ocupação da praça. A redução física de estoque é medida pelas quantidades expedidas/entradas, não apenas por juntar dois paletes.

## Etiquetas e QR

Etiqueta interna com ID legível e QR contendo a rota/identificação do palete, sem produto, senha ou documento sensível no código. Exigir autenticação ao abrir. Escolher dimensões e impressora conforme a operação; gerar versão para impressão legível no piloto. Não substituir identificação oficial existente.

## Uso como aplicativo

Interface responsiva, manifest e modo de abertura próprio. Testar instalação nos dispositivos reais. Quando não houver instalação disponível, o uso pelo navegador mantém o núcleo funcional. Estados de falta de conexão e atualização pendente precisam ser claros.

No celular, o painel do palete aparece abaixo ou como tela de detalhe, com retorno preservando a seleção. Controles de conferência são grandes o suficiente para toque e funcionam sem hover. Nenhuma ação de estoque depende somente de arrastar um elemento.

## Acessibilidade e estados

Navegação por teclado, rótulos nos campos, foco visível e restauração de foco ao fechar detalhes. Não depender apenas de cor. Paginação e busca mantêm contexto. Mostrar carregamento, resultado vazio, erro de servidor, erro por campo, sem conexão, conflito e operação em andamento. Evitar cliques repetidos na interface; a proteção real de duplicidade fica na API.
