/**
 * Importação da seleção do cliente (complemento): cada linha selecionada vira
 * uma solicitação explícita, com abrangência registrada e valores originais.
 * Não altera estoque, não reserva, não libera e não confirma saída.
 *
 * - Lista já selecionada: cada linha é uma solicitação.
 * - Inventário com marcação: só os valores configurados na coluna de decisão
 *   selecionam; vazio ou outro texto ficam EXCLUIDOS (visíveis, com motivo).
 * - Abrangência: coluna explícita (PALETE, NF/DOCUMENTO, LINHA) ou regra
 *   registrada pela identificação (SKU → linha/produto; NF → documento;
 *   só palete → palete inteiro). Interpretação conflitante bloqueia.
 * - NF válida sem alocação é pendência de conciliação, não erro de formato.
 * - Linhas repetidas: nada é somado nem descartado por coincidência; a
 *   decisão (agrupar idênticas ou manter separadas) é explícita e registrada.
 * - Versão substitutiva da mesma referência de pedido: diferenças mostradas;
 *   reservas e saídas da versão anterior não são canceladas automaticamente.
 */
import { type AbrangenciaSelecao, type Escopo, type MotivoLinha, type ParametrosSelecao } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import type { Banco, Transacao } from '../../db/cliente.js';
import { ErroHttp } from '../../http/erros.js';
import { registrarEvento } from '../auditoria/registrar.js';
import type { CelulaTabela } from './arquivo/ler.js';
import { chaveDocumento } from './inventario.js';
import { decimalExato, identificador, quantidade, textoLido, textoLivre, unidade, type Campo } from './interpretar.js';
import { celulaDe, lidosDaLinha, type Entrada, type LinhaClassificada } from './tipos.js';

const CAMPOS = {
  inventoryLine: { campo: 'inventoryLine', rotulo: 'Referência da linha do inventário' },
  windowRef: { campo: 'windowRef', rotulo: 'Janela' },
  palletCode: { campo: 'palletCode', rotulo: 'Palete' },
  documentType: { campo: 'documentType', rotulo: 'Tipo do documento' },
  documentNumber: { campo: 'documentNumber', rotulo: 'NF/documento' },
  delivery: { campo: 'delivery', rotulo: 'DELIVERY' },
  lineRef: { campo: 'lineRef', rotulo: 'Linha do pedido' },
  sku: { campo: 'sku', rotulo: 'SKU' },
  lot: { campo: 'lot', rotulo: 'Lote' },
  quantity: { campo: 'quantity', rotulo: 'Quantidade solicitada' },
  unit: { campo: 'unit', rotulo: 'Unidade' },
  mark: { campo: 'mark', rotulo: 'Marcação' },
  scope: { campo: 'scope', rotulo: 'Abrangência' },
  address: { campo: 'address', rotulo: 'Endereço informado' },
  notes: { campo: 'notes', rotulo: 'Observação' },
} as const satisfies Record<string, Campo>;

const SEP = '\u001f';
const aviso = (code: string, field: string | null, message: string): MotivoLinha => ({ code, field, message });

/** Identificador como texto; inteiro gravado como número aceito com aviso (precisão perdida = erro). */
function identificadorSelecao(c: CelulaTabela | undefined, f: Campo, max: number): { valor: string | null; erro?: MotivoLinha; aviso?: MotivoLinha } {
  if (c?.tipo === 'NUMERO' && !c.formula) {
    const t = (c.texto ?? '').trim();
    if (/^\d{1,15}$/.test(t)) return { valor: t, aviso: aviso('IDENTIFICADOR_NUMERICO', f.campo, `${f.rotulo}: gravado como número (${t}); lido como texto (zeros à esquerda da origem não estão no arquivo).`) };
    const d = decimalExato(t);
    if (d !== null && d.fracao === '' && d.inteiro.length > 15) {
      return { valor: null, erro: aviso('IDENTIFICADOR_TRUNCADO', f.campo, `${f.rotulo}: número com mais de 15 dígitos (${t}); o Excel já perdeu dígitos. Corrija a origem.`) };
    }
    return { valor: null, erro: aviso('IDENTIFICADOR_INVALIDO', f.campo, `${f.rotulo}: "${t}" não é um identificador inteiro.`) };
  }
  const r = identificador(c, f, max, { maximo: 64 });
  return r.ok ? { valor: r.valor } : { valor: null, erro: r.motivo };
}

const ABRANGENCIAS: Readonly<Record<string, AbrangenciaSelecao>> = {
  PALETE: 'PALETE',
  'PALETE INTEIRO': 'PALETE',
  NF: 'DOCUMENTO',
  DOCUMENTO: 'DOCUMENTO',
  DEVOLUCAO: 'DOCUMENTO',
  DEVOLUÇÃO: 'DOCUMENTO',
  LINHA: 'LINHA_PRODUTO',
  PRODUTO: 'LINHA_PRODUTO',
  LINHA_PRODUTO: 'LINHA_PRODUTO',
};

export interface LinhaSelecaoLida {
  numero: number;
  lidos: Record<string, string | null>;
  erros: MotivoLinha[];
  avisos: MotivoLinha[];
  selecionada: boolean;
  motivoExclusao: string | null;
  marcacao: string | null;
  paleteRef: string | null;
  tipoDocumento: string | null;
  numeroDocumento: string | null;
  delivery: string | null;
  referenciaInventario: string | null;
  janela: string | null;
  referenciaLinha: string | null;
  sku: string | null;
  lote: string | null;
  quantidade: string | null;
  unidade: string | null;
  abrangencia: AbrangenciaSelecao | null;
  regraAbrangencia: string;
  endereco: string | null;
  observacao: string | null;
}

export function interpretarSelecao(e: Entrada, p: ParametrosSelecao): LinhaSelecaoLida[] {
  const max = e.limites.maxCellChars;
  const valores = new Set(p.markValues.map((v) => v.trim().toUpperCase()));
  return e.tabela.linhas.map((linha) => {
    const erros: MotivoLinha[] = [];
    const avisos: MotivoLinha[] = [];
    const c = (campo: keyof typeof CAMPOS) => celulaDe(linha, e.colunas, campo);
    const ident = (campo: keyof typeof CAMPOS) => {
      const r = identificadorSelecao(c(campo), CAMPOS[campo], max);
      if (r.erro) erros.push(r.erro);
      if (r.aviso) avisos.push(r.aviso);
      return r.valor;
    };
    const livre = (campo: keyof typeof CAMPOS, maximo: number) => {
      const r = textoLivre(c(campo), CAMPOS[campo], max, 1, maximo);
      if (!r.ok) {
        erros.push(r.motivo);
        return null;
      }
      return r.valor;
    };
    const marcacao = textoLido(c('mark'));
    let selecionada = true;
    let motivoExclusao: string | null = null;
    if (p.mode === 'MARCACAO') {
      if (marcacao === null) {
        selecionada = false;
        motivoExclusao = 'Marcação vazia: vazio não é aprovação.';
      } else if (!valores.has(marcacao.trim().toUpperCase())) {
        selecionada = false;
        motivoExclusao = `Marcação "${marcacao}" não está na regra (${p.markValues.join(', ')}).`;
      }
    }
    const tipoLido = livre('documentType', 20);
    const qtd = quantidade(c('quantity'), CAMPOS.quantity, e.separador, max);
    if (!qtd.ok) erros.push(qtd.motivo);
    const un = unidade(c('unit'), CAMPOS.unit, max);
    if (!un.ok) erros.push(un.motivo);
    const escopoLido = livre('scope', 30);
    let abrangencia: AbrangenciaSelecao | null = null;
    let regra = '';
    const paleteRef = ident('palletCode');
    const numeroDocumento = ident('documentNumber');
    const sku = ident('sku');
    const referenciaInventario = ident('inventoryLine');
    if (escopoLido !== null) {
      const chave = escopoLido.trim().toUpperCase();
      abrangencia = ABRANGENCIAS[chave] ?? null;
      regra = `coluna de abrangência ("${escopoLido}")`;
      if (abrangencia === null) erros.push(aviso('ABRANGENCIA_INVALIDA', 'scope', `Abrangência "${escopoLido}" desconhecida: use PALETE, NF (ou DOCUMENTO) ou LINHA.`));
    } else if (sku !== null) {
      abrangencia = 'LINHA_PRODUTO';
      regra = 'regra: SKU informado → linha/produto e quantidade';
    } else if (numeroDocumento !== null) {
      abrangencia = 'DOCUMENTO';
      regra = paleteRef !== null ? 'regra: NF com palete → material da NF naquele palete' : 'regra: NF informada → material da NF/devolução';
    } else if (paleteRef !== null) {
      abrangencia = 'PALETE';
      regra = 'regra: só palete informado → palete inteiro do inventário';
    }
    return {
      numero: linha.numero,
      lidos: lidosDaLinha(linha, e.colunas),
      erros,
      avisos,
      selecionada,
      motivoExclusao,
      marcacao,
      paleteRef: paleteRef === null ? null : paleteRef.toUpperCase(),
      tipoDocumento: tipoLido === null ? p.defaultDocumentType : tipoLido.toUpperCase(),
      numeroDocumento,
      delivery: ident('delivery'),
      referenciaInventario,
      janela: livre('windowRef', 40),
      referenciaLinha: ident('lineRef'),
      sku,
      lote: ident('lot'),
      quantidade: qtd.ok ? qtd.valor : null,
      unidade: un.ok ? un.valor : null,
      abrangencia,
      regraAbrangencia: regra,
      endereco: livre('address', 60),
      observacao: livre('notes', 500),
    };
  });
}

export interface EstadoSelecao {
  /** Documentos (chave e só número) e paletes citados no inventário de referência / vínculos atuais. */
  documentos: Set<string>;
  numerosComTipos: Map<string, Set<string>>;
  paletes: Set<string>;
  inventario: { id: string; codigo: string } | null;
  anterior: { id: string; codigo: string; versaoPedido: number; referenciaPedido: string; linhas: Map<string, { numero: number; quantidade: string | null; unidade: string | null; descricao: string }>; reservas: { id: string; codigo: string; situacao: string; linhas: number }[] } | null;
  mesmaReferencia: { codigo: string } | null;
}

export async function carregarEstadoSelecao(db: Banco | Transacao, escopoId: string, p: ParametrosSelecao): Promise<EstadoSelecao> {
  let inventario: EstadoSelecao['inventario'] = null;
  if (p.inventoryId !== null) {
    const inv = await db.inventarioReferencia.findFirst({ where: { id: p.inventoryId, escopoId }, select: { id: true, codigo: true } });
    if (!inv) throw new ErroHttp(404, 'NAO_ENCONTRADO', 'Inventário de referência não encontrado neste escopo.');
    inventario = inv;
  }
  const linhasInv = inventario === null ? [] : await db.linhaInventario.findMany({ where: { escopoId, inventarioId: inventario.id }, select: { chaveDocumento: true, tipoDocumento: true, numeroDocumento: true, numeroPalete: true } });
  const vinculos = await db.vinculoDocumentoPalete.findMany({ where: { escopoId, situacao: 'ATIVO' }, select: { chaveDocumento: true, tipoDocumento: true, numeroDocumento: true } });
  const documentos = new Set<string>();
  const numerosComTipos = new Map<string, Set<string>>();
  for (const l of [...linhasInv, ...vinculos]) {
    if (l.chaveDocumento === null || l.numeroDocumento === null) continue;
    documentos.add(l.chaveDocumento);
    documentos.add(`|${l.numeroDocumento}`);
    numerosComTipos.set(l.numeroDocumento, new Set([...(numerosComTipos.get(l.numeroDocumento) ?? []), l.tipoDocumento ?? '']));
  }
  const paletes = new Set(linhasInv.flatMap((l) => (l.numeroPalete === null ? [] : [l.numeroPalete.toUpperCase()])));
  let anterior: EstadoSelecao['anterior'] = null;
  if (p.replacesSelectionId !== null) {
    const s = await db.selecaoCliente.findFirst({
      where: { id: p.replacesSelectionId, escopoId },
      select: { id: true, codigo: true, versaoPedido: true, referenciaPedido: true, situacao: true, linhas: { where: { duplicadaDeId: null }, select: { linhaArquivo: true, chave: true, quantidade: true, unidade: true, numeroDocumento: true, paleteReferencia: true, sku: true } }, reservas: { select: { reservaId: true, reserva: { select: { codigo: true, situacao: true } } } } },
    });
    if (!s) throw new ErroHttp(404, 'NAO_ENCONTRADO', 'Seleção a substituir não encontrada neste escopo.');
    if (s.situacao !== 'REGISTRADA') throw new ErroHttp(409, 'CONFLITO', `A seleção ${s.codigo} já foi substituída por outra versão.`);
    if (s.referenciaPedido !== p.orderReference) {
      throw new ErroHttp(409, 'CONFLITO', `A seleção ${s.codigo} é do pedido "${s.referenciaPedido}": a versão substitutiva precisa da mesma referência de pedido.`);
    }
    const reservas = new Map<string, { id: string; codigo: string; situacao: string; linhas: number }>();
    for (const r of s.reservas) {
      const atual = reservas.get(r.reservaId) ?? { id: r.reservaId, codigo: r.reserva.codigo, situacao: r.reserva.situacao, linhas: 0 };
      atual.linhas += 1;
      reservas.set(r.reservaId, atual);
    }
    anterior = {
      id: s.id,
      codigo: s.codigo,
      versaoPedido: s.versaoPedido,
      referenciaPedido: s.referenciaPedido,
      linhas: new Map(
        s.linhas.map((l) => [
          l.chave,
          {
            numero: l.linhaArquivo,
            quantidade: l.quantidade === null ? null : l.quantidade.toFixed(),
            unidade: l.unidade,
            descricao: [l.paleteReferencia ? `palete ${l.paleteReferencia}` : null, l.numeroDocumento ? `NF ${l.numeroDocumento}` : null, l.sku ? `SKU ${l.sku}` : null].filter(Boolean).join(' · '),
          },
        ]),
      ),
      reservas: [...reservas.values()],
    };
  }
  const mesma =
    p.replacesSelectionId === null
      ? await db.selecaoCliente.findFirst({ where: { escopoId, referenciaPedido: p.orderReference, situacao: 'REGISTRADA' }, select: { codigo: true } })
      : null;
  return { documentos, numerosComTipos, paletes, inventario, anterior, mesmaReferencia: mesma };
}

export interface LinhaPlanoSelecao {
  numero: number;
  dados: LinhaSelecaoLida;
  chave: string;
  gravar: boolean;
  duplicadaDe: number | null;
  decisaoDuplicidade: string | null;
}

export interface PlanoSelecao {
  parametros: ParametrosSelecao;
  estado: EstadoSelecao;
  linhas: LinhaPlanoSelecao[];
  diferencas: {
    added: { row: number; description: string }[];
    removed: { row: number; description: string }[];
    quantityChanged: { row: number; description: string; before: string | null; after: string | null }[];
    unchanged: number;
  } | null;
  resumo: string[];
  excluidas: number;
}

function descricaoLinha(l: LinhaSelecaoLida): string {
  return [l.paleteRef ? `palete ${l.paleteRef}` : null, l.numeroDocumento ? `NF ${l.numeroDocumento}` : null, l.sku ? `SKU ${l.sku}` : null].filter(Boolean).join(' · ');
}

export function classificarSelecao(lidas: readonly LinhaSelecaoLida[], estado: EstadoSelecao, p: ParametrosSelecao): { linhas: LinhaClassificada[]; plano: PlanoSelecao } {
  const vistas = new Map<string, { numero: number; quantidade: string | null; unidade: string | null }>();
  const plano: PlanoSelecao = { parametros: p, estado, linhas: [], diferencas: null, resumo: [], excluidas: 0 };
  const resultado: LinhaClassificada[] = [];
  for (const l of lidas) {
    const erros = [...l.erros];
    const conflitos: MotivoLinha[] = [];
    const avisos = [...l.avisos];
    let classificacao: LinhaClassificada['classificacao'];
    let acao: string;
    let duplicadaDe: number | null = null;
    let decisao: string | null = null;
    const chave = [l.abrangencia ?? '', l.paleteRef ?? '', l.tipoDocumento ?? '', l.numeroDocumento ?? '', l.delivery ?? '', l.sku ?? '', l.lote ?? '', l.referenciaLinha ?? '', l.referenciaInventario ?? ''].join(SEP);
    if (!l.selecionada) {
      classificacao = 'EXCLUIDA';
      acao = 'EXCLUIDA_MARCACAO';
      plano.excluidas += 1;
    } else {
      if (l.paleteRef === null && l.numeroDocumento === null && l.sku === null && l.referenciaInventario === null) {
        erros.push(aviso('SEM_IDENTIFICACAO', null, 'A linha não identifica a solicitação: informe palete, NF/documento, SKU ou a referência da linha do inventário.'));
      }
      if (l.abrangencia === 'PALETE' && l.paleteRef === null) erros.push(aviso('ABRANGENCIA_CONFLITANTE', 'scope', 'Abrangência PALETE sem o palete informado.'));
      if (l.abrangencia === 'DOCUMENTO' && l.numeroDocumento === null) erros.push(aviso('ABRANGENCIA_CONFLITANTE', 'scope', 'Abrangência NF/DOCUMENTO sem o número do documento.'));
      if (l.abrangencia === 'LINHA_PRODUTO' && l.sku === null) erros.push(aviso('ABRANGENCIA_CONFLITANTE', 'scope', 'Abrangência LINHA sem o SKU.'));
      if (l.abrangencia === null && erros.length === 0) erros.push(aviso('ABRANGENCIA_INDEFINIDA', 'scope', 'Não foi possível determinar a abrangência pela regra registrada.'));
      if (l.quantidade !== null && l.unidade === null) erros.push(aviso('QUANTIDADE_SEM_UNIDADE', 'unit', 'Quantidade informada sem unidade: nenhuma unidade é presumida.'));
      if (l.quantidade === null && l.unidade !== null) avisos.push(aviso('UNIDADE_SEM_QUANTIDADE', 'quantity', 'Unidade sem quantidade: a quantidade fica não informada (nunca zero).'));
      if (l.abrangencia === 'LINHA_PRODUTO' && l.quantidade === null) {
        avisos.push(aviso('QUANTIDADE_NAO_INFORMADA', 'quantity', 'Linha/produto sem quantidade: registrada como informação pendente (nenhuma quantidade é presumida).'));
      }
      if (l.abrangencia === 'DOCUMENTO' && l.quantidade === null) {
        avisos.push(
          aviso(
            'NF_SEM_QUANTIDADE',
            'quantity',
            p.documentWithoutQuantity === 'TODO_MATERIAL_DO_INVENTARIO'
              ? 'NF sem quantidade: por configuração, representa todo o material dela que constava no inventário (não a quantidade fiscal original).'
              : 'NF sem quantidade: quantidade pendente (configuração atual não presume o material todo).',
          ),
        );
      }
      if (erros.length === 0) {
        const anterior = vistas.get(chave);
        if (anterior) {
          if (anterior.quantidade === l.quantidade && anterior.unidade === l.unidade) {
            if (p.duplicates === null) {
              conflitos.push(aviso('DUPLICIDADE_DECIDIR', null, `Igual à linha ${String(anterior.numero)}: escolha "agrupar idênticas" (sem somar) ou "manter separadas" antes de confirmar.`));
            } else if (p.duplicates === 'AGRUPAR_IDENTICAS') {
              duplicadaDe = anterior.numero;
              decisao = `Agrupada com a linha ${String(anterior.numero)} (idêntica); nada foi somado.`;
            } else {
              avisos.push(aviso('REPETIDA_MANTIDA', null, `Igual à linha ${String(anterior.numero)}: mantida como solicitação separada por decisão registrada.`));
            }
          } else {
            conflitos.push(
              aviso(
                'REPETICAO_DIVERGENTE',
                'quantity',
                `Mesma solicitação da linha ${String(anterior.numero)} com quantidade diferente (${anterior.quantidade ?? 'não informada'} × ${l.quantidade ?? 'não informada'}): corrija a origem; nada é somado.`,
              ),
            );
          }
        }
      }
      if (erros.length > 0) {
        classificacao = 'INVALIDA';
        acao = 'SOLICITACAO';
      } else if (conflitos.length > 0) {
        classificacao = 'CONFLITANTE';
        acao = 'SOLICITACAO';
      } else if (duplicadaDe !== null) {
        classificacao = 'DUPLICADA';
        acao = 'DUPLICIDADE_AGRUPADA';
      } else {
        classificacao = 'VALIDA_NOVA';
        acao = 'SOLICITACAO';
        if (!vistas.has(chave)) vistas.set(chave, { numero: l.numero, quantidade: l.quantidade, unidade: l.unidade });
        // Pistas de conciliação (não impedem o registro).
        if (l.numeroDocumento !== null) {
          const doc = chaveDocumento(l.tipoDocumento, l.numeroDocumento);
          const tipos = estado.numerosComTipos.get(l.numeroDocumento);
          if (!estado.documentos.has(doc) && !(l.tipoDocumento === null && estado.documentos.has(`|${l.numeroDocumento}`))) {
            avisos.push(aviso('NF_SEM_ALOCACAO', 'documentNumber', `${l.tipoDocumento ?? 'Documento'} ${l.numeroDocumento} não consta do inventário de referência nem dos vínculos atuais: pendência de conciliação (não impede o registro).`));
          } else if (l.tipoDocumento === null && tipos !== undefined && tipos.size > 1) {
            avisos.push(aviso('NUMERO_EM_CONTEXTOS', 'documentType', `O número ${l.numeroDocumento} aparece com mais de um tipo (${[...tipos].map((t) => t || 'sem tipo').join(', ')}): a conciliação pedirá a resolução.`));
          }
        } else if (l.paleteRef !== null && estado.inventario !== null && !estado.paletes.has(l.paleteRef)) {
          avisos.push(aviso('PALETE_FORA_DO_INVENTARIO', 'palletCode', `Palete ${l.paleteRef} não consta do inventário de referência: pendência de conciliação.`));
        }
      }
    }
    if (classificacao === 'VALIDA_NOVA' || classificacao === 'DUPLICADA') {
      plano.linhas.push({ numero: l.numero, dados: l, chave, gravar: true, duplicadaDe, decisaoDuplicidade: decisao });
    }
    const motivos = classificacao === 'INVALIDA' ? erros : classificacao === 'CONFLITANTE' ? conflitos : classificacao === 'EXCLUIDA' ? [aviso('FORA_DA_SELECAO', 'mark', l.motivoExclusao ?? 'Fora da seleção.')] : [];
    resultado.push({
      numero: l.numero,
      classificacao,
      chave: descricaoLinha(l) || null,
      valores: {
        scope: l.abrangencia,
        scopeRule: l.regraAbrangencia || null,
        palletCode: l.paleteRef,
        documentType: l.tipoDocumento,
        documentNumber: l.numeroDocumento,
        delivery: l.delivery,
        inventoryLine: l.referenciaInventario,
        lineRef: l.referenciaLinha,
        sku: l.sku,
        lot: l.lote,
        quantity: l.quantidade,
        unit: l.unidade,
        mark: l.marcacao,
        windowRef: l.janela,
        address: l.endereco,
        notes: l.observacao,
        duplicateOf: duplicadaDe === null ? null : String(duplicadaDe),
      },
      lidos: l.lidos,
      motivos,
      avisos: classificacao === 'EXCLUIDA' ? [] : avisos,
      acao,
    });
  }
  // Versão substitutiva: inclusões, exclusões e quantidades alteradas.
  if (estado.anterior !== null) {
    const atuais = new Map(plano.linhas.filter((l) => l.duplicadaDe === null).map((l) => [l.chave, l]));
    const diferencas: NonNullable<PlanoSelecao['diferencas']> = { added: [], removed: [], quantityChanged: [], unchanged: 0 };
    for (const [chave, l] of atuais) {
      const antes = estado.anterior.linhas.get(chave);
      if (!antes) diferencas.added.push({ row: l.numero, description: descricaoLinha(l.dados) });
      else if (antes.quantidade !== l.dados.quantidade || antes.unidade !== l.dados.unidade) {
        diferencas.quantityChanged.push({
          row: l.numero,
          description: descricaoLinha(l.dados),
          before: antes.quantidade === null ? null : `${antes.quantidade} ${antes.unidade ?? ''}`.trim(),
          after: l.dados.quantidade === null ? null : `${l.dados.quantidade} ${l.dados.unidade ?? ''}`.trim(),
        });
      } else diferencas.unchanged += 1;
    }
    for (const [chave, antes] of estado.anterior.linhas) if (!atuais.has(chave)) diferencas.removed.push({ row: antes.numero, description: antes.descricao });
    plano.diferencas = diferencas;
  }
  const conta = (c: LinhaClassificada['classificacao']) => resultado.filter((r) => r.classificacao === c).length;
  plano.resumo = [
    `Pedido ${p.orderReference}${p.orderVersionLabel ? ` (versão do cliente: ${p.orderVersionLabel})` : ''} · ${p.mode === 'MARCACAO' ? `inventário com marcação (seleciona: ${p.markValues.join(', ')})` : 'lista já selecionada'}.`,
    `${String(conta('VALIDA_NOVA'))} solicitação(ões) · ${String(conta('DUPLICADA'))} agrupada(s) por duplicidade · ${String(conta('EXCLUIDA'))} fora da seleção · ${String(conta('INVALIDA'))} inválida(s) · ${String(conta('CONFLITANTE'))} a decidir.`,
    `Inventário de referência: ${estado.inventario?.codigo ?? 'não informado (a conciliação usa só os registros atuais)'}.`,
    'Importar a seleção não reserva, não libera e não altera estoque: a conciliação e a proposta para a janela vêm depois.',
    ...(estado.mesmaReferencia !== null ? [`Já existe a seleção ${estado.mesmaReferencia.codigo} para este pedido: importe como versão substitutiva dela.`] : []),
    ...(plano.diferencas !== null && estado.anterior !== null
      ? [
          `Versão substitutiva do ${estado.anterior.codigo}: ${String(plano.diferencas.added.length)} inclusão(ões), ${String(plano.diferencas.removed.length)} exclusão(ões), ${String(plano.diferencas.quantityChanged.length)} quantidade(s) alterada(s), ${String(plano.diferencas.unchanged)} sem mudança.`,
          ...(estado.anterior.reservas.length > 0
            ? [`Reservas ligadas à versão anterior (revisar no fluxo da janela; nada é cancelado automaticamente): ${estado.anterior.reservas.map((r) => `${r.codigo} (${r.situacao.toLowerCase()})`).join(', ')}.`]
            : []),
        ]
      : []),
  ];
  return { linhas: resultado, plano };
}

/** Grava a seleção e as linhas (VALIDA_NOVA e agrupadas), e marca a versão anterior como substituída. */
export async function gravarSelecao(
  tx: Transacao,
  escopo: Escopo,
  autor: { usuarioId: string; requestId: string },
  lote: { id: string },
  plano: PlanoSelecao,
  agora: Date,
): Promise<{ selecaoId: string; linhas: number; registros: Map<number, string> }> {
  const p = plano.parametros;
  if (plano.estado.mesmaReferencia !== null) {
    throw new ErroHttp(409, 'CONFLITO', `Já existe a seleção ${plano.estado.mesmaReferencia.codigo} para o pedido ${p.orderReference}: importe como versão substitutiva.`);
  }
  if (plano.estado.anterior !== null) {
    const r = await tx.selecaoCliente.updateMany({
      where: { id: plano.estado.anterior.id, escopoId: escopo.id, situacao: 'REGISTRADA' },
      data: { situacao: 'SUBSTITUIDA', versao: { increment: 1 } },
    });
    if (r.count !== 1) throw new ErroHttp(409, 'PREVIA_DESATUALIZADA', `A seleção ${plano.estado.anterior.codigo} mudou enquanto a prévia era revisada.`);
  }
  const [n] = await tx.$queryRaw<{ n: number }[]>`SELECT COALESCE(MAX(numero), 0)::int + 1 AS n FROM selecao_cliente WHERE escopo_id = ${escopo.id}::uuid`;
  const numero = n?.n ?? 1;
  const selecaoId = randomUUID();
  const codigo = `SEL-${String(numero).padStart(6, '0')}`;
  const diferencas =
    plano.diferencas === null || plano.estado.anterior === null
      ? null
      : {
          previousId: plano.estado.anterior.id,
          previousCode: plano.estado.anterior.codigo,
          ...plano.diferencas,
          reservationsToReview: plano.estado.anterior.reservas.map((r) => ({ id: r.id, code: r.codigo, state: r.situacao, lines: r.linhas })),
        };
  await tx.selecaoCliente.create({
    data: {
      id: selecaoId,
      escopoId: escopo.id,
      numero,
      codigo,
      referenciaPedido: p.orderReference,
      versaoPedido: plano.estado.anterior === null ? 1 : plano.estado.anterior.versaoPedido + 1,
      rotuloVersao: p.orderVersionLabel,
      modalidade: p.mode,
      inventarioId: plano.estado.inventario?.id ?? null,
      loteImportacaoId: lote.id,
      parametros: {
        mode: p.mode,
        markValues: p.markValues,
        documentContext: p.documentContext,
        defaultDocumentType: p.defaultDocumentType,
        documentWithoutQuantity: p.documentWithoutQuantity,
        duplicates: p.duplicates,
      },
      situacao: 'REGISTRADA',
      substituiId: plano.estado.anterior?.id ?? null,
      diferencas: diferencas ?? undefined,
      totalLinhas: plano.linhas.filter((l) => l.duplicadaDe === null).length,
      linhasExcluidas: plano.excluidas,
      criadoPorId: autor.usuarioId,
      criadoEm: agora,
    },
  });
  const ids = new Map<number, string>();
  for (const l of plano.linhas) ids.set(l.numero, randomUUID());
  // Primeiro as originais, depois as agrupadas (que apontam para elas).
  const ordenadas = [...plano.linhas.filter((l) => l.duplicadaDe === null), ...plano.linhas.filter((l) => l.duplicadaDe !== null)];
  for (const l of ordenadas) {
    const d = l.dados;
    await tx.linhaSelecao.create({
      data: {
        id: ids.get(l.numero) ?? randomUUID(),
        escopoId: escopo.id,
        selecaoId,
        linhaArquivo: l.numero,
        referenciaLinha: d.referenciaLinha,
        abrangencia: d.abrangencia ?? 'DOCUMENTO',
        regraAbrangencia: d.regraAbrangencia,
        paleteReferencia: d.paleteRef,
        tipoDocumento: d.tipoDocumento,
        numeroDocumento: d.numeroDocumento,
        chaveDocumento: d.numeroDocumento === null ? null : chaveDocumento(d.tipoDocumento, d.numeroDocumento),
        delivery: d.delivery,
        referenciaInventario: d.referenciaInventario,
        janelaReferencia: d.janela,
        sku: d.sku,
        lote: d.lote,
        quantidade: d.quantidade,
        unidade: d.unidade,
        marcacao: d.marcacao,
        observacao: d.observacao,
        lidos: d.lidos,
        chave: l.chave,
        duplicadaDeId: l.duplicadaDe === null ? null : (ids.get(l.duplicadaDe) ?? null),
        decisaoDuplicidade: l.decisaoDuplicidade,
      },
    });
  }
  await registrarEvento(tx, {
    acao: 'SELECAO_IMPORTADA',
    resultado: 'SUCESSO',
    atorUsuarioId: autor.usuarioId,
    escopoId: escopo.id,
    alvoTipo: 'SELECAO_CLIENTE',
    alvoId: selecaoId,
    detalhes: {
      codigo,
      pedido: p.orderReference,
      modalidade: p.mode,
      linhas: plano.linhas.length,
      excluidas: plano.excluidas,
      substitui: plano.estado.anterior?.codigo ?? null,
      inventario: plano.estado.inventario?.codigo ?? null,
    },
    requestId: autor.requestId,
  });
  return { selecaoId, linhas: plano.linhas.length, registros: ids };
}
