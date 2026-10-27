import type { Permissao } from '@praca-reversa/contracts';
import type { Rota } from '../rotas';

export interface ItemMenu {
  rotulo: string;
  rota: Rota;
  /** Basta uma das permissões. */
  permissoes: readonly Permissao[];
  ativo: (rota: Rota) => boolean;
}

/** Páginas do menu da conta, exibidas conforme as permissões do escopo ativo. */
export const ITENS_MENU: readonly ItemMenu[] = [
  { rotulo: 'Mapa da praça', rota: { tipo: 'praca' }, permissoes: ['praca.consultar'], ativo: (r) => r.tipo === 'praca' || r.tipo === 'palete' },
  { rotulo: 'Cadastrar palete', rota: { tipo: 'novo-palete' }, permissoes: ['palete.cadastrar'], ativo: (r) => r.tipo === 'novo-palete' },
  { rotulo: 'Registrar conteúdo', rota: { tipo: 'novo-conteudo' }, permissoes: ['palete.cadastrar'], ativo: (r) => r.tipo === 'novo-conteudo' },
  { rotulo: 'Validação sem endereço', rota: { tipo: 'validacao' }, permissoes: ['validacao.consultar'], ativo: (r) => r.tipo === 'validacao' },
  {
    rotulo: 'Importações',
    rota: { tipo: 'importacoes' },
    permissoes: ['importacao.consultar', 'claim.consultar'],
    ativo: (r) => r.tipo === 'importacoes' || r.tipo === 'nova-importacao' || r.tipo === 'importacao',
  },
  {
    rotulo: 'Seleção do cliente',
    rota: { tipo: 'selecoes' },
    permissoes: ['selecao.consultar'],
    ativo: (r) => r.tipo === 'selecoes' || r.tipo === 'selecao' || r.tipo === 'inventarios' || r.tipo === 'inventario',
  },
  {
    rotulo: 'Claims',
    rota: { tipo: 'claims' },
    permissoes: ['claim.consultar'],
    ativo: (r) => r.tipo === 'claims' || r.tipo === 'novo-claim' || r.tipo === 'claim' || r.tipo === 'editar-claim',
  },
  {
    rotulo: 'Janelas de devolução',
    rota: { tipo: 'janelas', mes: null },
    permissoes: ['janela.consultar'],
    ativo: (r) => ['janelas', 'nova-janela', 'janela', 'editar-janela', 'reserva', 'expedicao'].includes(r.tipo),
  },
  {
    rotulo: 'Painel da operação',
    rota: { tipo: 'painel', parametros: '' },
    permissoes: ['painel.operacao'],
    ativo: (r) => r.tipo === 'painel' || r.tipo === 'painel-estoque' || r.tipo === 'painel-janela',
  },
  { rotulo: 'Painel do cliente', rota: { tipo: 'painel-cliente', parametros: '' }, permissoes: ['painel.cliente'], ativo: (r) => r.tipo === 'painel-cliente' },
  // Só com a concessão explícita (responsável interno); some quando a funcionalidade está desligada.
  {
    rotulo: 'Seleção cliente — teste',
    rota: { tipo: 'selecao-teste', solicitacao: null },
    permissoes: ['selecao_teste.solicitar', 'selecao_teste.responder'],
    ativo: (r) => r.tipo === 'selecao-teste' || r.tipo === 'selecao-teste-solicitacoes' || r.tipo === 'selecao-teste-solicitacao',
  },
  { rotulo: 'Indicadores', rota: { tipo: 'indicadores', inicio: null, fim: null }, permissoes: ['praca.consultar'], ativo: (r) => r.tipo === 'indicadores' },
  {
    rotulo: 'Relatórios',
    rota: { tipo: 'relatorios', parametros: '' },
    permissoes: ['palete.consultar', 'claim.consultar', 'janela.consultar'],
    ativo: (r) => r.tipo === 'relatorios',
  },
  // Planilha única e proteção dos dados: situação para quem consulta a praça.
  { rotulo: 'Planilha e proteção', rota: { tipo: 'planilha' }, permissoes: ['praca.consultar'], ativo: (r) => r.tipo === 'planilha' },
  { rotulo: 'Layout da praça', rota: { tipo: 'layout' }, permissoes: ['praca.consultar'], ativo: (r) => r.tipo === 'layout' },
  { rotulo: 'Administração de acesso', rota: { tipo: 'acesso' }, permissoes: ['acesso.administrar'], ativo: (r) => r.tipo === 'acesso' },
  // Sem dados da operação: disponível para todos (etapa 09).
  { rotulo: 'Aplicativo e aparelho', rota: { tipo: 'aplicativo' }, permissoes: [], ativo: (r) => r.tipo === 'aplicativo' },
  // Etapa 10: tutorial e guias por tarefa.
  { rotulo: 'Ajuda e tutorial', rota: { tipo: 'ajuda', guia: null }, permissoes: [], ativo: (r) => r.tipo === 'ajuda' },
];

export const ROTAS_AGENDA: readonly Rota['tipo'][] = ['janelas', 'nova-janela', 'janela', 'editar-janela', 'reserva', 'expedicao'];

/** Título e descrição curta da seção, para o cabeçalho. */
export function secaoDaRota(rota: Rota): { titulo: string; descricao: string } {
  switch (rota.tipo) {
    case 'praca':
    case 'palete':
      return { titulo: 'Mapa da praça', descricao: 'Localize paletes, notas e posições livres na disposição real da praça.' };
    case 'inventarios':
    case 'inventario':
      return { titulo: 'Inventário', descricao: 'Inventários importados, notas e endereços de origem.' };
    case 'novo-palete':
    case 'bipagem':
    case 'bipagem-escolher':
    case 'novo-conteudo':
      return { titulo: 'Recebimento', descricao: 'Palete, conteúdo recebido (remetente, nota e Delivery) e conferência de volumes.' };
    case 'volumes':
      return { titulo: 'Conferência de volumes', descricao: 'Palete inteiro numa tabela: confirmar sem diferença, registrar diferenças ou conferir só uma parte.' };
    case 'validacao':
      return { titulo: 'Validação urgente — sem endereço', descricao: 'Conteúdos com local físico desconhecido: escolher o destino no mapa.' };
    case 'painel':
    case 'painel-estoque':
    case 'painel-janela':
      return { titulo: 'Painel da operação', descricao: 'Estoque, localização, reconferência e janelas em volumes.' };
    case 'painel-cliente':
      return { titulo: 'Painel do cliente', descricao: 'Estoque, janelas e histórico da operação.' };
    case 'selecoes':
    case 'selecao':
      return { titulo: 'Seleção do cliente', descricao: 'Pedidos do cliente cruzados com os paletes da praça.' };
    case 'selecao-teste':
    case 'selecao-teste-solicitacoes':
    case 'selecao-teste-solicitacao':
      return { titulo: 'Seleção cliente — teste', descricao: 'Ambiente de teste — não movimenta estoque.' };
    case 'importacoes':
    case 'nova-importacao':
    case 'importacao':
      return { titulo: 'Importações', descricao: 'Arquivos enviados, prévias e resultados.' };
    case 'conferencia':
      return { titulo: 'Conferência', descricao: 'Contagem física do palete.' };
    case 'indicadores':
      return { titulo: 'Indicadores', descricao: 'Praça, conferência, movimentações e estoque.' };
    case 'mover':
    case 'transferir':
    case 'historico':
    case 'retirar':
      return { titulo: 'Movimentação', descricao: 'Mudança de local e de conteúdo do palete, com histórico.' };
    case 'claims':
    case 'novo-claim':
    case 'claim':
    case 'editar-claim':
      return { titulo: 'Claims', descricao: 'Busca e recuperação de produtos reclamados.' };
    default: {
      if (ROTAS_AGENDA.includes(rota.tipo)) return { titulo: 'Agendas', descricao: 'Janelas de devolução, reservas e saídas.' };
      const item = ITENS_MENU.find((i) => i.ativo(rota));
      return { titulo: item?.rotulo ?? 'Praça Reversa', descricao: '' };
    }
  }
}
