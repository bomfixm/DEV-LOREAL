import {
  LayoutSchema,
  PaleteDetalheSchema,
  chaveDeCodigo,
  verificarOcupacao,
  type ContagemObservada,
  type ItemDeclarado,
  type ItemSaldo,
  type Layout,
  type PaleteDetalhe,
} from '@praca-reversa/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { chaveBase, chaveSegmento, identificado, totalizar } from '../modules/conferencia/regras.js';
import { ParametrosGeometriaSchema } from '../modules/layout/blocos.js';
import type { ArquivoLayoutInformado, ArquivoMapeamento, ArquivoPaletes, ItemExemplo } from './arquivos.js';
import { gerarDesenhoAprovado, type ArquivoDesenhoAprovado } from '../modules/layout/desenho-aprovado.js';
import { idDemoMd5, idDeterministico } from './ids.js';
import { gerarLayoutNavegacao, posicaoVaziaDemo } from './layout-navegacao.js';
import type { LayoutGerado } from '../modules/layout/tipos.js';

export const CODIGOS_DEMO = {
  unidadePraca: 'DEMO-UN-PRACA',
  unidadeNavegacao: 'DEMO-UN-NAVEGACAO',
  cliente: 'DEMO-CLIENTE',
  layoutNavegacao: 'CENARIO-NAVEGACAO',
} as const;

export const ID_UNIDADE_PRACA = idDeterministico(`unidade:${CODIGOS_DEMO.unidadePraca}`);
export const ID_UNIDADE_NAVEGACAO = idDeterministico(`unidade:${CODIGOS_DEMO.unidadeNavegacao}`);
export const ID_CLIENTE_DEMO = idDeterministico(`cliente:${CODIGOS_DEMO.cliente}`);
export const ID_ESCOPO_PRACA = idDeterministico(`escopo:${CODIGOS_DEMO.unidadePraca}:${CODIGOS_DEMO.cliente}`);
export const ID_ESCOPO_NAVEGACAO = idDeterministico(`escopo:${CODIGOS_DEMO.unidadeNavegacao}:${CODIGOS_DEMO.cliente}`);
export const PALETES_SEM_ENDERECO_NAVEGACAO = 2;

export interface FixturesDemo {
  unidades: Prisma.UnidadeCreateManyInput[];
  clientes: Prisma.ClienteCreateManyInput[];
  escopos: Prisma.EscopoCreateManyInput[];
  layouts: Prisma.LayoutCreateManyInput[];
  elementos: Prisma.ElementoLayoutCreateManyInput[];
  fileiras: Prisma.FileiraCreateManyInput[];
  posicoes: Prisma.PosicaoCreateManyInput[];
  paletes: Prisma.PaleteCreateManyInput[];
  produtos: Prisma.ProdutoCreateManyInput[];
  codigosBarras: Prisma.CodigoBarrasCreateManyInput[];
  declarados: Prisma.ItemDeclaradoCreateManyInput[];
  segmentos: Prisma.SegmentoEstoqueCreateManyInput[];
  eventos: Prisma.EventoEstoqueCreateManyInput[];
  saldos: Prisma.SaldoEstoqueCreateManyInput[];
  linhasEvento: Prisma.LinhaEventoEstoqueCreateManyInput[];
  sessoes: Prisma.SessaoConferenciaCreateManyInput[];
  observacoes: Prisma.ObservacaoConferenciaCreateManyInput[];
  /** Endereços reais FICTÍCIOS da demonstração (tabela de correspondência), aplicados pelo código da posição. */
  enderecos: EnderecoDemo[];
}

export interface EnderecoDemo {
  escopoId: string;
  layoutId: string;
  fileiraCodigo: string;
  posicaoCodigo: string;
  prefixo: string;
  codigoLocal: string;
  lado: 'ESQUERDO' | 'DIREITO' | 'UNICO';
  ordemVisual: number;
}

/**
 * Sequências fictícias da demonstração (não são as da praça real, ainda
 * pendentes): Fileira 11 (F01) e Fileira 15 (F08 ímpares à esquerda, F09 pares
 * à direita), P01 recebendo o primeiro endereço. As demais faixas ficam sem
 * correspondência para mostrar a pendência.
 */
export const SEQUENCIAS_DEMO: readonly { fileira: string; prefixo: string; codigos: (n: number) => string }[] = [
  { fileira: 'F01', prefixo: '11', codigos: (n) => `A${String(n)}` },
  { fileira: 'F08', prefixo: '15', codigos: (n) => `A${String(99 + 2 * n)}` },
  { fileira: 'F09', prefixo: '15', codigos: (n) => `A${String(100 + 2 * n)}` },
];

/**
 * Códigos de barras fictícios da demonstração (prefixo 2, de circulação
 * restrita, para não coincidir com produtos reais). A caixa de DEMO-101 tem
 * fator 12; a de DEMO-102 está com fator pendente (conversão bloqueada).
 */
export const CODIGOS_BARRAS_DEMO: readonly { sku: string; codigo: string; embalagem: string; fator: string | null }[] = [
  { sku: 'DEMO-101', codigo: '2000000001014', embalagem: 'UN', fator: '1' },
  { sku: 'DEMO-101', codigo: '12000000001011', embalagem: 'CX', fator: '12' },
  { sku: 'DEMO-102', codigo: '2000000001021', embalagem: 'UN', fator: '1' },
  { sku: 'DEMO-102', codigo: '12000000001028', embalagem: 'CX', fator: null },
  { sku: 'DEMO-103', codigo: '2000000001038', embalagem: 'UN', fator: '1' },
];

/** IDs determinísticos iguais aos da migração da etapa 04 (função SQL uuid_deterministico). */
export const idsDemo = {
  produto: (escopoId: string, sku: string) => idDemoMd5(`produto:${escopoId}:${sku}`),
  sessao: (paleteId: string) => idDemoMd5(`sessao:${paleteId}:1`),
  observacao: (paleteId: string, ordem: number) => idDemoMd5(`observacao:${paleteId}:${String(ordem)}`),
  segmento: (escopoId: string, chave: string) => idDemoMd5(`segmento:${escopoId}:${chave}`),
  eventoInicial: (paleteId: string) => idDemoMd5(`evento-saldo-inicial:${paleteId}`),
  saldo: (paleteId: string, segmentoId: string) => idDemoMd5(`saldo:${paleteId}:${segmentoId}`),
  linha: (paleteId: string, segmentoId: string) => idDemoMd5(`linha:${paleteId}:${segmentoId}`),
};

interface LayoutPersistido {
  id: string;
  escopoId: string;
  codigo: string;
  posicaoPorCodigo: Map<string, string>;
}

function idPaleteGerado(numero: number): string {
  return `00000000-0000-4000-8000-${String(numero).padStart(12, '0')}`;
}

function quantidade(item: ItemExemplo): string {
  return String(item.quantity);
}

/**
 * Monta as fixtures fictícias da demonstração:
 * - "Praça informada · demonstração": esquema informado (15 primeiro, depois
 *   17) com os 6 paletes de paletes-demo.json no mapeamento documentado;
 * - "Cenário de navegação · fictício": layout maior da etapa 01, com os 337
 *   paletes gerados (mesmos IDs e endereços), conteúdo desconhecido.
 */
/** Data fictícia (fixa) do bloqueio dos paletes de exemplo: as fixtures não dependem do relógio. */
const DATA_BLOQUEIO_DEMO = new Date('2026-10-01T00:00:00Z');

export function montarFixturesDemo(
  arquivos: { paletes: ArquivoPaletes; layoutInformado: ArquivoLayoutInformado; desenhoAprovado: ArquivoDesenhoAprovado; mapeamento: ArquivoMapeamento },
  base: Date,
): FixturesDemo {
  const f: FixturesDemo = {
    unidades: [
      { id: ID_UNIDADE_PRACA, codigo: CODIGOS_DEMO.unidadePraca, nome: 'Unidade demonstrativa (fictícia)', demonstracao: true },
      { id: ID_UNIDADE_NAVEGACAO, codigo: CODIGOS_DEMO.unidadeNavegacao, nome: 'Unidade de navegação (fictícia)', demonstracao: true },
    ],
    clientes: [{ id: ID_CLIENTE_DEMO, codigo: CODIGOS_DEMO.cliente, nome: 'Cliente demonstrativo (fictício)', demonstracao: true }],
    escopos: [
      {
        id: ID_ESCOPO_PRACA,
        unidadeId: ID_UNIDADE_PRACA,
        clienteId: ID_CLIENTE_DEMO,
        nome: 'Praça informada · demonstração',
        demonstracao: true,
        criadoEm: base,
      },
      {
        id: ID_ESCOPO_NAVEGACAO,
        unidadeId: ID_UNIDADE_NAVEGACAO,
        clienteId: ID_CLIENTE_DEMO,
        nome: 'Cenário de navegação · fictício',
        demonstracao: true,
        criadoEm: new Date(base.getTime() + 1_000),
      },
    ],
    layouts: [],
    elementos: [],
    fileiras: [],
    posicoes: [],
    paletes: [],
    produtos: [],
    codigosBarras: [],
    declarados: [],
    segmentos: [],
    eventos: [],
    saldos: [],
    linhasEvento: [],
    sessoes: [],
    observacoes: [],
    enderecos: [],
  };

  const persistir = (
    escopoId: string,
    layout: {
      id: string;
      codigo: string;
      nome: string;
      versao: string;
      capacidadeTotal: number | null;
      ficticio: boolean;
      observacao: string;
      parametros: Prisma.InputJsonValue | null;
    },
    gerado: LayoutGerado,
  ): LayoutPersistido => {
    f.layouts.push({
      id: layout.id,
      escopoId,
      codigo: layout.codigo,
      nome: layout.nome,
      versao: layout.versao,
      largura: gerado.largura,
      altura: gerado.altura,
      capacidadeTotal: layout.capacidadeTotal,
      esquematico: true,
      ficticio: layout.ficticio,
      observacao: layout.observacao,
      ...(layout.parametros === null ? {} : { parametros: layout.parametros }),
    });
    const prefixo = `${escopoId}:${layout.codigo}`;
    for (const e of gerado.elementos) {
      f.elementos.push({
        id: idDeterministico(`${prefixo}:elemento:${e.codigo}`),
        escopoId,
        layoutId: layout.id,
        tipo: e.tipo,
        codigo: e.codigo,
        rotulo: e.rotulo,
        ficticio: e.ficticio,
        x: e.x,
        y: e.y,
        largura: e.largura,
        altura: e.altura,
        rotuloX: e.caixaRotulo?.x ?? null,
        rotuloY: e.caixaRotulo?.y ?? null,
        rotuloLargura: e.caixaRotulo?.largura ?? null,
        rotuloAltura: e.caixaRotulo?.altura ?? null,
        nomeOperacional: e.nomeOperacional ?? null,
        prefixoEndereco: e.prefixoEndereco ?? null,
      });
    }
    const fileiraPorCodigo = new Map<string, string>();
    for (const r of gerado.fileiras) {
      const id = idDeterministico(`${prefixo}:fileira:${r.codigo}`);
      fileiraPorCodigo.set(r.codigo, id);
      f.fileiras.push({
        id,
        escopoId,
        layoutId: layout.id,
        codigo: r.codigo,
        rotulo: r.rotulo,
        ordem: r.ordem,
        blocoCodigo: r.blocoCodigo,
        x: r.x,
        y: r.y,
        largura: r.largura,
        altura: r.altura,
        rotuloX: r.caixaRotulo.x,
        rotuloY: r.caixaRotulo.y,
        rotuloLargura: r.caixaRotulo.largura,
        rotuloAltura: r.caixaRotulo.altura,
        lado: r.lado ?? null,
      });
    }
    const posicaoPorCodigo = new Map<string, string>();
    for (const p of gerado.posicoes) {
      const id = idDeterministico(`${prefixo}:posicao:${p.codigo}`);
      const fileiraId = fileiraPorCodigo.get(p.fileiraCodigo);
      if (!fileiraId) throw new Error(`Fileira ${p.fileiraCodigo} inexistente.`);
      posicaoPorCodigo.set(p.codigo, id);
      f.posicoes.push({
        id,
        escopoId,
        layoutId: layout.id,
        fileiraId,
        codigo: p.codigo,
        codigoProvisorio: true,
        numero: p.numero,
        x: p.x,
        y: p.y,
        largura: p.largura,
        altura: p.altura,
        disponivel: p.disponivel,
        ocupacaoLevantada: p.ocupacaoLevantada,
        desativada: p.desativada ?? false,
        motivoIndisponibilidade: p.disponivel ? null : (p.motivoIndisponibilidade ?? null),
      });
    }
    return { id: layout.id, escopoId, codigo: layout.codigo, posicaoPorCodigo };
  };

  // Escopo 1: desenho aprovado da praça (mesmo ID e código do layout do
  // esquema informado, para preservar os IDs das posições) + 6 paletes de exemplo.
  const cfg = arquivos.layoutInformado;
  const aprovado = arquivos.desenhoAprovado;
  const geradoPraca = gerarDesenhoAprovado(aprovado);
  const informado = persistir(
    ID_ESCOPO_PRACA,
    {
      id: cfg.layout.id,
      codigo: cfg.layout.codigo,
      nome: 'Praça da reversa — desenho aprovado (demonstração)',
      versao: aprovado.versao,
      capacidadeTotal: null,
      ficticio: false,
      observacao: `${aprovado.fonte} ${aprovado.aviso}`,
      parametros: ParametrosGeometriaSchema.parse(cfg.geometria),
    },
    geradoPraca,
  );
  for (const seq of SEQUENCIAS_DEMO) {
    const fileira = geradoPraca.fileiras.find((r) => r.codigo === seq.fileira);
    if (!fileira) throw new Error(`Fileira ${seq.fileira} ausente no desenho aprovado.`);
    for (const p of geradoPraca.posicoes.filter((x) => x.fileiraCodigo === seq.fileira)) {
      f.enderecos.push({
        escopoId: ID_ESCOPO_PRACA,
        layoutId: cfg.layout.id,
        fileiraCodigo: seq.fileira,
        posicaoCodigo: p.codigo,
        prefixo: seq.prefixo,
        codigoLocal: seq.codigos(p.numero),
        lado: fileira.lado ?? 'UNICO',
        ordemVisual: p.numero,
      });
    }
  }
  const destinos = new Map(arquivos.mapeamento.mapeamento.map((m) => [m.paleteId, m]));

  // Produtos fictícios referenciados pelos paletes de exemplo (unidade canônica UN).
  const produtoPorSku = new Map<string, string>();
  for (const p of arquivos.paletes.pallets) {
    for (const i of [...(p.currentItems ?? []), ...(p.observations ?? []), ...(p.declaredItems ?? [])]) {
      if (produtoPorSku.has(i.sku)) continue;
      const id = idsDemo.produto(ID_ESCOPO_PRACA, i.sku);
      produtoPorSku.set(i.sku, id);
      f.produtos.push({ id, escopoId: ID_ESCOPO_PRACA, sku: i.sku, descricao: i.description, unidadeCanonica: i.unit, ativo: true, versao: 1 });
    }
  }
  for (const c of CODIGOS_BARRAS_DEMO) {
    const produtoId = produtoPorSku.get(c.sku);
    if (!produtoId) throw new Error(`Produto ${c.sku} ausente na demonstração.`);
    f.codigosBarras.push({
      id: idDeterministico(`codigo-barras:${ID_ESCOPO_PRACA}:${c.codigo}`),
      escopoId: ID_ESCOPO_PRACA,
      produtoId,
      codigo: c.codigo,
      embalagem: c.embalagem,
      fatorConversao: c.fator,
    });
  }
  const produtoDe = (sku: string) => {
    const id = produtoPorSku.get(sku);
    if (!id) throw new Error(`Produto ${sku} ausente na demonstração.`);
    return id;
  };

  for (const p of arquivos.paletes.pallets) {
    const destino = destinos.get(p.id);
    if (destino?.codigo !== p.code || destino.enderecoEtapa01 !== p.address) {
      throw new Error(`Mapeamento ausente ou divergente para ${p.code}.`);
    }
    const posicaoId = informado.posicaoPorCodigo.get(destino.posicaoEtapa02);
    if (!posicaoId) throw new Error(`Posição ${destino.posicaoEtapa02} não existe no esquema informado.`);
    const saldo = p.currentItems ?? [];
    const criadoEm = base;
    f.paletes.push({
      id: p.id,
      escopoId: ID_ESCOPO_PRACA,
      codigo: p.code,
      codigoBusca: chaveDeCodigo(p.code),
      origemCodigo: 'DEMONSTRACAO',
      posicaoId,
      estadoConferencia: p.countState,
      estadoLiberacao: p.releaseState,
      estadoFluxo: p.flowState,
      motivoPendencia: p.pendingReason,
      versaoSaldo: saldo.length > 0 ? 2 : 1,
      // Etapa 08: bloqueio do palete inteiro (o estado do palete é resumo derivado).
      ...(p.releaseState === 'BLOQUEADO' ? { bloqueioMotivo: p.pendingReason ?? 'Bloqueio do exemplo (fictício)', bloqueadoEm: DATA_BLOQUEIO_DEMO } : {}),
    });
    // Saldo validado do exemplo: segmentos + saldo + evento de saldo inicial (sem sessão).
    if (saldo.length > 0) {
      const eventoId = idsDemo.eventoInicial(p.id);
      f.eventos.push({
        id: eventoId,
        escopoId: ID_ESCOPO_PRACA,
        tipo: 'SALDO_INICIAL',
        paleteId: p.id,
        sessaoId: null,
        motivo: 'Saldo da carga de demonstração anterior (fictício), registrado sem sessão de conferência.',
        autorId: null,
        ocorridoEm: criadoEm,
        eventoAnteriorId: null,
        versaoSaldoAnterior: 1,
        versaoSaldoPosterior: 2,
      });
      for (const i of saldo) {
        const identidade = {
          produtoId: produtoDe(i.sku),
          lote: i.lot,
          origemTipo: i.returnReference === null ? null : ('DEVOLUCAO' as const),
          origemReferencia: i.returnReference,
          condicao: i.condition,
        };
        // ID derivado dos atributos (igual ao da carga anterior); com lote/origem
        // pendentes, a linhagem é a própria ID (como na migração da etapa 05).
        const segmentoId = idsDemo.segmento(ID_ESCOPO_PRACA, chaveBase(identidade));
        const linhagem = identificado(identidade) ? null : segmentoId;
        const chave = chaveSegmento({ ...identidade, linhagem });
        if (!f.segmentos.some((s) => s.id === segmentoId)) {
          f.segmentos.push({ id: segmentoId, escopoId: ID_ESCOPO_PRACA, ...identidade, unidade: i.unit, linhagem, chave });
        }
        f.saldos.push({
          id: idsDemo.saldo(p.id, segmentoId),
          escopoId: ID_ESCOPO_PRACA,
          paleteId: p.id,
          segmentoId,
          quantidade: quantidade(i),
          quantidadeReservada: '0',
          // Palete liberado no exemplo: todo o saldo validado liberado (fictício).
          quantidadeLiberada: p.releaseState === 'LIBERADO' ? quantidade(i) : '0',
          versao: 1,
        });
        f.linhasEvento.push({
          id: idsDemo.linha(p.id, segmentoId),
          escopoId: ID_ESCOPO_PRACA,
          eventoId,
          paleteId: p.id,
          segmentoId,
          quantidadeAnterior: '0',
          delta: quantidade(i),
          quantidadePosterior: quantidade(i),
        });
      }
    }
    // Contagem do exemplo (parcial ou completa aguardando validação): uma sessão concluída sem responsável.
    const observados = p.observations ?? [];
    if (observados.length > 0) {
      const parcial = p.countState === 'PARCIAL';
      const sessaoId = idsDemo.sessao(p.id);
      f.sessoes.push({
        id: sessaoId,
        escopoId: ID_ESCOPO_PRACA,
        paleteId: p.id,
        numero: 1,
        escopoContagem: parcial ? 'PARCIAL' : 'COMPLETA',
        descricaoEscopo: parcial ? 'Parte física não registrada na carga anterior' : null,
        motivo: 'CONFERENCIA',
        situacao: p.countState === 'RECONCILIADO' ? 'RECONCILIADA' : 'CONCLUIDA',
        ativa: null,
        revisao: 1,
        versaoPaleteInicial: 1,
        versaoSaldoInicial: saldo.length > 0 ? 2 : 1,
        observacoes: 'Contagem da carga de demonstração anterior (fictícia), registrada sem sessão de origem.',
        iniciadaEm: criadoEm,
        atualizadaEm: criadoEm,
        concluidaEm: criadoEm,
        escopoCompletoConfirmado: !parcial,
        ...(p.countState === 'RECONCILIADO' ? { reconciliadaEm: criadoEm, justificativaReconciliacao: 'Carga de demonstração anterior.' } : {}),
      });
      observados.forEach((i, indice) => {
        f.observacoes.push({
          id: idsDemo.observacao(p.id, indice + 1),
          escopoId: ID_ESCOPO_PRACA,
          sessaoId,
          ordem: indice + 1,
          produtoId: produtoDe(i.sku),
          sku: i.sku,
          descricao: i.description,
          codigoLido: null,
          modoEntrada: 'MANUAL',
          quantidadeInformada: quantidade(i),
          unidadeInformada: i.unit,
          fatorConversao: '1',
          quantidadeCanonica: quantidade(i),
          unidadeCanonica: i.unit,
          lote: i.lot,
          origemTipo: i.returnReference === null ? null : 'DEVOLUCAO',
          origemReferencia: i.returnReference,
          condicao: i.condition,
          pendencia: null,
          revisao: 1,
          registradoEm: criadoEm,
        });
      });
    }
    // Linhas declaradas: a referência de devolução do exemplo é a origem documental.
    f.declarados.push(
      ...(p.declaredItems ?? []).map((i, ordem) => ({
        escopoId: ID_ESCOPO_PRACA,
        paleteId: p.id,
        ordem,
        produtoId: produtoDe(i.sku),
        sku: i.sku,
        descricao: i.description,
        lote: i.lot,
        origemTipo: i.returnReference === null ? null : ('DEVOLUCAO' as const),
        origemReferencia: i.returnReference,
        quantidade: quantidade(i),
        unidadeMedida: i.unit,
        condicao: i.condition,
      })),
    );
  }

  // Escopo 2: cenário de navegação fictício com os paletes gerados da etapa 01.
  const geradoNavegacao = gerarLayoutNavegacao();
  const navegacao = persistir(
    ID_ESCOPO_NAVEGACAO,
    {
      id: idDeterministico(`layout:${CODIGOS_DEMO.layoutNavegacao}`),
      codigo: CODIGOS_DEMO.layoutNavegacao,
      nome: 'Cenário de navegação (fictício)',
      versao: 'demo-1',
      capacidadeTotal: null,
      ficticio: true,
      observacao: 'Layout fictício da etapa 01 mantido para testar navegação. Não representa a praça.',
      parametros: null,
    },
    geradoNavegacao,
  );
  let numero = arquivos.paletes.pallets.length + 1;
  const desconhecido = (posicaoId: string | null) => {
    const atual = numero++;
    const codigo = `PAL-DEMO-${String(atual).padStart(3, '0')}`;
    return {
      id: idPaleteGerado(atual),
      escopoId: ID_ESCOPO_NAVEGACAO,
      codigo,
      codigoBusca: chaveDeCodigo(codigo),
      origemCodigo: 'DEMONSTRACAO' as const,
      posicaoId,
      estadoConferencia: 'NAO_CONFERIDO' as const,
      estadoLiberacao: 'PENDENTE' as const,
      estadoFluxo: 'EM_ESTOQUE' as const,
      motivoPendencia: posicaoId ? 'Conteúdo desconhecido' : 'Endereço não registrado; conteúdo desconhecido',
    };
  };
  for (const p of geradoNavegacao.posicoes) {
    const [rua = '', coluna = ''] = p.codigo.split('-');
    if (!p.disponivel || posicaoVaziaDemo(rua, coluna)) continue;
    const posicaoId = navegacao.posicaoPorCodigo.get(p.codigo);
    if (!posicaoId) throw new Error(`Posição ${p.codigo} sem ID.`);
    f.paletes.push(desconhecido(posicaoId));
  }
  for (let i = 0; i < PALETES_SEM_ENDERECO_NAVEGACAO; i++) f.paletes.push(desconhecido(null));

  return f;
}

/** Converte as fixtures para os contratos e aplica as mesmas regras da API. */
export function validarFixtures(f: FixturesDemo): { layouts: Layout[]; paletes: PaleteDetalhe[] } {
  const layouts: Layout[] = f.layouts.map((l) => {
    const elementos = f.elementos.filter((e) => e.layoutId === l.id);
    const fileiras = f.fileiras.filter((r) => r.layoutId === l.id);
    const posicoes = f.posicoes.filter((p) => p.layoutId === l.id);
    return LayoutSchema.parse({
      id: l.id,
      code: l.codigo,
      version: l.versao,
      revision: 1,
      name: l.nome,
      unit: 'UNIDADE_DE_DESENHO',
      origin: 'SUPERIOR_ESQUERDO',
      width: l.largura,
      height: l.altura,
      totalCapacity: l.capacidadeTotal ?? null,
      schematic: l.esquematico ?? true,
      fictional: l.ficticio ?? false,
      elements: elementos.map((e) => ({
        id: e.id,
        kind: e.tipo,
        code: e.codigo,
        label: e.rotulo,
        fictional: e.ficticio ?? false,
        x: e.x,
        y: e.y,
        width: e.largura,
        height: e.altura,
        labelBox:
          e.rotuloX == null ? null : { x: e.rotuloX, y: e.rotuloY, width: e.rotuloLargura, height: e.rotuloAltura },
        operationalName: e.nomeOperacional ?? null,
        addressPrefix: e.prefixoEndereco ?? null,
      })),
      rows: fileiras.map((r) => ({
        id: r.id,
        code: r.codigo,
        label: r.rotulo,
        order: r.ordem,
        blockCode: r.blocoCodigo ?? null,
        x: r.x,
        y: r.y,
        width: r.largura,
        height: r.altura,
        labelBox: { x: r.rotuloX, y: r.rotuloY, width: r.rotuloLargura, height: r.rotuloAltura },
        side: r.lado ?? null,
      })),
      positions: posicoes.map((p) => ({
        id: p.id,
        code: p.codigo,
        provisionalCode: p.codigoProvisorio ?? true,
        rowId: p.fileiraId,
        number: p.numero,
        x: p.x,
        y: p.y,
        width: p.largura,
        height: p.altura,
        available: p.disponivel ?? true,
        unavailableReason: p.motivoIndisponibilidade ?? null,
        occupancySurveyed: p.ocupacaoLevantada ?? false,
        deactivated: p.desativada ?? false,
      })),
    });
  });

  const posicoes = new Map(f.posicoes.map((p) => [p.id, p]));
  const texto = (q: Prisma.ItemDeclaradoCreateManyInput['quantidade'] | null | undefined) =>
    q === null || q === undefined ? null : typeof q === 'string' ? q : typeof q === 'number' ? String(q) : q.toFixed();
  const declarado = (i: Prisma.ItemDeclaradoCreateManyInput): ItemDeclarado => ({
    productId: i.produtoId ?? null,
    sku: i.sku ?? null,
    description: i.descricao,
    lot: i.lote ?? null,
    originType: i.origemTipo ?? null,
    originReference: i.origemReferencia ?? null,
    quantity: texto(i.quantidade) ?? '0',
    unit: i.unidadeMedida,
    condition: i.condicao ?? null,
  });
  const produtos = new Map(f.produtos.map((p) => [p.id ?? '', p]));
  const segmentos = new Map(f.segmentos.map((s) => [s.id ?? '', s]));
  const saldoDe = (paleteId: string): ItemSaldo[] =>
    f.saldos
      .filter((s) => s.paleteId === paleteId)
      .map((s) => {
        const seg = segmentos.get(s.segmentoId);
        const produto = seg ? produtos.get(seg.produtoId) : undefined;
        if (!seg || !produto) throw new Error('Saldo da demonstração sem segmento ou produto.');
        return {
          segmentId: s.segmentoId,
          productId: seg.produtoId,
          sku: produto.sku,
          description: produto.descricao,
          lot: seg.lote ?? null,
          originType: seg.origemTipo ?? null,
          originReference: seg.origemReferencia ?? null,
          condition: seg.condicao,
          lineage: seg.linhagem ?? null,
          quantity: texto(s.quantidade) ?? '0',
          unit: seg.unidade,
          reserved: '0',
          claimLinked: '0',
          released: texto(s.quantidadeLiberada) ?? '0',
          blocked: null,
        };
      });
  const contagensDe = (paleteId: string): ContagemObservada[] =>
    f.sessoes
      .filter((s) => s.paleteId === paleteId && s.situacao === 'CONCLUIDA')
      .map((s) => {
        const linhas = f.observacoes.filter((o) => o.sessaoId === s.id);
        const { totais, pendencias } = totalizar(
          linhas.map((o) => ({
            id: o.id ?? '',
            produtoId: o.produtoId ?? null,
            sku: o.sku ?? null,
            descricao: o.descricao,
            codigoLido: o.codigoLido ?? null,
            lote: o.lote ?? null,
            origemTipo: o.origemTipo ?? null,
            origemReferencia: o.origemReferencia ?? null,
            condicao: o.condicao,
            quantidadeInformada: texto(o.quantidadeInformada) ?? '0',
            unidadeInformada: o.unidadeInformada,
            quantidadeCanonica: texto(o.quantidadeCanonica),
            unidadeCanonica: o.unidadeCanonica ?? null,
            pendencia: o.pendencia ?? null,
            removida: false,
          })),
        );
        const data = new Date(s.iniciadaEm ?? 0).toISOString();
        return {
          session: {
            id: s.id ?? '',
            number: s.numero,
            palletId: paleteId,
            scope: s.escopoContagem,
            scopeDescription: s.descricaoEscopo ?? null,
            kind: s.motivo,
            origin: null,
            state: s.situacao,
            revision: s.revisao ?? 1,
            responsible: null,
            startedAt: data,
            updatedAt: data,
            concludedAt: data,
            concludedBy: null,
            cancelledAt: null,
            reconciledAt: null,
            activeLines: linhas.length,
            pendingLines: pendencias.length,
          },
          items: totais,
          pending: pendencias,
        };
      });
  const paletes = f.paletes.map((p) => {
    const declarados = f.declarados.filter((i) => i.paleteId === p.id).map(declarado);
    const evento = f.eventos.find((e) => e.paleteId === p.id);
    return PaleteDetalheSchema.parse({
      id: p.id,
      code: p.codigo,
      positionId: p.posicaoId ?? null,
      positionCode: p.posicaoId ? (posicoes.get(p.posicaoId)?.codigo ?? null) : null,
      countState: p.estadoConferencia,
      releaseState: p.estadoLiberacao,
      flowState: p.estadoFluxo,
      pendingReason: p.motivoPendencia ?? null,
      activeCountId: null,
      currentItems: evento ? saldoDe(p.id) : null,
      observedCounts: contagensDe(p.id),
      activeCount: null,
      lastReconciliation: evento
        ? { eventId: evento.id ?? '', type: evento.tipo, at: new Date(evento.ocorridoEm ?? 0).toISOString(), by: null, session: null }
        : null,
      lastStockEvent: evento
        ? { eventId: evento.id ?? '', type: evento.tipo, at: new Date(evento.ocorridoEm ?? 0).toISOString(), by: null, session: null }
        : null,
      declaredItems: declarados.length > 0 ? declarados : null,
      dataSource: 'DEMONSTRACAO_FICTICIA',
      updatedAt: new Date(0).toISOString(),
      version: 1,
      notes: null,
      createdAt: new Date(0).toISOString(),
      createdBy: null,
      codeOrigin: p.origemCodigo,
      archived: null,
    });
  });

  for (const layout of layouts) {
    const escopoId = f.layouts.find((l) => l.id === layout.id)?.escopoId;
    const doEscopo = paletes.filter((p) => f.paletes.find((x) => x.id === p.id)?.escopoId === escopoId);
    const problemas = verificarOcupacao(layout, doEscopo);
    if (problemas.length > 0) throw new Error(`Fixtures incoerentes: ${problemas.join('; ')}`);
  }
  return { layouts, paletes };
}
