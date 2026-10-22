// Snapshot congelado da apresentação (21/10/2026). Nada aqui é consultado durante a reunião.
// Sem dados de acesso nem de conexão a sistemas.
window.PR_DADOS = {
  snapshot: {
    data: '21/10/2026',
    descricao: 'Recorte fixo para a apresentação: dois registros do inventário e a geometria do mapa do escopo real, lida só para consulta.',
  },

  // Recorte histórico do inventário (dados/CASOS-REAIS-E-LIMITES.json do pacote do pedido).
  inventario: {
    arquivo: "Inventario_Loreal_otimizado (4).xlsx",
    aba: "Inventario L'oreal",
    sha256: '25266432c1d6386c2c01a9f879c676ea4a705a62db7937352251a018fa58d0b8',
    rotulo: 'Exemplo real do inventário · conferência 16/10/2026',
  },
  registros: {
    p256: {
      linha: 3,
      palete: '256',
      posicao: '11 - A42',
      tipo: 'NFD',
      numero: '9059802',
      volumes: 117,
      full: '3/9',
      delivery: '89443472',
      remetente: 'J SLEIMAN SA COM DE PROD HIGIENE',
      conferencia: '16/10/2026',
    },
    p257: {
      linha: 4,
      palete: '257',
      posicao: '11 - A43',
      tipo: 'NFD',
      numero: '9059802',
      volumes: 117,
      full: '1/9',
      delivery: null, // "*" na origem = não informado; não herda a Delivery do 256
      remetente: 'J SLEIMAN SA COM DE PROD HIGIENE',
      conferencia: '16/10/2026',
    },
  },

  // Selos de estado. "Disponível" = funciona na versão de teste local e passou nos testes automáticos;
  // nada disso está em produção e o piloto no piso ainda não começou.
  selos: {
    DISPONIVEL: 'Disponível na versão de teste',
    TESTE: 'Em teste',
    AJUSTE: 'Em ajuste',
  },

  // Inventário de evidências: função → origem → estado verificado.
  funcoes: [
    { id: 'mapa', nome: 'Mapa com foco na L’Oréal', estado: 'DISPONIVEL', cena: '05',
      origem: 'Tela Praça (mapa) — e2e/mapa-inicial.spec.ts; geometria lida do banco em 21/10/2026',
      verificacao: 'E2E 21/10/2026 (2 aprovados); 194 posições ativas, 11 - A42 a A58 na Rua 11' },
    { id: 'busca', nome: 'Busca por nota ou palete', estado: 'DISPONIVEL', cena: '05',
      origem: 'Pesquisa e "Ver no mapa" — e2e/busca-importacao.spec.ts',
      verificacao: 'E2E 21/10/2026 (3 aprovados no computador)' },
    { id: 'janela', nome: 'Janela do palete', estado: 'DISPONIVEL', cena: '06',
      origem: 'Janela sobre o mapa — e2e/janela-palete.spec.ts',
      verificacao: 'E2E 21/10/2026 (3 aprovados); a cena 06 é composição com os dados do inventário, não captura' },
    { id: 'bipagem', nome: 'Importar a bipagem de um palete', estado: 'DISPONIVEL', cena: '04',
      origem: '/bipagem (arquivo "Etiquetas") — e2e/bipagem.spec.ts; docs/IMPORTACAO-BIPAGEM.md',
      verificacao: 'E2E 21/10/2026 (1 aprovado); leitor em TypeScript; amostra real não importada em escopo nenhum' },
    { id: 'inventario', nome: 'Carga do inventário completo', estado: 'AJUSTE', cena: '04',
      origem: 'Comando inventario:carregar (assistido) — INV-000005 em validação',
      verificacao: 'Carga ainda associa o palete pelo endereço (docs/ESTADO.md, 21/10/2026); base em validação' },
    { id: 'selecao', nome: 'Seleção do cliente', estado: 'TESTE', cena: '07',
      origem: '"Seleção cliente — teste" — e2e/selecao-teste.spec.ts',
      verificacao: 'E2E 21/10/2026 (2 aprovados); simulação só de leitura do estoque, acesso por concessão; planilha do cliente aguarda arquivo real' },
    { id: 'conferencia', nome: 'Conferência do palete em tabela', estado: 'DISPONIVEL', cena: '08',
      origem: 'Conferência sobre o mapa — e2e/conferencia-tabela.spec.ts',
      verificacao: 'E2E 21/10/2026 (3 aprovados): grava contagem, quantidade atual, estado e histórico; entrou na versão de teste em 21/10' },
    { id: 'reconferencia', nome: 'Aviso de 20 dias sem movimentação', estado: 'DISPONIVEL', cena: '08',
      origem: 'Palete em laranja + "Reconferência necessária" — e2e/reconferencia.spec.ts',
      verificacao: 'E2E 21/10/2026 (1 aprovado); regra, sem passagem de tempo na apresentação' },
    { id: 'validacao', nome: 'Fila de validação sem endereço', estado: 'DISPONIVEL', cena: '09',
      origem: '/validacao — e2e/conferencia-tabela.spec.ts (enviar à validação e resolver)',
      verificacao: 'E2E 21/10/2026; fora do mapa e da visão do cliente; números não exibidos' },
    { id: 'painel', nome: 'Painel da operação', estado: 'DISPONIVEL', cena: '10',
      origem: '/painel — e2e/paineis.spec.ts',
      verificacao: 'E2E 21/10/2026 (2 aprovados); sem janelas nem metas reais cadastradas' },
    { id: 'cliente', nome: 'Painel do cliente', estado: 'TESTE', cena: '10',
      origem: '/painel/cliente, perfil de consulta — e2e/paineis.spec.ts',
      verificacao: 'E2E 21/10/2026 (1 aprovado): mapa e API interna negados; só conta de teste do cliente' },
    { id: 'historico', nome: 'Histórico de movimentações', estado: 'DISPONIVEL', cena: '11',
      origem: 'Mover, transferir, corrigir — e2e/movimentacoes.spec.ts',
      verificacao: 'E2E 21/10/2026 (3 aprovados no computador)' },
    { id: 'copia', nome: 'Cópia de segurança fora da máquina', estado: 'AJUSTE', cena: '11',
      origem: 'docs/ESTADO.md — planilha única e proteção dos dados',
      verificacao: 'Destino independente e agendamento não configurados' },
  ],
};
