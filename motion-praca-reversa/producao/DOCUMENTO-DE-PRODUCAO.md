# Praça Reversa — documento de produção do motion

Base: `PROMPT-CLAUDE-MOTION-PRACA.txt` e `ROTEIRO-MOTION-PRACA-150S.txt` (pacote `MOTION-DHL-REFERENCIAS-E-PROMPTS.zip`, 19/10/2026).

- **Entrega 1** (19–20/10/2026): análise das referências, matriz de evidências, três quadros-chave e amostra de 15 s. Aprovada: "Aprovei a linguagem da amostra; pode seguir com o filme completo."
- **Entrega 2** (20/10/2026): filme completo de 150 s, trilha e efeitos próprios, texto de narração e legendas.

## Entrega 2 — arquivos

| Arquivo | O que é |
| --- | --- |
| `out/praca-reversa-apresentacao.mp4` | Filme completo: 1920×1080, 30 fps, 150 s (4500 quadros), H.264 yuv420p, AAC 48 kHz estéreo; sem locução |
| `out/praca-reversa-apresentacao.srt` | Legendas do texto de narração (32 blocos, até 2 linhas de 42 caracteres, até 17 caracteres por segundo) |
| `out/narracao.txt` | Texto de narração por cena, para gravar a voz depois |
| `out/filme-audio-final.wav` | Trilha e efeitos mixados (−16 LUFS integrado, pico real −1,5 dBTP) |
| `out/quadros-chave/` | Quadros do filme final, um por cena |
| `out/previa-acabamento.mp4`, `out/quadro-A/B/C*.png` | Entrega 1 (mantidos) |
| `filme/`, `motor.js`, `render.mjs`, `audio-filme.mjs`, `legendas.mjs` | Projeto editável (cena, motor de animação, renderizador, trilha, legendas) |
| `capturas/`, `ativos/` | Telas reais, números medidos (`dados.json`, `camadas.json`, `filme.json`), CSV exportado e ativos gráficos |

## Como foi feito

- **Sem Remotion** (licença paga para empresas com mais de 3 pessoas): cada quadro é uma página HTML/CSS calculada a partir do número do quadro (`motor.js` + `filme/cena.js`, sem relógio nem animação CSS), fotografada pelo Playwright (Chromium) e montada pelo FFmpeg. O projeto Remotion antigo em `motion-praca-reversa/` não é usado.
- **Telas reais**: tudo o que aparece do aplicativo é captura do `praca-reversa` atual, num ambiente isolado (mesma aplicação, banco dos testes de interface, dados fictícios, porta 4330). O banco de desenvolvimento e o escopo real L'Oréal não foram tocados. Realces, etiquetas, fichas, trilhas de luz e frases são camadas sobrepostas; nenhum número foi alterado ou inventado.
- **Personagem**: a **NF-e 900123** (5 volumes, Distribuidora Demonstração Ltda) do palete **PAL-DEMO-001 (11 - A1)**, acompanhada da bipagem ao mapa, à janela do palete, à busca, à janela de saída (separação de 5, expedição de 3), ao painel e à exportação (2 volumes restantes no palete).
- **Demonstração identificada**: selo "Demonstração · dados fictícios" em todo o filme; as telas trazem também o selo do próprio aplicativo.
- **Câmera**: cada plano tem uma câmera por ponto de foco (aproxima, lê, recupera o contexto), perspectiva 3D, desfoque de profundidade e de movimento só em deslocamentos rápidos; luz de fundo em outra velocidade.
- **Áudio**: trilha própria a 96 BPM (pad, pulso grave, chimbal, arpejo) com intensidade por cena e harmonia Am9 – Fmaj9 – Cadd9 – G6; 125 efeitos sincronizados aos eventos da cena (palavras, realces, cliques, voo e encaixe das fichas, chegada de telas, trocas de estado, confirmações, título). Tudo sintetizado em `audio-filme.mjs`, sem amostras de terceiros.
- **Sem locução**: nenhuma voz autorizada disponível e sem clonagem de voz. O texto de narração (`out/narracao.txt`) segue o roteiro, com as falas ajustadas ao que o filme comprova (ver "Ajustes da narração").

## Estrutura do filme

| Cena | Tempo | Telas reais | Texto na tela | Continuidade |
| --- | --- | --- | --- | --- |
| 1 O problema | 0:00–0:12 | Fragmentos: prévia da bipagem, mapa, busca, linhas de documento | "O material está aqui." / "A informação precisa acompanhar."; rótulos: muitos paletes, conteúdo pouco visível, busca manual, risco de divergências e claims | A câmera escolhe a linha da NF-e 900123 |
| 2 O sistema | 0:12–0:22 | Linha da NF-e 900123 | DHL, "Praça Reversa", "Informação conectada à operação."; PAL-DEMO-001 · 11 - A1 · 5 volumes | Corredores da praça em luz; a câmera atravessa o título |
| 3 Bipagem | 0:22–0:40 | Importar bipagem (01 → 02 prévia → 03 resultado) | "Da bipagem ao palete.", "Revisar antes de gravar.", "Sem redigitar."; 5 campos lidos; "Lidos 5 = 5 volumes"; Delivery/SKU/validade opcionais | A linha entra no campo do arquivo; o cartão da prévia se descola e volta |
| 4 Mapa | 0:40–0:59 | Mapa na área da L'Oréal (escuro), janela do palete | "Localizar.", "Abrir.", "Entender.", "O mapa abre na área da L'Oréal." | **Transição 1**: ficha PAL-DEMO-001 voa do resultado ao palete 11 - A1. **Transição 2**: a janela nasce do tamanho e do lugar do palete |
| 5 Divergências | 0:59–1:15 | Busca "900123", janela pela busca, Prioridades, Mover palete, Histórico, etiqueta com QR | "Uma busca.", "O endereço.", "A ação.", "Histórico com origem e destino.", "O QR da etiqueta abre o palete." | Zoom no campo de busca; o QR liga a etiqueta à janela do palete |
| 6 Janela de saída | 1:15–1:37 | Volumes da janela (meta, separação, expedição), bloco "Janela selecionada" do painel | "O cliente escolhe.", "A operação prepara.", "Solicitado, separado e expedido: estados distintos." | **Transição 3**: ficha "5 volumes" vai ao "Separado"; ficha "3 volumes" vai ao "Expedido" |
| 7 Reconferência | 1:37–1:52 | Mapa (palete laranja), janela "Precisa conferir", reconferência antes/depois | "Conferir com prioridade.", "Conferido, com registro."; "Regra: 20 dias sem movimentação"; "Precisa conferir: 1 → 0" | A janela nasce do palete 11 - A3 |
| 8 Painel e cliente | 1:52–2:08 | Painel da operação (montado a partir de cartões, janela e prioridades), painel do cliente | "Operação e gestão, com a mesma base.", "Estoque, janela e prioridades em uma tela.", "O cliente consulta o que é permitido." | Montagem dos blocos no painel |
| 9 Registros | 2:08–2:20 | Histórico recente (cliente), Estoque e histórico, CSV exportado | "Registrar.", "Consultar.", "Exportar."; "Exportação manual · arquivo CSV" | A tabela do CSV nasce do botão "Exportar estoque (CSV)" |
| 10 Piloto | 2:20–2:30 | Mapa ao fundo | "Mais visibilidade. Menos procura.", "Validar na operação."; medidas propostas: tempo de localização, acuracidade do inventário, atendimento das janelas | Quadro final DHL + "Praça Reversa" por 3 s |

## Matriz de evidências (estado no aplicativo atual)

Estados: **demonstrável** (ação real com resultado verificável, gravada no filme), **parcial** (parte real, limite dito), **pendente**.

| # | Problema | Solução | Tela / ação real no filme | Dado usado | Resultado observado | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Conteúdo pouco visível | Mapa com endereço real e janela do palete | Cena 4: clique no palete 11 - A1 → janela (Tipo, Número, Remetente, CNPJ, Volumes) | PAL-DEMO-001 | 6 documentos, 16 volumes lidos na bipagem, Misto | Demonstrável |
| 2 | Conferir tudo um por um | Buscar antes de abrir | Cena 5: busca "900123" → 1 resultado com palete e posição → "Ver no mapa" abre a janela | NF 900123 | 5 volumes contados, PAL-DEMO-001, F01-P01 | Demonstrável; o filtro "Precisam de reconferência" não aparece no filme |
| 3 | Triagem incorreta / palete diferente | Mover com histórico de origem e destino | Cena 5: Prioridades → Mover palete → Histórico | PAL-DEMO-005 | "Mudança de localização · F02-P02 → F01-P05"; sem endereço 3 → 2 | Demonstrável; registro manual (não é sensor) |
| 4 | Redigitação | Importação da bipagem para o palete | Cena 3: Importar bipagem → prévia → importar | Planilha fictícia de 8 linhas | 6 conteúdos novos, 6 contagens, 16 volumes | Demonstrável |
| 5 | Repetições, zeros, documentos distribuídos | Prévia separa registros, leituras e volumes | Cena 3: contadores da prévia | Mesma planilha | 8 registros · 6 com leitura · 2 sem leitura · 16 volumes | Demonstrável; NF em vários paletes não aparece no filme (narração ajustada) |
| 6 | NF sem palete / palete sem endereço | Listas rastreáveis | Cena 5 (Prioridades: "3 palete(s) sem endereço") e cena 8 (cartão "Sem endereço 2") | Demonstração | 3 antes da correção, 2 depois | Demonstrável |
| 7 | Quantidade exata da janela | Meta em volumes; separado × expedido | Cena 6: meta 20 → separação de 5 da NF 900123 → expedição de 3 → painel | JAN-000001 (fictícia) | Solicitado 20 · Separado 2 · Expedido 3 · Falta separar 15 · Falta expedir 17 · 25% / 15% | Demonstrável; a meta foi registrada na tela ("Pedido de demonstração"): a importação do arquivo de seleção do cliente não aparece |
| 8 | Inventário que envelhece | Reconferência após 20 dias sem movimentação | Cena 7: mapa (laranja) → "Precisa conferir" → reconferência completa | PAL-DEMO-003 com entrada há 25 dias, preparada no banco de teste (regra inalterada) | "novo prazo de 20 dias"; prevista 14/10 → 08/11; Precisa conferir 1 → 0 | Demonstrável (data preparada no ambiente de teste) |
| 9 | Mapa apertado | Vista inicial na L'Oréal, "Focar L'Oréal"/"Ver praça completa", janela sobre o mapa | Cena 4 | Demonstração | Área da L'Oréal ocupando o mapa | Demonstrável |
| 10 | Identificar na operação | QR da etiqueta abre o palete | Cena 5: etiqueta interna com QR do PAL-DEMO-001 ligada à janela do palete | Demonstração | — | Parcial: a leitura pela câmera não foi filmada; no ambiente isolado o QR aponta para endereço local (etiquetas definitivas dependem de `APP_URL_PUBLICA`) |
| 11 | Pouca visibilidade | Painel em uma tela; consulta do cliente sem dados internos | Cena 8: painel da operação e painel do cliente | Demonstração | 6 paletes, 13 volumes, sem endereço 2, precisa conferir 0; cliente: Solicitado 20, Expedido 3 | Demonstrável (perfil `CLIENTE_CONSULTA`, D237) |
| 12 | Medo de perder registros | Histórico e exportação CSV | Cena 9: histórico recente, Estoque e histórico, "Exportar estoque (CSV)" | Arquivo real `estoque-2026-10-200203.csv` (11 linhas) | NF 900123 com 2 volumes no palete após a expedição de 3 | Demonstrável; exportação manual; sem espelho em tempo real nem backup prometidos |
| 13 | Risco de claims | Consequência do conjunto | — | — | Sem base de medição | Objetivo do piloto (não quantificado) |

## Ajustes da narração (em relação ao roteiro)

- Cena 4: "inclusive paletes mistos ou uma nota distribuída em mais de um palete" → "como neste palete misto" (o filme não mostra NF em vários paletes).
- Cena 5: "as correções podem ser acompanhadas pelo histórico" → "a correção fica no histórico, com origem e destino"; "O QR facilita a consulta quando disponível" → "O QR da etiqueta abre a consulta do palete".
- Cena 6: "o cliente define os volumes e os documentos" → "o pedido do cliente define a meta em volumes"; "seja um FULL ou parte de um palete misto" → "aqui, uma nota de um palete misto".
- Cena 8: "dashboard" → "painel"; cena 9: "A exportação, quando disponível" → "A exportação manual em CSV".

## Limites

- Sem locução (só texto e legendas); a duração das cenas foi pensada para a leitura das legendas (até 17 caracteres por segundo).
- Não aparecem no filme: NF distribuída em vários paletes, importação da seleção do cliente, filtro de reconferência, leitura do QR pela câmera.
- A reconferência usa um palete com data de entrada preparada no banco de teste (25 dias), sem alterar a regra.
- Algumas telas foram capturadas em momentos diferentes do mesmo percurso; os números mostrados em cada uma são os daquele momento (ex.: a busca mostra 5 volumes antes da expedição; a exportação, 2 depois).
- Benefícios ("mais visibilidade, menos procura") aparecem como proposta, e as medidas como objetivos do piloto, sem números.

## Fontes dos ativos

- Telas: capturas do aplicativo `praca-reversa` (ambiente isolado, dados fictícios), em `capturas/`; o CSV é o arquivo exportado pela tela do cliente.
- Símbolo DHL: arquivo `DHL-Symbol.png` fornecido pelo usuário, só recortado (sem redesenho). Ícone do aplicativo: do próprio `praca-reversa`.
- Fonte Inter (Rasmus Andersson, SIL Open Font License 1.1), arquivos woff2 do pacote `@fontsource-variable/inter`.
- Trilha e efeitos: sintetizados em `audio-filme.mjs`.
- Ferramentas gratuitas: Node.js, Playwright/Chromium, FFmpeg. Nenhum trecho, música, logotipo ou marca d'água das referências foi usado.

## Análise das referências (Entrega 1; quadros a 1 e 5 por segundo; áudio não analisado)

| Referência | Trechos observados | O que foi aproveitado |
| --- | --- | --- |
| Luminovo (7118) | ~12–25 s: planilhas empilhadas viram produto; ~27–33 s: uma única tabela cresce, inclina e é percorrida linha a linha; luz de fundo em faixas | Cartão da prévia que se descola e inclina; câmera até **uma linha** (NF-e 900123); luz quente de fundo |
| Synaps (6193) | ~18–24 s: palavras com seleção e cursores; a câmera sai do detalhe, mostra a tela inteira e inclina com profundidade de foco | Câmera por ponto de foco; contexto → detalhe → contexto no mapa; desfoque do mapa atrás da janela |
| Filme verde (6156) | ~22–28 s: componentes entram separados e se encaixam numa composição | Montagem do painel (cartões, janela, prioridades); fichas que encaixam nos indicadores |
| Flowz (7131) | ~16–22 s: um objeto vira a ponte para a ideia seguinte | A linha da NF e as fichas ligam bipagem, mapa, janela de saída e exportação |

Paleta DHL: amarelo #FFCC00, vermelho #D40511, grafite #101114.

## Renderizar de novo

Na pasta `motion-praca-reversa` (≈ 55 min para os 4500 quadros nesta máquina):

```
node producao/render.mjs filme --eventos
node producao/audio-filme.mjs producao/out/filme-audio.wav
ffmpeg -y -i producao/out/filme-audio.wav -af "volume=5.2dB,alimiter=limit=0.74:attack=2:release=60:level=disabled:asc=1" -ar 48000 -c:a pcm_s16le producao/out/filme-audio-final.wav
node producao/render.mjs filme --video producao/out/praca-reversa-apresentacao.mp4 --audio producao/out/filme-audio-final.wav
node producao/legendas.mjs
```

Quadros soltos para conferir: `node producao/render.mjs filme --quadros 300,1250,2740,4499` (saem em `producao/out/quadros/filme/`).

Amostra da Entrega 1: `node producao/audio.mjs amostra producao/out/amostra-audio.wav` e `node producao/render.mjs amostra --video producao/out/previa-acabamento.mp4 --audio producao/out/amostra-audio.wav`.

Recapturar as telas (ambiente isolado; apaga e recria o banco dos testes de interface — não rodar junto com o E2E): em `praca-reversa`, `node scripts/preparar-e2e.mjs`, subir `node .dados/servidor-motion.tmp.mjs` (porta 4330), `npx tsx .dados/usuarios-motion.tmp.mts`, depois `node .dados/capturar-motion.tmp.mjs`, `capturar-motion-camadas.tmp.mjs`, `capturar-motion-filme.tmp.mjs`, `capturar-motion-reconf.tmp.mjs` e `capturar-motion-painel.tmp.mjs`.
