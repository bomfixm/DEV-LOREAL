import { API_PREFIXO, FiltroPaletesSchema } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { naoEncontrado, requisicaoInvalida } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { consultarPalete, consultarPraca, filtrarPaletes } from './consultas.js';

const ParametrosPaleteSchema = z.object({ id: z.uuid() });

/** Consultas da praça. Somente leitura; tudo restrito ao escopo ativo da sessão. */
export function registrarRotasPraca(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  app.get(`${API_PREFIXO}/praca`, { preHandler: auth.exigirPermissao('praca.consultar') }, (request) =>
    consultarPraca(deps.db, escopoAtivoDe(request), deps.agora()),
  );

  app.get(`${API_PREFIXO}/paletes`, { preHandler: auth.exigirPermissao('palete.consultar') }, (request) => {
    const filtro = FiltroPaletesSchema.safeParse(request.query);
    if (!filtro.success) throw requisicaoInvalida('Filtro inválido: texto até 64 caracteres e limite de 1 a 500.');
    return filtrarPaletes(deps.db, escopoAtivoDe(request), filtro.data, deps.agora());
  });

  app.get(`${API_PREFIXO}/paletes/:id`, { preHandler: auth.exigirPermissao('palete.consultar') }, async (request) => {
    const parametros = ParametrosPaleteSchema.safeParse(request.params);
    if (!parametros.success) throw requisicaoInvalida('Identificador de palete inválido.');
    const escopo = escopoAtivoDe(request);
    const detalhe = await consultarPalete(deps.db, escopo, parametros.data.id, deps.agora());
    if (detalhe) return detalhe;

    // Mesmo 404 para inexistente e para palete de outro escopo; a tentativa
    // sobre outro escopo fica registrada para o administrador desse escopo.
    const outro = await deps.db.palete.findUnique({ where: { id: parametros.data.id }, select: { escopoId: true } });
    if (outro) {
      await registrarEvento(deps.db, {
        acao: 'ACESSO_NEGADO',
        resultado: 'NEGADO',
        atorUsuarioId: contextoDe(request).sessao.usuario.id,
        escopoId: outro.escopoId,
        alvoTipo: 'PALETE',
        alvoId: parametros.data.id,
        detalhes: { motivo: 'palete_de_outro_escopo', escopoAtivo: escopo.id },
        requestId: request.id,
      });
    }
    throw naoEncontrado('Palete não encontrado neste escopo.');
  });
}
