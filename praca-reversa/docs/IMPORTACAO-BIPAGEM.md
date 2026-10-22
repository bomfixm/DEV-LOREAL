# Importação fixa da bipagem "Etiquetas" — contrato

21 out. 2026. Pedido: `Downloads/IMPORTADOR-ETIQUETAS-PYTHON.zip` (`PROMPT-CLAUDE-IMPORTACAO-ETIQUETAS.txt`, leitor Python de referência e 11 testes). Decisões D283–D288 (`DECISOES.md`). Substitui a etapa de 19 out. (D249–D252): o destino passa a ser escolhido no mapa, o palete novo é numerado pela série do piso e notas repetidas seguem "Revalidar" ou "Importar separadamente" (sem substituir contagem).

## Arquivo

Um arquivo = **um único palete bipado**. Referência: `amostras/Bipagem-real.xlsx` (= `Etiquetas (1).xlsx`, md5 `da2d4901…`, o mesmo do pacote; dado real fora do versionamento). Aba `Etiquetas_1`, cabeçalho na linha 1, 63 linhas.

| Coluna (amostra) | Cabeçalho | Uso |
| --- | --- | --- |
| C | Tipo | **Obrigatório**: NF-e, Minuta (ou NFD) |
| D | Número | **Obrigatório**: número do documento, como texto |
| G | Lidos | **Obrigatório**: volumes lidos daquela linha (quantidade) |
| K | Remetente | **Obrigatório**: nome do remetente |
| J | CNPJ Remetente | Opcional: texto original guardado; comparado pelos 14 dígitos |
| I | Última Leitura | Opcional: data/hora da bipagem, como lida (sem fuso inventado) |
| A, B, E, F, H, L, M | Status, Baixa indevida, Série, **Leituras**, Destino, Posicao, Area | **Ignorados** em qualquer regra (nem filtro, nem destino, nem quantidade) |

As letras são da amostra; o leitor acha os cabeçalhos pelo nome (sem acentos, caixa, pontuação ou espaços), em qualquer ordem, aba ou nas 10 primeiras linhas. Faltando um obrigatório: "Não encontrei a coluna … Exporte de novo a bipagem de um palete no padrão "Etiquetas"…" — nada é gravado e não há mapeador.

Amostra conferida: 63 linhas, **41 com Lidos > 0 (47 volumes)**, **22 com Lidos = 0**, 0 erros; NF-e 285987 = 5 (Leituras 1); Minuta 1379 = 1 (Leituras 0,1).

## Leitura por linha

- **Lidos**: inteiro de 0 a 100.000. Vazio, negativo, fracionário, texto, erro do Excel ou fórmula = **pendência** (erro da linha; nunca vira zero). **Lidos = 0**: relatado, não gera entrada (não exige identificação).
- **Tipo**: NF-e → código NF, Minuta → MI, NFD → NFD (original guardado; NF-e nunca vira NFD). Outro tipo = pendência.
- **Número**: texto exato (zeros à esquerda preservados). **Remetente**: obrigatório com Lidos > 0.
- **CNPJ**: opcional; número da planilha que perdeu zeros (11–14 dígitos) é completado até 14 com aviso; texto com outra quantidade de dígitos fica como lido, sem dígitos de comparação (aviso, nunca completado por suposição).
- **Última Leitura**: célula de data, serial do Excel, "DD/MM/AAAA HH:MM[:SS]" ou ISO → `AAAA-MM-DDTHH:MM:SS` (horário local da bipagem). Não reconhecida = aviso. Não é conferência do palete.

## Destino e numeração

- **Posição vazia** escolhida no mapa → palete novo **na confirmação**, na posição, com o próximo **número operacional** (série física do piso, sem prefixo). Número, endereço e ID técnico são distintos. O número não é digitado.
- **Posição ocupada** (ou palete aberto/pesquisado) → o palete dela: número e conteúdo preservados; as notas são acrescentadas ("Este palete já contém notas. Deseja acrescentar os conteúdos desta importação?", com quantidades atuais e a adicionar). Nada é substituído.
- Bloqueios: posição desativada, indisponível ou fora do layout; palete arquivado ou expedido.
- **Numeração** (`numeracao_palete`, por escopo): próximo número, faixas reservadas e origem. Gerada com a linha travada (`FOR UPDATE`) + código único no banco; pula faixas reservadas e qualquer número já usado (código de palete, inclusive arquivado/expedido, ou N° Pallet em qualquer versão do inventário). Não reinicia com servidor, importação ou posição liberada. Sem definição, parte do maior número conhecido até 999 + 1. Escopo real: **último 278 → próximo 279; reservados 1000–1015** (paletes "com gato" aguardando o cliente; ao passar de 999, segue em 1016+). O 372 da planilha (digitação errada) é pulado enquanto constar como N° Pallet.

## Notas repetidas (regra do usuário)

Comparação **só dentro do palete de destino** (e entre linhas positivas do próprio arquivo): tipo (NF-e = NF = NFE; Minuta = MI; NFD distinto) + número + CNPJ (14 dígitos) + remetente (sem acentos/caixa/espaços extras; sem agrupamento aproximado). Série não entra.

- Número igual com **CNPJ ou remetente diferente** → outra entrada, sem aviso.
- **Tudo igual** (quantidades à parte) ou **identificação incompleta** (falta CNPJ/remetente em algum lado) → decisão por linha, com existente e proposta lado a lado:
  - **Revalidar**: mantém a existente; esta linha não entra (fica no lote como ignorada, rastreável). A quantidade antiga não muda; não é conferência física nem reinicia os 20 dias.
  - **Importar separadamente**: nova entrada com a quantidade desta linha; nada é fundido; as duas contam no total do palete (10 + 5 = 15).
- A identidade não é chave única no banco (o usuário autorizou ocorrências distintas).

## Gravação, reenvio e concorrência

- Nada é gravado no envio nem na prévia. Erro, só zeros, revalidar tudo ou cancelar não criam palete nem conteúdo.
- Confirmação: uma transação (bloqueio de importação do escopo; posição e palete travados) — palete novo (se for o caso), `conteudo_palete` (origem BIPAGEM, tipo original, CNPJ, Última Leitura, lote, linha, `decisao_bipagem` = IMPORTAR_SEPARADO quando for o caso) + `contagem_volumes` (origem BIPAGEM, chave da identidade), movimentação "entrada de conteúdo" e auditoria (destino, número, linhas separadas e revalidadas). O lote recebe o palete na confirmação.
- A prévia é refeita e comparada na confirmação (assinatura): posição ocupada por outra pessoa, nota nova no palete ou importação do mesmo arquivo nesse meio → `PREVIA_DESATUALIZADA`, nada gravado, prévia nova.
- Mesma confirmação repetida (clique duplo, nova tentativa) → chave de idempotência e lote confirmado: grava uma vez.
- **Mesmo arquivo** (hash) já importado: aviso com a importação anterior; só segue com "É uma nova operação" (e as notas repetidas ainda pedem decisão).

## Implementação

API `apps/api/src/modules/importacao/bipagem.ts` (leitor, destino, classificação, gravação), `paletes/numeracao.ts`, `importacao/servico.ts` (lote), `cli/numeracao-paletes.ts` (`npm run paletes:numeracao`); contratos `packages/contracts/src/bipagem.ts` (inclui `compararIdentidade`); web `features/paletes/TelaBipagem.tsx` + `bipagem.css`; migração `20261021150000_bipagem_etiquetas`. O leitor Python do pacote foi reescrito em TypeScript (decisão do usuário: "reescreva … para a linguagem que suporta"); **não há dependência de Python** no desenvolvimento, no servidor nem na hospedagem (Netlify incluído).

## Testes

`packages/contracts/src/bipagem.test.ts` e `apps/api/test/unidade/bipagem-leitor.test.ts` (os 11 casos do `testar_leitor.py`: amostra 63/41/22/47, Lidos ≠ Leituras, colunas ignoradas, zero, quantidade inválida, identificadores e CNPJ, mesma identidade, CNPJ/remetente diferentes, CNPJ ausente, tipo legado e NFD, cabeçalho e Última Leitura); `apps/api/test/banco/bipagem.test.ts` (prévia sem gravar, palete novo numerado, Revalidar/Importar separadamente, outro remetente, incompleta, repetição no arquivo, erro/zeros/descartado, posição ocupada depois da prévia, clique duplo, dois lotes na mesma posição, numeração com reservas e concorrência); E2E `e2e/bipagem.spec.ts` (computador e celular).
