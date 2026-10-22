# Praça Reversa — apresentação com motion (avanço manual)

Apresentação de 12 cenas para os gerentes da operação DHL/L’Oréal. Funciona como slides: cada tecla avança uma cena, nada avança sozinho e cada cena fica legível pelo tempo que for preciso. Substitui o filme de 150 s de 20/10/2026.

## Para a reunião: pasta `entrega/`

| Arquivo | Para quê |
| --- | --- |
| `Praca-Reversa-Apresentacao.html` | **A apresentação.** Arquivo único (fontes, imagens e dados embutidos). Abre com dois cliques no Chrome ou Edge, sem internet, sem login e sem o servidor do aplicativo. |
| `Guia-rapido.html` / `.pdf` | Uma página: abrir, projetar com notas, teclas, encerrar. |
| `Roteiro-do-apresentador.html` / `.pdf` | Fala de cada cena, sincronizada com a apresentação (para celular, impressão ou tela espelhada). |
| `Fontes-e-estado.html` | Origem de cada número, data do recorte e estado verificado de cada função. |
| `Praca-Reversa-Apresentacao-estatica.pdf` | Backup sem animação (12 páginas 16:9). |
| `Praca-Reversa-Apresentacao-complemento.mp4` | Complemento para compartilhar (1920×1080, 30 fps, sem áudio). Não substitui a versão navegável. |

Teclas: `→` `espaço` `PageDown` próxima · `←` `PageUp` anterior · `Home`/`End` · `I` índice · `N` notas do apresentador (outra janela) · `F` tela cheia (sair: `Esc`) · `M` movimento reduzido · `B` tela preta · `H` ocultar controles.

## Editar

Fontes em `fonte/` (HTML, CSS e JavaScript simples, sem build obrigatório — `fonte/index.html` também abre direto no navegador):

- `dados.js` — recorte congelado: os dois registros do inventário, selos e estado das funções.
- `dados-mapa.js` — geometria real do mapa (gerado; não editar à mão).
- `roteiro.js` — falas e lembretes do apresentador.
- `cenas.js` + `cenas.css` — composição de cada cena; `estilos.css` — identidade, entradas, luz ambiente.
- `motor.js` — navegação, pontes entre cenas, índice, notas, movimento reduzido.

Regra das animações: o estilo-base é o estado de leitura; a animação de entrada só define o início (`data-e` + `--i`). Assim, voltar, saltar pelo índice ou o modo estático mostram sempre a cena completa.

## Gerar de novo (na pasta `apresentacao-praca-reversa`)

```
node ferramentas/construir.mjs          # HTML único + roteiro, guia, fontes e estado
node ferramentas/exportar-pdf.mjs        # backup estático, roteiro e guia em PDF
node ferramentas/exportar-mp4.mjs 6.5    # MP4 complementar (~7 min nesta máquina)
node ferramentas/verificar.mjs verificacao/evidencias   # verificação completa (~5 min)
```

As ferramentas usam o Playwright/Chromium já instalado em `../motion-praca-reversa` e o FFmpeg da máquina. Mapa: `node ferramentas/gerar-dados-mapa.mjs` a partir de `ferramentas/snapshot/` (o leitor `ler-snapshot-somente-leitura.cjs` só consulta o banco, em transação somente leitura).

## Limites

- Os números vêm de um recorte histórico do inventário (conferência informada em 16/10/2026); não são estoque atual.
- "Disponível na versão de teste" = funciona na versão de teste local e passou nos testes automáticos de 21/10/2026; nada está em produção e o piloto no piso não começou.
- A janela de notas abre como pop-up: se o navegador bloquear, permitir pop-ups para o arquivo ou usar o roteiro.
- Sem Remotion (licença paga para empresas com mais de 3 pessoas): só ferramentas gratuitas (navegador, Node.js, Playwright, FFmpeg).
