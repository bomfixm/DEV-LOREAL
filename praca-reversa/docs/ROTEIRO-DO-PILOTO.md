# Roteiro do piloto — Praça Reversa

Documento para **preencher durante o piloto físico**. Nada aqui foi executado na praça: o piloto, o teste com pessoas e a comparação com o físico estão **pendentes** até que as tabelas abaixo sejam preenchidas por quem participou. Não registre aprovação, assinatura, tempo ou resultado de quem não participou. Exemplos de preenchimento são marcados como *(exemplo fictício)*.

Três situações são diferentes e devem ser registradas separadamente:

| Situação | O que significa | Onde registrar |
| --- | --- | --- |
| Verificação local | Testes automatizados e demonstração com dados fictícios no computador de desenvolvimento. | `docs/ESTADO.md` |
| Preparação da implantação | Ambiente, HTTPS, contas, backup e restauração ensaiados no ambiente do piloto. | `docs/IMPLANTACAO.md` e seção 2 deste roteiro |
| Piloto real | Uso com pessoas, paletes e documentos reais de um grupo delimitado, comparado com o físico e validado pelo responsável operacional. | Seções 3 a 9 deste roteiro |

## 1. Escopo do piloto

| Item | Preenchimento |
| --- | --- |
| Unidade / cliente (escopo no aplicativo) | |
| Período (início e fim, horário de Brasília) | |
| Grupo de paletes (critério de escolha: fileira, área, tipo de material…) | |
| Quantidade de paletes do grupo (depende de pessoas e tempo disponíveis; não é regra) | |
| Lista de códigos do grupo (anexar; é a mesma usada no relatório "Grupo do piloto") | |
| Módulos incluídos (consulta, cadastro, conferência, movimentação, claims, janelas/expedição) | |
| Fora do piloto (o que continua pelo procedimento atual) | |

O procedimento atual continua sendo a referência operacional até o responsável validar o novo fluxo.

## 2. Critérios de entrada (antes de começar)

| Critério | Situação | Quem confirmou e quando |
| --- | --- | --- |
| Endereço HTTPS estável do ambiente do piloto, acessível pelos aparelhos | Pendente | |
| Banco do piloto separado da demonstração e da operação; **sem dados fictícios** carregados | Pendente | |
| `npm run db:migrar` aplicado; `/api/v1/health/ready` = 200 | Pendente | |
| Contas individuais criadas na Administração de acesso, com o perfil certo por pessoa | Pendente | |
| Backup do banco do piloto criado e **restauração ensaiada** num banco novo isolado (`IMPLANTACAO.md`) | Pendente | |
| Aparelhos testados (seção 4) | Pendente | |
| Endereços físicos do grupo conferidos com o desenho cadastrado (posições do grupo existem e batem com a praça) | Pendente | |
| Etiquetas com QR do grupo impressas com o endereço definitivo (`APP_URL_PUBLICA`) | Pendente | |
| Regras essenciais do cliente para os módulos incluídos registradas em `DESCOBERTA.md` | Pendente | |

**Layout:** o ajuste geral do desenho da praça foi adiado. Conferir os endereços do grupo antes do piloto **não** valida o layout inteiro: os indicadores continuam com "Base: posições cadastradas — validação do layout pendente" até a revisão completa do desenho.

## 3. Pessoas e funções

Preencher só com pessoas e cargos confirmados. Funções ainda sem responsável ficam "pendente".

| Função no piloto | Perfil no aplicativo | Pessoa (nome e cargo) | Confirmado por |
| --- | --- | --- | --- |
| Cadastro de paletes e conferência | Operador | Pendente | |
| Reconciliação de contagens (validação do saldo) | Supervisor de estoque | Pendente | |
| Liberação, reserva e confirmação de expedição | Supervisor de estoque | Pendente | |
| Investigação de claims e validação da recuperação | Analista de claims | Pendente | |
| Resultado financeiro de claims | Analista com aprovação financeira | Pendente | |
| Contas e permissões | Administrador | Pendente | |
| Suporte durante o piloto | — | Pendente | |
| Backup, restauração e manutenção | — (técnico) | Pendente | |
| Responsável operacional que valida o resultado | — | Pendente | |

## 4. Equipamentos

| Aparelho (modelo) | Sistema e navegador (versão) | Origem HTTPS ok | Instalou como app | Câmera: QR / códigos de produto lidos | Leitor-teclado | Foto na conferência | Queda de rede testada | Atualização testada |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | |

Na página **Aplicativo e aparelho** (menu ou tela de login) o aparelho mostra origem segura, câmera, versões e modo aplicativo: copie esses dados para a tabela.

## 5. Fotografia inicial do grupo

No primeiro dia, antes de qualquer movimento do piloto:

1. Em **Relatórios → Grupo do piloto**, informe a lista de códigos e o período começando no primeiro dia; exporte o CSV ("saldo inicial do grupo" = fotografia reconstruída pelos eventos até o início).
2. Em **Relatórios → Paletes e pendências**, exporte o estado dos paletes (conferência, endereço, saldo validado, declarado, pendências).
3. Registre o físico observado do grupo (contagem visual ou conferência), com quem contou e quando.

| Item | Valor do sistema | Valor físico observado | Diferença e observação |
| --- | --- | --- | --- |
| Paletes do grupo na praça | | | |
| Paletes com conteúdo desconhecido (não conferidos/parciais) | | | |
| Saldo validado por unidade | | | |
| Endereços conferidos com o físico | | | |

Use a **mesma lista de códigos e a mesma regra** na comparação final. Incluir ou retirar paletes do grupo é mudança de escopo: registre a data e o motivo (seção 9).

## 6. Exercícios

Registrar cada execução com data/hora, pessoa (função), aparelho, resultado e referência no aplicativo (código do palete, conferência, claim, reserva ou expedição; o histórico e a auditoria mostram autor e horário).

| # | Exercício | O que observar | Execuções (data, pessoa, aparelho, resultado, referência) |
| --- | --- | --- | --- |
| 1 | Pessoa sem histórico do projeto faz o tutorial (**Ajuda → Começar aqui**) e encontra um produto/palete do grupo | Consegue explicar o endereço, o ID e a base das quantidades (declarado, observado, validado) sem ajuda? | |
| 2 | Conferência completa e parcial, rascunho, divergência, recontagem e reconciliação autorizada | Contagem registrada na hora; parcial não "zera" o resto; divergência tratada pelo responsável com justificativa | |
| 3 | Mudança de localização e transferência entre paletes (inclusive consolidação e **Retirar palete vazio…**) | Origem, lote, condição e saldo preservados; posição ocupada cai sem saída de estoque | |
| 4 | Investigação de claim com candidato de origem diferente, evidência e validação pelo responsável | Candidato bloqueado continua bloqueado; recuperação só por validação; valor só por quem tem aprovação financeira | |
| 5 | Reserva/preparação, cancelamento antes da saída e uma expedição confirmada (**só com janela real autorizada no piloto**) | Reserva não baixa; cancelamento libera; uma única baixa por expedição | |
| 6 | Falha de conexão / resultado incerto, retomada, foto na conferência e ensaio do procedimento de recuperação | "Em confirmação" resolvido sem duplicar; nada gravado sem servidor; restauração em banco isolado | |
| 7 | Comparação entre físico, registros, indicadores e relatórios | Diferenças registradas com causa e correção (por evento, nunca apagando) | |

## 7. Teste com iniciante

Uma linha por pessoa e tarefa. Não preencher por quem não participou.

| Data | Pessoa (função, sem experiência no projeto?) | Tarefa | Concluiu? | Dúvidas | Passos em que precisou de ajuda | Aparelho | Ajuste feito na orientação/interface |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |

Ajustes na orientação ou na interface só a partir dessas evidências; registre a mudança em `DECISOES.md`.

## 8. Medições e comparação final

No último dia, repita a seção 5 com o mesmo grupo e período completo:

| Medida | Fonte | Início | Fim | Observação |
| --- | --- | --- | --- | --- |
| Paletes do grupo na praça | Relatório "Grupo do piloto" | | | |
| Paletes conferidos/reconciliados | Relatório "Paletes e pendências" | | | |
| Saldo validado por unidade | Relatório "Grupo do piloto" | | | |
| Entradas, saídas e ajustes por unidade | Relatório "Grupo do piloto" | — | | |
| Recebido de fora / enviado para fora do grupo | Relatório "Grupo do piloto" | — | | |
| Paletes vazios retirados (consolidação) | Relatório "Grupo do piloto" | — | | Não é saída de estoque |
| Produtos localizados para claims (candidatos) | Claims | | | Pista, não recuperação |
| Recuperações validadas | Relatório "Claims e valores" | | | |
| Claims regularizados / valor evitado confirmado (por moeda) | Relatório "Claims e valores" | | | Só com decisão e evidência |
| Material expedido | Relatório "Expedições e retornos" | | | |
| Divergências físico × sistema | Seção 5 e 9 | | | |

Produto localizado, recuperação validada, claim regularizado, valor evitado e material expedido têm evidências diferentes e **não se somam**. Uma melhoria percebida ou uma mudança no tipo de trabalho não comprova, sozinha, benefício financeiro causado pelo aplicativo. **Produtividade e tempo poupado** só podem ser comparados se o esforço (horas por tarefa) for registrado antes e durante o piloto com a mesma regra — hoje não há essa medição (`INDICADORES.md`).

## 9. Registro de dúvidas, divergências e mudanças de escopo

| Data | Tipo (dúvida, divergência, mudança de escopo, falha) | Descrição | Referência no aplicativo | Tratamento / correção | Responsável |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

## 10. Critérios para ampliar o piloto

| Critério | Situação | Evidência |
| --- | --- | --- |
| Registros do grupo conferidos com o físico (diferenças explicadas e corrigidas por evento) | Pendente | |
| Regras essenciais aprovadas pelo responsável (`DESCOBERTA.md`) | Pendente | |
| Acesso protegido (HTTPS, contas individuais, perfis revisados) | Pendente | |
| Recuperação verificada no ambiente do piloto (backup + restauração isolada) | Pendente | |
| Tarefas compreendidas pelos participantes (seção 7) | Pendente | |
| Pendências materiais resolvidas ou aceitas por escrito | Pendente | |
| Revisão completa do layout da praça (para ocupação deixar de ser provisória) | Pendente (entrega futura) | |

Preparação técnica, autorização operacional para usar o sistema e publicação para mais pessoas são decisões diferentes, de responsáveis diferentes; registre cada uma com data e quem decidiu.
