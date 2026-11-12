# Editor de layout dos espelhos de paletes (12 nov. 2026)

Branch `espelhos-editor-layout`, worktree `LR LOREAL-espelhos/`. Mudança só de apresentação: a API, o banco, o estoque, o mapa, o importador e os outros documentos não foram alterados.

## Como usar

1. **Imprimir espelhos**: marque os paletes no mapa como antes e clique em **Gerar prévia**.
2. **Editar layout** abre o editor. A folha mostra os dados reais do 1º espelho do lote. Navegue com ‹ › e, se houver, escolha a folha.
3. Clique num campo para selecioná-lo e arraste. As alças laterais mudam a largura; na tabela, a alça de baixo muda a altura. O painel **Propriedades** (recolhível) tem X, Y, largura, fonte, tamanho (pt), negrito, alinhamento e rótulo. As setas movem 0,5 mm; com Shift, 5 mm. Ctrl+Z desfaz e Ctrl+Y refaz. **Restaurar** volta ao ponto de partida.
4. **Aplicar aos N espelhos** grava o rascunho só nos paletes daquele lote. **Quais espelhos?** mostra a lista exata. **Cancelar** descarta o rascunho.
5. **Imprimir espelhos** abre a impressão. Para gerar o PDF, escolha "Salvar como PDF". A impressão fica bloqueada enquanto houver conteúdo cortado e mostra qual espelho e qual campo precisam de ajuste.

## Espelho de embarque (Expedição), 12 nov. 2026

O espelho de embarque (via do cliente) usa o mesmo editor e a mesma folha. O conteúdo é o de antes: veículo, placa, janela, número do palete, identidade, tipo, revisão, NFs desta saída, total e coluna de conferência.

- **Como editar:** Expedição → veículo → palete → bloco Impressão → **Layout do espelho**. A folha mostra o palete escolhido, e ‹ › percorre os paletes ativos do veículo. **Aplicar ao espelho de embarque** vale para todas as vias impressas neste computador, rascunho e final. Assim as vias de uma saída ficam iguais.
- **Layout fixo na emissão:** ao clicar em "Espelho (rascunho)" ou "Espelho final", o layout é capturado junto com o pedido. A impressão só abre depois de paginar e carregar as fontes.
- **Paginação:** antes era uma folha só, e com muitas NFs (até 300 por palete) o conteúdo passava da folha. Agora as NFs são paginadas, com cabeçalho e palete repetidos, e o total sai na última folha.
- **Modelos:** *Operacional limpo* (padrão novo) e *Clássico (moldura DHL)*, este último perto da aparência anterior. Modelo salvo de um documento não aparece no outro.
- **Limite:** o servidor registra a emissão (tipo, final, revisão), mas não o layout usado. Reimprimir um espelho final usa o layout atual deste computador.
- **Arquivos:** `EspelhoEmbarque.tsx` (novo); `carga/Impressao.tsx` (troca o desenho antigo do espelho pelo novo; etiqueta, mapa e lista de documentos não mudaram); `carga/TelaCarga.tsx` (botão "Layout do espelho", editor, layout capturado na emissão e espera da paginação antes de imprimir); `e2e/carga.spec.ts`.

## Como funciona

- **Modelo visual** (`layout-modelo.ts`): papel A4 paisagem fixo (área útil de 287 × 199 mm) e, para cada campo de identificador estável, posição e largura em mm e texto em pt. Tudo é validado com zod e mantido dentro da folha. Não há HTML, CSS livre nem fonte fora da lista.
- **Campos**: endereço, número do palete, continuação, aviso de demonstração, tabela de notas (bloco único), escopo e emissão, legenda, código do formulário e divisória. Só o código do formulário e a divisória podem ser ocultados; nenhum campo de dado pode.
- **Modelos do sistema**: *Operacional limpo* (padrão novo: fundo branco, endereço e palete grandes no topo, tabela com linhas finas) e *Clássico (moldura DHL)*, que reproduz a aparência anterior.
- **Onde fica guardado**: no navegador deste computador (`localStorage`, chave `praca-reversa:espelhos-layout:v1`), por id de palete, com layouts deduplicados. Também guarda os modelos salvos. Não há tabela de modelos no servidor, e essa persistência não foi criada para não mexer no banco. Consequência: outro computador ou navegador continua com o padrão. Aplicar a um lote não muda o padrão do sistema.
- **Prévia = PDF**: o mesmo componente (`FolhaEspelho.tsx`) desenha a prévia, o editor e a impressão, com o mesmo CSS. A folha zera a tipografia da tela (o `redesign.css` só vale em `@media screen`) para não mudar as quebras no PDF. As fontes são carregadas antes de medir e de imprimir: Inter vem com o sistema; Arial, Verdana, Georgia e Courier New são conferidas no computador e aparecem desabilitadas se não estiverem instaladas.
- **Paginação**: as linhas da tabela são medidas fora da tela, com a largura, a fonte e o respiro do layout. As folhas quebram pela altura da tabela, com cabeçalho e palete repetidos e "Folha 1/N" / "Continuação · folha 2/N". Nenhuma nota é cortada nem descartada. Uma nota mais alta que a tabela inteira é apontada como erro.
- **Durante o arraste** só a folha em foco é redesenhada. O lote é desenhado de novo apenas ao aplicar. Ao imprimir, o lote e os layouts são capturados antes de abrir a impressão.

## Arquivos

Todos em `apps/web/src/features/espelhos/`, exceto os testes de tela.

- Novos: `layout-modelo.ts`, `layout-armazenamento.ts`, `historico.ts`, `verificacao.ts`, `conteudo-espelho.ts`, `fontes.ts`, `FolhaEspelho.tsx`, `usePaginacao.tsx`, `EditorLayout.tsx`, `editor-layout.css`, `layout-editor.test.ts`; `e2e/espelhos-editor.spec.ts`; `docs/capturas/espelhos-editor/`.
- Alterados: `TelaEspelhos.tsx`, `espelhos.css`, `paginas.ts` (paginação por altura medida no lugar da estimativa por caracteres), `paginas.test.ts` e `e2e/espelhos.spec.ts` (conferência de corte sem o antigo `<footer>`).
- **Arquivos compartilhados tocados:** só `carga/Impressao.tsx` e `carga/TelaCarga.tsx`, na etapa do espelho de embarque (ver acima). Rotas, menu, API, contratos e estilos globais ficaram como estavam.

## Verificação feita

- Unidade (`vitest --project unidade apps/web/src/features/espelhos`): 13 testes. Cobrem modelo, validação contra HTML/CSS, limites da folha, histórico, cenário A/B/C, armazenamento adulterado e paginação.
- Tela (`e2e/espelhos.spec.ts` e `e2e/espelhos-editor.spec.ts`): 3 testes. Rodaram com banco próprio (`praca_reversa_espelhos_e2e`) e portas 4350/4351, com o script `.dados/espelhos-editor/e2e-espelhos.mjs` (fora do Git). Cobrem:
  - A e B com o palete em 210 mm e 24 pt, e C mantendo 192 mm;
  - arraste de 20 mm em dois zooms dando o mesmo valor em mm;
  - desfazer/refazer, setas, cancelar, modelo salvo aplicado a outra seleção sem dados de A;
  - 45 notas com remetente longo paginando sem corte;
  - mesmas alturas de linha na tela e na impressão;
  - impressão sem contornos, alças nem guias.
- `tsc` (web e raiz, com e2e) e eslint dos arquivos alterados sem erros. Build completo ok.

## Abrir a prévia isolada

Rode o servidor do worktree na porta 4352, com o banco de teste dos espelhos:

```
node .dados/espelhos-editor/servidor-espelhos.mjs
```

Abra http://127.0.0.1:4352/espelhos. A conta `operadorDemo` está em `.dados/e2e/credenciais.json`. Antes, faça `npm run build` no worktree. As dependências vêm do checkout principal por junção de `node_modules`.

## Para a integração

- Não há migração nem mudança de contrato. O merge da branch e um `npm run build` bastam.
- Depois do deploy, quem abrir a impressão verá o *Operacional limpo* como padrão. O *Clássico* fica disponível em **Modelos…**.
- Se o projeto passar a guardar modelos no servidor, troque só `layout-armazenamento.ts` (mesma interface).
