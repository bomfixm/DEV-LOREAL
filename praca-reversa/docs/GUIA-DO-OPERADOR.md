# Guia do operador — Praça Reversa

<!-- Gerado por `npm run guia:gerar` a partir de apps/web/src/features/ajuda/conteudo.ts. Não edite à mão: altere o conteúdo e gere de novo. -->

Este guia é o mesmo conteúdo da **Ajuda** do aplicativo (botão **Ajuda** no topo da tela). Para aprender a primeira tarefa — encontrar um produto e saber em qual palete e endereço ele está — use **Começar aqui** na Ajuda: o tutorial aponta os botões reais da tela, passo a passo, sem gravar nada.

Os exemplos são fictícios. Na demonstração (selo **Demonstração** no topo), nada é estoque real. Cada passo diz **o que fazer**, **onde** e **o que deve aparecer**; os passos marcados com um perfil só aparecem para quem tem essa permissão.

Instruções de servidor, banco, migrações e backup ficam no material técnico (`docs/IMPLANTACAO.md`), não aqui.

## Tarefas

### Consultar palete ou produto

**Para quê:** Achar em qual palete e endereço um produto está e entender o que se sabe do conteúdo.

**Quem faz:** Todos os perfis consultam.

| # | O que fazer | Onde | O que deve aparecer |
| --- | --- | --- | --- |
| 1 | Toque em "Buscar conteúdo" (computador) ou na aba "Busca" (celular). | Mapa da praça: painel da esquerda no computador; barra de abas embaixo no celular. | O campo "Buscar". |
| 2 | Digite ou leia o SKU, código de barras, lote, devolução, NF ou o código do palete (3 caracteres ou mais). | Campo "Buscar". | Resultados em cartões, cada um com a base da informação: saldo validado, observado em conferência, declarado no palete ou documento importado. |
| 3 | Escolha o cartão certo e toque em "Ver no mapa". | Cartão do resultado. | O palete centralizado no mapa e a janela do palete aberta sobre a página (tocar num palete do mapa também a abre). |
| 4 | Leia o número do palete e o endereço no topo da janela, o resumo (volumes e notas/minutas) e a tabela de conteúdo. "Fechar" ou Esc fecha a janela. | Janela do palete. | Tipo, número, remetente, CNPJ (quando houver) e volumes de cada documento; "Informações adicionais" e "Detalhes completos e outras ações" ficam recolhidos. |
| 5 | No celular, a aba "Lista" mostra todos os paletes; o filtro aceita o código ou o link do QR. No computador, "Ler QR" fica no canto do mapa. | Mapa da praça. | Lista agrupada por fileira (celular) ou o leitor da câmera; escolher um palete abre a janela dele. |

**Atenção:**

- ID identifica o palete. Endereço mostra onde ele está agora: o endereço pode mudar, o ID não.
- O mesmo SKU pode aparecer em vários paletes e origens. Encontrar o SKU é uma pista, não prova de origem.
- Conteúdo pendente significa que ainda falta informação; não significa que o palete está vazio.

**Sem permissão:** Sem acesso à unidade/cliente, fale com o administrador.

### Cadastrar palete

**Para quê:** Registrar que um palete existe, com identificação própria e endereço, mesmo sem saber o conteúdo.

**Quem faz:** Operador e supervisor de estoque cadastram. Consulta e analista de claims só consultam.

| # | O que fazer | Onde | O que deve aparecer |
| --- | --- | --- | --- |
| 1 | Toque em "Receber palete" (topo do mapa), em "Novo palete" (lista, no celular) ou em "Cadastrar palete" no Menu. *(perfil autorizado)* | Mapa da praça ou Menu. | O formulário de cadastro. |
| 2 | Em "Número do palete", escolha "Próximo número da sequência da praça" ou "Usar o número que já está no palete". *(perfil autorizado)* | Formulário de cadastro. | O código precisa ser único; código de palete arquivado nunca é reutilizado. |
| 3 | Em "Destino na praça", informe o código de uma posição livre ou marque "Sem posição (localização pendente)". *(perfil autorizado)* | Formulário de cadastro. | Só posições livres e disponíveis do layout ativo são aceitas. |
| 4 | Se já houver itens de documento em mãos, preencha "Itens de documento (opcional)". Campos vazios ficam pendentes. *(perfil autorizado)* | Formulário de cadastro. | Linhas declaradas: elas não comprovam presença física e não criam saldo. |
| 5 | Toque em "Cadastrar palete"; depois, em "Importar bipagem" (documentos e volumes lidos) e "Imprimir etiqueta". *(perfil autorizado)* | Formulário e detalhe do palete. | O palete no mapa como "Não conferido" (conteúdo desconhecido) e a etiqueta com QR para colar no palete. |

**Atenção:**

- Cadastrar não é conferir: o conteúdo fica desconhecido até a conferência.
- Cadastro feito por engano é arquivado pelo supervisor ("Arquivar cadastro feito por engano…"), nunca apagado.

**Sem permissão:** Seu perfil não cadastra paletes: anote o código e o endereço e peça ao operador ou ao supervisor de estoque.

### Importar a bipagem no palete

**Para quê:** Trazer as notas e os volumes lidos na bipagem de UM palete, sem digitar nota por nota, e escolher no mapa onde o palete está.

**Quem faz:** Operador e supervisor de estoque importam. Os demais perfis consultam o conteúdo do palete.

| # | O que fazer | Onde | O que deve aparecer |
| --- | --- | --- | --- |
| 1 | Abra "Recebimento" e toque em "Importar a bipagem e escolher a posição no mapa" (ou, num palete aberto, em "Importar bipagem"). *(perfil autorizado)* | Menu "Recebimento" ou a janela do palete. | A página "Importar bipagem". |
| 2 | Escolha o Excel exportado da bipagem (planilha "Etiquetas", um palete por arquivo) e toque em "Ler arquivo". Não é preciso ajustar abas, linhas nem colunas. *(perfil autorizado)* | Página "Importar bipagem", em "Arquivo da bipagem". | As notas a importar, os volumes e o total; linhas sem volumes e pendências à parte. CNPJ e Última Leitura ficam em "Mais informações". |
| 3 | No mapa, toque numa posição vazia (palete novo) ou no palete onde o material está (acrescentar). *(perfil autorizado)* | "Onde está este palete?". | Posição vazia: "Palete novo", com o número "gerado ao confirmar". Palete existente: "Este palete já contém notas. Deseja acrescentar os conteúdos desta importação?", com o que ele já tem e o que vai receber. |
| 4 | Se aparecer "Notas repetidas", escolha para cada uma: "Revalidar" (mantém a que já está; esta linha não entra) ou "Importar separadamente" (nova entrada; as duas contam). Depois, confirme. *(perfil autorizado)* | "Revisar e confirmar". | O número do palete criado (ou o palete que recebeu as notas) e o resumo do que foi importado. |

**Atenção:**

- Lidos é a quantidade usada (não Leituras). Linha com Lidos = 0 aparece no resumo e não entra no palete. Linha com erro impede a importação: exporte de novo no padrão.
- O número do palete novo é gerado pelo sistema na confirmação (série do piso; nunca reutiliza número). Nada é gravado antes de confirmar.
- Mesmo número de nota com outro remetente ou CNPJ é outra nota. Nada é somado nem substituído: Revalidar não muda a quantidade antiga e não é conferência do palete.
- Delivery, SKU e validade são complementos opcionais, preenchidos depois. Importar não libera, não reserva e não expede.

**Sem permissão:** Seu perfil não importa a bipagem: entregue o arquivo ao operador ou ao supervisor de estoque.

### Conferir material

**Para quê:** Contar o que está fisicamente no palete, com produto, unidade e quantidade confirmados.

**Quem faz:** Operador e supervisor de estoque conferem. Validar (reconciliar) é só do supervisor de estoque.

| # | O que fazer | Onde | O que deve aparecer |
| --- | --- | --- | --- |
| 1 | Abra o palete e, na seção "Conferência", toque em "Iniciar conferência". Escolha "Completa" (todo o palete) ou "Parcial" (só uma parte, descrita). *(perfil autorizado)* | Detalhe do palete. | A tela da conferência, com responsável, horário e "rascunho salvo no servidor". |
| 2 | Escolha o modo: "Quantidade manual", "Uma unidade por leitura" ou "Uma embalagem por leitura". *(perfil autorizado)* | Painel de entrada da conferência. | A explicação do modo (ex.: cada leitura de caixa soma 1 CX convertida pelo fator aprovado). |
| 3 | Leia o código com o leitor (ou digite e Enter), ou toque em "Ler código (câmera)" e depois "Usar este código". *(perfil autorizado)* | Painel de entrada. | Produto, unidade e fator para você confirmar antes de somar. Fator desconhecido ou código não cadastrado não convertem. |
| 4 | Confirme a soma. Cada entrada é gravada na hora; tire foto em "Fotos e documentos" se precisar. *(perfil autorizado)* | Linhas da conferência. | A linha com quantidade e unidade. Sem conexão a entrada fica "não enviado" e concluir fica bloqueado. |
| 5 | Toque em "Concluir conferência…" (ou "Salvar rascunho e sair" para continuar depois). *(perfil autorizado)* | Fim da tela da conferência. | A comparação declarado × observado × validado. A contagem completa fica aguardando validação; a parcial registra só o que foi contado. |

**Atenção:**

- Quantidade declarada veio do documento; observada veio da contagem; saldo validado foi conferido e aprovado para controle do estoque.
- Parcial não prova que o resto está vazio. Duas leituras do mesmo código = duas peças.
- Uma caixa só vira peças com fator aprovado (ex.: 1 CX = 12 UN). Sem fator, registre a pendência.

**Sem permissão:** Seu perfil não registra conferências: peça ao operador ou ao supervisor de estoque.

### Tratar divergência

**Para quê:** Quando o contado difere do documento ou do saldo, recontar e decidir com responsável autorizado.

**Quem faz:** Operador e supervisor pedem recontagem. Só o supervisor de estoque reconcilia.

| # | O que fazer | Onde | O que deve aparecer |
| --- | --- | --- | --- |
| 1 | Leia a comparação depois de concluir: declarado (documento), observado (contagem) e validado (saldo atual). | Tela da conferência concluída. | A diferença aparece só quando as duas quantidades existem (ex.: declarado 12, observado 9 = diferença 3). |
| 2 | Se a contagem parece errada, toque em "Solicitar recontagem…" com a justificativa. *(perfil autorizado)* | Tela da conferência. | Uma nova conferência vinculada; a original fica guardada. |
| 3 | Supervisor: toque em "Reconciliar conferência…", revise a prévia dos efeitos, escreva a justificativa e confirme. *(perfil autorizado)* | Tela da conferência completa concluída. | O saldo validado do palete (saldo inicial ou ajuste), com evento e auditoria; o palete passa a "Reconciliado". |

**Atenção:**

- Reconciliar não libera o material, não fecha claim e não confirma expedição.
- Nada é apagado: a contagem original, a recontagem e o ajuste ficam no histórico do palete.

**Sem permissão:** Seu perfil não trata divergências: avise o supervisor de estoque, com o código do palete.

### Mover palete ou transferir produtos

**Para quê:** Mudar o endereço do palete ou passar produtos de um palete para outro.

**Quem faz:** Operador e supervisor de estoque. Corrigir um movimento é só do supervisor.

| # | O que fazer | Onde | O que deve aparecer |
| --- | --- | --- | --- |
| 1 | Para mudar o endereço: "Mover palete", escolha a posição de destino (código ou posição livre), informe o motivo e confirme a posição física. *(perfil autorizado)* | Detalhe do palete, seção "Movimentações". | "Movimentação registrada": o ID, o código, o QR e o conteúdo não mudam; só o endereço. |
| 2 | Para passar produtos: "Transferir produtos", escolha o item, a quantidade (até o disponível), o palete de destino e o motivo. *(perfil autorizado)* | Detalhe do palete, seção "Movimentações". | A prévia com antes/depois dos dois paletes; o total não muda. Depois, "Confirmar transferência". |
| 3 | Consolidação: depois de transferir todo o conteúdo, use "Retirar palete vazio…" no palete que ficou vazio. *(perfil autorizado)* | Detalhe do palete esvaziado, seção "Movimentações". | O palete sai da posição e fica arquivado; nenhuma unidade sai do estoque. |
| 4 | Para conferir o que aconteceu: "Histórico de localização e conteúdo". | Detalhe do palete. | Cada movimento com autor, horário de Brasília, motivo, origem e destino. |

**Atenção:**

- Mover muda o endereço; transferir muda o conteúdo entre paletes. Arrastar o mapa só mexe na visão.
- Quantidade reservada para uma janela não é transferida. Com conferência em andamento, mover e transferir ficam bloqueados.
- Juntar dois paletes reduz posições ocupadas, mas não é saída de estoque.

**Sem permissão:** Seu perfil não movimenta: peça ao operador ou ao supervisor de estoque.

### Investigar claim

**Para quê:** Procurar o produto de um claim, registrar evidência e pedir a validação do responsável.

**Quem faz:** Analista de claims cadastra, investiga, registra evidência e valida a recuperação. Resultado financeiro: só quem recebeu a aprovação financeira. Supervisor só consulta.

| # | O que fazer | Onde | O que deve aparecer |
| --- | --- | --- | --- |
| 1 | Abra o caso em "Claims" (Menu) e vá até a linha do produto. | Lista de claims → caso. | Totais separados: em análise, recuperação validada, estimado (não é valor evitado), evitado e perda confirmados. |
| 2 | Veja os candidatos: cada um mostra a base (saldo validado, observado, declarado, documento) e os selos de produto, lote, origem e condição. Toque em "Investigar". *(perfil autorizado)* | Seção de candidatos da linha. | O candidato registrado como em investigação; "Ver no mapa" mostra o palete e "Voltar ao claim" retorna. |
| 3 | Com o material conferido, toque em "Registrar evidência (material conferido)" e depois em "Solicitar validação" com a quantidade. *(perfil autorizado)* | Candidato de saldo validado. | A evidência aguardando validação. |
| 4 | Responsável: "Validar recuperação física" (com justificativa) ou "Rejeitar". *(perfil autorizado)* | Evidência com validação solicitada. | A quantidade recuperada validada na linha; o material continua no estoque, vinculado ao claim. |
| 5 | Quem tem aprovação financeira: "Registrar resultado da regularização" com valor, moeda, fonte e comprovante. *(perfil autorizado)* | Seção de resultados do caso. | O valor evitado ou a perda confirmados, separados da estimativa. |

**Atenção:**

- Encontrar o mesmo produto é uma pista. A origem e a quantidade precisam ser comprovadas para tratar o claim.
- Candidato de outra devolução fica bloqueado; material avariado localizado não encerra um claim de avaria.
- Valor estimado nunca aparece como valor evitado; recuperação parcial não confirma o valor inteiro.

**Sem permissão:** Seu perfil não trata claims. Se encontrar material suspeito, informe o analista de claims com o código do palete.

### Preparar uma janela de devolução

**Para quê:** Separar material liberado para uma janela do cliente, dentro da capacidade autorizada.

**Quem faz:** Supervisor de estoque cadastra a janela, libera material e reserva. Operador registra a preparação. Os demais consultam.

| # | O que fazer | Onde | O que deve aparecer |
| --- | --- | --- | --- |
| 1 | Libere o material: no palete, seção "Liberação para expedição", "Liberar quantidade para expedição" com critério e motivo. *(perfil autorizado)* | Detalhe do palete. | A parte liberada daquele material. Conferência e claim não liberam nada sozinhos. |
| 2 | Em "Janelas de devolução" (Menu), abra a janela (ou "Nova janela") e use "Confirmar janela" com a autorização registrada. *(perfil autorizado)* | Janelas de devolução. | A janela confirmada com limites por métrica; limite vazio é pendente, nunca ilimitado. |
| 3 | Na aba "Material elegível e pendente", marque as linhas e quantidades, toque em "Revisar medidas e capacidade" e depois "Confirmar reserva". *(perfil autorizado)* | Detalhe da janela. | A reserva com reservado, expedido e restante por métrica. A reserva não baixa o estoque. |
| 4 | Na reserva, use "Imprimir" (lista de preparação) e, depois de separar, "Registrar separação/preparação". *(perfil autorizado)* | Tela da reserva. | A lista com palete, endereço atual, produto, lote e quantidade; diferenças ficam registradas. |

**Atenção:**

- Reservar separa o material para a janela. O estoque é baixado quando a saída é confirmada.
- Caixas, peso, volume e paletes não são convertidos por fator genérico: cada restrição da janela precisa caber.
- Material bloqueado ou fora dos critérios fica na fila de pendências, com o motivo.

**Sem permissão:** Seu perfil só consulta janelas: peça ao supervisor de estoque.

### Localizar o que o cliente pediu

**Para quê:** Ler a lista que o cliente devolveu, achar os paletes/NFs pedidos e seus endereços atuais, ver as pendências e montar a proposta para a janela.

**Quem faz:** Supervisor de estoque importa o inventário e a seleção, resolve ambiguidades e reserva. Operador e analista de claims consultam e exportam a lista de separação e as pendências.

| # | O que fazer | Onde | O que deve aparecer |
| --- | --- | --- | --- |
| 1 | Escolha o inventário de referência: em "Inventários de referência" veja se o inventário enviado ao cliente já está registrado; se não, use "Importar inventário conferido" com o arquivo definitivo. *(perfil autorizado)* | Menu → "Seleção do cliente". | A fotografia com NF × palete × endereço × volumes, a data e a fonte da conferência. Volumes não viram peças nem saldo validado. |
| 2 | Toque em "Importar seleção", envie o arquivo do cliente, escolha a aba, as colunas, a modalidade (lista ou marcação), o pedido e o significado da coluna NF; depois "Gerar prévia" e "Confirmar importação". *(perfil autorizado)* | Seleção do cliente → Nova importação. | A prévia com cada linha: solicitação, fora da seleção (marcação) ou a decidir. NF sem palete é pendência, não erro: a lista é registrada assim mesmo. |
| 3 | Abra a seleção ("Ver a conciliação da seleção" ou toque nela na lista) e use os filtros por situação. | Tela da seleção: resumo, filtros e tabela. | Cada linha com paletes, endereços atuais, bases das quantidades, situação e próximo passo. Linhas, documentos e paletes são contagens separadas. |
| 4 | Toque no número da linha para ver todos os paletes; em cada palete, "Ver no mapa" ou "Abrir palete". | Detalhe da linha e mapa da seleção. | O palete centralizado no mapa; palete sem endereço fica só na lista, sem posição inventada. |
| 5 | Para identificação ambígua, escolha o candidato certo em "Resolver a identificação", informe o motivo e toque em "Registrar resolução". *(perfil autorizado)* | Detalhe da linha. | A linha recalculada com a resolução, o autor e o motivo (pode ser anulada depois, sem apagar o histórico). |
| 6 | Baixe o "Relatório de pendências" e a "Lista de separação (proposta, por palete/endereço)". *(perfil autorizado)* | Seção "Exportar (CSV)" da seleção. | CSV com horário, inventário, versão da seleção e filtros. A lista é proposta: não diz que o material está reservado. |
| 7 | Marque as linhas elegíveis, escolha a janela em "Preparar para a janela", toque em "Montar proposta (nada é gravado)", revise e só então "Confirmar reserva". *(perfil autorizado)* | Seção "Preparar para a janela" da seleção. | A proposta com o que entra, o que fica de fora e a verificação da janela. A reserva é tudo ou nada e não baixa estoque. |

**Atenção:**

- Localizado não é liberado: um palete pode estar localizado e ainda bloqueado, reservado ou sem liberação para saída.
- NF sem palete, não encontrado ou quantidade a menos não são perda nem claim: são falta de registro até a investigação.
- Endereço do inventário é o informado naquela data; o atual vem dos movimentos. "15 - A120" e "13 - A120" são posições diferentes.
- Importar ou conciliar não reserva, não libera e não muda estoque. Só "Confirmar reserva" reserva, e a saída continua na expedição.

**Sem permissão:** Seu perfil não consulta seleções do cliente: peça ao supervisor de estoque a lista de separação exportada.

### Confirmar saída (expedição)

**Para quê:** Registrar o que realmente saiu, uma única vez, e liberar o que não foi.

**Quem faz:** Só o supervisor de estoque confirma a expedição e registra retorno.

| # | O que fazer | Onde | O que deve aparecer |
| --- | --- | --- | --- |
| 1 | Na reserva, informe data/hora da saída, responsável, quantidade enviada por linha e os documentos exigidos. *(perfil autorizado)* | Tela da reserva, "Confirmar expedição física". | Se enviar menos que o reservado, a tela mostra "Quantidade enviada e restante a liberar" e pede confirmação. |
| 2 | Marque "O palete físico inteiro sai" só quando nada ficar no palete; depois "Confirmar expedição". *(perfil autorizado)* | Tela da reserva. | A expedição com baixa única; repetir a confirmação nunca baixa duas vezes. |
| 3 | Para reserva que não vai sair: "Cancelar reserva" com o motivo (antes da saída). *(perfil autorizado)* | Tela da reserva. | Estoque disponível e capacidade de volta; nada muda no físico. |
| 4 | Se o material voltar: "Registrar retorno físico" na expedição. *(perfil autorizado)* | Tela da expedição. | Uma declaração no palete que recebeu; o saldo volta só depois da conferência e reconciliação desse palete. |

**Atenção:**

- Não há botão de desfazer expedição; "Corrigir informação" muda só observações e documentos.
- Aviso documental de retorno não repõe saldo.

**Sem permissão:** Seu perfil não confirma saídas: entregue a lista preparada ao supervisor de estoque.

### Usar a câmera e o aplicativo instalado

**Para quê:** Ler QR e códigos de barras pela câmera e usar o sistema como aplicativo, quando o aparelho permitir.

**Quem faz:** Todos os perfis. A câmera só ajuda a ler: quem confirma é você.

| # | O que fazer | Onde | O que deve aparecer |
| --- | --- | --- | --- |
| 1 | Abra "Aplicativo e aparelho" (Menu ou tela de login) e veja origem segura, câmera e instalação deste aparelho. | Aplicativo e aparelho. | "Instalar aplicativo" só quando o navegador oferece; nos outros casos, as instruções do navegador. |
| 2 | Toque em "Ler código (câmera)" e aponte para o código. Permita a câmera se o navegador pedir. | Lista de paletes do mapa ou painel de entrada da conferência. | Uma leitura por vez: o resultado fica parado até "Ler próximo", "Usar este código" ou "Fechar". |
| 3 | QR do palete: toque em "Abrir palete". Código de produto: confira SKU, embalagem e fator. | Resultado da leitura. | O palete aberto (com seu login e escopo) ou o produto; código desconhecido não cria nada. |
| 4 | Sem câmera, sem permissão ou em endereço sem HTTPS: use o leitor que digita como teclado ou digite o código. | Mesmo campo de código. | O mesmo resultado da leitura pela câmera. |

**Atenção:**

- A câmera não aprova nada: nenhuma quantidade é somada sem a sua confirmação.
- Zeros à esquerda são preservados; uma caixa nunca vira peça sem fator aprovado.

**Sem permissão:** A câmera não depende de perfil, mas cada ação continua exigindo a permissão dela.

### Resolver uma interrupção

**Para quê:** Saber o que fazer quando a rede cai, a resposta não volta ou a sessão expira, sem registrar duas vezes.

**Quem faz:** Todos os perfis.

| # | O que fazer | Onde | O que deve aparecer |
| --- | --- | --- | --- |
| 1 | Olhe o selo no topo: "Servidor disponível", "Sem conexão", "Servidor sem resposta", "Servidor indisponível" ou "Banco indisponível". | Topo da tela. | A faixa vermelha avisa que os dados mostrados são da última consulta; nada é confirmado sem o servidor. |
| 2 | Se aparecer "Em confirmação", toque em "Verificar agora" ou em "Repetir (mesma chave)". | Painel "Em confirmação". | "Confirmada pelo servidor", "não registrada" ou "recusada". Repetir com a mesma chave nunca grava duas vezes. |
| 3 | Na conferência, entradas "não enviado" ou "em confirmação": "Verificar no servidor", "Reenviar (mesma chave)" ou "Enviar agora". | Linhas da conferência. | A entrada confirmada sem duplicar. Se outra pessoa mudou o rascunho, revise e toque em "Revisei". |
| 4 | "Sessão expirada: entre novamente." Entre com o mesmo usuário. | Tela de login. | O que não foi enviado continua na aba para você revisar. Em produção nada fica guardado no navegador ao fechar a aba. |

**Atenção:**

- Não há fila automática: gravação sem servidor não acontece depois sozinha.
- Antes de "Atualizar" para uma versão nova, resolva o que estiver em confirmação ou não enviado.

**Sem permissão:** As verificações não exigem permissão extra; repetir uma ação exige a permissão dela.

### Acompanhar o painel e registrar a separação por volumes

**Para quê:** Ver estoque, localização, reconferência e janelas num só lugar e registrar quantos volumes foram separados e expedidos em cada janela.

**Quem faz:** Todos os perfis da DHL consultam; o operador e o supervisor registram a separação; só o supervisor registra a meta e confirma a expedição.

| # | O que fazer | Onde | O que deve aparecer |
| --- | --- | --- | --- |
| 1 | Abra "Painel da operação": numa tela só estão os quatro cartões ("Paletes na praça", "Volumes registrados", "Sem endereço", "Precisa conferir"), a janela selecionada, a situação da praça, os volumes por rua e as prioridades. Toque num cartão para ver a lista com os mesmos filtros. | Menu lateral, "Painel". Janela e período na linha de filtros, no topo; "Atualizar" aplica o período e busca os números de novo. | A hora da consulta ao lado de "Atualizar"; a lista mostra uma linha por NF × palete e o total igual ao do cartão. |
| 2 | Para as definições e os números secundários (informado × conferido, sem volume, identificação incompleta, posições desativadas, claims), toque em "Detalhes". Para a lista completa, use "Ver todas" (prioridades), "Tabela" (ruas) ou "Comparar" (janelas do período). | Linha de filtros e canto de cada painel. | Uma janela sobre o painel; Esc ou "Fechar" volta ao resumo. |
| 3 | Na janela, informe os volumes pedidos pelo cliente e a referência e toque em "Registrar meta". *(perfil autorizado)* | Janela no painel, seção "Meta do cliente". | A meta vigente e as anteriores no histórico; as porcentagens aparecem só com meta maior que zero. |
| 4 | Procure o palete ou a NF em "Buscar conteúdo", informe os volumes efetivamente separados e toque em "Registrar separação". *(perfil autorizado)* | Janela no painel, seção "Registrar separação". | O volume entra em "Separados aguardando saída"; o restante da NF continua no estoque e não pode ser separado de novo além da base. |
| 5 | Quando a carga sair, informe os volumes e toque em "Confirmar expedição". *(perfil autorizado)* | Janela no painel, seção "Separados nesta janela". | Os volumes saem de separados e entram em expedidos na mesma operação; o palete reinicia o prazo de reconferência. |
| 6 | Registro errado: use "Estornar (corrigir registro)" com os volumes e o motivo. *(perfil autorizado)* | Janela no painel, seção "Registros da janela". | Um estorno ligado ao registro original; nada é apagado e os totais não contam duas vezes. |

**Atenção:**

- Janela em volumes: Falta separar = Solicitado − Separado − Expedido; Falta expedir = Solicitado − Expedido (nunca abaixo de zero). Preparação = (Separado + Expedido) ÷ Solicitado; Expedição = Expedido ÷ Solicitado. Sem meta, não há porcentagem.
- Selecionar a NF ou reservar não é separar: só a separação registrada conta, e só a saída confirmada conta como expedida.
- Volumes são a contagem operacional do inventário/pedido (não é m³, caixa nem unidade de produto). Sem volume informado, registre a contagem na conferência de volumes antes de separar.
- Sem endereço confirmado não quer dizer posição livre: o painel separa ocupadas, livres confirmadas e ocupação desconhecida.

**Sem permissão:** Sem permissão de registro, o painel é só consulta: peça ao supervisor de estoque para registrar a meta ou confirmar a saída.

### Consultar o painel do cliente

**Para quê:** Acompanhar o estoque da operação, o andamento das janelas e o histórico, sem alterar nada.

**Quem faz:** Perfil de consulta do cliente (e o supervisor, para conferir o que o cliente vê).

| # | O que fazer | Onde | O que deve aparecer |
| --- | --- | --- | --- |
| 1 | Confira os quatro cartões: "Paletes", "Volumes registrados", "Solicitado" e "Expedido" da janela escolhida. | "Painel do cliente" (uma tela, com a janela na linha de filtros). | Os números de agora, com a hora da consulta; volume desconhecido aparece como "Não informado", nunca como zero. |
| 2 | Veja a janela selecionada (solicitado, separado, expedido e o que falta, com as barras de preparação e expedição) e as etapas das NFs selecionadas; "Ver seleção" abre a lista de NFs. | Painéis "Janela selecionada" e "Etapas da seleção". | Cada NF como localizada, em separação, separada ou expedida; sem meta, não há porcentagem. |
| 3 | Em "Estoque e histórico" (ou "Ver tudo" no histórico recente), use os filtros (janela, rua, palete, NF, Delivery, remetente) e a aba "Histórico". | Botão "Estoque e histórico" na linha de filtros. | A mesma consulta fica no endereço da página; "Voltar ao painel" volta ao resumo. |
| 4 | Para levar os dados, toque em "Exportar estoque (CSV)" ou "Exportar histórico (CSV)". | "Estoque e histórico". | Um arquivo só com os campos da tela, códigos como texto e proteção contra fórmulas. |

**Atenção:**

- "Entrada registrada no sistema" é a data do cadastro, não a chegada física.
- Conferência registrada não é liberação nem saída; a seleção do cliente não marca a NF como separada.

**Sem permissão:** O painel do cliente só aparece para o acesso do cliente; a equipe DHL usa o painel da operação.

## Glossário

| Termo | O que é | Exemplo (fictício) |
| --- | --- | --- |
| Palete | Unidade física identificada por um código e um ID permanente. | PAL-DEMO-001 (fictício). |
| ID permanente | Identificação que nunca muda nem é reutilizada; é o que vai no QR da etiqueta. | Mesmo depois de mover o palete, o ID continua o mesmo. |
| Endereço (posição) | Onde o palete está agora no mapa. Pode mudar a cada movimento. | F01-P01; "Localização pendente" quando ainda não tem posição. |
| SKU | Código do produto no cadastro. É texto: zeros à esquerda contam. | DEMO-101 (fictício). |
| Lote | Lote de fabricação. Desconhecido fica pendente, nunca inventado. | LOTE-DEMO-A (fictício). |
| Declarado | Quantidade que veio de um documento (nota, devolução). Não prova que está no palete. | Documento diz 12 peças. |
| Observado | Quantidade contada numa conferência, ainda não validada. | A contagem achou 9 peças. |
| Saldo validado | Quantidade conferida e aprovada na reconciliação; é a base dos movimentos e da expedição. | Saldo validado 9 UN depois da reconciliação. |
| Conteúdo pendente / desconhecido | Ainda falta informação. Não é zero e não quer dizer palete vazio. | Palete "Não conferido". |
| Conferência | Contagem física do palete, completa ou parcial, com rascunho gravado no servidor. | Conferência parcial da camada de cima. |
| Reconciliação | Decisão do supervisor que transforma a contagem completa em saldo validado, com justificativa. | Ajuste de −3 UN depois da recontagem. |
| Claim | Caso de falta, avaria ou divergência documental cobrado ou em análise. | Claim de falta de 12 UN de DEMO-101 (fictício). |
| Candidato | Palete onde o produto do claim pode estar. É pista, não recuperação. | Mesmo SKU em outra devolução: candidato bloqueado. |
| Liberação | Autorização para a parte de um material entrar numa janela de expedição. | Liberar 8 UN de um palete misto, não o palete inteiro. |
| Janela | Período de devolução autorizado pelo cliente, com capacidade por métrica. | Janela com limite de 20 UN e 3 paletes (fictício). |
| Reserva | Separa material e capacidade para uma janela. Não baixa o estoque. | Reserva de 8 UN; o saldo continua 12 até a saída. |
| Expedição | Registro da saída física confirmada: baixa o saldo uma única vez. | Saíram 6 UN; 2 UN reservadas voltaram a ficar disponíveis. |
| Volumes da janela | Meta pedida pelo cliente, separados aguardando saída e expedidos, contados em volumes (não em m³, caixas ou unidades de produto). | Meta 8.000; expedidos 2.000; separados aguardando 4.500; preparados 6.500 (81,25%) — fictício. |
| Consolidação | Juntar o conteúdo de paletes num só. Reduz posições ocupadas, mas não é saída de estoque. | Dois paletes viram um; o total de peças continua igual. |
| Inventário de referência | Fotografia do que foi informado ao cliente: NF, palete, endereço e volumes, com data e fonte. | INV-000001 conferido em 28/09 (fictício). |
| Seleção do cliente | Lista do material que o cliente escolheu para devolver, com pedido e versão. | Pedido PED-DEMO-1, versão 1 (fictício). |
| Localizado | O vínculo foi resolvido: há palete e endereço atual conhecidos. Não quer dizer que pode sair. | NF 5550001 nos paletes 9101 e 9102 (fictício). |
| Sem vínculo (NF sem palete) | A NF existe nos registros, mas nenhum palete físico está ligado a ela. Investigar e vincular. | NF 5550099 sem palete: pendência, não perda. |
| Validado × liberado para saída | Validado é o saldo conferido e reconciliado; liberado é a parte autorizada para uma janela. | 10 UN validadas, 6 UN liberadas: só 6 entram na proposta. |

## Dúvidas frequentes

**O palete aparece no mapa, mas o conteúdo diz "Não conferido". Ele está vazio?**

Não se sabe. Conteúdo desconhecido não é zero: é preciso conferir o palete para saber.

**Achei o SKU do claim num palete. Posso dar o claim como resolvido?**

Não. Encontrar o SKU é pista. Registre a evidência, peça a validação e espere o responsável validar a origem e a quantidade.

**Por que o mesmo produto aparece em vários cartões na busca?**

Cada cartão é uma base diferente (saldo validado, contagem, documento) ou outro palete/lote/origem. As bases não se somam.

**A tela mostra "Sem conexão". Posso continuar trabalhando?**

Você pode consultar o que já está na tela, mas nada é confirmado. Gravações exigem o servidor e não ficam numa fila automática.

**Toquei duas vezes em confirmar. Registrou duas vezes?**

Não. Cada ação usa uma chave única: repetir o mesmo pedido devolve o resultado original sem gravar de novo.

**Reservei material para a janela. O estoque baixou?**

Não. A reserva separa; a baixa acontece só na confirmação da expedição, uma única vez.

**Juntei dois paletes. Isso conta como saída?**

Não. Consolidar reduz posições ocupadas; as peças continuam no estoque. Saída é só expedição confirmada.

**Não vejo um botão que o guia cita.**

O botão depende do seu perfil e da situação do registro. O guia diz quem executa cada passo; sem permissão, peça a quem tem.

**A seleção mostra "Localizado". Já posso expedir?**

Ainda não. Localizado diz onde está; a saída exige saldo validado, liberado e disponível, reserva na janela e a confirmação da expedição.

**A NF da seleção está "sem palete". O material sumiu?**

Não se sabe. É falta de vínculo nos registros: investigue e vincule pela conferência ou pelo inventário. Não é perda nem claim.

**Os indicadores mostram ocupação "provisória". Por quê?**

O desenho da praça ainda não foi validado contra a praça real. A ocupação usa as posições cadastradas e pode mudar no ajuste do layout.

## O que esta versão ainda não faz

- Trabalho sem conexão com gravação posterior (não há fila automática de gravações).
- Ajuste definitivo do desenho da praça (geometria, fileiras e endereços oficiais): pendente para depois do levantamento físico.
- Medição de produtividade e tempo poupado: não há registro de esforço; nada é estimado como economia.
- Integração com sistemas da DHL ou da L’Oréal, notificações externas, RFID e leitura automática de documentos.
- Desfazer uma expedição confirmada (retorno usa um novo recebimento ligado à saída original).
- Restaurar backup pela interface (é procedimento técnico, fora do aplicativo).
