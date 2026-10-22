import { z } from 'zod';

/**
 * Perfis iniciais (docs/ARQUITETURA.md). `CLIENTE_CONSULTA` é o acesso de
 * consulta do cliente (painel do cliente): só a projeção permitida, nunca os
 * dados internos da operação.
 */
export const PerfilSchema = z.enum(['CONSULTA', 'OPERADOR', 'SUPERVISOR_ESTOQUE', 'ANALISTA_CLAIMS', 'ADMINISTRADOR', 'CLIENTE_CONSULTA']);
export type Perfil = z.infer<typeof PerfilSchema>;
export const PERFIS = PerfilSchema.options;

/**
 * Catálogo de permissões. As de consulta, acesso e auditoria vêm da etapa 02;
 * cadastro, produtos, layout e etiquetas, da etapa 03; conferência e
 * reconciliação, da etapa 04; movimentações e correções de movimentação, da
 * etapa 05; importação, histórico de importações e exportação da busca, da
 * etapa 06; claims, da etapa 07; janelas, liberação, reservas, preparação,
 * expedição e retorno, da etapa 08; exportação dos relatórios, da etapa 10
 * (indicadores e relatórios são consultados com as permissões de cada área).
 */
export const PermissaoSchema = z.enum([
  'praca.consultar',
  'palete.consultar',
  'produto.consultar',
  'acesso.administrar',
  'auditoria.consultar',
  'palete.cadastrar',
  'palete.arquivar',
  'produto.cadastrar',
  'layout.configurar',
  'etiqueta.imprimir',
  'conferencia.registrar',
  'conferencia.reconciliar',
  'movimento.registrar',
  /** Correção (evento compensatório) de movimentação concluída. */
  'movimento.corrigir',
  /** Enviar arquivo, gerar prévia, confirmar e descartar importações. */
  'importacao.executar',
  /** Histórico de importações, detalhes por linha e relatório de erros. */
  'importacao.consultar',
  /** Exportar resultados da busca (CSV). */
  'busca.exportar',
  /** Lista, detalhe, candidatos, evidências, anexos, histórico e resumo de claims. */
  'claim.consultar',
  /** Cadastrar, importar e editar casos; investigar candidatos; registrar evidências e anexos; solicitar validação; exportar. */
  'claim.tratar',
  /** Validar ou rejeitar recuperação física; estornar recuperação; encerrar e reabrir casos. */
  'claim.validar',
  /** Registrar, corrigir e anular o resultado da regularização (valores confirmados). Só por concessão explícita. */
  'claim.aprovar_financeiro',
  /** Janelas, material elegível/pendente, reservas, preparação, expedições, histórico e anexos. */
  'janela.consultar',
  /** Cadastrar, alterar (com versão das regras), confirmar, encerrar e cancelar janelas; anexos de autorização. */
  'janela.gerenciar',
  /** Liberar, revogar, bloquear e desbloquear material (palete × segmento) e palete inteiro. */
  'material.liberar',
  /** Criar reserva e cancelar/liberar reserva antes da saída. */
  'janela.reservar',
  /** Registrar separação/preparação e medidas da carga. */
  'expedicao.preparar',
  /** Confirmar expedição física (baixa única) e corrigir informações da expedição. */
  'expedicao.confirmar',
  /** Registrar retorno físico ou aviso documental ligado à expedição. */
  'expedicao.retorno',
  /** Exportar lista de preparação e resumo das janelas (CSV). */
  'janela.exportar',
  /** Exportar relatórios da etapa 10 (CSV); cada relatório exige também a permissão de consulta da área. */
  'relatorio.exportar',
  /** Importar inventário conferido (vínculos NF × palete × endereço; nunca saldo validado). */
  'inventario.importar',
  /** Seleções do cliente, inventários de referência, conciliação e pendências. */
  'selecao.consultar',
  /** Importar seleção, resolver identificação ambígua e preparar a proposta para a janela. */
  'selecao.importar',
  /** Exportar lista de separação, pendências e conciliação (CSV). */
  'selecao.exportar',
  /** Planilha única: pedir nova publicação agora ("tentar novamente"); a situação é consulta de todos. */
  'planilha.publicar',
  /** Painel da operação DHL (estoque, localização, reconferência, janelas e tarefas; claims só com claim.consultar). */
  'painel.operacao',
  /** Painel do cliente: estoque, janelas e histórico na projeção permitida (sem claims, valores nem pendências internas). */
  'painel.cliente',
  /**
   * "Seleção cliente — teste": consultar o estoque (só leitura), montar o
   * carrinho, enviar solicitações de teste e pedir alteração. Só por concessão
   * explícita do vínculo (responsável interno), nunca por perfil.
   */
  'selecao_teste.solicitar',
  /** "Seleção cliente — teste": aprovar ou recusar pedidos de alteração e registrar a resposta. Só por concessão explícita. */
  'selecao_teste.responder',
  /** Mover, enviar à validação sem endereço e cancelar conteúdos do palete (correção de cadastro/importação). */
  'conteudo.corrigir',
  /** Fila interna "Validação urgente — sem endereço" (nunca do cliente). */
  'validacao.consultar',
]);
export type Permissao = z.infer<typeof PermissaoSchema>;

export const PERMISSOES_IMPLEMENTADAS: ReadonlySet<Permissao> = new Set([
  'praca.consultar',
  'palete.consultar',
  'produto.consultar',
  'acesso.administrar',
  'auditoria.consultar',
  'palete.cadastrar',
  'palete.arquivar',
  'produto.cadastrar',
  'layout.configurar',
  'etiqueta.imprimir',
  'conferencia.registrar',
  'conferencia.reconciliar',
  'movimento.registrar',
  'movimento.corrigir',
  'importacao.executar',
  'importacao.consultar',
  'busca.exportar',
  'claim.consultar',
  'claim.tratar',
  'claim.validar',
  'claim.aprovar_financeiro',
  'janela.consultar',
  'janela.gerenciar',
  'material.liberar',
  'janela.reservar',
  'expedicao.preparar',
  'expedicao.confirmar',
  'expedicao.retorno',
  'janela.exportar',
  'relatorio.exportar',
  'inventario.importar',
  'selecao.consultar',
  'selecao.importar',
  'selecao.exportar',
  'planilha.publicar',
  'painel.operacao',
  'painel.cliente',
  'selecao_teste.solicitar',
  'selecao_teste.responder',
  'conteudo.corrigir',
  'validacao.consultar',
]);

/**
 * Permissões explícitas por perfil (proposta provisória até a operação
 * confirmar as funções; ver docs/DESCOBERTA.md). Cadastro de produtos,
 * configuração do layout, arquivamento, correção de movimentações e
 * importações ficam com o supervisor de estoque; a exportação da busca, com o
 * supervisor e o analista de claims; o
 * administrador técnico cuida de contas e não altera estoque nem layout.
 * `claim.aprovar_financeiro` não pertence a nenhum perfil: é concedida de forma
 * explícita pelo administrador a um analista de claims (vínculo do escopo) e
 * não decorre de ser administrador técnico. O supervisor consulta claims (para
 * saber por que um material está vinculado), sem tratar nem validar. Etapa 08:
 * janelas, liberação, reserva, expedição e retorno ficam com o supervisor; o
 * operador consulta e registra a preparação; consulta e analista só consultam.
 * Etapa 10: exportar relatórios fica com o supervisor e o analista de claims.
 * Seleção do cliente: importar inventário conferido e seleções, resolver
 * ambiguidades e encaminhar à janela ficam com o supervisor; operador e
 * analista consultam e exportam a lista de separação e as pendências.
 * Painéis: todos os perfis DHL veem o painel da operação; o painel do cliente
 * é do perfil do cliente (e do supervisor, para conferir o que o cliente vê).
 * O cliente não recebe nenhuma permissão operacional nem interna.
 */
export const PERMISSOES_POR_PERFIL: Readonly<Record<Perfil, readonly Permissao[]>> = {
  CONSULTA: ['praca.consultar', 'palete.consultar', 'produto.consultar', 'janela.consultar', 'painel.operacao'],
  OPERADOR: [
    'praca.consultar',
    'palete.consultar',
    'produto.consultar',
    'palete.cadastrar',
    'etiqueta.imprimir',
    'conferencia.registrar',
    'movimento.registrar',
    'janela.consultar',
    'expedicao.preparar',
    'selecao.consultar',
    'selecao.exportar',
    'painel.operacao',
    'validacao.consultar',
  ],
  SUPERVISOR_ESTOQUE: [
    'praca.consultar',
    'palete.consultar',
    'produto.consultar',
    'palete.cadastrar',
    'palete.arquivar',
    'produto.cadastrar',
    'layout.configurar',
    'etiqueta.imprimir',
    'conferencia.registrar',
    'conferencia.reconciliar',
    'movimento.registrar',
    'movimento.corrigir',
    'importacao.executar',
    'importacao.consultar',
    'busca.exportar',
    'claim.consultar',
    'janela.consultar',
    'janela.gerenciar',
    'material.liberar',
    'janela.reservar',
    'expedicao.preparar',
    'expedicao.confirmar',
    'expedicao.retorno',
    'janela.exportar',
    'relatorio.exportar',
    'inventario.importar',
    'selecao.consultar',
    'selecao.importar',
    'selecao.exportar',
    'planilha.publicar',
    'painel.operacao',
    'painel.cliente',
    'conteudo.corrigir',
    'validacao.consultar',
  ],
  ANALISTA_CLAIMS: [
    'praca.consultar',
    'palete.consultar',
    'produto.consultar',
    'busca.exportar',
    'claim.consultar',
    'claim.tratar',
    'claim.validar',
    'janela.consultar',
    'relatorio.exportar',
    'selecao.consultar',
    'selecao.exportar',
    'painel.operacao',
  ],
  // Perfil administrativo máximo: corrige registros de conteúdo (cadastro/importação) e resolve a validação (21 out. 2026).
  ADMINISTRADOR: [
    'praca.consultar',
    'palete.consultar',
    'produto.consultar',
    'acesso.administrar',
    'auditoria.consultar',
    'planilha.publicar',
    'painel.operacao',
    'conteudo.corrigir',
    'validacao.consultar',
  ],
  CLIENTE_CONSULTA: ['painel.cliente'],
};

export function perfilPossui(perfil: Perfil | null, permissao: Permissao): boolean {
  return perfil !== null && PERMISSOES_POR_PERFIL[perfil].includes(permissao);
}

/** Perfis que podem receber a concessão explícita de aprovação financeira de claims. */
export const PERFIS_APROVACAO_FINANCEIRA: readonly Perfil[] = ['ANALISTA_CLAIMS'];

/**
 * Perfis internos que podem receber a concessão "Seleção cliente — teste"
 * (responsável interno pelo projeto). O perfil do cliente nunca recebe.
 */
export const PERFIS_SELECAO_TESTE: readonly Perfil[] = ['SUPERVISOR_ESTOQUE', 'ADMINISTRADOR'];

/**
 * Permissões efetivas de um vínculo: as do perfil e, se concedidas a um perfil
 * elegível, a aprovação financeira e a "Seleção cliente — teste" (esta só com
 * a funcionalidade ligada na instalação).
 */
export function permissoesDoVinculo(perfil: Perfil | null, aprovacaoFinanceira: boolean, selecaoTeste = false): Permissao[] {
  if (perfil === null) return [];
  const lista: Permissao[] = [...PERMISSOES_POR_PERFIL[perfil]];
  if (aprovacaoFinanceira && PERFIS_APROVACAO_FINANCEIRA.includes(perfil)) lista.push('claim.aprovar_financeiro');
  if (selecaoTeste && PERFIS_SELECAO_TESTE.includes(perfil)) lista.push('selecao_teste.solicitar', 'selecao_teste.responder');
  return lista;
}

/** Autor/responsável apresentado em registros (sem ID interno). */
export const UsuarioResumoSchema = z.object({ login: z.string().min(1), name: z.string().min(1) });
export type UsuarioResumo = z.infer<typeof UsuarioResumoSchema>;

export const EscopoSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  unitCode: z.string().min(1),
  unitName: z.string().min(1),
  clientCode: z.string().min(1),
  clientName: z.string().min(1),
  /** Escopo de demonstração com dados fictícios. */
  demo: z.boolean(),
});
export type Escopo = z.infer<typeof EscopoSchema>;

export const EscopoComPerfilSchema = EscopoSchema.extend({
  role: PerfilSchema,
  /** Concessão explícita de aprovação financeira de claims neste escopo. */
  financialApproval: z.boolean().default(false),
  /** Concessão explícita da "Seleção cliente — teste" neste escopo (responsável interno). */
  clientSelectionTest: z.boolean().default(false),
});
export type EscopoComPerfil = z.infer<typeof EscopoComPerfilSchema>;

export const LoginSchema = z.object({
  login: z.string().trim().min(1).max(64),
  senha: z.string().min(1).max(256),
});
export type Login = z.infer<typeof LoginSchema>;

export const SessaoSchema = z.object({
  user: z.object({ id: z.uuid(), login: z.string().min(1), name: z.string().min(1) }),
  activeScope: EscopoSchema.nullable(),
  scopes: z.array(EscopoComPerfilSchema),
  role: PerfilSchema.nullable(),
  permissions: z.array(PermissaoSchema),
  /** Token anti-CSRF para requisições mutáveis; guardado apenas em memória. */
  csrfToken: z.string().min(32),
  expiresAt: z.iso.datetime(),
  idleTimeoutMinutes: z.number().int().positive(),
});
export type Sessao = z.infer<typeof SessaoSchema>;

export const TrocaEscopoSchema = z.object({ scopeId: z.uuid() });
export type TrocaEscopo = z.infer<typeof TrocaEscopoSchema>;
