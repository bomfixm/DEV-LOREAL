import { API_PREFIXO, FiltroBuscaSchema, type BaseResultado, type Correspondencia, type FiltroBusca, type ResultadoBusca } from '@praca-reversa/contracts';
import type { FastifyInstance } from 'fastify';
import { celulaCsv, documentoCsv, nomeDownload, quantidadeCsv } from '../../http/csv-seguro.js';
import { contextoDe, escopoAtivoDe, type Autenticacao, type Dependencias } from '../acesso/contexto.js';
import { registrarEvento } from '../auditoria/registrar.js';
import { validar } from '../idempotencia/http.js';
import { buscar, buscarParaExportar } from './consulta.js';

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

export const ROTULO_BASE: Readonly<Record<BaseResultado, string>> = {
  PALETE: 'Palete',
  SALDO_VALIDADO: 'Saldo validado',
  OBSERVADO: 'Observado em conferência (não validado)',
  DECLARADO_PALETE: 'Declarado no cadastro do palete (documento)',
  DOCUMENTO: 'Documento importado (sem vínculo físico)',
  INVENTARIO: 'Vínculo informado no inventário (NF × palete)',
  CONTEUDO: 'Conteúdo registrado no palete',
  ORIGEM_INVENTARIO: 'Origem do inventário sem alocação',
};

const ROTULO_CORRESPONDENCIA: Readonly<Record<Correspondencia, string>> = {
  ID_PALETE: 'ID do palete (QR)',
  CODIGO_PALETE: 'Código do palete',
  CODIGO_PALETE_PARCIAL: 'Parte do código do palete',
  ENDERECO: 'Endereço',
  ENDERECO_PARCIAL: 'Parte do endereço',
  SKU: 'SKU exato',
  SKU_PREFIXO: 'SKU começa com o texto',
  CODIGO_BARRAS: 'Código de barras exato',
  CODIGO_BARRAS_PREFIXO: 'Código de barras começa com o texto',
  LOTE: 'Lote exato',
  LOTE_PREFIXO: 'Lote começa com o texto',
  DOCUMENTO: 'Referência do documento exata',
  DOCUMENTO_PREFIXO: 'Referência começa com o texto',
  NF: 'NF exata',
  NF_PREFIXO: 'NF começa com o texto',
  DESCRICAO_APROXIMADA: 'Descrição aproximada (confira o SKU)',
  FILTRO: 'Filtro',
};

function descreverFiltro(f: FiltroBusca): string {
  const partes = [
    `texto: ${f.texto && f.texto !== '' ? f.texto : '(nenhum)'}`,
    `buscar em: ${f.campo}`,
    `bases: ${f.base && f.base.length > 0 ? f.base.join(', ') : 'todas'}`,
  ];
  if (f.conferencia) partes.push(`conferência: ${f.conferencia}`);
  if (f.liberacao) partes.push(`liberação: ${f.liberacao}`);
  if (f.condicao) partes.push(`condição: ${f.condicao}`);
  if (f.localizacao) partes.push(`localização: ${f.localizacao}`);
  if (f.emConferencia) partes.push('somente em conferência');
  return partes.join('; ');
}

function linhaCsv(r: ResultadoBusca): string[] {
  return [
    celulaCsv(ROTULO_BASE[r.base]),
    celulaCsv(ROTULO_CORRESPONDENCIA[r.match]),
    celulaCsv(r.pallet?.code ?? (r.base === 'DOCUMENTO' ? 'sem vínculo físico' : null)),
    celulaCsv(r.pallet ? (r.pallet.positionCode ?? 'localização pendente') : null),
    celulaCsv(r.pallet?.countState ?? null),
    celulaCsv(r.pallet?.releaseState ?? null),
    celulaCsv(r.product?.sku ?? (r.pendingDescription !== null ? 'produto pendente' : null)),
    celulaCsv(r.product?.description ?? r.pendingDescription),
    celulaCsv(r.base === 'PALETE' ? null : (r.lot ?? 'pendente')),
    celulaCsv(r.base === 'PALETE' ? null : (r.originType ?? 'pendente')),
    celulaCsv(r.base === 'PALETE' ? null : (r.originReference ?? 'pendente')),
    celulaCsv(r.condition),
    quantidadeCsv(r.quantity),
    celulaCsv(r.unit),
    quantidadeCsv(r.reserved),
    quantidadeCsv(r.available),
    celulaCsv(r.session ? `nº ${String(r.session.number)}` : null),
    celulaCsv(r.session?.scope ?? null),
    r.session ? String(r.session.pendingLines) : '',
    celulaCsv(r.document?.reference ?? null),
    celulaCsv(r.document?.lineReference ?? null),
    celulaCsv(r.document?.invoice ?? null),
    celulaCsv(r.document?.date ?? null),
    quantidadeCsv(r.document?.declaredQuantity ?? null),
    celulaCsv(r.document?.declaredUnit ?? null),
    quantidadeCsv(r.document?.factor ?? null),
    celulaCsv(r.documentLink?.inventoryCode ?? r.inventoryOrigin?.inventoryCode ?? null),
    r.documentLink ? String(r.documentLink.row) : r.inventoryOrigin ? String(r.inventoryOrigin.row) : '',
    celulaCsv(r.documentLink?.documentType ?? r.contentLink?.documentType ?? r.inventoryOrigin?.documentType ?? null),
    celulaCsv(r.documentLink?.documentNumber ?? r.contentLink?.documentNumber ?? r.inventoryOrigin?.documentNumber ?? null),
    celulaCsv(r.documentLink?.delivery ?? r.contentLink?.delivery ?? r.inventoryOrigin?.delivery ?? null),
    quantidadeCsv(r.documentLink?.volumes ?? r.contentLink?.counted ?? r.inventoryOrigin?.volumes ?? null),
    celulaCsv(r.documentLink?.volumesUnit ?? null),
    celulaCsv(r.documentLink?.informedAddress ?? (r.inventoryOrigin ? (r.inventoryOrigin.informedAddress ?? 'sem alocação / endereço não informado') : null)),
    celulaCsv(r.documentLink?.documentation ?? null),
  ];
}

const COLUNAS = [
  'Base da informação',
  'Correspondência',
  'Palete',
  'Endereço atual',
  'Conferência do palete',
  'Liberação do palete',
  'SKU',
  'Descrição',
  'Lote',
  'Tipo de origem',
  'Referência de origem',
  'Condição',
  'Quantidade (na base)',
  'Unidade',
  'Reservado',
  'Disponível',
  'Conferência',
  'Escopo da conferência',
  'Pendências da conferência',
  'Documento',
  'Linha do documento',
  'NF',
  'Data do documento',
  'Quantidade declarada original',
  'Unidade declarada',
  'Fator usado',
  'Inventário de referência',
  'Linha do inventário',
  'Tipo documental (inventário)',
  'Número do documento (inventário)',
  'DELIVERY',
  'Volumes informados',
  'Unidade dos volumes',
  'Endereço informado no inventário',
  'Documentação informada',
];

/**
 * Busca operacional (`palete.consultar`) e exportação CSV (`busca.exportar`),
 * restritas ao escopo ativo. A exportação aplica o mesmo filtro da tela, no
 * servidor, até o limite configurado (informado no arquivo).
 */
export function registrarRotasBusca(app: FastifyInstance, deps: Dependencias, auth: Autenticacao): void {
  app.get(`${API_PREFIXO}/busca`, { preHandler: auth.exigirPermissao('palete.consultar') }, async (request) => {
    const filtro = validar(FiltroBuscaSchema, request.query, 'Busca inválida: texto até 120 caracteres, até 100 por página.');
    return buscar(deps.db, escopoAtivoDe(request), filtro, deps.agora());
  });

  app.get(
    `${API_PREFIXO}/busca/exportar`,
    { preHandler: [auth.exigirPermissao('palete.consultar'), auth.exigirPermissao('busca.exportar')] },
    async (request, reply) => {
      const escopo = escopoAtivoDe(request);
      const filtro = validar(FiltroBuscaSchema, request.query, 'Busca inválida.');
      const limite = deps.exportacaoMaxLinhas;
      const agora = deps.agora();
      const { itens, total } = await buscarParaExportar(deps.db, escopo, filtro, limite);
      await registrarEvento(deps.db, {
        acao: 'BUSCA_EXPORTADA',
        resultado: 'SUCESSO',
        atorUsuarioId: contextoDe(request).sessao.usuario.id,
        escopoId: escopo.id,
        detalhes: { campo: filtro.campo, linhas: itens.length, total, limitada: total > itens.length },
        requestId: request.id,
      });
      const topo = [
        [celulaCsv('Exportação da busca — Praça Reversa')],
        [celulaCsv('Escopo'), celulaCsv(`${escopo.name}${escopo.demo ? ' (demonstração, dados fictícios)' : ''}`)],
        [celulaCsv('Filtros'), celulaCsv(descreverFiltro(filtro))],
        [celulaCsv('Gerado em'), celulaCsv(`${DATA_HORA.format(agora)} (horário de Brasília)`)],
        [
          celulaCsv('Linhas'),
          celulaCsv(total > itens.length ? `${String(itens.length)} de ${String(total)} (limitado a ${String(limite)} linhas: refine os filtros)` : String(itens.length)),
        ],
        [
          celulaCsv('Base das quantidades'),
          celulaCsv(
            'Cada linha tem a sua base: saldo validado, observado (não validado), declarado no palete, documento importado ou vínculo informado no inventário. Quantidades de bases diferentes não se somam; documento não comprova presença física; volumes do inventário não são unidades de produto.',
          ),
        ],
        [],
        COLUNAS.map((c) => celulaCsv(c)),
      ];
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${nomeDownload(`busca-${agora.toISOString().slice(0, 16).replace(/[:T]/g, '')}`)}.csv"`)
        .send(documentoCsv([...topo, ...itens.map(linhaCsv)]));
    },
  );
}
