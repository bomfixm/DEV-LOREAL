import { LIMITE_PROCESSAMENTO_MS } from '@praca-reversa/contracts';
import { useMemo } from 'react';
import { z } from 'zod';
import { criarLoja, useLoja } from '../utils/loja';

/**
 * Operações com resultado incerto (etapa 09): o pedido saiu, a resposta não
 * chegou (rede, proxy, servidor). Não é recusa: o servidor pode ter gravado.
 * Ficam aqui a chave de idempotência, o pedido idêntico e o alvo, até a
 * consulta autenticada (GET /operacoes/<chave>) ou o reenvio com a mesma
 * chave resolverem. Enquanto isso, outro pedido ao mesmo alvo com outra
 * chave é bloqueado (mudança de payload exige resolver o anterior).
 *
 * Isolamento: por usuário e escopo; sair da conta apaga tudo. Persistência no
 * sessionStorage só quando a política da API permite (nunca em produção), sem
 * corpo que contenha senha e sem arquivos.
 */
export type SituacaoIncerta = 'incerta' | 'verificando' | 'confirmada' | 'recusada' | 'nao-registrada';
export type Metodo = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface OperacaoIncerta {
  id: string;
  chave: string;
  metodo: Metodo;
  /** URL interna da API (sem caminho-base). */
  url: string;
  /** Corpo JSON idêntico ao enviado; `undefined` quando não pode ser reenviado daqui (arquivo). */
  corpo: unknown;
  descricao: string;
  usuarioId: string;
  escopoId: string;
  /** Momento da falha (epoch ms). */
  criadaEm: number;
  situacao: SituacaoIncerta;
  verificadaEm: number | null;
  mensagem: string | null;
}

export interface Contexto {
  usuarioId: string;
  escopoId: string;
}

interface Estado {
  contexto: Contexto | null;
  /** Política de rascunho no navegador; null = ainda desconhecida (só memória, nada gravado nem apagado). */
  persistir: boolean | null;
  itens: readonly OperacaoIncerta[];
}

export const lojaIncertas = criarLoja<Estado>({ contexto: null, persistir: false, itens: [] });

/** Acesso ao sessionStorage (substituível nos testes). */
export interface Armazenamento {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
  key(indice: number): string | null;
  readonly length: number;
}

let armazenamento: () => Armazenamento | null = () => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};
export function usarArmazenamento(fonte: () => Armazenamento | null): void {
  armazenamento = fonte;
}

const PREFIXO = 'pr-operacoes-incertas:';
const VERSAO_FORMATO = 1;
const ROTULO = 'em confirmação — não confirmado pelo servidor';

const GravadoSchema = z.object({
  versao: z.literal(VERSAO_FORMATO),
  salvoEm: z.string(),
  rotulo: z.string(),
  itens: z.array(
    z.object({
      id: z.string().min(1),
      chave: z.string().min(8),
      metodo: z.enum(['POST', 'PUT', 'PATCH', 'DELETE']),
      url: z.string().startsWith('/api/'),
      corpo: z.unknown().optional(),
      descricao: z.string(),
      criadaEm: z.number(),
    }),
  ),
});

function chaveArmazenamento(c: Contexto): string {
  return `${PREFIXO}v${String(VERSAO_FORMATO)}:${c.usuarioId}:${c.escopoId}`;
}

/** Senha nunca vai para armazenamento acessível a scripts. */
function corpoGravavel(corpo: unknown): boolean {
  if (corpo === undefined) return true;
  const texto = JSON.stringify(corpo);
  return !/"(senha|password|novaSenha|token)"\s*:/i.test(texto);
}

function gravar(estado: Estado): void {
  const fonte = armazenamento();
  if (!fonte || estado.contexto === null) return;
  if (estado.persistir === null) return;
  const chave = chaveArmazenamento(estado.contexto);
  try {
    if (!estado.persistir) {
      fonte.removeItem(chave);
      return;
    }
    const doContexto = estado.itens.filter(
      (i) => i.usuarioId === estado.contexto?.usuarioId && i.escopoId === estado.contexto.escopoId && (i.situacao === 'incerta' || i.situacao === 'verificando'),
    );
    if (doContexto.length === 0) fonte.removeItem(chave);
    else {
      fonte.setItem(
        chave,
        JSON.stringify({
          versao: VERSAO_FORMATO,
          salvoEm: new Date().toISOString(),
          rotulo: ROTULO,
          itens: doContexto.map((i) => ({
            id: i.id,
            chave: i.chave,
            metodo: i.metodo,
            url: i.url,
            ...(corpoGravavel(i.corpo) && i.corpo !== undefined ? { corpo: i.corpo } : {}),
            descricao: i.descricao,
            criadaEm: i.criadaEm,
          })),
        }),
      );
    }
  } catch {
    // Armazenamento indisponível: fica só na memória da aba.
  }
}

function lerGravadas(c: Contexto): OperacaoIncerta[] {
  const fonte = armazenamento();
  if (!fonte) return [];
  try {
    const texto = fonte.getItem(chaveArmazenamento(c));
    if (!texto) return [];
    const lido = GravadoSchema.safeParse(JSON.parse(texto));
    if (!lido.success) return [];
    return lido.data.itens.map((i) => ({
      ...i,
      metodo: i.metodo,
      corpo: i.corpo,
      usuarioId: c.usuarioId,
      escopoId: c.escopoId,
      situacao: 'incerta',
      verificadaEm: null,
      mensagem: 'Recuperada depois de reabrir a aplicação: verificando no servidor.',
    }));
  } catch {
    return [];
  }
}

function removerDoArmazenamento(filtro: (chave: string) => boolean): void {
  const fonte = armazenamento();
  if (!fonte) return;
  try {
    const chaves: string[] = [];
    for (let i = 0; i < fonte.length; i++) {
      const chave = fonte.key(i);
      if (chave?.startsWith(PREFIXO) && filtro(chave)) chaves.push(chave);
    }
    for (const chave of chaves) fonte.removeItem(chave);
  } catch {
    // Sem armazenamento: nada a remover.
  }
}

/**
 * Sessão autenticada atual. Outro usuário: o que era do anterior é apagado
 * (memória e armazenamento). Mesmo usuário em outro escopo: os itens do outro
 * escopo ficam guardados, mas não aparecem nem são enviados.
 */
export function definirContexto(contexto: Contexto | null, persistir: boolean | null): void {
  const atual = lojaIncertas.ler();
  if (contexto === null) {
    lojaIncertas.definir({ contexto: null, persistir, itens: atual.itens });
    return;
  }
  if (atual.contexto?.usuarioId === contexto.usuarioId && atual.contexto.escopoId === contexto.escopoId && atual.persistir === persistir) return;
  removerDoArmazenamento((chave) => !chave.includes(`:${contexto.usuarioId}:`));
  const mantidos = atual.itens.filter((i) => i.usuarioId === contexto.usuarioId);
  const recuperados = persistir === true ? lerGravadas(contexto).filter((r) => !mantidos.some((m) => m.chave === r.chave)) : [];
  const novo: Estado = { contexto, persistir, itens: [...mantidos, ...recuperados] };
  lojaIncertas.definir(novo);
  gravar(novo);
}

/** Sair da conta: nada fica na memória nem no armazenamento. */
export function limparIncertas(): void {
  removerDoArmazenamento(() => true);
  lojaIncertas.definir((atual) => ({ ...atual, contexto: null, itens: [] }));
}

function atualizar(mudar: (itens: readonly OperacaoIncerta[]) => readonly OperacaoIncerta[]): void {
  lojaIncertas.definir((atual) => {
    const novo = { ...atual, itens: mudar(atual.itens) };
    gravar(novo);
    return novo;
  });
}

export function registrarIncerta(dados: Omit<OperacaoIncerta, 'id' | 'usuarioId' | 'escopoId' | 'criadaEm' | 'situacao' | 'verificadaEm' | 'mensagem'>): OperacaoIncerta | null {
  const { contexto } = lojaIncertas.ler();
  if (contexto === null) return null;
  const existente = lojaIncertas.ler().itens.find((i) => i.chave === dados.chave && i.usuarioId === contexto.usuarioId && i.escopoId === contexto.escopoId);
  if (existente) {
    alterarIncerta(existente.id, { situacao: 'incerta', mensagem: 'Sem resposta outra vez: o resultado continua incerto.' });
    return existente;
  }
  const item: OperacaoIncerta = {
    ...dados,
    id: crypto.randomUUID(),
    usuarioId: contexto.usuarioId,
    escopoId: contexto.escopoId,
    criadaEm: Date.now(),
    situacao: 'incerta',
    verificadaEm: null,
    mensagem: null,
  };
  atualizar((itens) => [...itens, item]);
  return item;
}

export function alterarIncerta(id: string, mudanca: Partial<Pick<OperacaoIncerta, 'situacao' | 'verificadaEm' | 'mensagem'>>): void {
  atualizar((itens) => itens.map((i) => (i.id === id ? { ...i, ...mudanca } : i)));
}

export function descartarIncerta(id: string): void {
  atualizar((itens) => itens.filter((i) => i.id !== id));
}

/** Itens visíveis: só os da sessão (usuário e escopo) atual. */
export function incertasDoContexto(estado: Estado = lojaIncertas.ler()): OperacaoIncerta[] {
  const c = estado.contexto;
  if (c === null) return [];
  return estado.itens.filter((i) => i.usuarioId === c.usuarioId && i.escopoId === c.escopoId);
}

/** Ainda sem desfecho (bloqueia outro pedido ao mesmo alvo e a atualização da versão). */
export function pendente(i: OperacaoIncerta): boolean {
  return i.situacao === 'incerta' || i.situacao === 'verificando';
}

/** Operação incerta que impede enviar outro pedido (outra chave) ao mesmo alvo. */
export function bloqueioPara(metodo: string, url: string, chave: string): OperacaoIncerta | null {
  return incertasDoContexto().find((i) => pendente(i) && i.metodo === metodo && i.url === url && i.chave !== chave) ?? null;
}

/** O servidor ainda pode estar processando (antes do tempo-limite das transações)? */
export function aindaPodeProcessar(i: OperacaoIncerta, agora = Date.now()): boolean {
  return agora - i.criadaEm < LIMITE_PROCESSAMENTO_MS;
}

/** Resposta do servidor a um pedido com esta chave (reenvio ou outra tela): encerra o estado pendente uma única vez. */
export function concluirPorChave(chave: string, situacao: 'confirmada' | 'recusada', mensagem: string): void {
  const item = incertasDoContexto().find((i) => i.chave === chave && pendente(i));
  if (item) alterarIncerta(item.id, { situacao, mensagem, verificadaEm: Date.now() });
}

export function useIncertas(): OperacaoIncerta[] {
  const estado = useLoja(lojaIncertas);
  return useMemo(() => incertasDoContexto(estado), [estado]);
}
