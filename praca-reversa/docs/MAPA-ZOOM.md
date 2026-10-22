# Mapa interno da praça

Requisito incluído em 1 de outubro de 2026: navegar por uma praça grande com zoom e arraste da visão, em uma interação semelhante à de aplicativos de mapas. A planta e o volume real de paletes ainda precisam ser levantados.

## Comportamento

- Ampliar e reduzir pelos botões, roda do mouse e pinça nos dispositivos de toque compatíveis.
- Arrastar o fundo ou começar o gesto sobre um palete para navegar pela visão. Um gesto de arraste não executa seleção nem movimento de estoque.
- **Vista inicial (20 out. 2026, D264–D266)**: ao abrir, o mapa enquadra a área principal (L'Oréal) — as zonas com posições em uso, incluindo as vazias; no desenho aprovado, a zona de baixo — no maior zoom em que ela cabe inteira no espaço livre entre os controles sobrepostos (medidos na hora; zoom calculado, sem nível fixo). O enquadramento é aplicado quando o layout e o tamanho do mapa existem e só uma vez: abrir/fechar a janela do palete ou recolher o menu mantém zoom e centro. "Focar L'Oréal" (e a tecla Home) volta a ele; "Ver praça completa" mostra também as posições superiores; centralizar enquadra o palete selecionado em nível legível, onde ele estiver (link, QR ou busca não forçam a volta à área principal).
- **Rótulos por largura da posição na tela**: menos de 30 px, nenhum; 30–60 px, endereço curto ("A120"; a rua está no título do bloco); 60–112 px, endereço completo ("15 - A120"; código só no palete selecionado); a partir de 112 px, também o código do palete, a situação e o estado das posições vazias.
- Clique, toque ou seleção pela lista abre o conteúdo do palete correto.
- Busca de ID/endereço centraliza o resultado. Busca de SKU mantém os candidatos em lista para escolha; presença documental não comprova presença física.
- Retornar do detalhe preserva seleção, zona e visão. Redimensionamento mantém contexto e posições.
- Limites de zoom e deslocamento permitem recuperar a praça; gestos cancelados não deixam a tela presa.

## Tecnologia e coordenadas

Usar Leaflet com CRS.Simple integrado ao React. Fixar versões compatíveis na etapa 01 e preservar o ciclo de vida do mapa ao atualizar dados. A versão da biblioteca e a forma de integração devem ser registradas em `DECISOES.md`.

O desenho usa coordenadas próprias do layout, sem presumir latitude, longitude, GPS ou medidas físicas. Definir largura, altura, origem, unidade de desenho e versão do layout. A unidade só representa metros depois de existir uma escala validada.

Contrato proposto: origem do desenho no canto superior esquerdo, x aumentando para a direita e y aumentando para baixo. Cada posição possui x, y, largura e altura, vinculados ao ID permanente da posição. Separar geometria e ocupação; a posição do palete vem do seu endereço registrado. Coordenadas da câmera pertencem à interface, sem alterar endereços.

Em CRS.Simple, isolar a adaptação para a ordem `[y, x]` e para o sentido vertical da biblioteca. Para um desenho de altura H, um ponto (x, y) pode ser adaptado para `[H - y, x]`; verificar cantos, retângulos e imagem de base na implementação. Não espalhar conversões pelos componentes.

Base possível: desenho vetorial configurável ou planta/imagem autorizada com limites definidos. A planta continua pendente até a operação fornecer os dados. Manter ruas, corredores, docas e posições indisponíveis coerentes com a praça. Alterações do layout exigem permissão e preservam endereços/histórico.

## Detalhe e desempenho

Na visão geral, reduzir rótulos e agrupar quando necessário. Em zoom de consulta, mostrar IDs legíveis e áreas de seleção adequadas para mouse e toque. Cor sempre acompanha estado textual na lista e no detalhe. A lista permite acessar paletes que não tenham alvo confortável em zoom distante.

Consultar layout e ocupação resumida; carregar conteúdo detalhado ao selecionar. Renderizar apenas a área visível e uma margem ou usar agrupamento conforme o volume medido. Mapas por zona são um recurso adicional, sem eliminar a visão geral. Evitar carregar todas as linhas de todos os produtos só para abrir o mapa.

Não presumir uma meta de capacidade a partir da demonstração. Medir com quantidade representativa de posições/paletes, equipamentos, rede e usuários; registrar tempos de abertura, seleção e busca e fluidez de navegação. Acordar os limites aceitáveis antes de ampliar o piloto.

## Entregas

Etapa 01: navegação e lista com layout e dados fictícios. Etapa 03: geometria real/configurável e ocupação persistida. Etapa 06: busca operacional por produto, lote e origem. Etapa 09: gestos e instalação validados nos dispositivos efetivos. Etapa 10: desempenho medido na volumetria do piloto.

Executar os cenários T33 a T37 de `VALIDACAO.md` conforme a etapa. A demonstração na conversa não constitui implementação do aplicativo, inventário real ou teste de desempenho operacional.
