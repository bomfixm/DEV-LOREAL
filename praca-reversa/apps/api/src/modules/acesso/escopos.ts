import type { EscopoComPerfil } from '@praca-reversa/contracts';
import type { Banco, Transacao } from '../../db/cliente.js';

/**
 * Escopos em que o usuário tem vínculo ativo, na ordem de criação do escopo.
 * Lidos a cada requisição: mudanças de perfil ou desativação de vínculo valem
 * imediatamente para sessões abertas.
 */
export async function escoposDoUsuario(db: Banco | Transacao, usuarioId: string): Promise<EscopoComPerfil[]> {
  const vinculos = await db.vinculo.findMany({
    where: { usuarioId, ativo: true, escopo: { ativo: true } },
    include: { escopo: { include: { unidade: true, cliente: true } } },
    orderBy: [{ escopo: { criadoEm: 'asc' } }, { escopo: { nome: 'asc' } }],
  });
  return vinculos.map((v) => ({
    id: v.escopo.id,
    name: v.escopo.nome,
    unitCode: v.escopo.unidade.codigo,
    unitName: v.escopo.unidade.nome,
    clientCode: v.escopo.cliente.codigo,
    clientName: v.escopo.cliente.nome,
    demo: v.escopo.demonstracao,
    role: v.perfil,
    financialApproval: v.aprovaFinanceiro,
    clientSelectionTest: v.selecaoClienteTeste,
  }));
}
