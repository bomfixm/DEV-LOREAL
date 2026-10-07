# Indicadores e relatórios — definições

Etapa 10. Definição, fonte, unidade, filtros, regra de datas, inclusões/exclusões e tratamento de desconhecidos e correções de cada número do painel (**Indicadores**, menu) e dos relatórios (**Relatórios**, menu). A tela usa linguagem simples; os detalhes ficam aqui. Implementação: `apps/api/src/modules/indicadores/` (`consultas.ts`, `relatorios.ts`, `periodo.ts`, `rotas.ts`); contratos em `packages/contracts/src/indicadores.ts`; testes em `apps/api/test/banco/indicadores.test.ts`.

## Regras gerais

- **Servidor, escopo e permissão.** Tudo é calculado no servidor, sempre no escopo ativo (unidade × cliente). Cada área exige a permissão de consulta dela, conferida no servidor; a área sem permissão **não é enviada** (vem `null` e aparece em `restricted`), não só escondida. Exportar exige também `relatorio.exportar` (supervisor de estoque e analista de claims).

  | Área / relatório | Permissão de consulta |
  | --- | --- |
  | Painel (base de posições) | `praca.consultar` |
  | Praça, conferência, estoque, idade; relatórios de paletes, estoque e piloto | `palete.consultar` |
  | Claims e valores; relatório de claims | `claim.consultar` (os mesmos perfis que já veem os valores na lista de claims, etapa 07) |
  | Janelas e fluxo; relatório de expedições | `janela.consultar` |

- **Leitura consistente.** Cada consulta (painel, página de relatório ou exportação) roda numa única transação `REPEATABLE READ READ ONLY`: totais e linhas vêm da mesma fotografia do banco. O horário mostrado ("Consultado em") é o da consulta. Duas consultas diferentes (por exemplo, o painel e depois o relatório aberto a partir dele) são duas fotografias; cada uma informa o seu horário.
- **Período.** Datas do fuso da operação (`unidade.fuso`, inicialmente `America/Sao_Paulo`), início e fim **inclusivos**. O servidor converte com o PostgreSQL (`AT TIME ZONE`): início = 00:00 do primeiro dia; fim = 00:00 do dia seguinte ao último, **exclusivo**. Um evento às 23:59:59,999 do último dia entra; às 00:00 do dia seguinte, não. Padrão: do primeiro dia do mês até hoje. Máximo de 366 dias. "Inclui hoje" quando o fim é hoje ou depois.
- **Posição atual × período.** "Posição atual" é o estado agora (não muda com o filtro de datas). "No período" conta acontecimentos entre os limites. O saldo de uma data passada é **reconstruído pelos eventos** (soma das linhas de evento até o instante), nunca copiado do saldo atual.
- **Unidades e moedas.** Quantidades sempre por unidade canônica do material (`UN`, `CX`…), sem conversão e sem total entre unidades; valores sempre por moeda, sem conversão. Decimais exatos (texto), sem ponto flutuante.
- **Contagem única.** Palete e posição são contados nas tabelas `palete`/`posicao`, sem junção com conteúdo, documentos, evidências ou contagens. Somas com várias relações são feitas em subconsultas por registro (nada se multiplica por junção).
- **Desconhecido.** Conteúdo não conferido continua desconhecido (vazio na tela, nunca "0"). Base zero ou desconhecida não gera porcentagem ("sem base para cálculo").

## Base de posições (todas as telas com ocupação)

- **Fonte:** layout ativo do escopo (`layout.ativo`), suas posições não retiradas (`posicao.retirada_em IS NULL`) e o histórico de alterações (`historico_layout`).
- **Rótulo:** enquanto o desenho for esquemático (`layout.esquematico`) ou houver código de posição provisório (`posicao.codigo_provisorio`), o painel mostra **"Base: posições cadastradas — validação do layout pendente"** e a ocupação é **provisória** (não é a capacidade física definitiva). É o caso atual da praça informada: o ajuste do layout ficou para depois (pendência futura, fora do aceite desta etapa).
- **Mudança de base:** o número de alterações do layout dentro do período aparece junto ("a configuração mudou N vez(es) no período"): ativar/desativar posições muda o denominador e não comprova redução de estoque.
- Nesta entrega nenhuma posição foi ativada, renumerada ou movida para "melhorar" o indicador.

## Praça (posição atual)

| Indicador | Definição | Fonte | Observações |
| --- | --- | --- | --- |
| Paletes na praça | Paletes não arquivados com fluxo `EM_ESTOQUE` ou `RESERVADO` | `palete` | Cada palete uma vez. Expedidos e arquivados (inclusive vazios retirados) ficam fora. "Reservados" é parte desse total. |
| Com posição / localização pendente | Paletes na praça com e sem `posicao_id` | `palete` | Localização pendente não é ausência física. |
| Posições cadastradas | Posições do layout ativo, não retiradas | `posicao` | Elegíveis + indisponíveis. |
| Posições elegíveis (denominador) | Cadastradas com `disponivel = true` | `posicao` | |
| Ocupadas / livres | Elegíveis com/sem palete vinculado | `posicao` + `palete.posicao_id` | Uma posição individual tem no máximo um palete (índice único). |
| Indisponíveis | `disponivel = false` | `posicao` | Fora do denominador; as que têm palete aparecem à parte ("com palete registrado"). |
| Ocupação | ocupadas ÷ elegíveis, uma casa decimal (arredondamento inteiro, sem ponto flutuante) | — | Sem layout ativo ou sem elegíveis: **sem base para cálculo**. Com base provisória: "Ocupação provisória". |
| Áreas desenhadas | Zonas, blocos, corredores e docas do layout ativo | `elemento_layout` | Classificação separada: não são posições nem capacidade. |
| No período: cadastrados | `palete.criado_em` no período | `palete` | |
| No período: mudanças de localização | Eventos `MOVIMENTO` e `CORRECAO` | `evento_localizacao.ocorrido_em` | |
| No período: paletes vazios retirados | Eventos `RETIRADA_VAZIO` (consolidação) | `evento_localizacao` | **Não é saída de estoque**: nenhuma unidade muda. |
| No período: saíram inteiros | Eventos `SAIDA_EXPEDICAO` | `evento_localizacao` | O palete inteiro saiu numa expedição confirmada. |

**Consolidação (T29).** Juntar dois paletes = transferir todo o conteúdo de um para o outro (evento `TRANSFERENCIA`, soma zero no escopo) e retirar o palete que ficou vazio (**Retirar palete vazio…**, evento de localização `RETIRADA_VAZIO`). Resultado: posições ocupadas e paletes na praça caem 1; unidades em estoque, saídas e expedições não mudam. A retirada só é aceita com saldo validado zero, sem reserva/vínculo, sem conferência em andamento e com conteúdo conhecido por conferência completa reconciliada (conteúdo desconhecido nunca é presumido vazio); o ID e o código ficam arquivados.

## Conferência

| Indicador | Definição | Fonte |
| --- | --- | --- |
| Por situação (posição atual) | Paletes na praça por `estado_conferencia`: não conferido, parcial, aguardando validação, reconciliado | `palete` |
| Em andamento | Sessões com `ativa = true` | `sessao_conferencia` |
| Observações pendentes | Linhas não removidas com produto não identificado ou fator desconhecido, em sessões em andamento ou concluídas (não reconciliadas) | `observacao_conferencia` |
| No período: iniciadas, concluídas, reconciliadas, recontagens, canceladas | `iniciada_em`, `concluida_em`, `reconciliada_em`, `motivo = RECONTAGEM` com `iniciada_em`, `cancelada_em` | `sessao_conferencia` |

"Reconciliado" não é "liberado"; "conferido" não libera material.

## Estoque validado

**Posição atual, por unidade:** saldo validado (`saldo_estoque.quantidade`), reservado (`quantidade_reservada`), vinculado a claim (`quantidade_vinculada`, continua no estoque) e disponível = validado − reservado; SKUs e paletes distintos com saldo > 0. Junto: **paletes na praça sem conteúdo totalmente validado** (não conferidos, parciais ou aguardando validação) — o saldo validado não representa todo o material físico quando esse número é maior que zero.

**Base documental (separada, não é estoque físico):** declarado nos paletes da praça (`item_declarado`, por unidade declarada) e documentos importados (`linha_documento_devolucao.quantidade_canonica`, por unidade canônica). Nunca somados ao saldo nem entre si.

**Fluxo do período, por unidade** (`linha_evento_estoque` × `evento_estoque.ocorrido_em` × `segmento_estoque.unidade`):

> **Saldo final = saldo inicial + entradas validadas − saídas confirmadas + ajustes líquidos**

| Componente | Definição |
| --- | --- |
| Saldo inicial | Soma de todas as linhas de evento antes do início do período (fotografia reconstruída). |
| Entradas validadas | Linhas de eventos `SALDO_INICIAL` no período: primeira validação do conteúdo de um palete (conferência completa reconciliada). |
| ↳ das quais retorno | Parte das entradas em paletes que receberam um retorno físico de expedição (entrada vinculada à saída). Esses paletes são sempre novos, não conferidos e sem saldo; a entrada acontece na reconciliação deles. |
| Saídas confirmadas | − linhas de eventos `EXPEDICAO` no período (baixa única da confirmação da expedição). |
| Ajustes líquidos | Linhas de eventos `AJUSTE_RECONCILIACAO` no período (reconciliações posteriores, com sinal). |
| Transferido entre paletes | Soma das linhas positivas de `TRANSFERENCIA` e `CORRECAO_TRANSFERENCIA` (volume movido; **não altera o total**). A soma com sinal dessas linhas é conferida: precisa dar zero no escopo. |
| Saldo final | Soma de todas as linhas até o fim do período. |
| Conferência | "✓ fecha" quando inicial + entradas − saídas + ajustes = final, as transferências somam zero e, se o período inclui hoje, o final = saldo atual. |

Cada linha de evento conta uma vez; uma transferência tem a baixa na origem e a entrada no destino (soma zero); desdobrar um evento em linhas não duplica o total. **Data:** horário de registro do evento no sistema (`ocorrido_em`): reconciliação, transferência, correção e confirmação da expedição. A data física informada na expedição ("saída física") aparece no relatório de expedições, ao lado da confirmação.

**Exemplo fictício (teste automatizado):** inicial 20 UN → entrada validada 5 → expedição 8 → **17**. Transferir 4 entre paletes e consolidar não muda os 17 (transferido 13, saídas continuam 8). Recontagem com ajuste −2 → **15**, com o ajuste aparecendo separado.

**Retornos no período:** retornos físicos registrados (`retorno_expedicao` tipo `RECEBIMENTO_FISICO`, `criado_em`) com a quantidade por unidade (`linha_retorno`) — declaração no palete que recebeu, aguardando conferência; avisos documentais (`AVISO_DOCUMENTAL`) — não alteram o saldo.

## Idade do material

Saldo validado atual agrupado pelo **mês da primeira entrada física validada** do material (segmento: menor `ocorrido_em` de linha positiva em `SALDO_INICIAL`/`AJUSTE_RECONCILIACAO`) — a mesma regra do FIFO das janelas (etapa 08). Sem data: "sem data de entrada validada". A referência **apenas documental** (data do documento importado) aparece à parte (quantidade de linhas, mais antiga e mais recente). **Sem faixas, prioridades ou metas**: critérios do cliente não informados (`DESCOBERTA.md`).

## Claims

Mesma definição do resumo de claims da etapa 07 (funções SQL compartilhadas `PENDENCIA_SQL` e `ESTIMADO_CASO`).

| Indicador | Definição | Fonte |
| --- | --- | --- |
| Casos / não finalizados | Todos os casos; não finalizados = fora de regularizado, perda confirmada e encerrado | `claim` |
| Por situação e por motivo | Contagem por `situacao` e `motivo` | `claim` |
| Casos com candidato em investigação | Casos com candidato `EM_INVESTIGACAO` (e o número de candidatos) | `candidato_claim` |
| Recuperação física validada | Soma de `linha_claim.quantidade_recuperada` por unidade e casos com recuperação | `linha_claim` |
| Pendências | Triagem, validação pendente, cobrança finalizada sem resultado externo, sem responsável, sem prazo, sem recuperação validada | `claim` + relações |
| No período | Casos registrados (`criado_em`), recuperações validadas ativas (`validada_em`, por unidade), estornos (`estornada_em`), encerrados (`encerrado_em`) | `claim`, `recuperacao_claim` |

**Candidato não é recuperação; localizado não é regularizado.** Quantidades recuperadas vêm só de vínculos válidos com o material (etapa 07), nunca de resultados de busca.

## Valores

| Indicador | Definição |
| --- | --- |
| Estimativa em análise | Soma da estimativa dos casos **não finalizados** (unitário × quantidade ou total da linha), por moeda; casos com alguma linha sem valor contam como "estimativa parcial". **Não é valor evitado.** |
| Valor evitado confirmado | Soma de `resultado_claim.valor` com tipo `REGULARIZACAO` e situação `VIGENTE`, por moeda (registrado por quem tem aprovação financeira, com fonte e evidência). |
| Perda confirmada | Idem, tipo `PERDA_CONFIRMADA`. |
| Corrigidos / anulados | Resultados substituídos por correção ou anulados: fora dos totais; o histórico continua no caso. |
| Registrado no período | Resultados vigentes com `registrado_em` no período, por moeda. |

Várias evidências não multiplicam o valor de uma decisão (o valor é do resultado, não das evidências); recuperação parcial não confirma o valor integral do caso; moedas diferentes nunca se somam.

## Janelas e fluxo

- **Janelas listadas:** as que têm intervalo de saída cruzando o período ou, sem intervalo, mês de referência no período (até 12; o painel avisa se houver mais).
- **Por restrição:** limite (pendente = "não é ilimitado"), reservado ativo, expedido e restante = limite − reservado − expedido, **na métrica da própria janela** (peças, caixas, paletes, peso com base, volume), sem conversão por fator genérico (`restricao_janela`).
- **No período:** expedições confirmadas (`expedicao.confirmada_em`) e com conclusão parcial, enviado por unidade (`linha_expedicao.quantidade_enviada`), paletes que saíram inteiros (`SAIDA_EXPEDICAO`), reservas criadas (`reserva_janela.criado_em`) e canceladas/liberadas (`encerrada_em`). Reserva não altera o físico; a baixa é única, na expedição.

## Sem base de medição (pendências)

- **Produtividade e tempo poupado:** não há registro de esforço (horas por tarefa) nem base comparável anterior ao aplicativo. O tempo entre abrir e concluir uma conferência não comprova trabalho ativo. Nada é estimado como economia.
- **Metas, faixas de idade e prioridade do cliente:** não informadas.

## Relatórios

Formato único (`RelatorioSchema`): título, escopo, período, horário da consulta, filtros, base, notas (dados ausentes e universo parcial), totais tipados (contagem, quantidade, valor) e linhas. **A tela, o CSV e a impressão mostram exatamente o mesmo conteúdo.** Página na tela: 50 linhas; exportação: até **5.000 linhas** (o cabeçalho do CSV informa quando há mais e pede para refinar os filtros).

| Relatório | Linhas | Filtros | Período |
| --- | --- | --- | --- |
| Paletes e pendências | Um palete por linha (na praça): endereço, conferência, liberação, fluxo, em conferência, saldo validado e declarado por unidade, observações pendentes, pendência | conferência, localização, somente com pendência | Não (posição atual) |
| Movimento do estoque | Um material (produto × lote × origem × condição × unidade) por linha: inicial, entradas, saídas, ajustes, transferido, final | SKU (começa com) | Sim |
| Expedições e retornos | Uma linha por material expedido: expedição, janela, saída física, confirmação, palete, SKU, lote, origem, reservado, enviado, liberado, retornado | — | Sim (confirmação) |
| Claims e valores | Um caso por linha: motivo, situação, em análise, candidatos, recuperada, estimado, evitado, perda, resultados corrigidos/anulados | situação, motivo | Sim (totais "no período") |
| Grupo do piloto | Uma unidade por linha: inicial, entradas, ajustes, saídas, recebido de fora do grupo, enviado para fora, movido dentro do grupo, final | códigos dos paletes (até 300) | Sim |

**Grupo do piloto:** o grupo é a lista de códigos informada. Saldo final = inicial + entradas + ajustes − saídas + recebido de fora − enviado para fora; transferências internas e consolidação não mudam o total; transferências que cruzam o limite do grupo aparecem separadas e não são entradas/saídas da praça. Códigos não encontrados e paletes que já saíram da praça aparecem nas notas. A fotografia inicial é o saldo reconstruído pelos eventos até o início do período (usar a mesma lista e o mesmo período na comparação final; mudar a lista é mudança de escopo do piloto).

**CSV:** UTF-8 com BOM, `;`, CRLF, todas as células de texto entre aspas (códigos com zeros à esquerda continuam texto no arquivo; ao abrir no Excel, use *Dados → De Texto/CSV* e marque as colunas de código como Texto, porque o duplo clique pode converter `000123` em `123`). Texto que começa com `=`, `+`, `-`, `@`, tabulação ou CR recebe um apóstrofo no arquivo (proteção contra fórmula, OWASP); o valor no banco não muda. Quantidades com vírgula decimal. Cada exportação é auditada (`RELATORIO_EXPORTADO`); sem permissão, `ACESSO_NEGADO` é registrado. Outras exportações existentes continuam: busca (etapa 06), lista de claims (etapa 07), janelas e lista de preparação (etapa 08).

**Impressão:** pelo navegador (*Imprimir*), com o mesmo conteúdo da tela (filtros e navegação ficam fora da folha). Não há XLSX novo: sem necessidade concreta nesta etapa.
