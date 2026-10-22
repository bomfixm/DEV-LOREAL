import {
  API_PREFIXO,
  AlterarContaSchema,
  AlterarVinculoSchema,
  CriarUsuarioSchema,
  FiltroAuditoriaSchema,
  PERFIS_APROVACAO_FINANCEIRA,
  PERFIS_SELECAO_TESTE,
  type ListaAuditoria,
  type UsuarioAdmin,
} from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Transacao } from '../../db/cliente.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ErroHttp, naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { gerarHashSenha } from '../acesso/senhas.js';
import { revogarSessoesDoUsuario } from '../acesso/sessoes.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { executarIdempotente, type Resposta } from '../idempotencia/executar.js';
import { chaveIdempotencia, responder } from '../idempotencia/http.js';

const ParametrosUsuarioSchema = z.object({ id: z.uuid() });

function usuarioAdmin(u: {
  id: string;
  login: string;
  nome: string;
  ativo: boolean;
  criadoEm: Date;
  vinculo: { perfil: UsuarioAdmin['role']; ativo: boolean; aprovaFinanceiro: boolean; selecaoClienteTeste: boolean };
}): UsuarioAdmin {
  return {
    id: u.id,
    login: u.login,
    name: u.nome,
    accountActive: u.ativo,
    role: u.vinculo.perfil,
    membershipActive: u.vinculo.ativo,
    financialApproval: u.vinculo.aprovaFinanceiro,
    clientSelectionTest: u.vinculo.selecaoClienteTeste,
    createdAt: u.criadoEm.toISOString(),
  };
}

async function vinculoNoEscopo(tx: Transacao, usuarioId: string, escopoId: string) {
  const vinculo = await tx.vinculo.findUnique({
    where: { usuarioId_escopoId: { usuarioId, escopoId } },
    include: { usuario: true },
  });
  // Usuário sem vínculo no escopo ativo responde como inexistente.
  if (!vinculo) throw naoEncontrado('Usuário não encontrado neste escopo.');
  return vinculo;
}

async function administradoresAtivos(tx: Transacao, escopoId: string): Promise<number> {
  return tx.vinculo.count({ where: { escopoId, perfil: 'ADMINISTRADOR', ativo: true, usuario: { ativo: true } } });
}

/** Administração de acesso do escopo ativo. Toda mutação é idempotente, transacional e auditada. */
export function registrarRotasAdmin(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  const administrar = { preHandler: auth.exigirPermissao('acesso.administrar') };

  app.get(`${API_PREFIXO}/admin/usuarios`, administrar, async (request) => {
    const escopo = escopoAtivoDe(request);
    const vinculos = await deps.db.vinculo.findMany({
      where: { escopoId: escopo.id },
      include: { usuario: true },
      orderBy: { usuario: { login: 'asc' } },
    });
    return {
      items: vinculos.map((v) =>
        usuarioAdmin({ ...v.usuario, vinculo: { perfil: v.perfil, ativo: v.ativo, aprovaFinanceiro: v.aprovaFinanceiro, selecaoClienteTeste: v.selecaoClienteTeste } }),
      ),
    };
  });

  app.post(`${API_PREFIXO}/admin/usuarios`, administrar, async (request, reply) => {
    const contexto = contextoDe(request);
    const escopo = escopoAtivoDe(request);
    const chave = chaveIdempotencia(request);
    const dados = CriarUsuarioSchema.safeParse(request.body);
    if (!dados.success) throw requisicaoInvalida(dados.error.issues[0]?.message ?? 'Dados do usuário inválidos.');
    const senhaHash = await gerarHashSenha(dados.data.initialPassword);

    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: contexto.sessao.usuario.id, operacao: 'admin.criar_usuario', chave, payload: { corpo: request.body } },
      async (tx): Promise<Resposta> => {
        try {
          const usuario = await tx.usuario.create({
            data: {
              login: dados.data.login,
              nome: dados.data.name,
              senhaHash,
              vinculos: { create: { escopoId: escopo.id, perfil: dados.data.role } },
            },
          });
          await registrarEvento(tx, {
            acao: 'USUARIO_CRIADO',
            resultado: 'SUCESSO',
            atorUsuarioId: contexto.sessao.usuario.id,
            escopoId: escopo.id,
            alvoTipo: 'USUARIO',
            alvoId: usuario.id,
            detalhes: { login: usuario.login, perfil: dados.data.role },
            requestId: request.id,
          });
          const corpo = usuarioAdmin({ ...usuario, vinculo: { perfil: dados.data.role, ativo: true, aprovaFinanceiro: false, selecaoClienteTeste: false } });
          return { status: 201, corpo };
        } catch (erro) {
          if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
            throw new ErroHttp(409, 'CONFLITO', 'Login indisponível. Escolha outro.');
          }
          throw erro;
        }
      },
    );
    return responder(reply, resultado);
  });

  app.put(`${API_PREFIXO}/admin/usuarios/:id/vinculo`, administrar, async (request, reply) => {
    const contexto = contextoDe(request);
    const escopo = escopoAtivoDe(request);
    const chave = chaveIdempotencia(request);
    const parametros = ParametrosUsuarioSchema.safeParse(request.params);
    const dados = AlterarVinculoSchema.safeParse(request.body);
    if (!parametros.success || !dados.success) throw requisicaoInvalida('Perfil ou situação inválidos.');
    const alvoId = parametros.data.id;

    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      {
        escopoId: escopo.id,
        usuarioId: contexto.sessao.usuario.id,
        operacao: 'admin.alterar_vinculo',
        chave,
        payload: { alvoId, corpo: request.body },
      },
      async (tx): Promise<Resposta> => {
        const vinculo = await vinculoNoEscopo(tx, alvoId, escopo.id);
        const deixaDeSerAdmin = vinculo.perfil === 'ADMINISTRADOR' && vinculo.ativo && (dados.data.role !== 'ADMINISTRADOR' || !dados.data.active);
        if (deixaDeSerAdmin && alvoId === contexto.sessao.usuario.id) {
          throw new ErroHttp(409, 'CONFLITO', 'Você não pode remover o próprio acesso administrativo.');
        }
        if (deixaDeSerAdmin && (await administradoresAtivos(tx, escopo.id)) <= 1) {
          throw new ErroHttp(409, 'CONFLITO', 'O escopo precisa manter ao menos um administrador ativo.');
        }
        // Aprovação financeira de claims: concessão explícita, só a perfil elegível;
        // mudar para outro perfil retira a concessão.
        const elegivel = PERFIS_APROVACAO_FINANCEIRA.includes(dados.data.role);
        if (dados.data.financialApproval === true && !elegivel) {
          throw requisicaoInvalida('A aprovação financeira de claims só pode ser concedida a analista de claims.');
        }
        const aprovaFinanceiro = elegivel && (dados.data.financialApproval ?? vinculo.aprovaFinanceiro);
        // "Seleção cliente — teste": concessão explícita ao responsável interno (supervisor ou administrador).
        const elegivelTeste = PERFIS_SELECAO_TESTE.includes(dados.data.role);
        if (dados.data.clientSelectionTest === true && !elegivelTeste) {
          throw requisicaoInvalida('A "Seleção cliente — teste" só pode ser concedida a supervisor de estoque ou administrador.');
        }
        const selecaoClienteTeste = elegivelTeste && (dados.data.clientSelectionTest ?? vinculo.selecaoClienteTeste);
        const atualizado = await tx.vinculo.update({
          where: { id: vinculo.id },
          data: { perfil: dados.data.role, ativo: dados.data.active, aprovaFinanceiro, selecaoClienteTeste, versao: { increment: 1 } },
        });
        await registrarEvento(tx, {
          acao: 'VINCULO_ALTERADO',
          resultado: 'SUCESSO',
          atorUsuarioId: contexto.sessao.usuario.id,
          escopoId: escopo.id,
          alvoTipo: 'USUARIO',
          alvoId,
          detalhes: {
            perfilAnterior: vinculo.perfil,
            perfilNovo: atualizado.perfil,
            ativoAnterior: vinculo.ativo,
            ativoNovo: atualizado.ativo,
            aprovacaoFinanceiraAnterior: vinculo.aprovaFinanceiro,
            aprovacaoFinanceiraNova: atualizado.aprovaFinanceiro,
            selecaoClienteTesteAnterior: vinculo.selecaoClienteTeste,
            selecaoClienteTesteNova: atualizado.selecaoClienteTeste,
          },
          requestId: request.id,
        });
        return {
          status: 200,
          corpo: usuarioAdmin({
            ...vinculo.usuario,
            vinculo: { perfil: atualizado.perfil, ativo: atualizado.ativo, aprovaFinanceiro: atualizado.aprovaFinanceiro, selecaoClienteTeste: atualizado.selecaoClienteTeste },
          }),
        };
      },
    );
    return responder(reply, resultado);
  });

  app.patch(`${API_PREFIXO}/admin/usuarios/:id/conta`, administrar, async (request, reply) => {
    const contexto = contextoDe(request);
    const escopo = escopoAtivoDe(request);
    const chave = chaveIdempotencia(request);
    const parametros = ParametrosUsuarioSchema.safeParse(request.params);
    const dados = AlterarContaSchema.safeParse(request.body);
    if (!parametros.success || !dados.success) throw requisicaoInvalida('Situação da conta inválida.');
    const alvoId = parametros.data.id;
    if (alvoId === contexto.sessao.usuario.id) throw new ErroHttp(409, 'CONFLITO', 'Você não pode desativar a própria conta.');

    const resultado = await executarIdempotente(
      deps.db,
      deps.config.appSegredo,
      { escopoId: escopo.id, usuarioId: contexto.sessao.usuario.id, operacao: 'admin.alterar_conta', chave, payload: { alvoId, corpo: request.body } },
      async (tx): Promise<Resposta> => {
        const vinculo = await vinculoNoEscopo(tx, alvoId, escopo.id);
        // A conta é global: só pode ser alterada por quem administra todos os
        // escopos em que ela tem acesso ativo.
        const outrosEscopos = await tx.vinculo.findMany({
          where: { usuarioId: alvoId, ativo: true, escopoId: { not: escopo.id } },
          select: { escopoId: true },
        });
        const administrados = new Set(
          contexto.escopos.filter((e) => e.role === 'ADMINISTRADOR').map((e) => e.id),
        );
        if (outrosEscopos.some((v) => !administrados.has(v.escopoId))) {
          throw new ErroHttp(
            403,
            'ACESSO_NEGADO',
            'A conta tem acesso a escopos que você não administra. Desative apenas o vínculo deste escopo.',
          );
        }
        const agora = deps.agora();
        const usuario = await tx.usuario.update({
          where: { id: alvoId },
          data: { ativo: dados.data.active, desativadoEm: dados.data.active ? null : agora, versao: { increment: 1 } },
        });
        const sessoesRevogadas = dados.data.active ? 0 : await revogarSessoesDoUsuario(tx, alvoId, 'CONTA_DESATIVADA', agora);
        await registrarEvento(tx, {
          acao: dados.data.active ? 'CONTA_REATIVADA' : 'CONTA_DESATIVADA',
          resultado: 'SUCESSO',
          atorUsuarioId: contexto.sessao.usuario.id,
          escopoId: escopo.id,
          alvoTipo: 'USUARIO',
          alvoId,
          detalhes: { sessoesRevogadas },
          requestId: request.id,
        });
        return {
          status: 200,
          corpo: usuarioAdmin({
            ...usuario,
            vinculo: { perfil: vinculo.perfil, ativo: vinculo.ativo, aprovaFinanceiro: vinculo.aprovaFinanceiro, selecaoClienteTeste: vinculo.selecaoClienteTeste },
          }),
        };
      },
    );
    return responder(reply, resultado);
  });

  app.get(`${API_PREFIXO}/admin/auditoria`, { preHandler: auth.exigirPermissao('auditoria.consultar') }, async (request) => {
    const escopo = escopoAtivoDe(request);
    const filtro = FiltroAuditoriaSchema.safeParse(request.query);
    if (!filtro.success) throw requisicaoInvalida('Filtro de auditoria inválido.');
    const eventos = await deps.db.eventoAuditoria.findMany({
      where: { escopoId: escopo.id, ...(filtro.data.antesDe ? { ocorridoEm: { lt: new Date(filtro.data.antesDe) } } : {}) },
      include: { ator: { select: { id: true, login: true } } },
      orderBy: [{ ocorridoEm: 'desc' }, { id: 'desc' }],
      take: filtro.data.limite,
    });
    const ultimo = eventos.at(-1);
    const corpo: ListaAuditoria = {
      items: eventos.map((e) => ({
        id: e.id,
        at: e.ocorridoEm.toISOString(),
        action: e.acao,
        result: e.resultado,
        actor: e.ator,
        targetType: e.alvoTipo,
        targetId: e.alvoId,
        details: e.detalhes !== null && typeof e.detalhes === 'object' && !Array.isArray(e.detalhes) ? (e.detalhes as Record<string, unknown>) : null,
      })),
      nextCursor: eventos.length === filtro.data.limite && ultimo ? ultimo.ocorridoEm.toISOString() : null,
    };
    return corpo;
  });
}
