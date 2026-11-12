import { NOME_CAMPO, PAPEL, type ItemId } from './layout-modelo';

/** Caixa de um item (campo ou texto livre) como ficou na folha (mm), medida sem zoom. */
export interface CaixaCampo {
  campo: ItemId;
  /** Nome para os avisos (textos livres trazem o seu; campos usam o nome do campo). */
  nome?: string;
  x: number;
  y: number;
  largura: number;
  altura: number;
  /** Conteúdo mais alto que a caixa (tabela com linha que não coube). */
  transborda?: boolean;
}
export interface Problema {
  campo: ItemId;
  gravidade: 'erro' | 'aviso';
  texto: string;
}
const TOLERANCIA = 0.3;
const nomeDe = (c: CaixaCampo): string => c.nome ?? (NOME_CAMPO as Partial<Record<string, string>>)[c.campo] ?? c.campo;

/**
 * Problemas de uma folha: fora do papel ou conteúdo cortado é erro (a impressão
 * sairia incompleta); fora da área útil ou sobreposto é aviso.
 */
export function problemasDaFolha(caixas: readonly CaixaCampo[], margem: number): Problema[] {
  const r: Problema[] = [];
  for (const c of caixas) {
    const nome = nomeDe(c);
    if (c.x < -TOLERANCIA || c.y < -TOLERANCIA || c.x + c.largura > PAPEL.largura + TOLERANCIA || c.y + c.altura > PAPEL.altura + TOLERANCIA) {
      r.push({ campo: c.campo, gravidade: 'erro', texto: `${nome}: passa da borda da folha.` });
    } else if (c.x < margem - TOLERANCIA || c.y < margem - TOLERANCIA || c.x + c.largura > PAPEL.largura - margem + TOLERANCIA || c.y + c.altura > PAPEL.altura - margem + TOLERANCIA) {
      r.push({ campo: c.campo, gravidade: 'aviso', texto: `${nome}: fora da área útil (margem de ${String(margem).replace('.', ',')} mm).` });
    }
    if (c.transborda === true) r.push({ campo: c.campo, gravidade: 'erro', texto: `${nome}: há conteúdo que não cabe na área do bloco.` });
  }
  for (let i = 0; i < caixas.length; i += 1) {
    for (let j = i + 1; j < caixas.length; j += 1) {
      const a = caixas[i];
      const b = caixas[j];
      if (a === undefined || b === undefined) continue;
      const sobrepoe = a.x + TOLERANCIA < b.x + b.largura && b.x + TOLERANCIA < a.x + a.largura && a.y + TOLERANCIA < b.y + b.altura && b.y + TOLERANCIA < a.y + a.altura;
      if (sobrepoe) r.push({ campo: b.campo, gravidade: 'aviso', texto: `${nomeDe(a)} e ${nomeDe(b)} estão sobrepostos.` });
    }
  }
  return r;
}

const PX_MM = 25.4 / 96;
const caixaDoElemento = (el: HTMLElement, campo: string): CaixaCampo => ({ campo, ...(el.dataset.nome === undefined ? {} : { nome: el.dataset.nome }), x: el.offsetLeft * PX_MM, y: el.offsetTop * PX_MM, largura: el.offsetWidth * PX_MM, altura: el.offsetHeight * PX_MM });

/** Mede os itens impressos de uma folha (offset* ignora o zoom por transformação). */
export function medirFolha(folha: HTMLElement): CaixaCampo[] {
  return [...folha.querySelectorAll<HTMLElement>('[data-campo]')].flatMap((el) => {
    const campo = el.dataset.campo;
    if (campo === undefined) return [];
    const interno = el.querySelector<HTMLElement>('[data-conteudo]');
    const transborda = interno !== null && interno.scrollHeight > el.clientHeight + 1;
    return [{ ...caixaDoElemento(el, campo), transborda }];
  });
}

/** Caixas de todos os itens do editor, inclusive os de exemplo (seleção por área). */
export function medirItensDoEditor(folha: HTMLElement): CaixaCampo[] {
  return [...folha.querySelectorAll<HTMLElement>('[data-campo-editor]')].flatMap((el) => {
    const campo = el.dataset.campoEditor;
    return campo === undefined ? [] : [caixaDoElemento(el, campo)];
  });
}
