import type { Permissao } from '@praca-reversa/contracts';
import { TITULOS_TAREFA, type IdTarefa } from './tarefas';

/**
 * Conteúdo da ajuda (etapa 10): guias curtos por tarefa, glossário e dúvidas
 * frequentes, escritos a partir dos nomes reais dos botões e campos desta
 * versão. A mesma fonte gera a central de ajuda, a ajuda de cada tela, a
 * versão impressa e o docs/GUIA-DO-OPERADOR.md (npm run guia:gerar; um teste
 * confere que o arquivo está igual). Exemplos são fictícios.
 */

export interface PassoGuia {
  /** O que fazer. */
  fazer: string;
  /** Onde fazer (tela, seção ou botão). */
  onde: string;
  /** O que deve aparecer depois. */
  aparece: string;
  /** Permissão necessária para executar este passo; sem ela o passo é só leitura. */
  permissao?: Permissao;
}

export interface GuiaTarefa {
  id: IdTarefa;
  titulo: string;
  /** Para que serve, numa frase. */
  objetivo: string;
  /** Quem executa (perfis desta versão) e quem só consulta. */
  quem: string;
  /** Basta uma destas permissões para executar a tarefa. */
  executam: readonly Permissao[];
  /** O que fazer sem permissão (nunca contornar). */
  semPermissao: string;
  passos: readonly PassoGuia[];
  atencao: readonly string[];
}

export const GUIAS: readonly GuiaTarefa[] = [
  {
    id: 'consultar',
    titulo: TITULOS_TAREFA.consultar,
    objetivo: 'Achar em qual palete e endereço um produto está e entender o que se sabe do conteúdo.',
    quem: 'Todos os perfis consultam.',
    executam: ['palete.consultar'],
    semPermissao: 'Sem acesso à unidade/cliente, fale com o administrador.',
    passos: [
      {
        fazer: 'Toque em "Buscar conteúdo" (computador) ou na aba "Busca" (celular).',
        onde: 'Mapa da praça: painel da esquerda no computador; barra de abas embaixo no celular.',
        aparece: 'O campo "Buscar".',
      },
      {
        fazer: 'Digite ou leia o SKU, código de barras, lote, devolução, NF ou o código do palete (3 caracteres ou mais).',
        onde: 'Campo "Buscar".',
        aparece: 'Resultados em cartões, cada um com a base da informação: saldo validado, observado em conferência, declarado no palete ou documento importado.',
      },
      {
        fazer: 'Escolha o cartão certo e toque em "Ver no mapa".',
        onde: 'Cartão do resultado.',
        aparece: 'O palete centralizado no mapa. No computador o detalhe abre ao lado; no celular toque em "Ver conteúdo".',
      },
      {
        fazer: 'Leia o código do palete, a "Posição" e o "ID permanente", e depois a seção "Conteúdo".',
        onde: 'Detalhe do palete.',
        aparece: 'Endereço atual (ou "Localização pendente") e o conteúdo com a base de cada quantidade.',
      },
      {
        fazer: 'Para ver todos os paletes, use "Paletes" (computador) ou a aba "Lista" (celular). O filtro aceita o código ou o link do QR.',
        onde: 'Mapa da praça.',
        aparece: 'Lista agrupada por fileira; tocar num palete centraliza no mapa.',
      },
    ],
    atencao: [
      'ID identifica o palete. Endereço mostra onde ele está agora: o endereço pode mudar, o ID não.',
      'O mesmo SKU pode aparecer em vários paletes e origens. Encontrar o SKU é uma pista, não prova de origem.',
      'Conteúdo pendente significa que ainda falta informação; não significa que o palete está vazio.',
    ],
  },
  {
    id: 'cadastrar',
    titulo: TITULOS_TAREFA.cadastrar,
    objetivo: 'Registrar que um palete existe, com identificação própria e endereço, mesmo sem saber o conteúdo.',
    quem: 'Operador e supervisor de estoque cadastram. Consulta e analista de claims só consultam.',
    executam: ['palete.cadastrar'],
    semPermissao: 'Seu perfil não cadastra paletes: anote o código e o endereço e peça ao operador ou ao supervisor de estoque.',
    passos: [
      {
        fazer: 'Toque em "Novo palete" (lista de paletes) ou em "Cadastrar palete" no Menu.',
        onde: 'Mapa da praça ou Menu.',
        aparece: 'O formulário de cadastro.',
        permissao: 'palete.cadastrar',
      },
      {
        fazer: 'Em "Código do palete", use a identificação que já está no palete ou escolha "Gerar código interno".',
        onde: 'Formulário de cadastro.',
        aparece: 'O código precisa ser único; código de palete arquivado nunca é reutilizado.',
        permissao: 'palete.cadastrar',
      },
      {
        fazer: 'Em "Localização inicial", informe o código de uma posição livre ou marque "Sem posição (localização pendente)".',
        onde: 'Formulário de cadastro.',
        aparece: 'Só posições livres e disponíveis do layout ativo são aceitas.',
        permissao: 'palete.cadastrar',
      },
      {
        fazer: 'Se houver documento, preencha "Declarado em documento (opcional)". Campos vazios ficam pendentes.',
        onde: 'Formulário de cadastro.',
        aparece: 'Linhas declaradas: elas não comprovam presença física e não criam saldo.',
        permissao: 'palete.cadastrar',
      },
      {
        fazer: 'Toque em "Cadastrar palete" e depois em "Imprimir etiqueta".',
        onde: 'Formulário e detalhe do palete.',
        aparece: 'O palete no mapa como "Não conferido" (conteúdo desconhecido) e a etiqueta com QR para colar no palete.',
        permissao: 'palete.cadastrar',
      },
    ],
    atencao: ['Cadastrar não é conferir: o conteúdo fica desconhecido até a conferência.', 'Cadastro feito por engano é arquivado pelo supervisor ("Arquivar cadastro feito por engano…"), nunca apagado.'],
  },
  {
    id: 'conferir',
    titulo: TITULOS_TAREFA.conferir,
    objetivo: 'Contar o que está fisicamente no palete, com produto, unidade e quantidade confirmados.',
    quem: 'Operador e supervisor de estoque conferem. Validar (reconciliar) é só do supervisor de estoque.',
    executam: ['conferencia.registrar'],
    semPermissao: 'Seu perfil não registra conferências: peça ao operador ou ao supervisor de estoque.',
    passos: [
      {
        fazer: 'Abra o palete e, na seção "Conferência", toque em "Iniciar conferência". Escolha "Completa" (todo o palete) ou "Parcial" (só uma parte, descrita).',
        onde: 'Detalhe do palete.',
        aparece: 'A tela da conferência, com responsável, horário e "rascunho salvo no servidor".',
        permissao: 'conferencia.registrar',
      },
      {
        fazer: 'Escolha o modo: "Quantidade manual", "Uma unidade por leitura" ou "Uma embalagem por leitura".',
        onde: 'Painel de entrada da conferência.',
        aparece: 'A explicação do modo (ex.: cada leitura de caixa soma 1 CX convertida pelo fator aprovado).',
        permissao: 'conferencia.registrar',
      },
      {
        fazer: 'Leia o código com o leitor (ou digite e Enter), ou toque em "Ler código (câmera)" e depois "Usar este código".',
        onde: 'Painel de entrada.',
        aparece: 'Produto, unidade e fator para você confirmar antes de somar. Fator desconhecido ou código não cadastrado não convertem.',
        permissao: 'conferencia.registrar',
      },
      {
        fazer: 'Confirme a soma. Cada entrada é gravada na hora; tire foto em "Fotos e documentos" se precisar.',
        onde: 'Linhas da conferência.',
        aparece: 'A linha com quantidade e unidade. Sem conexão a entrada fica "não enviado" e concluir fica bloqueado.',
        permissao: 'conferencia.registrar',
      },
      {
        fazer: 'Toque em "Concluir conferência…" (ou "Salvar rascunho e sair" para continuar depois).',
        onde: 'Fim da tela da conferência.',
        aparece: 'A comparação declarado × observado × validado. A contagem completa fica aguardando validação; a parcial registra só o que foi contado.',
        permissao: 'conferencia.registrar',
      },
    ],
    atencao: [
      'Quantidade declarada veio do documento; observada veio da contagem; saldo validado foi conferido e aprovado para controle do estoque.',
      'Parcial não prova que o resto está vazio. Duas leituras do mesmo código = duas peças.',
      'Uma caixa só vira peças com fator aprovado (ex.: 1 CX = 12 UN). Sem fator, registre a pendência.',
    ],
  },
  {
    id: 'divergencia',
    titulo: TITULOS_TAREFA.divergencia,
    objetivo: 'Quando o contado difere do documento ou do saldo, recontar e decidir com responsável autorizado.',
    quem: 'Operador e supervisor pedem recontagem. Só o supervisor de estoque reconcilia.',
    executam: ['conferencia.registrar', 'conferencia.reconciliar'],
    semPermissao: 'Seu perfil não trata divergências: avise o supervisor de estoque, com o código do palete.',
    passos: [
      {
        fazer: 'Leia a comparação depois de concluir: declarado (documento), observado (contagem) e validado (saldo atual).',
        onde: 'Tela da conferência concluída.',
        aparece: 'A diferença aparece só quando as duas quantidades existem (ex.: declarado 12, observado 9 = diferença 3).',
      },
      {
        fazer: 'Se a contagem parece errada, toque em "Solicitar recontagem…" com a justificativa.',
        onde: 'Tela da conferência.',
        aparece: 'Uma nova conferência vinculada; a original fica guardada.',
        permissao: 'conferencia.registrar',
      },
      {
        fazer: 'Supervisor: toque em "Reconciliar conferência…", revise a prévia dos efeitos, escreva a justificativa e confirme.',
        onde: 'Tela da conferência completa concluída.',
        aparece: 'O saldo validado do palete (saldo inicial ou ajuste), com evento e auditoria; o palete passa a "Reconciliado".',
        permissao: 'conferencia.reconciliar',
      },
    ],
    atencao: [
      'Reconciliar não libera o material, não fecha claim e não confirma expedição.',
      'Nada é apagado: a contagem original, a recontagem e o ajuste ficam no histórico do palete.',
    ],
  },
  {
    id: 'mover',
    titulo: TITULOS_TAREFA.mover,
    objetivo: 'Mudar o endereço do palete ou passar produtos de um palete para outro.',
    quem: 'Operador e supervisor de estoque. Corrigir um movimento é só do supervisor.',
    executam: ['movimento.registrar'],
    semPermissao: 'Seu perfil não movimenta: peça ao operador ou ao supervisor de estoque.',
    passos: [
      {
        fazer: 'Para mudar o endereço: "Mover palete", escolha a posição de destino (código ou posição livre), informe o motivo e confirme a posição física.',
        onde: 'Detalhe do palete, seção "Movimentações".',
        aparece: '"Movimentação registrada": o ID, o código, o QR e o conteúdo não mudam; só o endereço.',
        permissao: 'movimento.registrar',
      },
      {
        fazer: 'Para passar produtos: "Transferir produtos", escolha o item, a quantidade (até o disponível), o palete de destino e o motivo.',
        onde: 'Detalhe do palete, seção "Movimentações".',
        aparece: 'A prévia com antes/depois dos dois paletes; o total não muda. Depois, "Confirmar transferência".',
        permissao: 'movimento.registrar',
      },
      {
        fazer: 'Consolidação: depois de transferir todo o conteúdo, use "Retirar palete vazio…" no palete que ficou vazio.',
        onde: 'Detalhe do palete esvaziado, seção "Movimentações".',
        aparece: 'O palete sai da posição e fica arquivado; nenhuma unidade sai do estoque.',
        permissao: 'movimento.registrar',
      },
      {
        fazer: 'Para conferir o que aconteceu: "Histórico de localização e conteúdo".',
        onde: 'Detalhe do palete.',
        aparece: 'Cada movimento com autor, horário de Brasília, motivo, origem e destino.',
      },
    ],
    atencao: [
      'Mover muda o endereço; transferir muda o conteúdo entre paletes. Arrastar o mapa só mexe na visão.',
      'Quantidade reservada para uma janela não é transferida. Com conferência em andamento, mover e transferir ficam bloqueados.',
      'Juntar dois paletes reduz posições ocupadas, mas não é saída de estoque.',
    ],
  },
  {
    id: 'claim',
    titulo: TITULOS_TAREFA.claim,
    objetivo: 'Procurar o produto de um claim, registrar evidência e pedir a validação do responsável.',
    quem: 'Analista de claims cadastra, investiga, registra evidência e valida a recuperação. Resultado financeiro: só quem recebeu a aprovação financeira. Supervisor só consulta.',
    executam: ['claim.tratar', 'claim.validar'],
    semPermissao: 'Seu perfil não trata claims. Se encontrar material suspeito, informe o analista de claims com o código do palete.',
    passos: [
      {
        fazer: 'Abra o caso em "Claims" (Menu) e vá até a linha do produto.',
        onde: 'Lista de claims → caso.',
        aparece: 'Totais separados: em análise, recuperação validada, estimado (não é valor evitado), evitado e perda confirmados.',
      },
      {
        fazer: 'Veja os candidatos: cada um mostra a base (saldo validado, observado, declarado, documento) e os selos de produto, lote, origem e condição. Toque em "Investigar".',
        onde: 'Seção de candidatos da linha.',
        aparece: 'O candidato registrado como em investigação; "Ver no mapa" mostra o palete e "Voltar ao claim" retorna.',
        permissao: 'claim.tratar',
      },
      {
        fazer: 'Com o material conferido, toque em "Registrar evidência (material conferido)" e depois em "Solicitar validação" com a quantidade.',
        onde: 'Candidato de saldo validado.',
        aparece: 'A evidência aguardando validação.',
        permissao: 'claim.tratar',
      },
      {
        fazer: 'Responsável: "Validar recuperação física" (com justificativa) ou "Rejeitar".',
        onde: 'Evidência com validação solicitada.',
        aparece: 'A quantidade recuperada validada na linha; o material continua no estoque, vinculado ao claim.',
        permissao: 'claim.validar',
      },
      {
        fazer: 'Quem tem aprovação financeira: "Registrar resultado da regularização" com valor, moeda, fonte e comprovante.',
        onde: 'Seção de resultados do caso.',
        aparece: 'O valor evitado ou a perda confirmados, separados da estimativa.',
        permissao: 'claim.aprovar_financeiro',
      },
    ],
    atencao: [
      'Encontrar o mesmo produto é uma pista. A origem e a quantidade precisam ser comprovadas para tratar o claim.',
      'Candidato de outra devolução fica bloqueado; material avariado localizado não encerra um claim de avaria.',
      'Valor estimado nunca aparece como valor evitado; recuperação parcial não confirma o valor inteiro.',
    ],
  },
  {
    id: 'janela',
    titulo: TITULOS_TAREFA.janela,
    objetivo: 'Separar material liberado para uma janela do cliente, dentro da capacidade autorizada.',
    quem: 'Supervisor de estoque cadastra a janela, libera material e reserva. Operador registra a preparação. Os demais consultam.',
    executam: ['janela.gerenciar', 'janela.reservar', 'material.liberar', 'expedicao.preparar'],
    semPermissao: 'Seu perfil só consulta janelas: peça ao supervisor de estoque.',
    passos: [
      {
        fazer: 'Libere o material: no palete, seção "Liberação para expedição", "Liberar quantidade para expedição" com critério e motivo.',
        onde: 'Detalhe do palete.',
        aparece: 'A parte liberada daquele material. Conferência e claim não liberam nada sozinhos.',
        permissao: 'material.liberar',
      },
      {
        fazer: 'Em "Janelas de devolução" (Menu), abra a janela (ou "Nova janela") e use "Confirmar janela" com a autorização registrada.',
        onde: 'Janelas de devolução.',
        aparece: 'A janela confirmada com limites por métrica; limite vazio é pendente, nunca ilimitado.',
        permissao: 'janela.gerenciar',
      },
      {
        fazer: 'Na aba "Material elegível e pendente", marque as linhas e quantidades, toque em "Revisar medidas e capacidade" e depois "Confirmar reserva".',
        onde: 'Detalhe da janela.',
        aparece: 'A reserva com reservado, expedido e restante por métrica. A reserva não baixa o estoque.',
        permissao: 'janela.reservar',
      },
      {
        fazer: 'Na reserva, use "Imprimir" (lista de preparação) e, depois de separar, "Registrar separação/preparação".',
        onde: 'Tela da reserva.',
        aparece: 'A lista com palete, endereço atual, produto, lote e quantidade; diferenças ficam registradas.',
        permissao: 'expedicao.preparar',
      },
    ],
    atencao: [
      'Reservar separa o material para a janela. O estoque é baixado quando a saída é confirmada.',
      'Caixas, peso, volume e paletes não são convertidos por fator genérico: cada restrição da janela precisa caber.',
      'Material bloqueado ou fora dos critérios fica na fila de pendências, com o motivo.',
    ],
  },
  {
    id: 'selecao',
    titulo: TITULOS_TAREFA.selecao,
    objetivo: 'Ler a lista que o cliente devolveu, achar os paletes/NFs pedidos e seus endereços atuais, ver as pendências e montar a proposta para a janela.',
    quem: 'Supervisor de estoque importa o inventário e a seleção, resolve ambiguidades e reserva. Operador e analista de claims consultam e exportam a lista de separação e as pendências.',
    executam: ['selecao.consultar'],
    semPermissao: 'Seu perfil não consulta seleções do cliente: peça ao supervisor de estoque a lista de separação exportada.',
    passos: [
      {
        fazer: 'Escolha o inventário de referência: em "Inventários de referência" veja se o inventário enviado ao cliente já está registrado; se não, use "Importar inventário conferido" com o arquivo definitivo.',
        onde: 'Menu → "Seleção do cliente".',
        aparece: 'A fotografia com NF × palete × endereço × volumes, a data e a fonte da conferência. Volumes não viram peças nem saldo validado.',
        permissao: 'inventario.importar',
      },
      {
        fazer: 'Toque em "Importar seleção", envie o arquivo do cliente, escolha a aba, as colunas, a modalidade (lista ou marcação), o pedido e o significado da coluna NF; depois "Gerar prévia" e "Confirmar importação".',
        onde: 'Seleção do cliente → Nova importação.',
        aparece: 'A prévia com cada linha: solicitação, fora da seleção (marcação) ou a decidir. NF sem palete é pendência, não erro: a lista é registrada assim mesmo.',
        permissao: 'selecao.importar',
      },
      {
        fazer: 'Abra a seleção ("Ver a conciliação da seleção" ou toque nela na lista) e use os filtros por situação.',
        onde: 'Tela da seleção: resumo, filtros e tabela.',
        aparece: 'Cada linha com paletes, endereços atuais, bases das quantidades, situação e próximo passo. Linhas, documentos e paletes são contagens separadas.',
      },
      {
        fazer: 'Toque no número da linha para ver todos os paletes; em cada palete, "Ver no mapa" ou "Abrir palete".',
        onde: 'Detalhe da linha e mapa da seleção.',
        aparece: 'O palete centralizado no mapa; palete sem endereço fica só na lista, sem posição inventada.',
      },
      {
        fazer: 'Para identificação ambígua, escolha o candidato certo em "Resolver a identificação", informe o motivo e toque em "Registrar resolução".',
        onde: 'Detalhe da linha.',
        aparece: 'A linha recalculada com a resolução, o autor e o motivo (pode ser anulada depois, sem apagar o histórico).',
        permissao: 'selecao.importar',
      },
      {
        fazer: 'Baixe o "Relatório de pendências" e a "Lista de separação (proposta, por palete/endereço)".',
        onde: 'Seção "Exportar (CSV)" da seleção.',
        aparece: 'CSV com horário, inventário, versão da seleção e filtros. A lista é proposta: não diz que o material está reservado.',
        permissao: 'selecao.exportar',
      },
      {
        fazer: 'Marque as linhas elegíveis, escolha a janela em "Preparar para a janela", toque em "Montar proposta (nada é gravado)", revise e só então "Confirmar reserva".',
        onde: 'Seção "Preparar para a janela" da seleção.',
        aparece: 'A proposta com o que entra, o que fica de fora e a verificação da janela. A reserva é tudo ou nada e não baixa estoque.',
        permissao: 'janela.reservar',
      },
    ],
    atencao: [
      'Localizado não é liberado: um palete pode estar localizado e ainda bloqueado, reservado ou sem liberação para saída.',
      'NF sem palete, não encontrado ou quantidade a menos não são perda nem claim: são falta de registro até a investigação.',
      'Endereço do inventário é o informado naquela data; o atual vem dos movimentos. "15 - A120" e "13 - A120" são posições diferentes.',
      'Importar ou conciliar não reserva, não libera e não muda estoque. Só "Confirmar reserva" reserva, e a saída continua na expedição.',
    ],
  },
  {
    id: 'saida',
    titulo: TITULOS_TAREFA.saida,
    objetivo: 'Registrar o que realmente saiu, uma única vez, e liberar o que não foi.',
    quem: 'Só o supervisor de estoque confirma a expedição e registra retorno.',
    executam: ['expedicao.confirmar'],
    semPermissao: 'Seu perfil não confirma saídas: entregue a lista preparada ao supervisor de estoque.',
    passos: [
      {
        fazer: 'Na reserva, informe data/hora da saída, responsável, quantidade enviada por linha e os documentos exigidos.',
        onde: 'Tela da reserva, "Confirmar expedição física".',
        aparece: 'Se enviar menos que o reservado, a tela mostra "Quantidade enviada e restante a liberar" e pede confirmação.',
        permissao: 'expedicao.confirmar',
      },
      {
        fazer: 'Marque "O palete físico inteiro sai" só quando nada ficar no palete; depois "Confirmar expedição".',
        onde: 'Tela da reserva.',
        aparece: 'A expedição com baixa única; repetir a confirmação nunca baixa duas vezes.',
        permissao: 'expedicao.confirmar',
      },
      {
        fazer: 'Para reserva que não vai sair: "Cancelar reserva" com o motivo (antes da saída).',
        onde: 'Tela da reserva.',
        aparece: 'Estoque disponível e capacidade de volta; nada muda no físico.',
        permissao: 'janela.reservar',
      },
      {
        fazer: 'Se o material voltar: "Registrar retorno físico" na expedição.',
        onde: 'Tela da expedição.',
        aparece: 'Uma declaração no palete que recebeu; o saldo volta só depois da conferência e reconciliação desse palete.',
        permissao: 'expedicao.retorno',
      },
    ],
    atencao: ['Não há botão de desfazer expedição; "Corrigir informação" muda só observações e documentos.', 'Aviso documental de retorno não repõe saldo.'],
  },
  {
    id: 'camera',
    titulo: TITULOS_TAREFA.camera,
    objetivo: 'Ler QR e códigos de barras pela câmera e usar o sistema como aplicativo, quando o aparelho permitir.',
    quem: 'Todos os perfis. A câmera só ajuda a ler: quem confirma é você.',
    executam: [],
    semPermissao: 'A câmera não depende de perfil, mas cada ação continua exigindo a permissão dela.',
    passos: [
      {
        fazer: 'Abra "Aplicativo e aparelho" (Menu ou tela de login) e veja origem segura, câmera e instalação deste aparelho.',
        onde: 'Aplicativo e aparelho.',
        aparece: '"Instalar aplicativo" só quando o navegador oferece; nos outros casos, as instruções do navegador.',
      },
      {
        fazer: 'Toque em "Ler código (câmera)" e aponte para o código. Permita a câmera se o navegador pedir.',
        onde: 'Lista de paletes do mapa ou painel de entrada da conferência.',
        aparece: 'Uma leitura por vez: o resultado fica parado até "Ler próximo", "Usar este código" ou "Fechar".',
      },
      {
        fazer: 'QR do palete: toque em "Abrir palete". Código de produto: confira SKU, embalagem e fator.',
        onde: 'Resultado da leitura.',
        aparece: 'O palete aberto (com seu login e escopo) ou o produto; código desconhecido não cria nada.',
      },
      {
        fazer: 'Sem câmera, sem permissão ou em endereço sem HTTPS: use o leitor que digita como teclado ou digite o código.',
        onde: 'Mesmo campo de código.',
        aparece: 'O mesmo resultado da leitura pela câmera.',
      },
    ],
    atencao: ['A câmera não aprova nada: nenhuma quantidade é somada sem a sua confirmação.', 'Zeros à esquerda são preservados; uma caixa nunca vira peça sem fator aprovado.'],
  },
  {
    id: 'interrupcao',
    titulo: TITULOS_TAREFA.interrupcao,
    objetivo: 'Saber o que fazer quando a rede cai, a resposta não volta ou a sessão expira, sem registrar duas vezes.',
    quem: 'Todos os perfis.',
    executam: [],
    semPermissao: 'As verificações não exigem permissão extra; repetir uma ação exige a permissão dela.',
    passos: [
      {
        fazer: 'Olhe o selo no topo: "Servidor disponível", "Sem conexão", "Servidor sem resposta", "Servidor indisponível" ou "Banco indisponível".',
        onde: 'Topo da tela.',
        aparece: 'A faixa vermelha avisa que os dados mostrados são da última consulta; nada é confirmado sem o servidor.',
      },
      {
        fazer: 'Se aparecer "Em confirmação", toque em "Verificar agora" ou em "Repetir (mesma chave)".',
        onde: 'Painel "Em confirmação".',
        aparece: '"Confirmada pelo servidor", "não registrada" ou "recusada". Repetir com a mesma chave nunca grava duas vezes.',
      },
      {
        fazer: 'Na conferência, entradas "não enviado" ou "em confirmação": "Verificar no servidor", "Reenviar (mesma chave)" ou "Enviar agora".',
        onde: 'Linhas da conferência.',
        aparece: 'A entrada confirmada sem duplicar. Se outra pessoa mudou o rascunho, revise e toque em "Revisei".',
      },
      {
        fazer: '"Sessão expirada: entre novamente." Entre com o mesmo usuário.',
        onde: 'Tela de login.',
        aparece: 'O que não foi enviado continua na aba para você revisar. Em produção nada fica guardado no navegador ao fechar a aba.',
      },
    ],
    atencao: [
      'Não há fila automática: gravação sem servidor não acontece depois sozinha.',
      'Antes de "Atualizar" para uma versão nova, resolva o que estiver em confirmação ou não enviado.',
    ],
  },
];

export interface TermoGlossario {
  termo: string;
  explicacao: string;
  exemplo: string;
}

export const GLOSSARIO: readonly TermoGlossario[] = [
  { termo: 'Palete', explicacao: 'Unidade física identificada por um código e um ID permanente.', exemplo: 'PAL-DEMO-001 (fictício).' },
  { termo: 'ID permanente', explicacao: 'Identificação que nunca muda nem é reutilizada; é o que vai no QR da etiqueta.', exemplo: 'Mesmo depois de mover o palete, o ID continua o mesmo.' },
  { termo: 'Endereço (posição)', explicacao: 'Onde o palete está agora no mapa. Pode mudar a cada movimento.', exemplo: 'F01-P01; "Localização pendente" quando ainda não tem posição.' },
  { termo: 'SKU', explicacao: 'Código do produto no cadastro. É texto: zeros à esquerda contam.', exemplo: 'DEMO-101 (fictício).' },
  { termo: 'Lote', explicacao: 'Lote de fabricação. Desconhecido fica pendente, nunca inventado.', exemplo: 'LOTE-DEMO-A (fictício).' },
  { termo: 'Declarado', explicacao: 'Quantidade que veio de um documento (nota, devolução). Não prova que está no palete.', exemplo: 'Documento diz 12 peças.' },
  { termo: 'Observado', explicacao: 'Quantidade contada numa conferência, ainda não validada.', exemplo: 'A contagem achou 9 peças.' },
  { termo: 'Saldo validado', explicacao: 'Quantidade conferida e aprovada na reconciliação; é a base dos movimentos e da expedição.', exemplo: 'Saldo validado 9 UN depois da reconciliação.' },
  { termo: 'Conteúdo pendente / desconhecido', explicacao: 'Ainda falta informação. Não é zero e não quer dizer palete vazio.', exemplo: 'Palete "Não conferido".' },
  { termo: 'Conferência', explicacao: 'Contagem física do palete, completa ou parcial, com rascunho gravado no servidor.', exemplo: 'Conferência parcial da camada de cima.' },
  { termo: 'Reconciliação', explicacao: 'Decisão do supervisor que transforma a contagem completa em saldo validado, com justificativa.', exemplo: 'Ajuste de −3 UN depois da recontagem.' },
  { termo: 'Claim', explicacao: 'Caso de falta, avaria ou divergência documental cobrado ou em análise.', exemplo: 'Claim de falta de 12 UN de DEMO-101 (fictício).' },
  { termo: 'Candidato', explicacao: 'Palete onde o produto do claim pode estar. É pista, não recuperação.', exemplo: 'Mesmo SKU em outra devolução: candidato bloqueado.' },
  { termo: 'Liberação', explicacao: 'Autorização para a parte de um material entrar numa janela de expedição.', exemplo: 'Liberar 8 UN de um palete misto, não o palete inteiro.' },
  { termo: 'Janela', explicacao: 'Período de devolução autorizado pelo cliente, com capacidade por métrica.', exemplo: 'Janela com limite de 20 UN e 3 paletes (fictício).' },
  { termo: 'Reserva', explicacao: 'Separa material e capacidade para uma janela. Não baixa o estoque.', exemplo: 'Reserva de 8 UN; o saldo continua 12 até a saída.' },
  { termo: 'Expedição', explicacao: 'Registro da saída física confirmada: baixa o saldo uma única vez.', exemplo: 'Saíram 6 UN; 2 UN reservadas voltaram a ficar disponíveis.' },
  { termo: 'Consolidação', explicacao: 'Juntar o conteúdo de paletes num só. Reduz posições ocupadas, mas não é saída de estoque.', exemplo: 'Dois paletes viram um; o total de peças continua igual.' },
  { termo: 'Inventário de referência', explicacao: 'Fotografia do que foi informado ao cliente: NF, palete, endereço e volumes, com data e fonte.', exemplo: 'INV-000001 conferido em 28/09 (fictício).' },
  { termo: 'Seleção do cliente', explicacao: 'Lista do material que o cliente escolheu para devolver, com pedido e versão.', exemplo: 'Pedido PED-DEMO-1, versão 1 (fictício).' },
  { termo: 'Localizado', explicacao: 'O vínculo foi resolvido: há palete e endereço atual conhecidos. Não quer dizer que pode sair.', exemplo: 'NF 5550001 nos paletes 9101 e 9102 (fictício).' },
  { termo: 'Sem vínculo (NF sem palete)', explicacao: 'A NF existe nos registros, mas nenhum palete físico está ligado a ela. Investigar e vincular.', exemplo: 'NF 5550099 sem palete: pendência, não perda.' },
  { termo: 'Validado × liberado para saída', explicacao: 'Validado é o saldo conferido e reconciliado; liberado é a parte autorizada para uma janela.', exemplo: '10 UN validadas, 6 UN liberadas: só 6 entram na proposta.' },
];

export interface Duvida {
  pergunta: string;
  resposta: string;
}

export const DUVIDAS: readonly Duvida[] = [
  {
    pergunta: 'O palete aparece no mapa, mas o conteúdo diz "Não conferido". Ele está vazio?',
    resposta: 'Não se sabe. Conteúdo desconhecido não é zero: é preciso conferir o palete para saber.',
  },
  {
    pergunta: 'Achei o SKU do claim num palete. Posso dar o claim como resolvido?',
    resposta: 'Não. Encontrar o SKU é pista. Registre a evidência, peça a validação e espere o responsável validar a origem e a quantidade.',
  },
  {
    pergunta: 'Por que o mesmo produto aparece em vários cartões na busca?',
    resposta: 'Cada cartão é uma base diferente (saldo validado, contagem, documento) ou outro palete/lote/origem. As bases não se somam.',
  },
  {
    pergunta: 'A tela mostra "Sem conexão". Posso continuar trabalhando?',
    resposta: 'Você pode consultar o que já está na tela, mas nada é confirmado. Gravações exigem o servidor e não ficam numa fila automática.',
  },
  {
    pergunta: 'Toquei duas vezes em confirmar. Registrou duas vezes?',
    resposta: 'Não. Cada ação usa uma chave única: repetir o mesmo pedido devolve o resultado original sem gravar de novo.',
  },
  {
    pergunta: 'Reservei material para a janela. O estoque baixou?',
    resposta: 'Não. A reserva separa; a baixa acontece só na confirmação da expedição, uma única vez.',
  },
  {
    pergunta: 'Juntei dois paletes. Isso conta como saída?',
    resposta: 'Não. Consolidar reduz posições ocupadas; as peças continuam no estoque. Saída é só expedição confirmada.',
  },
  {
    pergunta: 'Não vejo um botão que o guia cita.',
    resposta: 'O botão depende do seu perfil e da situação do registro. O guia diz quem executa cada passo; sem permissão, peça a quem tem.',
  },
  {
    pergunta: 'A seleção mostra "Localizado". Já posso expedir?',
    resposta: 'Ainda não. Localizado diz onde está; a saída exige saldo validado, liberado e disponível, reserva na janela e a confirmação da expedição.',
  },
  {
    pergunta: 'A NF da seleção está "sem palete". O material sumiu?',
    resposta: 'Não se sabe. É falta de vínculo nos registros: investigue e vincule pela conferência ou pelo inventário. Não é perda nem claim.',
  },
  {
    pergunta: 'Os indicadores mostram ocupação "provisória". Por quê?',
    resposta: 'O desenho da praça ainda não foi validado contra a praça real. A ocupação usa as posições cadastradas e pode mudar no ajuste do layout.',
  },
];

/** Funções que esta versão não tem: aparecem como indisponíveis, nunca como passo executável. */
export const INDISPONIVEIS: readonly string[] = [
  'Trabalho sem conexão com gravação posterior (não há fila automática de gravações).',
  'Ajuste definitivo do desenho da praça (geometria, fileiras e endereços oficiais): pendente para depois do levantamento físico.',
  'Medição de produtividade e tempo poupado: não há registro de esforço; nada é estimado como economia.',
  'Integração com sistemas da DHL ou da L’Oréal, notificações externas, RFID e leitura automática de documentos.',
  'Desfazer uma expedição confirmada (retorno usa um novo recebimento ligado à saída original).',
  'Restaurar backup pela interface (é procedimento técnico, fora do aplicativo).',
];

/** Passos do guia que o perfil executa (os demais são mostrados como "quem faz"). */
export function podeExecutar(passo: PassoGuia, permissoes: readonly Permissao[]): boolean {
  return passo.permissao === undefined || permissoes.includes(passo.permissao);
}

export function guiaPorId(id: IdTarefa): GuiaTarefa {
  const guia = GUIAS.find((g) => g.id === id);
  if (!guia) throw new Error(`Guia desconhecido: ${id}`);
  return guia;
}
