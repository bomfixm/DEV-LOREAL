import { API_PREFIXO, FiltroEtiquetasSchema, ehEnderecoLocal, urlDoPalete, type LoteEtiquetas } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { ErroHttp, naoEncontrado } from '../../http/erros.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { validar } from '../idempotencia/http.js';

/**
 * Dados das etiquetas internas. O QR é gerado na interface a partir de `url`
 * (rota autenticada do palete pelo ID permanente, com a URL base configurada
 * por ambiente em APP_URL_PUBLICA). Nenhum produto, quantidade ou documento
 * entra na etiqueta. A emissão fica registrada na auditoria.
 */
export function registrarRotasEtiquetas(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  app.get(`${API_PREFIXO}/etiquetas`, { preHandler: auth.exigirPermissao('etiqueta.imprimir') }, async (request) => {
    const escopo = escopoAtivoDe(request);
    const usuarioId = contextoDe(request).sessao.usuario.id;
    const { ids } = validar(FiltroEtiquetasSchema, request.query, 'Informe de 1 a 50 IDs de palete separados por vírgula.');

    const paletes = await deps.db.palete.findMany({
      where: { escopoId: escopo.id, id: { in: ids } },
      select: { id: true, codigo: true, arquivadoEm: true, posicao: { select: { codigo: true, codigoProvisorio: true } } },
    });
    if (paletes.length !== ids.length) {
      const encontrados = new Set(paletes.map((p) => p.id));
      const deOutros = await deps.db.palete.findMany({
        where: { id: { in: ids.filter((id) => !encontrados.has(id)) } },
        select: { id: true, escopoId: true },
      });
      for (const outro of deOutros) {
        await registrarEvento(deps.db, {
          acao: 'ACESSO_NEGADO',
          resultado: 'NEGADO',
          atorUsuarioId: usuarioId,
          escopoId: outro.escopoId,
          alvoTipo: 'PALETE',
          alvoId: outro.id,
          detalhes: { motivo: 'etiqueta_de_outro_escopo', escopoAtivo: escopo.id },
          requestId: request.id,
        });
      }
      throw naoEncontrado('Palete não encontrado neste escopo. Nenhuma etiqueta foi emitida.');
    }
    const arquivado = paletes.find((p) => p.arquivadoEm !== null);
    if (arquivado) throw new ErroHttp(409, 'CONFLITO', `O palete ${arquivado.codigo} está arquivado: etiqueta não emitida.`);

    const porId = new Map(paletes.map((p) => [p.id, p]));
    // Link do QR: origem pública + caminho-base da instalação (ex.: https://host/praca/paletes/<id>).
    const base = `${deps.config.urlPublica}${(deps.caminhoBase ?? '/').replace(/\/$/, '')}`;
    const corpo: LoteEtiquetas = {
      generatedAt: deps.agora().toISOString(),
      environment: deps.config.ambiente,
      baseUrl: base,
      localAddress: ehEnderecoLocal(new URL(base).hostname),
      scope: { name: escopo.name, demo: escopo.demo },
      labels: ids.flatMap((id) => {
        const p = porId.get(id);
        return p
          ? [
              {
                palletId: p.id,
                code: p.codigo,
                url: urlDoPalete(base, p.id),
                positionCode: p.posicao?.codigo ?? null,
                positionProvisional: p.posicao ? p.posicao.codigoProvisorio : null,
              },
            ]
          : [];
      }),
    };
    await registrarEvento(deps.db, {
      acao: 'ETIQUETA_EMITIDA',
      resultado: 'SUCESSO',
      atorUsuarioId: usuarioId,
      escopoId: escopo.id,
      alvoTipo: 'PALETE',
      alvoId: ids.length === 1 ? (ids[0] ?? null) : null,
      detalhes: { quantidade: ids.length, codigos: corpo.labels.map((l) => l.code).join(', '), urlBase: base },
      requestId: request.id,
    });
    return corpo;
  });
}
