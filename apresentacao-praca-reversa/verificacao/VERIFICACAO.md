# Verificação — 21/10/2026

Feita nesta máquina (Windows 11, Chromium do Playwright, sem janela) sobre o arquivo entregue `entrega/Praca-Reversa-Apresentacao.html`, aberto por `file://` com a **internet desligada**. Log completo: `verificacao-completa.log`; quadros: `evidencias/`.

## Resultado: 43 de 43 aprovadas

- Arquivo sem credenciais, conexões ou URLs externas; fonte Inter embutida; sem erros no console nem requisições externas.
- Nada avança sozinho (4 s parado na cena 01).
- Uma tecla = uma cena: `→` `PageDown` `espaço` `↓` `Enter` avançam; `←` `PageUp` `↑` `Backspace` voltam; `Home`/`End`; não passa do fim.
- Botões: clique único avança uma vez; espaço logo depois não repete o clique.
- Avanço rápido (11 teclas seguidas) termina na 12, uma cena ativa e nenhum resto de transição; volta de 12 a 01, uma a uma, com o título visível em cada cena; salto pelo índice para a 09 mostra a cena completa; `Esc` fecha o índice.
- Pontes 02→03 e 05→06 (e 06→05 na volta) acontecem e terminam limpas (quadros do meio em `evidencias/ponte-*.png`).
- Notas do apresentador em janela própria: mostram a fala da cena atual, avançam/voltam a apresentação e acompanham quando se avança na apresentação; **nenhuma fala aparece na tela projetada**.
- `M` reduz movimentos (luz parada) mantendo a cena; navegação continua; preferência "reduzir movimento" do sistema respeitada; `B` tela preta; `F` tela cheia (entrou e saiu com `Esc`); recarregar com `#7` volta à cena 07.
- **Parado 60 s** nas cenas 05 (mapa, camadas), 06 (densa) e 08: 209, 210 e 32 textos sem mudar de lugar nem de valor; luz ambiente em movimento.
- **1366×768**: nenhum texto fora do palco e sem rolagem nas 12 cenas (`evidencias/1366x768-*.png`).

## Também conferido

- Testes de interface do aplicativo (banco isolado de testes, 21/10/2026): mapa inicial, busca, janela do palete, bipagem, conferência em tabela, reconferência de 20 dias, movimentações, painéis e seleção de teste — **21 aprovados**, 2 de celular pulados (projeto "computador").
- Leitura somente de consulta do banco de desenvolvimento: palete 256 em 11 - A42 e 257 em 11 - A43; layout ativo com 194 posições na área da L’Oréal.
- PDFs: estático com 12 páginas 16:9; guia em 1 página A4; roteiro em 7 páginas.

## Não medido

- Taxa de quadros (fps): só inspeção visual e quadros capturados; nenhuma medição de 60 fps.
- Passador físico, projetor e segundo monitor reais: testados por teclas equivalentes (`PageDown`/`PageUp`) e janela pop-up; conferir na sala.
- Chrome instalado nesta máquina (155, sem janela, offline): 11 × PageDown até a cena 12, notas abertas na cena 12, 0 erros. Edge e o computador da sala não foram testados.
