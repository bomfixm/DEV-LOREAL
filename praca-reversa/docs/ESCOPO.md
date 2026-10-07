# Escopo do aplicativo

## Contexto confirmado

A operação informada trata logística reversa de L’Oréal na DHL. Há muitos paletes e informação insuficiente sobre seu conteúdo. Há produtos em análise de extravio ou avaria que podem gerar claims. A triagem incorreta é uma possibilidade a investigar. O cliente permite expedições em quatro janelas mensais, com volume escolhido por ele em cada janela.

O usuário quer reduzir pendências de claims, localizar material e reduzir o estoque acumulado. Quantidade de paletes, sistema atual, documentos disponíveis, unidade de volumetria, regras fiscais, prazos de claim e critérios de liberação ainda não foram informados.

## Objetivos

- Saber onde está cada palete e o que foi fisicamente conferido nele.
- Encontrar candidatos à recuperação de produtos e registrar a validação da origem correta.
- Preparar material elegível para as janelas e acompanhar a saída real.
- Manter rastreabilidade e evitar novo acúmulo sem informação.
- Demonstrar resultado com evidências, separando produto localizado de claim regularizado.

## Funcionalidades

| ID | Funcionalidade | Etapa principal |
| --- | --- | --- |
| RF01 | Entrar com usuário individual; perfis e acesso por unidade/cliente. | 02 |
| RF02 | Cadastrar zonas, ruas, posições, corredores e posições indisponíveis. | 03 |
| RF03 | Mapa com zoom, arraste da visão, pinça, visão geral, centralização do palete, identificação, estados e alternativa em lista. | 01 e 03 |
| RF04 | Cadastrar palete com ID permanente, localização, data e documentos vinculados. | 03 |
| RF05 | Consultar produtos, lotes, quantidades, condições, devoluções e histórico do palete. | 03 e 04 |
| RF06 | Buscar por ID, SKU, código de barras, lote, NF/devolução e pendência. | 06 |
| RF07 | Conferência parcial ou completa, rascunho, responsável, data e registro de divergências. | 04 |
| RF08 | Recontagem e reconciliação autorizada com justificativa. | 04 |
| RF09 | Mover paletes e transferir quantidades entre paletes, preservando origem e condição. | 05 |
| RF10 | Gerar etiqueta com ID interno e QR para abrir o cadastro. Leitor de teclado e entrada manual. | 03 e 04 |
| RF11 | Importar produtos, devoluções e lista de claims de CSV/XLSX, com prévia, validação e duplicidades. | 06 e 07 |
| RF12 | Gerenciar casos de claim por extravio, avaria ou divergência documental, com prazo e responsável. | 07 |
| RF13 | Sugerir paletes candidatos por produto, origem, lote, documentos e histórico. | 07 |
| RF14 | Registrar localização, evidências, vínculo confirmado e resultado aprovado da tratativa. | 07 |
| RF15 | Cadastrar janelas com capacidade, unidade, datas e critérios do cliente. | 08 |
| RF16 | Preparar fila elegível, reservar capacidade e material e acompanhar pendências. | 08 |
| RF17 | Confirmar expedição, documentos e baixa atômica; cancelar reservas antes da saída. | 08 |
| RF18 | Indicadores e relatórios exportáveis de conferência, claims, pendências, estoque e janelas. | 07, 08 e 10 |
| RF19 | Histórico de ações, fotos/documentos de evidência, autoria e justificativas. | 02, 04 e 07 |
| RF20 | Instalação PWA, atualização controlada, tratamento de conexão e restauração de backups. | 09 |

Todos os IDs são escopo planejado. `ESTADO.md` registra o que existe de fato. Fotos podem entrar no piloto com upload restrito, tamanho/tipo limitados e acesso autenticado. Leitura por câmera depende dos dispositivos e entra na etapa 09; a entrada manual e o leitor que funciona como teclado devem estar disponíveis antes.

## Indicadores

- Paletes cadastrados, não conferidos, parcialmente conferidos, reconciliados e expedidos.
- Unidades localizadas e unidades cuja origem foi validada.
- Claims por motivo, prazo e situação; valor estimado em análise e valor evitado confirmado separados.
- Volume elegível, reservado e expedido por janela, na unidade definida pelo cliente.
- Estoque inicial, entradas e saídas reais do período; idade do material pela referência operacional validada.
- Tempo de conferência e unidades/paletes conferidos por hora de trabalho, quando houver registro de esforço.
- Motivos de divergência documentados, sem atribuir causa a pessoas apenas por coincidência.

Consolidação de paletes pode reduzir posições ocupadas sem reduzir unidades em estoque. O painel deve mostrar essas medidas separadamente. As métricas sempre expõem período, unidade e base de cálculo.

## Primeira versão e evoluções

O núcleo do piloto inclui mapa, cadastro, conferência, movimentos, busca, importação básica, casos de claims, janelas, autenticação e histórico. A conferência da praça pode alimentar gradualmente o cadastro; não é necessário esperar conhecer todos os paletes para cadastrar sua existência.

Ficam como evoluções: escrita em sistemas corporativos, leitura automática de documentos por IA, RFID, inventário por imagem, notificações externas, aplicativo nativo, trabalho completo de estoque sem conexão e otimização automática de carga. Nenhuma dessas funções é requisito para testar o núcleo.

O aplicativo apoia o processo. Ele não determina sozinho responsabilidade financeira, descarte, substituição de produtos ou regras fiscais de devolução.
