/**
 * Nome operacional de uma gravação, pela rota da API (para o painel de
 * operações em confirmação). A rota é interna: "/api/v1/...".
 */
const DESCRICOES: readonly (readonly [string, RegExp, string])[] = [
  ['POST', /\/paletes\/[^/]+\/movimentos$/, 'Movimento de palete'],
  ['POST', /\/transferencias$/, 'Transferência de conteúdo'],
  ['POST', /\/(movimentos|transferencias)\/[^/]+\/correcao$/, 'Correção de movimentação'],
  ['POST', /\/paletes$/, 'Cadastro de palete'],
  ['PATCH', /\/paletes\/[^/]+$/, 'Alteração do palete'],
  ['POST', /\/paletes\/[^/]+\/arquivar$/, 'Arquivamento de palete'],
  ['POST', /\/paletes\/[^/]+\/liberacao$/, 'Liberação ou bloqueio de material'],
  ['POST', /\/paletes\/[^/]+\/conferencias$/, 'Início de conferência'],
  ['POST', /\/conferencias\/[^/]+\/observacoes$/, 'Entrada da conferência'],
  ['PATCH', /\/conferencias\/[^/]+\/observacoes\/[^/]+$/, 'Correção de entrada da conferência'],
  ['POST', /\/conferencias\/[^/]+\/observacoes\/[^/]+\/remover$/, 'Remoção de entrada da conferência'],
  ['PATCH', /\/conferencias\/[^/]+$/, 'Observações da conferência'],
  ['POST', /\/conferencias\/[^/]+\/concluir$/, 'Conclusão da conferência'],
  ['POST', /\/conferencias\/[^/]+\/cancelar$/, 'Cancelamento da conferência'],
  ['POST', /\/conferencias\/[^/]+\/recontagem$/, 'Pedido de recontagem'],
  ['POST', /\/conferencias\/[^/]+\/reconciliar$/, 'Reconciliação do estoque'],
  ['POST', /\/conferencias\/[^/]+\/anexos$/, 'Anexo da conferência'],
  ['POST', /\/importacoes$/, 'Envio de arquivo de importação'],
  ['POST', /\/importacoes\/[^/]+\/confirmar$/, 'Confirmação de importação'],
  ['POST', /\/claims\/[^/]+\/evidencias\/[^/]+\/validar$/, 'Validação de recuperação'],
  ['POST', /\/claims\/[^/]+\/resultados$/, 'Resultado da regularização'],
  ['POST', /\/claims\/[^/]+\/anexos$/, 'Anexo do claim'],
  ['POST', /\/claims/, 'Alteração de claim'],
  ['PUT', /\/claims\/[^/]+$/, 'Edição de claim'],
  ['POST', /\/janelas\/[^/]+\/reservas$/, 'Reserva na janela'],
  ['POST', /\/janelas\/[^/]+\/anexos$/, 'Anexo da janela'],
  ['POST', /\/janelas/, 'Alteração de janela'],
  ['PUT', /\/janelas\/[^/]+$/, 'Edição de janela'],
  ['POST', /\/reservas\/[^/]+\/preparacao$/, 'Preparação da reserva'],
  ['POST', /\/reservas\/[^/]+\/expedicao$/, 'Confirmação de expedição'],
  ['POST', /\/reservas\/[^/]+\/cancelar$/, 'Cancelamento de reserva'],
  ['POST', /\/expedicoes\/[^/]+\/retornos$/, 'Retorno da expedição'],
  ['POST', /\/expedicoes\/[^/]+\/correcao$/, 'Correção de expedição'],
  ['POST', /\/produtos$/, 'Cadastro de produto'],
  ['PUT', /\/produtos\/[^/]+$/, 'Alteração de produto'],
  ['POST', /\/layout/, 'Alteração do layout'],
  ['PUT', /\/layout/, 'Alteração do layout'],
  ['PATCH', /\/layout/, 'Alteração do layout'],
  ['POST', /\/admin\//, 'Administração de acesso'],
  ['PUT', /\/admin\//, 'Administração de acesso'],
  ['PATCH', /\/admin\//, 'Administração de acesso'],
];

export function descreverOperacao(metodo: string, url: string): string {
  const caminho = url.split('?')[0] ?? url;
  const achada = DESCRICOES.find(([m, padrao]) => m === metodo && padrao.test(caminho));
  return achada ? achada[2] : `Gravação (${metodo} ${caminho.replace(/^\/api\/v1/, '')})`;
}
