import {
  API_PREFIXO,
  FiltroPeriodoSchema,
  FiltroRelatorioSchema,
  TipoRelatorioSchema,
  type Permissao,
  type Relatorio,
} from '@praca-reversa/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { celulaCsv, documentoCsv, nomeDownload, quantidadeCsv } from '../../http/csv-seguro.js';
import { acessoNegado } from '../../http/erros.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { validar } from '../idempotencia/http.js';
import { fusoDoEscopo } from '../janelas/leitura.js';
import { consultarIndicadores } from './consultas.js';
import { PERMISSAO_RELATORIO, gerarRelatorio } from './relatorios.js';

const TipoSchema = z.object({ tipo: TipoRelatorioSchema });

/** CSV do relatório: o mesmo conteúdo da tela (filtros, base, notas, totais e linhas). */
export function relatorioCsv(r: Relatorio, fuso: string): Buffer {
  const dataHora = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, dateStyle: 'short', timeStyle: 'short' });
  const par = (rotulo: string, valor: string) => [celulaCsv(rotulo), celulaCsv(valor)];
  const topo: string[][] = [
    [celulaCsv(`${r.title} — Praça Reversa`)],
    par('Escopo', `${r.scope.name}${r.scope.demo ? ' (demonstração, dados fictícios)' : ''}`),
    ...r.filters.map((f) => par(f.label, f.value)),
    par('Consultado em', `${dataHora.format(new Date(r.consultedAt))} (${fuso})`),
    par('Linhas', r.total > r.rows.length ? `${String(r.rows.length)} de ${String(r.total)} (limite de ${String(r.exportLimit)} por exportação; refine os filtros)` : String(r.rows.length)),
    ...r.basis.map((b) => par('Base', b)),
    ...r.notes.map((nota) => par('Atenção', nota)),
    ...r.summary.map((s) => [celulaCsv(`Total — ${s.label}`), s.kind === 'texto' || s.kind === 'codigo' ? celulaCsv(s.value) : quantidadeCsv(s.value)]),
    [],
    r.columns.map((c) => celulaCsv(c.label)),
  ];
  const linhas = r.rows.map((linha) =>
    r.columns.map((c) => {
      const valor = linha[c.key] ?? null;
      if (valor === null) return '';
      switch (c.kind) {
        case 'quantidade':
        case 'numero':
          return quantidadeCsv(valor);
        case 'datahora':
          return celulaCsv(dataHora.format(new Date(valor)));
        default:
          // Códigos e textos sempre como texto entre aspas (zeros à esquerda preservados; fórmulas neutralizadas).
          return celulaCsv(valor);
      }
    }),
  );
  return documentoCsv([...topo, ...linhas]);
}

/**
 * Indicadores e relatórios (etapa 10). Escopo ativo sempre; cada área e cada
 * relatório exigem a permissão de consulta correspondente (conferida no
 * servidor, também na exportação); exportar exige `relatorio.exportar`.
 */
export function registrarRotasIndicadores(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  async function exigir(request: FastifyRequest, permissoes: readonly Permissao[]): Promise<void> {
    const contexto = contextoDe(request);
    const escopo = escopoAtivoDe(request);
    const faltando = permissoes.filter((p) => !contexto.permissoes.has(p));
    if (faltando.length === 0) return;
    await registrarEvento(deps.db, {
      acao: 'ACESSO_NEGADO',
      resultado: 'NEGADO',
      atorUsuarioId: contexto.sessao.usuario.id,
      escopoId: escopo.id,
      detalhes: { permissao: faltando.join('|'), metodo: request.method, rota: request.routeOptions.url ?? request.url },
      requestId: request.id,
    });
    throw acessoNegado();
  }

  app.get(`${API_PREFIXO}/indicadores`, { preHandler: auth.exigirPermissao('praca.consultar') }, async (request) => {
    const filtro = validar(FiltroPeriodoSchema, request.query, 'Período inválido.');
    return consultarIndicadores(deps.db, escopoAtivoDe(request), contextoDe(request).permissoes, filtro, deps.agora());
  });

  app.get(`${API_PREFIXO}/relatorios/:tipo`, async (request) => {
    const { tipo } = validar(TipoSchema, request.params, 'Relatório desconhecido.');
    await exigir(request, [PERMISSAO_RELATORIO[tipo]]);
    const filtro = validar(FiltroRelatorioSchema, request.query, 'Filtros inválidos.');
    return gerarRelatorio(deps.db, escopoAtivoDe(request), tipo, filtro, deps.agora(), false);
  });

  app.get(`${API_PREFIXO}/relatorios/:tipo/exportar`, async (request, reply) => {
    const { tipo } = validar(TipoSchema, request.params, 'Relatório desconhecido.');
    await exigir(request, [PERMISSAO_RELATORIO[tipo], 'relatorio.exportar']);
    const filtro = validar(FiltroRelatorioSchema, request.query, 'Filtros inválidos.');
    const escopo = escopoAtivoDe(request);
    const agora = deps.agora();
    const relatorio = await gerarRelatorio(deps.db, escopo, tipo, filtro, agora, true);
    const fuso = relatorio.period?.timezone ?? (await fusoDoEscopo(deps.db, escopo.id));
    await registrarEvento(deps.db, {
      acao: 'RELATORIO_EXPORTADO',
      resultado: 'SUCESSO',
      atorUsuarioId: contextoDe(request).sessao.usuario.id,
      escopoId: escopo.id,
      alvoTipo: 'RELATORIO',
      alvoId: tipo,
      detalhes: { linhas: relatorio.rows.length, total: relatorio.total, inicio: relatorio.period?.start ?? null, fim: relatorio.period?.end ?? null },
      requestId: request.id,
    });
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('content-disposition', `attachment; filename="${nomeDownload(`relatorio-${tipo}-${agora.toISOString().slice(0, 16).replace(/[:T]/g, '')}`)}.csv"`)
      .send(relatorioCsv(relatorio, fuso));
  });
}
