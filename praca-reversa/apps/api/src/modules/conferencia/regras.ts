/**
 * Regras puras da conferência (sem banco): totais por segmento, pendências,
 * comparação declarado × observado × validado e plano de reconciliação.
 * Quantidades são textos decimais exatos; as contas usam BigInt (contracts).
 */
import {
  compararQuantidades,
  multiplicarExato,
  normalizarQuantidade,
  somarQuantidades,
  subtrairQuantidades,
  type CondicaoMaterial,
  type Comparacao,
  type EscopoConferencia,
  type PendenciaConferencia,
  type PendenciaObservacao,
  type SituacaoVinculo,
  type TipoOrigemDocumento,
  type TotalObservado,
  type VinculoComparacao,
} from '@praca-reversa/contracts';

const SEPARADOR = '\u001f';
const PENDENTE = '\u001e';

export interface IdentidadeSegmento {
  produtoId: string;
  lote: string | null;
  origemTipo: TipoOrigemDocumento | null;
  origemReferencia: string | null;
  condicao: CondicaoMaterial;
}

/**
 * Chave dos atributos do material (produto, lote, origem, condição): agrupa a
 * contagem. Lote/origem pendentes fazem parte da chave.
 */
export function chaveBase(s: IdentidadeSegmento): string {
  return [s.produtoId, s.lote ?? PENDENTE, s.origemTipo ?? PENDENTE, s.origemReferencia ?? PENDENTE, s.condicao].join(SEPARADOR);
}

/** Lote e origem conhecidos: o segmento é o mesmo material em qualquer palete do escopo. */
export function identificado(s: IdentidadeSegmento): boolean {
  return s.lote !== null && s.origemTipo !== null && s.origemReferencia !== null;
}

/**
 * Chave de identidade do segmento, igual à função SQL `chave_segmento` (CHECK
 * em segmento_estoque): atributos + linhagem. Segmento com lote/origem
 * pendentes tem linhagem própria, para que registros pendentes distintos não
 * se unam só por terem campos nulos.
 */
export function chaveSegmento(s: IdentidadeSegmento & { linhagem: string | null }): string {
  return [chaveBase(s), s.linhagem ?? PENDENTE].join(SEPARADOR);
}

/** Vínculo de comparação: produto + origem documental (pendente é um vínculo próprio, nunca compensado). */
function chaveVinculo(produtoId: string, origemTipo: TipoOrigemDocumento | null, origemReferencia: string | null): string {
  return [produtoId, origemTipo ?? PENDENTE, origemReferencia ?? PENDENTE].join(SEPARADOR);
}

export interface LinhaParaTotal {
  id: string;
  produtoId: string | null;
  sku: string | null;
  descricao: string;
  codigoLido: string | null;
  lote: string | null;
  origemTipo: TipoOrigemDocumento | null;
  origemReferencia: string | null;
  condicao: CondicaoMaterial;
  quantidadeInformada: string;
  unidadeInformada: string;
  quantidadeCanonica: string | null;
  unidadeCanonica: string | null;
  pendencia: PendenciaObservacao | null;
  removida: boolean;
}

/**
 * Soma as linhas ativas convertidas por segmento. Linhas pendentes (código não
 * cadastrado ou fator desconhecido) ficam à parte: não somam nem viram saldo.
 * Leituras repetidas são linhas distintas e todas somam.
 */
export function totalizar(linhas: readonly LinhaParaTotal[]): { totais: TotalObservado[]; pendencias: PendenciaConferencia[] } {
  const grupos = new Map<string, { base: LinhaParaTotal; quantidades: string[] }>();
  const pendencias: PendenciaConferencia[] = [];
  for (const l of linhas) {
    if (l.removida) continue;
    if (l.pendencia !== null || l.produtoId === null || l.quantidadeCanonica === null) {
      pendencias.push({
        lineId: l.id,
        kind: l.pendencia ?? (l.produtoId === null ? 'PRODUTO_NAO_IDENTIFICADO' : 'FATOR_DESCONHECIDO'),
        description: l.descricao,
        sku: l.sku,
        codeRead: l.codigoLido,
        quantity: normalizarQuantidade(l.quantidadeInformada),
        unit: l.unidadeInformada,
      });
      continue;
    }
    const chave = chaveBase({ ...l, produtoId: l.produtoId });
    const grupo = grupos.get(chave);
    if (grupo) grupo.quantidades.push(l.quantidadeCanonica);
    else grupos.set(chave, { base: l, quantidades: [l.quantidadeCanonica] });
  }
  const totais = [...grupos.entries()].map(([key, { base, quantidades }]) => ({
    key,
    productId: base.produtoId ?? '',
    sku: base.sku ?? '',
    description: base.descricao,
    lot: base.lote,
    originType: base.origemTipo,
    originReference: base.origemReferencia,
    condition: base.condicao,
    quantity: somarQuantidades(quantidades),
    unit: base.unidadeCanonica ?? '',
    lines: quantidades.length,
  }));
  totais.sort((a, b) => a.sku.localeCompare(b.sku) || (a.lot ?? '').localeCompare(b.lot ?? '') || a.key.localeCompare(b.key));
  return { totais, pendencias };
}

export interface ProdutoParaConversao {
  id: string;
  sku: string;
  descricao: string;
  unidadeCanonica: string;
  /** Embalagens cadastradas: nome e fator (nulo = desconhecido). */
  embalagens: readonly { embalagem: string; fator: string | null }[];
}

/**
 * Converte uma quantidade declarada para a unidade canônica. Só converte com
 * um único fator aprovado para aquela unidade; caso contrário, `null`.
 */
export function converterDeclarado(produto: ProdutoParaConversao, quantidade: string, unidade: string): string | null {
  if (unidade === produto.unidadeCanonica) return normalizarQuantidade(quantidade);
  const fatores = new Set(produto.embalagens.filter((e) => e.embalagem === unidade).map((e) => e.fator));
  if (fatores.size !== 1) return null;
  const [fator] = [...fatores];
  return fator === null || fator === undefined ? null : multiplicarExato(quantidade, fator);
}

export interface DeclaradoParaComparar {
  produtoId: string | null;
  descricao: string;
  lote: string | null;
  origemTipo: TipoOrigemDocumento | null;
  origemReferencia: string | null;
  quantidade: string;
  unidade: string;
}

export interface SaldoParaComparar {
  produtoId: string;
  origemTipo: TipoOrigemDocumento | null;
  origemReferencia: string | null;
  quantidade: string;
}

interface Acumulado {
  produtoId: string;
  origemTipo: TipoOrigemDocumento | null;
  origemReferencia: string | null;
  declarado: string[];
  declaradoIndisponivel: boolean;
  temDeclaracao: boolean;
  lotesDeclarados: (string | null)[];
  observado: TotalObservado[];
  pendentes: number;
  validado: string[];
}

/**
 * Compara declarado × observado × validado por vínculo compatível (produto +
 * origem). Origem pendente forma vínculo próprio e nunca compensa a falta de
 * uma devolução identificada. Sem declaração, a comparação fica indisponível
 * (não se presume esperado zero). Na parcial, nada é declarado ausente.
 */
export function comparar(entrada: {
  escopo: EscopoConferencia;
  totais: readonly TotalObservado[];
  pendencias: readonly (PendenciaConferencia & { produtoId: string | null; origemTipo: TipoOrigemDocumento | null; origemReferencia: string | null })[];
  declarados: readonly DeclaradoParaComparar[];
  /** Saldo validado atual; `null` = palete nunca reconciliado. */
  saldo: readonly SaldoParaComparar[] | null;
  produtos: ReadonlyMap<string, ProdutoParaConversao>;
}): Comparacao {
  const vinculos = new Map<string, Acumulado>();
  const obter = (produtoId: string, origemTipo: TipoOrigemDocumento | null, origemReferencia: string | null): Acumulado => {
    const chave = chaveVinculo(produtoId, origemTipo, origemReferencia);
    let v = vinculos.get(chave);
    if (!v) {
      v = {
        produtoId,
        origemTipo,
        origemReferencia,
        declarado: [],
        declaradoIndisponivel: false,
        temDeclaracao: false,
        lotesDeclarados: [],
        observado: [],
        pendentes: 0,
        validado: [],
      };
      vinculos.set(chave, v);
    }
    return v;
  };

  const declaradosSemProduto: Comparacao['declaredWithoutProduct'] = [];
  for (const d of entrada.declarados) {
    const produto = d.produtoId === null ? undefined : entrada.produtos.get(d.produtoId);
    if (d.produtoId === null || !produto) {
      declaradosSemProduto.push({ description: d.descricao, quantity: normalizarQuantidade(d.quantidade), unit: d.unidade, originReference: d.origemReferencia });
      continue;
    }
    const v = obter(d.produtoId, d.origemTipo, d.origemReferencia);
    v.temDeclaracao = true;
    if (!v.lotesDeclarados.includes(d.lote)) v.lotesDeclarados.push(d.lote);
    const convertido = converterDeclarado(produto, d.quantidade, d.unidade);
    if (convertido === null) v.declaradoIndisponivel = true;
    else v.declarado.push(convertido);
  }
  for (const t of entrada.totais) obter(t.productId, t.originType, t.originReference).observado.push(t);
  for (const p of entrada.pendencias) {
    if (p.produtoId !== null) obter(p.produtoId, p.origemTipo, p.origemReferencia).pendentes += 1;
  }
  for (const s of entrada.saldo ?? []) obter(s.produtoId, s.origemTipo, s.origemReferencia).validado.push(s.quantidade);

  const links: VinculoComparacao[] = [];
  for (const [key, v] of vinculos) {
    const produto = entrada.produtos.get(v.produtoId);
    const notas: string[] = [];
    const declarado = v.temDeclaracao && !v.declaradoIndisponivel ? somarQuantidades(v.declarado) : null;
    const observadoContado = v.observado.length > 0 ? somarQuantidades(v.observado.map((o) => o.quantity)) : null;
    // Na completa, não encontrado = 0 observado (ausência ainda não validada); na parcial, não contado = desconhecido.
    const observado = observadoContado ?? (entrada.escopo === 'COMPLETA' && v.pendentes === 0 ? '0' : null);
    const validado = entrada.saldo === null ? null : somarQuantidades(v.validado);

    let status: SituacaoVinculo;
    let diferenca: string | null = null;
    if (entrada.escopo === 'PARCIAL') {
      status = 'PARCIAL';
      notas.push('Conferência parcial: o que não foi contado continua pendente; nada é declarado ausente.');
    } else if (!v.temDeclaracao) {
      status = 'SEM_DECLARACAO';
      notas.push('Sem quantidade declarada para este vínculo: comparação indisponível (não se presume zero).');
    } else if (v.declaradoIndisponivel) {
      status = 'INDISPONIVEL';
      notas.push('Quantidade declarada em embalagem sem fator aprovado: não há conversão para comparar.');
    } else if (v.pendentes > 0) {
      status = 'INDISPONIVEL';
      notas.push(`${String(v.pendentes)} linha(s) observada(s) sem conversão aprovada: comparação incompleta.`);
    } else if (v.origemTipo === null) {
      status = 'INDISPONIVEL';
      notas.push('Origem pendente: vínculo documental não comprovado; nada é compensado entre origens.');
    } else {
      diferenca = subtrairQuantidades(observado ?? '0', declarado ?? '0');
      const sinal = compararQuantidades(observado ?? '0', declarado ?? '0');
      status = sinal === 0 ? 'CONFERE' : sinal < 0 ? 'FALTA' : 'SOBRA';
    }
    if (entrada.escopo === 'COMPLETA' && observadoContado === null && v.pendentes === 0) {
      notas.push('Não encontrado na contagem completa (ausência ainda não validada).');
    }
    if (v.origemTipo === null && v.observado.length > 0 && entrada.escopo === 'COMPLETA' && status !== 'INDISPONIVEL') {
      notas.push('Material com origem pendente: não é atribuído a outra devolução pelo SKU.');
    }
    const lotesObservados = new Set(v.observado.map((o) => o.lot));
    if (v.lotesDeclarados.some((l) => l !== null) && v.observado.length > 0 && v.lotesDeclarados.some((l) => l !== null && !lotesObservados.has(l))) {
      notas.push('Lote declarado diferente do observado: conferir.');
    }
    links.push({
      key,
      productId: v.produtoId,
      sku: produto?.sku ?? v.observado[0]?.sku ?? '?',
      description: produto?.descricao ?? v.observado[0]?.description ?? 'Produto',
      originType: v.origemTipo,
      originReference: v.origemReferencia,
      unit: produto?.unidadeCanonica ?? v.observado[0]?.unit ?? '?',
      declared: declarado,
      declaredLots: v.lotesDeclarados,
      observed: observado,
      observedDetail: v.observado.map((o) => ({ lot: o.lot, condition: o.condition, quantity: o.quantity })),
      validated: validado,
      difference: diferenca,
      status,
      notes: notas,
    });
  }
  links.sort((a, b) => a.sku.localeCompare(b.sku) || (a.originReference ?? '').localeCompare(b.originReference ?? ''));
  return {
    scope: entrada.escopo,
    links,
    declaredWithoutProduct: declaradosSemProduto,
    pending: entrada.pendencias.map(({ produtoId: _p, origemTipo: _t, origemReferencia: _r, ...p }) => p),
  };
}

export interface SaldoAtual extends IdentidadeSegmento {
  segmentoId: string;
  /** Chave completa do segmento (com a linhagem). */
  chave: string;
  linhagem: string | null;
  sku: string;
  descricao: string;
  unidade: string;
  quantidade: string;
  reservada: string;
  /** Vinculada a recuperações de claim validadas (etapa 07). */
  vinculada: string;
  /** Liberada para expedição (etapa 08); ausente nos cálculos que não a usam. */
  liberada?: string;
  /** Bloqueio próprio do material (etapa 08). */
  bloqueio?: { motivo: string; em: Date; por: { login: string; nome: string } | null } | null;
}

export interface MudancaPlanejada extends IdentidadeSegmento {
  chave: string;
  /** `null` = segmento novo, criado com a identidade e a linhagem informadas. */
  segmentoId: string | null;
  linhagem: string | null;
  sku: string;
  descricao: string;
  unidade: string;
  atual: string;
  alvo: string;
  delta: string;
  reservada: string;
  vinculada: string;
}

function mudancaDoSaldo(s: SaldoAtual, alvo: string): MudancaPlanejada {
  return {
    chave: s.chave,
    segmentoId: s.segmentoId,
    linhagem: s.linhagem,
    produtoId: s.produtoId,
    lote: s.lote,
    origemTipo: s.origemTipo,
    origemReferencia: s.origemReferencia,
    condicao: s.condicao,
    sku: s.sku,
    descricao: s.descricao,
    unidade: s.unidade,
    atual: s.quantidade,
    alvo,
    delta: subtrairQuantidades(alvo, s.quantidade),
    reservada: s.reservada,
    vinculada: s.vinculada,
  };
}

/**
 * Plano da reconciliação de uma contagem completa: o saldo de cada segmento
 * passa a ser o observado; segmento validado que não foi observado vai a zero
 * (ausência verificada na completa). O delta é sempre contra o saldo atual —
 * nunca se restaura um valor antigo. Conflitos: alvo abaixo do reservado, e
 * contagem que não distingue duas linhagens pendentes do mesmo material
 * (registros distintos que a contagem não separa) com total diferente.
 *
 * `linhagemNova` identifica os segmentos pendentes criados por esta
 * reconciliação (a própria conferência).
 */
export function planejarReconciliacao(
  totais: readonly TotalObservado[],
  saldo: readonly SaldoAtual[],
  linhagemNova: string,
): { mudancas: MudancaPlanejada[]; inalterados: number; conflitos: string[] } {
  const porBase = new Map<string, SaldoAtual[]>();
  for (const s of saldo) {
    const base = chaveBase(s);
    porBase.set(base, [...(porBase.get(base) ?? []), s]);
  }
  const mudancas: MudancaPlanejada[] = [];
  const conflitos: string[] = [];
  let inalterados = 0;
  const vistos = new Set<string>();
  for (const t of totais) {
    vistos.add(t.key);
    const atuais = porBase.get(t.key) ?? [];
    const identidade = { produtoId: t.productId, lote: t.lot, origemTipo: t.originType, origemReferencia: t.originReference, condicao: t.condition };
    const [unico] = atuais;
    if (unico === undefined) {
      const linhagem = identificado(identidade) ? null : linhagemNova;
      mudancas.push({
        ...identidade,
        chave: chaveSegmento({ ...identidade, linhagem }),
        segmentoId: null,
        linhagem,
        sku: t.sku,
        descricao: t.description,
        unidade: t.unit,
        atual: '0',
        alvo: t.quantity,
        delta: t.quantity,
        reservada: '0',
        vinculada: '0',
      });
      continue;
    }
    if (atuais.length === 1) {
      if (compararQuantidades(t.quantity, unico.quantidade) === 0) inalterados += 1;
      else mudancas.push(mudancaDoSaldo(unico, t.quantity));
      continue;
    }
    const soma = somarQuantidades(atuais.map((a) => a.quantidade));
    if (compararQuantidades(t.quantity, soma) === 0) {
      inalterados += atuais.length;
      continue;
    }
    conflitos.push(
      `${t.sku}${t.lot ? ` lote ${t.lot}` : ''}: o palete tem ${String(atuais.length)} linhagens pendentes distintas deste material (${soma} ${t.unit} no total) e a contagem (${t.quantity} ${t.unit}) não as distingue; trate as linhagens separadamente antes de reconciliar.`,
    );
  }
  for (const s of saldo) {
    if (vistos.has(chaveBase(s))) continue;
    if (compararQuantidades(s.quantidade, '0') === 0) continue;
    mudancas.push(mudancaDoSaldo(s, '0'));
  }
  for (const m of mudancas) {
    if (compararQuantidades(m.alvo, m.reservada) < 0) {
      conflitos.push(`${m.sku}${m.lote ? ` lote ${m.lote}` : ''}: saldo validado iria a ${m.alvo} ${m.unidade}, abaixo dos ${m.reservada} reservados.`);
    } else if (compararQuantidades(m.alvo, somarQuantidades([m.reservada, m.vinculada])) < 0) {
      // A quantidade usada como prova de recuperação de claim não some por ajuste:
      // a recuperação precisa ser estornada (com motivo) antes.
      conflitos.push(
        `${m.sku}${m.lote ? ` lote ${m.lote}` : ''}: saldo validado iria a ${m.alvo} ${m.unidade}, abaixo dos ${m.vinculada} vinculados a recuperações de claim validadas${
          compararQuantidades(m.reservada, '0') > 0 ? ` (mais ${m.reservada} reservados)` : ''
        }. Trate a recuperação no claim (estorno com motivo) antes de reconciliar.`,
      );
    }
  }
  mudancas.sort((a, b) => a.sku.localeCompare(b.sku) || a.chave.localeCompare(b.chave));
  return { mudancas, inalterados, conflitos };
}
