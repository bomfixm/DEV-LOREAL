// Falas do apresentador, sincronizadas com as cenas. Nunca aparecem na tela projetada.
// "cuidados" são lembretes para quem apresenta (fatos e limites), não para ler em voz alta.
window.PR_ROTEIRO = [
  {
    id: '01', titulo: 'Cada volume no lugar certo',
    fala: [
      'O projeto nasceu de uma dificuldade que a gente vive no piso: ter os paletes organizados não significa conseguir localizar rapidamente cada nota e cada volume.',
      'A proposta do Praça Reversa é juntar o endereço físico com a informação do conteúdo, para ajudar a operação a encontrar, conferir e preparar o que o cliente solicita.',
      'Hoje eu vou mostrar o problema, o caminho que estamos construindo e o que precisamos validar no piloto.',
    ],
    cuidados: ['Ao fundo está o desenho real da praça (área da L’Oréal), sem ocupação.'],
  },
  {
    id: '02', titulo: 'Organização precisa de informação',
    fala: [
      'A dificuldade não é só o espaço ocupado. Uma nota pode estar em outro palete, uma quantidade pode precisar de recontagem ou o endereço pode não estar claro.',
      'Com muita demanda e poucas pessoas, conferir tudo manualmente é um trabalho grande. Uma informação confiável ajuda a direcionar essa busca.',
      'O objetivo é reduzir retrabalho e o risco de tratar como perdido algo que ainda pode estar na praça. Esse resultado ainda precisa ser medido.',
    ],
    cuidados: ['Não citar redução de claims nem economia: não há medição.'],
  },
  {
    id: '03', titulo: 'Uma nota, paletes diferentes',
    fala: [
      'Aqui temos um exemplo real do inventário: a mesma nota aparece em dois paletes.',
      'O 256 está no endereço 11 - A42, com 117 volumes. O 257 está no endereço 11 - A43, também com 117. Cada palete tem sua identificação FULL: 3 de 9 e 1 de 9.',
      'São dois recortes da nota, não o total dela. E o número da nota, o número do palete e o endereço são informações diferentes: uma não pode substituir a outra.',
    ],
    cuidados: [
      'Não somar os volumes nem multiplicar 117 por 9. FULL 3/9 identifica a parte, não é quantidade.',
      'A Delivery do 257 está "Não informado" (na planilha há "*"); não vale a do 256.',
      'Se perguntarem: no inventário de 20/10 a NFD 9059802 aparece em 9 linhas FULL (paletes 256 a 264, Rua 11, A42 a A50).',
    ],
  },
  {
    id: '04', titulo: 'A informação já existe',
    fala: [
      'Grande parte da informação já está no inventário ou no arquivo que sai da bipagem. A ideia é aproveitar esse registro, em vez de cadastrar cada nota outra vez.',
      'Mas os dois arquivos têm finalidades diferentes: o inventário reúne a praça; a exportação da bipagem corresponde a um palete.',
      'A importação da bipagem de um palete já funciona na versão de teste: o arquivo mostra uma prévia, a pessoa escolhe a posição no mapa e confirma. Nota repetida não é somada sozinha: a pessoa decide revalidar ou importar separadamente.',
      'A carga do inventário completo é feita de forma assistida e está em ajuste: a base de 20/10 continua em validação.',
    ],
    cuidados: [
      'Na bipagem, os principais são Tipo, Número, Lidos e Remetente; CNPJ e Última leitura são adicionais; Delivery, SKU e validade são manuais e opcionais.',
      'O importador em Python é outra tarefa; não prometer prazo aqui.',
    ],
  },
  {
    id: '05', titulo: 'Encontrar sem abrir tudo',
    fala: [
      'Em vez de começar abrindo paletes, a consulta pode começar pela nota ou pelo número do palete. Neste recorte, o caminho leva ao 256 e ao endereço 11 - A42.',
      'O mapa transforma a informação em uma direção de busca no piso. Como a nota pode estar em mais de um palete, o resultado não deve esconder as outras ocorrências: aqui aparece também o 257, no A43.',
      'E quando a informação não é confiável, ela precisa ser sinalizada, não tratada como localização confirmada.',
    ],
    cuidados: [
      'O mapa é o desenho real da praça no sistema (área da L’Oréal, Rua 11 com A42 no topo).',
      'Em 21/10, o sistema mostra o 256 em 11 - A42 e o 257 em 11 - A43, como no inventário.',
    ],
  },
  {
    id: '06', titulo: 'O essencial, logo de cara',
    fala: [
      'A janela do palete precisa responder rápido: qual é o palete, onde ele está, quais notas tem e quantos volumes existem naquele registro.',
      'Neste exemplo também temos a Delivery e o remetente. As informações complementares ficam em "mais informações", sem obrigar a pessoa a procurar o básico no meio de muitos campos.',
      'Quando um dado não existe, ele fica como não informado; não deve ser preenchido por suposição.',
    ],
    cuidados: ['Esta tela é uma composição da apresentação com os dados do inventário, não uma captura do sistema.'],
  },
  {
    id: '07', titulo: 'O cliente escolhe; a operação executa',
    fala: [
      'O cliente define o que quer receber e em qual quantidade de volumes. Pode ser um palete inteiro, parte de uma nota ou uma Delivery específica.',
      'Uma seleção no aplicativo pode deixar esse pedido mais claro, com resumo e observações. Mas selecionar não significa que o material saiu: a operação continua responsável pela separação e pela baixa efetiva.',
      'Hoje a seleção do cliente existe como teste interno, que simula o pedido sem mexer no estoque. O processo atual pela planilha continua valendo até a gente validar esse caminho.',
    ],
    cuidados: [
      'Quatro janelas por mês; o limite por janela varia conforme o cliente (8.000 volumes foi só um exemplo).',
      'O cliente recebe o que pediu; saldo não solicitado permanece. Pedido enviado não muda sem aprovação.',
      'Não há pedido real nesta apresentação.',
    ],
  },
  {
    id: '08', titulo: 'Conferir e manter a informação atual',
    fala: [
      'Uma informação só continua útil se acompanhar o piso. A conferência precisa registrar a contagem, atualizar o volume atual e refletir o resultado no status do palete, com histórico.',
      'Desde 21/10 a versão de teste confere o palete inteiro numa tabela, sem abrir uma tela para cada nota. Isso ainda precisa ser validado no piso.',
      'A regra de atenção é olhar de novo os paletes que ficam 20 dias sem movimentação, contando a partir da última conferência completa. Abrir a tela não renova o prazo.',
    ],
    cuidados: ['20 dias é regra, não indicador. Não há contagem real mostrada nesta cena.'],
  },
  {
    id: '09', titulo: 'Dúvida de endereço pede validação',
    fala: [
      'Quando uma nota não tem endereço confiável, colocá-la em qualquer palete só muda o problema de lugar.',
      'Por isso essas notas vão para uma validação interna, preservando a origem e o histórico, até a equipe confirmar o vínculo certo.',
      'Essa área não é uma posição física, não conta como espaço ocupado e não aparece para o cliente como estoque localizado. Clareza sobre a dúvida é melhor do que uma certeza errada.',
    ],
    cuidados: ['Os números da fila não estão na tela de propósito: mudam com a validação. Consultar no sistema se perguntarem.'],
  },
  {
    id: '10', titulo: 'Visibilidade na medida certa',
    fala: [
      'A mesma base pode apoiar públicos diferentes. A operação precisa de localização, estoque e tratamento de pendências.',
      'O cliente precisa entender o material disponível para sua consulta, o que foi solicitado e o histórico que estiver autorizado a acompanhar.',
      'O acesso respeita o papel de cada usuário também nas consultas, não só escondendo botões. A visão do cliente ainda está em teste, com uma conta de teste.',
    ],
    cuidados: ['Sem janelas nem metas reais cadastradas: por isso a cena não tem números.'],
  },
  {
    id: '11', titulo: 'Cada mudança precisa de rastro',
    fala: [
      'Além de saber como o estoque está, precisamos entender como ele chegou ali: quem registrou uma movimentação, quando houve uma conferência e qual quantidade mudou.',
      'Neste exemplo, o único fato registrado é a conferência informada no inventário em 16/10, sem responsável registrado. As próximas movimentações e conferências passam a ficar no histórico do sistema.',
      'A cópia de segurança fora da máquina ainda está em ajuste; uma tela bonita não comprova backup funcionando.',
    ],
    cuidados: ['Não citar "backup garantido" nem "planilha em tempo real".'],
  },
  {
    id: '12', titulo: 'Testar, medir e evoluir',
    fala: [
      'O próximo passo é validar a base e testar o fluxo na operação, com critérios claros.',
      'Podemos acompanhar o tempo para localizar uma nota, as diferenças encontradas na conferência e os casos de possível perda que conseguimos investigar. São indicadores para medir, não resultados alcançados.',
      'Com uma base confiável e um piloto bem acompanhado, conseguimos decidir o que precisa de ajuste e qual é o valor real do projeto para a operação e para o cliente.',
    ],
    cuidados: ['Para perguntas, abrir o índice (tecla I) e voltar à cena.'],
  },
];
