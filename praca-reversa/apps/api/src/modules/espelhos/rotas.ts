import { API_PREFIXO, FiltroEspelhosSchema, selecionarEspelhos, decomporEnderecoEspelho, type LoteEspelhos, type OpcaoEspelho } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { ErroHttp, naoEncontrado } from '../../http/erros.js';
import { escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { validar } from '../idempotencia/http.js';
import { conteudosDoPalete } from '../conteudos/servico.js';

async function opcoes(deps: Dependencias, escopoId: string): Promise<OpcaoEspelho[]> {
  const paletes = await deps.db.palete.findMany({
    where: { escopoId, arquivadoEm: null, estadoFluxo: { in: ['EM_ESTOQUE', 'RESERVADO'] } },
    orderBy: { codigo: 'asc' },
    select: { id: true, codigo: true, posicao: { select: { endereco: { select: { endereco: true, situacao: true } } } } },
  });
  return paletes.map((p) => {
    const address = p.posicao?.endereco?.situacao === 'CONFIRMADO' ? p.posicao.endereco.endereco : null;
    return { id: p.id, code: p.codigo, address, ...decomporEnderecoEspelho(address) };
  });
}
export function registrarRotasEspelhos(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  app.get(`${API_PREFIXO}/espelhos/opcoes`, { preHandler: auth.exigirPermissao('etiqueta.imprimir') }, async (request) => ({ items: await opcoes(deps, escopoAtivoDe(request).id) }));
  app.get(`${API_PREFIXO}/espelhos`, { preHandler: auth.exigirPermissao('etiqueta.imprimir') }, async (request): Promise<LoteEspelhos> => {
    const escopo = escopoAtivoDe(request);
    const filtro = validar(FiltroEspelhosSchema, request.query, 'Selecione uma rua ou de 1 a 250 paletes.');
    const todos = await opcoes(deps, escopo.id);
    const ids = filtro.ids === undefined ? null : [...new Set(filtro.ids)];
    const selecionados = ids === null ? (filtro.rows ?? []).flatMap((row) => selecionarEspelhos(todos, row, filtro.side)) : ids.flatMap((id) => todos.filter((p) => p.id === id));
    if (ids !== null && selecionados.length !== ids.length) throw naoEncontrado('Palete indisponível neste escopo. Atualize a seleção.');
    if (selecionados.length > 250) throw new ErroHttp(400, 'REQUISICAO_INVALIDA', 'Selecione até 250 paletes por impressão.');
    const items: LoteEspelhos['items'] = [];
    // Lotes pequenos evitam esgotar as conexões ao consultar ruas inteiras.
    for (let i = 0; i < selecionados.length; i += 4) {
      items.push(...await Promise.all(selecionados.slice(i, i + 4).map(async (p) => ({ ...p, contents: await conteudosDoPalete(deps.db, escopo.id, p.id) }))));
    }
    return { generatedAt: deps.agora().toISOString(), scope: { name: escopo.name, demo: escopo.demo }, items };
  });
}
