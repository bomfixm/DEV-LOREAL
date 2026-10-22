/**
 * Regras puras dos claims (etapa 07; docs/DADOS-E-REGRAS.md R15–R20), sem
 * banco: compatibilidade de candidatos, pendências, estimativas e totais.
 *
 * - Coincidência de SKU encontra pistas; não prova. Outra devolução do mesmo
 *   SKU é origem incompatível. NF sozinha não identifica devolução e linha.
 * - Lote exigido divergente ou desconhecido bloqueia a validação sem tratativa
 *   documentada; origem pendente exige comprovação/reconciliação antes.
 * - Só saldo validado (reconciliado) sustenta recuperação física; documento,
 *   observação não reconciliada e histórico são pistas.
 * - Estimativa nunca vira valor confirmado; total da linha nunca é
 *   multiplicado de novo pela quantidade; moedas e unidades não se somam.
 */
import {
  compararQuantidades,
  somarQuantidades,
  subtrairQuantidades,
  totaisPorMoeda,
  valorUnitarioVezesQuantidade,
  type BaseValor,
  type Compatibilidade,
  type CondicaoMaterial,
  type MotivoClaim,
  type Pendencia,
  type QuantidadePorUnidade,
  type SituacaoClaim,
  type TipoOrigemDocumento,
  type VerificacoesCandidato,
  normalizarValor,
} from '@praca-reversa/contracts';

export const ROTULO_ORIGEM: Readonly<Record<TipoOrigemDocumento, string>> = {
  DEVOLUCAO: 'devolução',
  NOTA_FISCAL: 'NF',
  MANIFESTO: 'manifesto',
  OUTRO: 'documento',
};

export interface LinhaRegra {
  id: string;
  identificador: string;
  produtoId: string | null;
  sku: string;
  unidade: string;
  /** Unidade canônica do produto cadastrado (nula sem produto). */
  unidadeCanonica: string | null;
  quantidade: string;
  lote: string | null;
  loteExigido: boolean;
  origemTipo: TipoOrigemDocumento | null;
  origemReferencia: string | null;
  origemLinha: string | null;
  valorEstimado: string | null;
  baseValor: BaseValor | null;
  recuperada: string;
  coberta: string;
}

export interface MaterialRegra {
  produtoId: string | null;
  sku: string | null;
  unidade: string | null;
  lote: string | null;
  origemTipo: TipoOrigemDocumento | null;
  origemReferencia: string | null;
  condicao: CondicaoMaterial | null;
}

export interface Verificacao {
  checks: VerificacoesCandidato;
  pistas: string[];
  /** Bloqueios de validação que nenhuma tratativa resolve aqui. */
  bloqueios: string[];
  /** Bloqueio de lote (resolvível só com tratativa documentada na validação). */
  bloqueioLote: string | null;
}

const ROTULO_CONDICAO: Readonly<Record<CondicaoMaterial, string>> = { SAUDAVEL: 'saudável', AVARIADO: 'avariado', EM_AVALIACAO: 'em avaliação' };

function origemTexto(tipo: TipoOrigemDocumento | null, referencia: string | null): string {
  if (referencia === null) return 'origem pendente';
  return `${tipo === null ? 'origem' : ROTULO_ORIGEM[tipo]} ${referencia}`;
}

/** A linha do caso tem origem que identifica a devolução (não NF isolada). */
export function origemDaLinhaPendente(l: Pick<LinhaRegra, 'origemTipo' | 'origemReferencia'>): string | null {
  if (l.origemReferencia === null) return 'Origem do caso não informada: informe a devolução/documento de origem antes de validar.';
  if (l.origemTipo === 'NOTA_FISCAL') {
    return 'A origem do caso é só uma NF: o número da NF não identifica a devolução e a linha. Informe a devolução de origem antes de validar.';
  }
  return null;
}

/**
 * Compara o material de uma pista com a linha do caso. Não calcula
 * "confiança": diz o que coincide, o que diverge e o que está pendente.
 */
export function verificarMaterial(
  linha: LinhaRegra,
  motivo: MotivoClaim,
  m: MaterialRegra,
  documento: { produtoId: string; lote: string | null } | null = null,
): Verificacao {
  const pistas: string[] = [];
  const bloqueios: string[] = [];
  let bloqueioLote: string | null = null;

  // Produto
  let produto: Compatibilidade;
  if (m.produtoId === null) {
    produto = 'PENDENTE';
    bloqueios.push('Produto do registro não identificado.');
  } else if (linha.produtoId === null) {
    produto = 'PENDENTE';
    bloqueios.push(`SKU ${linha.sku} da linha não está no cadastro de produtos: inclua-o pela importação "Cadastro de produtos" antes de validar.`);
  } else if (m.produtoId === linha.produtoId) {
    produto = 'COMPATIVEL';
    pistas.push(`Mesmo SKU (${linha.sku}).`);
  } else {
    produto = 'INCOMPATIVEL';
    bloqueios.push(`Outro produto (${m.sku ?? '?'}).`);
  }
  if (m.unidade !== null && m.unidade !== linha.unidade) {
    bloqueios.push(`Unidade do material (${m.unidade}) diferente da unidade da linha (${linha.unidade}); nenhuma conversão é presumida.`);
  }

  // Lote
  let lote: Compatibilidade;
  if (linha.lote !== null && m.lote !== null && linha.lote === m.lote) {
    lote = 'COMPATIVEL';
    pistas.push(`Mesmo lote (${m.lote}).`);
  } else if (!linha.loteExigido) {
    lote = 'NAO_EXIGIDO';
    if (linha.lote !== null && m.lote !== null) pistas.push(`Lote diferente (${m.lote}; caso ${linha.lote}), não exigido pela regra do caso.`);
  } else if (linha.lote === null) {
    lote = 'PENDENTE';
    bloqueioLote = 'Lote exigido, mas o lote do caso não foi informado.';
  } else if (m.lote === null) {
    lote = 'PENDENTE';
    bloqueioLote = `Lote exigido (${linha.lote}), mas o lote do material está pendente.`;
  } else {
    lote = 'INCOMPATIVEL';
    bloqueioLote = `Lote exigido ${linha.lote}, material com lote ${m.lote}.`;
  }

  // Origem: a mesma devolução (referência) — nunca só o SKU nem só a NF.
  let origem: Compatibilidade;
  const pendenteLinha = origemDaLinhaPendente(linha);
  if (pendenteLinha !== null) {
    origem = 'PENDENTE';
    bloqueios.push(pendenteLinha);
  } else if (m.origemReferencia === null) {
    origem = 'PENDENTE';
    bloqueios.push('Origem do material pendente: comprove a origem ou reconcilie com a origem conhecida antes de validar.');
  } else if (m.origemTipo === linha.origemTipo && m.origemReferencia === linha.origemReferencia) {
    if (documento !== null && (documento.produtoId !== linha.produtoId || (documento.lote !== null && m.lote !== null && documento.lote !== m.lote))) {
      origem = 'INCOMPATIVEL';
      bloqueios.push(`A linha ${linha.origemLinha ?? ''} do documento ${linha.origemReferencia} registra outro produto ou lote.`);
    } else {
      origem = 'COMPATIVEL';
      pistas.push(`Mesma origem (${origemTexto(m.origemTipo, m.origemReferencia)}).`);
    }
  } else {
    origem = 'INCOMPATIVEL';
    bloqueios.push(`Outra origem: ${origemTexto(m.origemTipo, m.origemReferencia)} (caso: ${origemTexto(linha.origemTipo, linha.origemReferencia)}). Mesmo SKU de outra devolução não regulariza o caso.`);
  }

  // Condição
  let condicao: Compatibilidade;
  if (m.condicao === null) {
    condicao = 'PENDENTE';
  } else if (motivo === 'AVARIA') {
    if (m.condicao === 'SAUDAVEL') {
      condicao = 'PENDENTE';
      bloqueios.push('Material registrado como saudável num caso de avaria: avalie o motivo antes de validar (localizar não resolve a avaria).');
    } else {
      condicao = 'COMPATIVEL';
      pistas.push(`Material ${ROTULO_CONDICAO[m.condicao]} (caso de avaria): o motivo continua em avaliação.`);
    }
  } else if (m.condicao === 'SAUDAVEL') {
    condicao = 'COMPATIVEL';
  } else {
    condicao = 'INCOMPATIVEL';
    bloqueios.push(`Material ${ROTULO_CONDICAO[m.condicao]}: registre a evidência; a recuperação de falta/divergência exige condição compatível.`);
  }

  return { checks: { product: produto, lot: lote, origin: origem, condition: condicao }, pistas, bloqueios, bloqueioLote };
}

/** Estimativa total da linha: unitário × quantidade em análise, ou o total informado (nunca multiplicado). */
export function estimativaTotalLinha(l: Pick<LinhaRegra, 'valorEstimado' | 'baseValor' | 'quantidade'>): string | null {
  if (l.valorEstimado === null || l.baseValor === null) return null;
  return l.baseValor === 'UNITARIO' ? valorUnitarioVezesQuantidade(l.valorEstimado, l.quantidade) : normalizarValor(l.valorEstimado);
}

/**
 * Estimativa correspondente a uma quantidade coberta, quando derivável sem
 * presunção: unitário × quantidade; total só quando cobre a linha inteira
 * (proporcionalizar um total presumiria regra contratual).
 */
export function estimativaParaCobertura(l: Pick<LinhaRegra, 'valorEstimado' | 'baseValor' | 'quantidade'>, coberta: string): string | null {
  if (l.valorEstimado === null || l.baseValor === null) return null;
  if (l.baseValor === 'UNITARIO') return valorUnitarioVezesQuantidade(l.valorEstimado, coberta);
  return compararQuantidades(coberta, l.quantidade) === 0 ? normalizarValor(l.valorEstimado) : null;
}

/** Somas por unidade (unidades diferentes nunca se somam), em ordem alfabética. */
export function porUnidade(itens: readonly { unidade: string; quantidade: string }[]): QuantidadePorUnidade[] {
  const mapa = new Map<string, string[]>();
  for (const i of itens) mapa.set(i.unidade, [...(mapa.get(i.unidade) ?? []), i.quantidade]);
  return [...mapa.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([unit, q]) => ({ unit, quantity: somarQuantidades(q) }))
    .filter((x) => compararQuantidades(x.quantity, '0') > 0);
}

export function estimadoDoCaso(linhas: readonly LinhaRegra[], moeda: string | null): { estimado: { currency: string; value: string }[]; parcial: boolean } {
  const valores = linhas.map((l) => estimativaTotalLinha(l));
  const conhecidos = valores.filter((v): v is string => v !== null);
  const parcial = conhecidos.length > 0 && conhecidos.length < linhas.length;
  if (moeda === null || conhecidos.length === 0) return { estimado: [], parcial: false };
  return { estimado: totaisPorMoeda(conhecidos.map((valor) => ({ moeda, valor }))), parcial };
}

/** Pendências de uma linha (as que bloqueiam validação marcadas). */
export function pendenciasDaLinha(l: LinhaRegra, motivo: MotivoClaim, cobertaRegularizada: string): Pendencia[] {
  const lista: Pendencia[] = [];
  const add = (code: Pendencia['code'], message: string, blocksValidation: boolean) => lista.push({ code, message, lineId: l.id, blocksValidation });
  if (l.produtoId === null) add('PRODUTO_NAO_CADASTRADO', `Linha ${l.identificador}: SKU ${l.sku} não está no cadastro do escopo.`, true);
  else if (l.unidadeCanonica !== null && l.unidadeCanonica !== l.unidade) {
    add('UNIDADE_INCOMPATIVEL', `Linha ${l.identificador}: unidade ${l.unidade} diferente da unidade canônica ${l.unidadeCanonica} do produto (nenhuma conversão é presumida).`, true);
  }
  const origem = origemDaLinhaPendente(l);
  if (origem !== null) add('ORIGEM_PENDENTE', `Linha ${l.identificador}: ${origem}`, true);
  if (l.loteExigido && l.lote === null) add('LOTE_PENDENTE', `Linha ${l.identificador}: lote exigido e não informado.`, true);
  const restante = subtrairQuantidades(l.quantidade, l.recuperada);
  if (compararQuantidades(restante, '0') > 0) {
    add('SEM_RECUPERACAO_VALIDADA', `Linha ${l.identificador}: ${restante} ${l.unidade} sem recuperação física validada.`, false);
  }
  if (motivo === 'AVARIA' && compararQuantidades(cobertaRegularizada, l.quantidade) < 0 && compararQuantidades(l.coberta, l.quantidade) < 0) {
    add('AVARIA_EM_AVALIACAO', `Linha ${l.identificador}: avaria em avaliação (localizar o material não resolve o motivo).`, false);
  }
  return lista;
}

/** Situações manuais disponíveis a partir da atual. */
export function transicoesPermitidas(atual: SituacaoClaim, validacoesPendentes: number): SituacaoClaim[] {
  if (validacoesPendentes > 0) return [];
  const manuais: SituacaoClaim[] = ['EM_ANALISE', 'BUSCA_EM_ANDAMENTO', 'CANDIDATO_LOCALIZADO'];
  return manuais.includes(atual) ? manuais.filter((s) => s !== atual) : [];
}

/** Situação depois de decidir uma validação: outra pendente mantém; senão volta a candidato localizado. */
export function situacaoAposDecisao(pendentesRestantes: number): SituacaoClaim {
  return pendentesRestantes > 0 ? 'VALIDACAO_PENDENTE' : 'CANDIDATO_LOCALIZADO';
}
