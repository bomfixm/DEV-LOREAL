/**
 * Criação do primeiro administrador de um ou mais escopos (bootstrap). Usada
 * apenas pelo comando local src/cli/criar-admin.ts; não há rota HTTP.
 */
import { NovaSenhaSchema, NovoLoginSchema } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Banco } from '../../db/cliente.js';
import { gerarHashSenha } from './senhas.js';
import { registrarEvento } from '../auditoria/registrar.js';

export interface PedidoAdmin {
  login: string;
  nome: string;
  senha: string;
  unidade?: { codigo: string; nome?: string | undefined } | undefined;
  cliente?: { codigo: string; nome?: string | undefined } | undefined;
}

export async function criarPrimeiroAdministrador(db: Banco, pedido: PedidoAdmin): Promise<{ usuarioId: string; escopos: string[] }> {
  const login = NovoLoginSchema.parse(pedido.login);
  const senha = NovaSenhaSchema.parse(pedido.senha);
  const nome = pedido.nome.trim();
  if (nome.length < 2) throw new Error('Informe o nome do administrador (--nome).');
  const senhaHash = await gerarHashSenha(senha);

  return db.$transaction(async (tx) => {
    let escopos: { id: string; nome: string }[];
    if (pedido.unidade || pedido.cliente) {
      if (!pedido.unidade || !pedido.cliente) throw new Error('Informe --unidade e --cliente juntos.');
      const unidade =
        (await tx.unidade.findUnique({ where: { codigo: pedido.unidade.codigo } })) ??
        (await tx.unidade.create({
          data: { id: randomUUID(), codigo: pedido.unidade.codigo, nome: pedido.unidade.nome ?? pedido.unidade.codigo },
        }));
      const cliente =
        (await tx.cliente.findUnique({ where: { codigo: pedido.cliente.codigo } })) ??
        (await tx.cliente.create({
          data: { id: randomUUID(), codigo: pedido.cliente.codigo, nome: pedido.cliente.nome ?? pedido.cliente.codigo },
        }));
      const escopo =
        (await tx.escopo.findUnique({ where: { unidadeId_clienteId: { unidadeId: unidade.id, clienteId: cliente.id } } })) ??
        (await tx.escopo.create({
          data: {
            id: randomUUID(),
            unidadeId: unidade.id,
            clienteId: cliente.id,
            nome: `${unidade.nome} · ${cliente.nome}`,
            demonstracao: unidade.demonstracao && cliente.demonstracao,
          },
        }));
      escopos = [escopo];
    } else {
      escopos = await tx.escopo.findMany({ where: { ativo: true }, orderBy: { criadoEm: 'asc' } });
      if (escopos.length === 0) throw new Error('Nenhum escopo existe. Informe --unidade e --cliente.');
    }

    const comAdmin = await tx.vinculo.findMany({
      where: { escopoId: { in: escopos.map((e) => e.id) }, perfil: 'ADMINISTRADOR', ativo: true, usuario: { ativo: true } },
      include: { escopo: true },
    });
    if (comAdmin.length > 0) {
      throw new Error(
        `Já existe administrador ativo em: ${[...new Set(comAdmin.map((v) => v.escopo.nome))].join(', ')}. ` +
          'Crie outras contas pela administração de acesso.',
      );
    }
    if (await tx.usuario.findUnique({ where: { login } })) throw new Error('Login indisponível.');

    const usuario = await tx.usuario.create({
      data: {
        login,
        nome,
        senhaHash,
        vinculos: { create: escopos.map((e) => ({ escopoId: e.id, perfil: 'ADMINISTRADOR' as const })) },
      },
    });
    for (const e of escopos) {
      await registrarEvento(tx, {
        acao: 'ADMIN_BOOTSTRAP',
        resultado: 'SUCESSO',
        escopoId: e.id,
        alvoTipo: 'USUARIO',
        alvoId: usuario.id,
        detalhes: { login, origem: 'comando_local' },
      });
    }
    return { usuarioId: usuario.id, escopos: escopos.map((e) => e.nome) };
  });
}
