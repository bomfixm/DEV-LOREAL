# Verificação do aplicativo

## Verificações técnicas

Depois de criar o código, registrar e executar os scripts reais de typecheck, lint, build e teste. Usar Vitest para regras e API, Fastify inject quando adequado e Playwright para fluxos da interface. Transações e concorrência devem ser verificadas contra PostgreSQL; um banco em memória não comprova comportamento concorrente do ambiente proposto.

## Cenários obrigatórios

| ID | Cenário | Resultado esperado |
| --- | --- | --- |
| T01 | Dois cadastros com o mesmo ID de palete. | Segundo cadastro rejeitado; primeiro preservado. |
| T02 | Palete não conferido no mapa e na busca. | Conteúdo físico desconhecido, sem zero ou saldo inventado. |
| T03 | Conferência parcial de um palete com vários itens. | Somente o escopo contado é confirmado; o restante continua pendente. |
| T04 | Contagem e movimentação concorrentes. | Bloqueio de conflito ou conclusão recusada por versão desatualizada. |
| T05 | Documento declara 12 peças; são encontradas 9. | Diferença 3 registrada; saldo validado exige reconciliação pertinente. |
| T06 | Caixa com fator cadastrado 12 e leitura de uma caixa. | Unidade/fator visíveis; conversão exata para 12 peças. |
| T07 | Código de embalagem sem fator conhecido. | Conversão rejeitada; usuário recebe campo/pendência para resolver. |
| T08 | Transferir 8 de um saldo disponível 10. | Origem 2, destino +8 e evento único; origem/lote/condição preservados. |
| T09 | Erro entre baixa e entrada de transferência. | Transação inteira revertida; nenhum evento parcial. |
| T10 | Pedidos simultâneos de 8 e 6 com saldo 10. | Total confirmado não excede 10; saldo não negativo. |
| T11 | Reenviar o mesmo pedido após resposta de rede perdida. | Resultado original retornado; movimento não duplicado. |
| T12 | Reutilizar chave de idempotência com outro payload. | Solicitação rejeitada sem alteração. |
| T13 | Mover quantidade já reservada. | Disponível respeitado; reserva exige tratativa explícita. |
| T14 | Importar arquivo repetido ou linha repetida em outro arquivo. | Duplicidade reportada; nenhuma duplicação do registro. |
| T15 | Importar SKU/código de barras com zeros iniciais. | Texto preservado. |
| T16 | Importar NF/devolução de 100 unidades. | Registro documental criado; saldo físico não cresce sem reconciliação. |
| T17 | Encontrar mesmo SKU de outra devolução para um claim. | Candidato identificado; caso não regularizado automaticamente. |
| T18 | Encontrar material avariado em caso de avaria. | Evidência registrada; motivo do claim continua em avaliação. |
| T19 | Vincular a mesma quantidade a recuperações incompatíveis. | Vínculo duplicado bloqueado; quantidade validada não excedida. |
| T20 | Valor estimado sem decisão de regularização. | Não aparece como prejuízo evitado confirmado. |
| T21 | Duas reservas concorrentes na última capacidade da janela. | Limite respeitado; tentativa incompatível rejeitada. |
| T22 | Capacidade em m³ e volume do material desconhecido. | Sem reserva automática por conversão presumida. |
| T23 | Expedir material bloqueado ou sem liberação. | Operação rejeitada no servidor. |
| T24 | Confirmar a mesma expedição duas vezes. | Uma baixa e um consumo de reserva/capacidade. |
| T25 | Cancelar reserva antes da saída. | Estoque disponível e capacidade liberados, sem alterar físico. |
| T26 | Cancelar uma tela de material já expedido. | Nenhuma reinserção automática no estoque. |
| T27 | Operador chama diretamente uma API de aprovação restrita. | Negado no servidor; não basta ocultar o botão. |
| T28 | Usuário de outra unidade acessa palete/anexo/exportação. | Acesso negado. |
| T29 | Consolidar dois paletes num único palete. | Posições ocupadas caem; unidades em estoque permanecem iguais. |
| T30 | Ficar sem conexão durante uma confirmação. | Estado claro; retry idempotente; não mostrar sucesso sem confirmação. |
| T31 | Restaurar banco e anexos do backup de teste. | Registros, eventos, vínculos e acesso recuperados; invariantes conferidos. |
| T32 | Instalar/abrir/atualizar nos equipamentos do piloto. | Fluxos reais disponíveis; rascunho não perdido em atualização. |
| T33 | Arrastar a visão, ampliar/reduzir e ajustar visão geral. | Endereços, quantidades e histórico de estoque permanecem iguais; limites de navegação permitem recuperar a praça. |
| T34 | Arrastar começando sobre palete, soltar e cancelar um gesto. | Arraste não seleciona nem movimenta o palete; o mapa continua utilizável após cancelamento. |
| T35 | Pinça, zoom próximo ao cursor e redimensionamento. | Centro/âncora seguem o gesto conforme os limites; layout e identificação permanecem consistentes. |
| T36 | Escolher pela lista e buscar palete/SKU em ruas distantes. | Palete correto centralizado; vários resultados consultáveis; quantidade desconhecida não vira zero. |
| T37 | Navegar com volumetria representativa nos equipamentos da operação. | Tempos e fluidez medidos; critérios acordados para o piloto atendidos; rótulos legíveis e seleção acessível nos níveis de zoom. |

## Interface

Verificar computador, tablet e celular, teclado, toque, rótulos, foco, contraste e estados de erro/vazio. Selecionar paletes repetidamente atualiza o conteúdo correto. Retornar de detalhe mantém contexto. A alternativa em lista continua funcional. Leitor de teclado e entrada manual são testados com dados de embalagem diferentes.

## Piloto físico

Escolher o grupo de paletes, tirar fotografia inicial dos dados e acompanhar pelo menos uma conferência completa, uma parcial, uma divergência, uma transferência e uma consulta por produto. Incluir claim/janela/expedição quando os módulos fizerem parte do piloto. Comparar registros com o físico e validar os resultados com o responsável operacional.

## Critério de pronto

Tipos, lint e build aprovados; cenários da etapa aprovados; dados persistidos; permissões testadas; versão/confirmações de rede tratadas; material sem origem continua pendente; relatórios conciliados; backup restaurado; responsáveis e procedimento registrados. Pendências materiais devem permanecer explícitas em `ESTADO.md`.
