# Palete × posição, validação sem endereço e conferência em tabela — contrato

21 out. 2026. Pedido: `Downloads/CORRECAO-PALETES-CONFERENCIA-E-REFERENCIAS5.zip` (prompt, `CASO-11-A42.json`, três prints). Decisões D289–D295 (`DECISOES.md`). Migração `20261021180000_paletes_alocacao_conferencia` (aditiva).

## Causa

- A carga do inventário escolhe o palete pelo **endereço**. Em 11 - A42 a fonte de 06/10 tinha o palete **1** (36 notas) e a de 20/10 o palete **256** (NFD 9059802, 117 volumes, FULL 3/9). Os dois ficaram no registro PR-000001; manter os ausentes deixou as 36 notas ativas ("não consta"). O mesmo em dezenas de endereços.
- Recontagem: a contagem era gravada, mas a busca e as notas do palete liam os volumes do inventário, a lista de conteúdos só via contagens feitas no próprio palete e o mapa pintava pela conferência por SKU (sempre "Não conferido"). A tela de reconferência não fechava.

## Palete, posição e número

- Posição = endereço fixo (não muda com a saída). Palete = unidade física com número operacional. O **código** do palete é o número operacional ("Palete 256"); o PR-… fica em `codigo_legado` (busca e QR continuam achando; nunca reutilizado). ID técnico e etiqueta QR não mudam.
- Alocação: `palete.posicao_id` + histórico `evento_localizacao` (já existiam). Saída confirmada (movimento/saída) libera a posição; reservar/solicitar janela não.

## Ocorrências (conteúdos)

| Situação | Significado |
| --- | --- |
| `ATIVO` | No estoque físico do palete (`palete_id`). |
| `VALIDACAO` | Local físico desconhecido: fora do palete e de toda consulta de estoque/cliente; `palete_id` = último conhecido (histórico). |
| `CANCELADO` | Registro incorreto retirado do estoque ativo (autor, motivo, volumes no histórico). |
| `ENCERRADO` | Versão nova do inventário ou correção: já representado noutra ocorrência. |

Quantidade atual = última contagem da ocorrência (em qualquer palete), senão a do inventário. Histórico: `historico_conteudo` (só acrescentado) + contagens + conferências + importação. Autor ausente = "não registrado".

## API

| Rota | Permissão | Função |
| --- | --- | --- |
| `POST /paletes/:id/conferencias-volumes` | `conferencia.registrar` | Conferência em tabela (COMPLETA/PARCIAL, `setSignature`, linhas `{kind,id,counted}`). |
| `POST /paletes/:id/conteudos/acoes` | `conteudo.corrigir` | `MOVER` (destino POSICAO/PALETE, `confirmOccupied`), `VALIDACAO` (motivo), `CANCELAR` (motivo + `confirm`). |
| `GET /validacao`, `GET /validacao/resumo` | `validacao.consultar` | Fila interna com histórico e dados técnicos. |
| `POST /validacao/resolver` | `conteudo.corrigir` | Pendências → destino escolhido no mapa. |
| `GET /ocorrencias/:id/historico` | `palete.consultar` | Histórico real da ocorrência. |

Erros novos: `CONJUNTO_ALTERADO` (revisar e repetir), `CONFIRMAR_DESTINO` (destino com conteúdo), `JANELA_VINCULADA` (volumes separados/expedidos numa janela). Todas as gravações com chave de idempotência e transação.

Perfis: `conteudo.corrigir` = supervisor e administrador; `validacao.consultar` = operador, supervisor e administrador. Cliente e consulta: nenhuma.

## Conferência em tabela

- Uma linha por conteúdo: situação, tipo e número, remetente, **atual** (referência), **contado** (começa com o atual), diferença.
- "Confirmar todos sem diferença" (declaração física obrigatória) · "Concluir com as diferenças" (grava só o que mudou; sem referência, exige o valor) · "Conferência parcial" (só as marcadas; não renova o prazo).
- Estado do palete: Não conferido · Parcial (x de y) · Conferido · Conferido com diferença — no mapa (contorno), janela, lista e detalhe. Divergência continua visível.
- A tela fecha só depois da gravação; volta à janela do palete com aviso do resultado; o mapa não muda de zoom/posição. Erro: a tela fica com os valores digitados ("Recarregar o conjunto" mantém o digitado).

## Correção dos dados cadastrados

`npm run paletes:corrigir -- --unidade <u> --cliente <c> --usuario <login> [--executar]` (simula por padrão; relatório em `.dados/correcoes/`). Sobre o inventário ativo, sem ler arquivo:

1. Número operacional: N° Pallet único da fonte no endereço do palete (pendentes: mais de um número no endereço, número em dois endereços, número já usado, palete já com número próprio).
2. Notas de versões substituídas que não constam da ativa: **encerrar** se a ativa põe a nota noutro palete; **validação** se a ativa só a tem sem alocação ou se o endereço tem outro N° Pallet; **manter** com mesmo N° Pallet, endereço fora da fonte ou sem N° Pallet, contagem positiva depois da data-base, volumes numa janela ou palete movido depois do inventário.

## Limites

- **Carga do inventário ajustada** (D296, pedido seguinte do usuário): o palete é o do N° Pallet único do endereço, não o que estava antes no endereço; nada desfaz movimentação, validação ou cancelamento feitos no aplicativo (ver README, carga do inventário).
- Conferência por SKU (etapa 04) continua separada; prevalece quando reconciliada.
- Números pendentes (endereço com dois N° Pallet etc.) continuam PR-… até confirmação no piso.

## Testes

`apps/api/test/banco/conferencia-tabela.test.ts` (50 notas numa operação; 130 → 126 persistido e depois de reiniciar; zero; inválidos; parcial × completa; clique duplo; conjunto alterado), `correcao-conteudos.test.ts` (mover vários para ocupado com soma conservada; posição vazia; validação e resolução; cliente sem acesso; cancelar uma de duas da mesma NF pelo administrador; janela vinculada), `correcao-paletes.test.ts` (caso 13 - A101 como 11 - A42: número 256, legado, validação, encerramento, entrada posterior e recontada preservadas; posição fixa e número não reutilizado). E2E `e2e/conferencia-tabela.spec.ts`.
