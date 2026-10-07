# Dados e regras operacionais

## Três informações que devem permanecer distintas

A quantidade declarada é a informação de nota, devolução, manifesto ou outro documento. A quantidade observada é o resultado de uma conferência física. O saldo validado é a posição de estoque reconciliada e utilizada para movimentos e expedição. Uma importação de nota não cria saldo físico automaticamente.

Produtos encontrados sem origem comprovada podem ser registrados e localizados, mas ficam com origem pendente. Eles não devem ser usados automaticamente para encerrar uma falta de outra devolução. Lote desconhecido permanece desconhecido; não usar um lote inventado para preencher um campo obrigatório.

## Modelo lógico

Os nomes abaixo são entidades propostas, não tabelas já criadas. Os IDs internos são UUIDs. Referências externas preservam sua forma textual. Todas as entidades operacionais têm escopo de unidade e cliente, autoria e timestamps pertinentes.

| Entidade | Dados principais e vínculo |
| --- | --- |
| Unidade e Cliente | Escopo de acesso, fuso, identificação e configurações da operação. |
| Usuário e Permissão | Identidade, perfil, unidade/cliente e ações autorizadas. |
| Layout da praça | Largura/altura, unidade de desenho, origem dos eixos, versão e planta autorizada quando disponível. |
| Zona e Posição | Rua, ID permanente da posição, tipo de área, geometria x/y/largura/altura, disponibilidade e ocupação atual. |
| Produto | SKU textual, descrição, unidade canônica e conversões aprovadas. |
| Código de barras | Código textual, produto, embalagem/unidade e fator de conversão conhecido. |
| Devolução e Linha | Referência, NF, item da nota, produto, lote declarado, quantidade documental e data de referência. |
| Recebimento e Linha | Evidência/data de entrada, quantidade efetivamente registrada e vínculo documental, se disponível. |
| Palete | ID permanente, localização atual, estados separados, data de cadastro e versão. |
| Segmento de estoque | Produto, lote conhecido ou pendente, origem comprovada ou pendente, condição e identidade própria. |
| Posição de estoque | Segmento, palete, quantidade validada, reserva ativa e versão. |
| Sessão de conferência | Palete, escopo parcial/completo, versão inicial, responsável e situação. |
| Observação de conferência | Produto, lote, origem observada/pendente, unidade informada, quantidade e evidências. |
| Divergência e Reconciliação | Declaração versus observação, recontagem, responsável, decisão e evento de ajuste. |
| Evento de estoque e Linhas | Tipo, origem/destino, segmento, delta exato, autor, motivo e evento original em caso de correção. |
| Caso de claim | Referência externa, motivo, origem/linha, quantidade em análise, prazo, valor estimado e responsável. |
| Evidência e Tratativa de claim | Registro localizado, quantidade vinculada, documentos, validador e resultado confirmado. |
| Janela e Restrições | Datas, critérios, capacidade por métrica, confirmação do cliente e situação. |
| Reserva de janela e Material | Janela, estoque reservado, métricas da carga, situação e versão. |
| Expedição e Linhas | Reserva, quantidades reais, métricas, documentos, data e comprovante. |
| Lote de importação e Linhas | Tipo, hash, origem do arquivo, erros, chave de negócio e resultado por linha. |
| Anexo | Arquivo privado, proprietário operacional, tipo, tamanho e permissão de leitura. |
| Auditoria e Idempotência | Operação, ator, escopo, antes/depois apropriados, chave, payload e resultado. |

Uma devolução tem várias linhas e pode ter vários recebimentos. Um palete pode conter itens de várias devoluções; uma linha de devolução pode estar distribuída em vários paletes. A relação passa pelos segmentos e posições de estoque, e não por um único campo de NF no cabeçalho do palete.

Manter produto/lote/origem/condição separados ao transferir itens. Uma origem pendente pode ser vinculada após validação, por evento que preserve sua identificação anterior. O aplicativo nunca substitui silenciosamente um vínculo já comprovado.

## Estados

| Objeto | Estados propostos |
| --- | --- |
| Conferência do palete | Não conferido; parcial; contado aguardando validação; reconciliado. |
| Condição do material | Saudável; avariado; em avaliação. |
| Liberação do material | Pendente; bloqueado; liberado. |
| Fluxo do palete | Em estoque; reservado; expedido; vazio arquivado. |
| Sessão de contagem | Rascunho; em andamento; concluída; cancelada; reconciliada. |
| Claim | Em análise; busca em andamento; candidato localizado; validação pendente; regularizado; perda confirmada; encerrado conforme regra documentada. |
| Janela | Rascunho; confirmada; preparação; encerrada; cancelada. |
| Reserva | Ativa; liberada; consumida; cancelada. |

A apresentação do mapa pode resumir esses estados em rótulos simples, mas deve mostrar os detalhes ao abrir o palete. “Conferido” não significa “liberado”; “localizado” não significa “claim regularizado”; “reservado” não significa “expedido”.

## Identificação e números

R01. Identificação do palete é permanente e única no escopo. Localização pode mudar; um ID arquivado não é reutilizado para outro palete. Usar o código existente da operação quando houver. O QR interno não se apresenta como um SSCC oficial.

R02. NF, chave fiscal, SKU, código de barras, lote e referências externas são strings. Preservar zeros à esquerda. Normalizar espaços/formato somente com regra explícita e rastreável.

R03. Dinheiro usa decimal exato ou centavos inteiros conforme contrato. Quantidades e volume usam decimal exato com escala permitida por unidade; produtos medidos em peças exigem inteiros. Não somar caixas e peças sem conversão conhecida.

R04. Desconhecido é nulo/pendente, nunca zero presumido. Um palete pode existir sem conteúdo confirmado. Separar idade calculada a partir da entrada comprovada da idade baseada apenas no documento.

## Conferência e reconciliação

R05. A sessão tem escopo declarado: completa ou parcial. Contagem parcial não comprova a ausência de todos os itens restantes nem libera o palete inteiro.

R06. Registrar responsável, horário, palete, itens, unidades, condição e referências disponíveis. A quantidade esperada pode ficar oculta na contagem inicial para reduzir influência; a comparação ocorre depois.

R07. Enquanto houver uma conferência ativa, bloquear movimentos conflitantes daquele palete ou rejeitar a conclusão se a versão mudou. A escolha deve ser implementada e documentada. Não bloquear a praça inteira.

R08. Contagem produz observações. Reconciliação cria o evento de ajuste ou saldo inicial identificado, com motivo, responsável e evidência. Divergências relevantes são recontadas segundo o limite operacional registrado; não inventar um limite financeiro do cliente.

R09. Guardar as observações originais. Corrigir um registro concluído por nova versão/evento referenciando o anterior, sem apagar a evidência.

## Movimentações e reservas

R10. Transferir de origem para destino preserva produto, lote, origem e condição. Baixa, entrada, evento e auditoria acontecem juntos. Falha em qualquer parte reverte tudo.

R11. O saldo disponível é o saldo validado menos reservas ativas. Reserva não baixa o estoque físico. Movimentos e ajustes que afetem reserva exigem tratativa explícita.

R12. Nunca permitir quantidade negativa, transferência maior que o disponível, destino inválido ou mistura entre clientes/unidades. Limites físicos das posições são configurados quando conhecidos.

R13. Repetição do pedido não repete o movimento. Aplicar chave de idempotência e versionamento. Clique duplo, resposta de rede perdida e duas pessoas operando ao mesmo tempo são cenários obrigatórios de teste.

R14. Um evento concluído não é apagado. Uma correção autorizada usa evento compensatório validado contra o estado atual; não restaurar um saldo que já foi consumido por outra operação.

## Claims

R15. Buscar um SKU encontra candidatos, não prova origem. Validar devolução/recebimento, quantidade, lote quando aplicável, condição e histórico. Se só houver registro documental, mostrar isso explicitamente.

R16. Faltas sem evidência suficiente de recebimento exigem também investigação documental. Avaria exige avaliação e destino conforme o processo; localizar material avariado não elimina o motivo do claim.

R17. Quantidade recuperada validada não excede a quantidade em análise. A mesma quantidade/segmento já vinculada a uma tratativa válida não deve ser utilizada para justificar duas recuperações incompatíveis.

R18. A situação final é registrada por perfil autorizado, com comprovação. Claims já finalizados financeiramente exigem a tratativa prevista pela área responsável; o aplicativo não cancela ou estorna uma cobrança sozinho.

R19. Valor estimado é apresentado separadamente do valor evitado confirmado. Registrar fonte do valor, quantidade considerada, validador e evidência da regularização. Sem confirmação, o indicador permanece estimado/em análise.

R20. Prioridade considera prazo, valor e pistas de localização. A ordem inicial é proposta de trabalho; pesos e datas devem ser configurados conforme regras reais. Prazo não informado não recebe data inventada.

## Janelas e expedição

R21. As quatro janelas mensais são configuráveis. Cada uma guarda suas datas, capacidade e unidade definidas pelo cliente, além de critérios de material aceito. Capacidade desconhecida não significa capacidade ilimitada.

R22. Não reservar material sem liberação ou fora dos critérios da janela. Quantidade disponível e capacidade residual são verificadas na mesma operação. Não converter m³, caixas, paletes ou peças com fator presumido.

R23. Caso a janela tenha várias restrições, todas devem ser respeitadas. Valores medidos e documentos da carga ficam em uma fotografia do momento da reserva/expedição, para não mudarem retroativamente quando o cadastro for alterado.

R24. Confirmar expedição exige registro do material efetivamente enviado e documentos previstos no processo. Baixa de saldo, consumo de reservas/capacidade e evento acontecem juntos e uma única vez.

R25. Reserva pode ser cancelada antes da saída e libera saldo/capacidade. Material já expedido não retorna ao estoque por cancelar uma tela. Recusa ou retorno físico gera novo recebimento e referência à expedição original.

R26. FIFO orienta material elegível, dentro das regras do cliente e de condição/liberação. Expedir material bloqueado apenas por ser antigo não é permitido.

## Importações e relatórios

R27. Importar exige prévia, mapeamento de colunas, unidade, erros por linha e decisão explícita de confirmação. Linhas inválidas não são gravadas silenciosamente. Documentos repetidos são detectados por hash e chave de negócio, inclusive em arquivo diferente.

R28. Importação documental não altera saldo físico. Importação de inventário inicial é uma operação distinta, autorizada e reconciliada. Corrigir uma importação já utilizada preserva os vínculos e eventos dependentes.

R29. Quantidade de paletes reduzida por consolidação é diferente de volume expedido. Estoque final depende do inicial, das entradas e das saídas reais. Medir sempre na mesma unidade e informar alterações de base.

R30. Todas as consultas, anexos e exportações verificam escopo e permissão no servidor. O histórico de domínio e a auditoria fazem parte da operação, não apenas dos logs de depuração.
