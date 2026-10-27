import { LIMITE_ETIQUETAS, TipoImportacaoSchema, type TipoImportacao } from '@praca-reversa/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { deEndereco, paraEndereco } from './base';
import { ehTarefa, type IdTarefa } from './features/ajuda/tarefas';

/**
 * Rotas da interface. O detalhe do palete tem endereço estável pelo ID
 * permanente (/paletes/<uuid>), o mesmo usado no QR da etiqueta; cada
 * conferência tem o seu (/conferencias/<uuid>), para retomar o rascunho. As
 * movimentações do palete ficam em /paletes/<uuid>/mover, /transferir e
 * /historico; as importações, em /importacoes, /importacoes/nova e
 * /importacoes/<uuid> (lote); os claims, em /claims, /claims/novo,
 * /claims/<uuid> (com ?linha=<uuid>&aba=… para voltar ao mesmo contexto) e
 * /claims/<uuid>/editar. Um palete aberto a partir de um claim leva
 * ?claim=<uuid>&linha=<uuid> para o retorno ao caso. Etapa 08: janelas em
 * /janelas (?mes=AAAA-MM), /janelas/nova, /janelas/<uuid> (?aba=…) e
 * /janelas/<uuid>/editar; reservas (preparação e saída) em /reservas/<uuid>;
 * expedições (retorno) em /expedicoes/<uuid>. Palete aberto da lista de
 * preparação leva ?reserva=<uuid> para voltar à preparação. Etapa 09:
 * /aplicativo (instalação, aparelho e versões, sem dados da operação). Etapa
 * 10: /ajuda (?guia=<tarefa>), /indicadores (?inicio&fim&aba) e /relatorios
 * (?tipo e filtros do relatório), e /paletes/<uuid>/retirar (palete vazio
 * depois de consolidação). Importar bipagem: /bipagem (arquivo → prévia → posição no mapa) ou /paletes/<uuid>/bipagem (destino = o palete aberto). Complemento "seleção do cliente": /selecoes,
 * /selecoes/<uuid> (?situacao=… filtros da conciliação), /inventarios e
 * /inventarios/<uuid>; /importacoes/nova?tipo=<TIPO> abre a importação com o
 * tipo escolhido (o servidor confere a permissão). Conteúdo do palete:
 * /conteudos/novo (?palete=<uuid>) e /paletes/<uuid>/volumes; os endereços
 * antigos /produtos e /produtos/catalogo levam a /conteudos/novo. Todos
 * os caminhos são internos. Painéis: /painel (?inicio&fim), /painel/estoque
 * (lista dos cards, com os filtros na URL), /painel/janelas/<uuid> (volumes
 * da janela) e /painel/cliente (?aba, janela e filtros); com caminho-base (CAMINHO_BASE=/praca/), a barra
 * de endereços mostra /praca/paletes/<uuid>. "Seleção cliente — teste":
 * /selecao-teste (?solicitacao=<uuid> = carrinho em uso), /selecao-teste/solicitacoes
 * e /selecao-teste/solicitacoes/<uuid> (revisão e acompanhamento).
 */
export type Rota =
  | { tipo: 'praca' }
  | { tipo: 'palete'; id: string; claim?: ContextoClaim; reserva?: string }
  | { tipo: 'conferencia'; id: string }
  | { tipo: AcaoPalete; id: string }
  /** Importar bipagem sem palete: arquivo, prévia e escolha da posição no mapa (/bipagem). */
  | { tipo: 'bipagem-escolher' }
  | { tipo: 'novo-palete'; posicao?: string }
  | { tipo: 'novo-conteudo'; palete?: string }
  | { tipo: 'importacoes' }
  | { tipo: 'nova-importacao'; importar?: TipoImportacao }
  | { tipo: 'importacao'; id: string }
  | { tipo: 'claims' }
  | { tipo: 'novo-claim' }
  | { tipo: 'claim'; id: string; linha: string | null; aba: AbaClaim | null }
  | { tipo: 'editar-claim'; id: string }
  | { tipo: 'janelas'; mes: string | null }
  | { tipo: 'nova-janela' }
  | { tipo: 'janela'; id: string; aba: AbaJanela | null }
  | { tipo: 'editar-janela'; id: string }
  | { tipo: 'reserva'; id: string }
  | { tipo: 'expedicao'; id: string }
  | { tipo: 'layout' }
  | { tipo: 'acesso' }
  | { tipo: 'etiquetas'; ids: string[] }
  | { tipo: 'aplicativo' }
  | { tipo: 'ajuda'; guia: IdTarefa | null }
  /** `aba` ausente = Visão geral; trocar de aba mantém o período. */
  | { tipo: 'indicadores'; inicio: string | null; fim: string | null; aba?: AbaIndicadores }
  | { tipo: 'relatorios'; parametros: string }
  | { tipo: 'planilha' }
  | { tipo: 'selecoes' }
  | { tipo: 'selecao'; id: string; situacao: string | null }
  | { tipo: 'inventarios' }
  /** Fila interna "Validação urgente — sem endereço" (21 out. 2026). */
  | { tipo: 'validacao' }
  | { tipo: 'inventario'; id: string }
  | { tipo: 'painel'; parametros: string }
  | { tipo: 'painel-estoque'; parametros: string }
  | { tipo: 'painel-janela'; id: string }
  | { tipo: 'painel-cliente'; parametros: string }
  | { tipo: 'selecao-teste'; solicitacao: string | null }
  | { tipo: 'selecao-teste-solicitacoes' }
  | { tipo: 'selecao-teste-solicitacao'; id: string }
  | { tipo: 'entrar'; retorno: string | null }
  | { tipo: 'desconhecida' };

/** Seções do detalhe do claim (contexto preservado ao voltar do mapa). */
export type AbaClaim = 'linhas' | 'candidatos' | 'evidencias' | 'resultados' | 'historico';
const ABAS_CLAIM: readonly AbaClaim[] = ['linhas', 'candidatos', 'evidencias', 'resultados', 'historico'];

/** Seções do detalhe da janela. */
export type AbaJanela = 'resumo' | 'material' | 'reservas' | 'historico';
const ABAS_JANELA: readonly AbaJanela[] = ['resumo', 'material', 'reservas', 'historico'];

/** Abas de detalhe dos indicadores (a Visão geral não aparece na URL). */
export type AbaIndicadores = 'movimentacoes' | 'conferencias' | 'estoque' | 'claims';
const ABAS_INDICADORES: readonly AbaIndicadores[] = ['movimentacoes', 'conferencias', 'estoque', 'claims'];

/** Caso e linha de onde o palete foi aberto (para "Voltar ao claim"). */
export interface ContextoClaim {
  id: string;
  linha: string | null;
}

/** Páginas próprias de um palete (movimentações). */
export type AcaoPalete = 'mover' | 'transferir' | 'historico' | 'retirar' | 'bipagem' | 'volumes';
const ACOES_PALETE: readonly AcaoPalete[] = ['mover', 'transferir', 'historico', 'retirar', 'bipagem', 'volumes'];

const DATA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** Filtros aceitos na rota dos relatórios (os demais são descartados); validados de novo pela API. */
export const PARAMETROS_RELATORIO = ['tipo', 'inicio', 'fim', 'conferencia', 'localizacao', 'somentePendencias', 'sku', 'situacao', 'motivo', 'paletes', 'pagina'] as const;

/** Parâmetros dos relatórios em ordem fixa, só chaves conhecidas e valores curtos. */
export function parametrosRelatorio(busca: string | URLSearchParams): string {
  const entrada = typeof busca === 'string' ? new URLSearchParams(busca) : busca;
  const saida = new URLSearchParams();
  for (const chave of PARAMETROS_RELATORIO) {
    const valor = (entrada.get(chave) ?? '').trim();
    if (valor !== '' && valor.length <= 12_000 && !/\p{Cc}/u.test(valor.replace(/[\n\r\t]/g, ' '))) saida.set(chave, valor);
  }
  return saida.toString();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filtros aceitos nas rotas dos painéis (guardados na URL para voltar à mesma consulta); validados de novo pela API. */
export const PARAMETROS_PAINEL = ['aba', 'janela', 'inicio', 'fim', 'rua', 'palete', 'documento', 'delivery', 'remetente', 'situacao', 'pagina'] as const;

/** Parâmetros dos painéis em ordem fixa, só chaves conhecidas e valores curtos. */
export function parametrosPainel(busca: string | URLSearchParams): string {
  const entrada = typeof busca === 'string' ? new URLSearchParams(busca) : busca;
  const saida = new URLSearchParams();
  for (const chave of PARAMETROS_PAINEL) {
    const valor = (entrada.get(chave) ?? '').trim();
    if (valor !== '' && valor.length <= 80 && !/\p{Cc}/u.test(valor)) saida.set(chave, valor);
  }
  return saida.toString();
}

/**
 * Endereços antigos que continuam abrindo a página que os substituiu
 * (favoritos, links salvos); a barra de endereços passa a mostrar o endereço
 * atual (useRota). /produtos ("Novo produto") e /produtos/catalogo (catálogo
 * de SKU, retirado da interface em out. 2026) levam a "Registrar conteúdo".
 */
const ENDERECOS_ANTIGOS: ReadonlyMap<string, 'novo-conteudo'> = new Map([
  ['/produtos', 'novo-conteudo'],
  ['/produtos/catalogo', 'novo-conteudo'],
]);

function partesDe(caminho: string): string[] {
  return caminho.replace(/\/+$/, '').split('/').filter(Boolean);
}

/** O caminho é um endereço antigo (a barra de endereços deve mostrar o atual). */
export function ehEnderecoAntigo(caminho: string): boolean {
  return ENDERECOS_ANTIGOS.has(`/${partesDe(caminho).join('/')}`);
}

export function lerRota(caminho: string, busca: string): Rota {
  const partes = partesDe(caminho);
  const parametros = new URLSearchParams(busca);
  const [primeira, segunda, terceira] = partes;
  if (partes.length === 0) return { tipo: 'praca' };
  const antigo = ENDERECOS_ANTIGOS.get(`/${partes.join('/')}`);
  if (antigo !== undefined) return { tipo: antigo };
  if (primeira === 'paletes' && partes.length === 2 && segunda === 'novo') {
    // "Receber palete aqui" (posição livre): a posição chega escolhida no cadastro.
    const posicao = parametros.get('posicao') ?? '';
    return UUID.test(posicao) ? { tipo: 'novo-palete', posicao: posicao.toLowerCase() } : { tipo: 'novo-palete' };
  }
  if (primeira === 'paletes' && partes.length === 2 && segunda !== undefined && UUID.test(segunda)) {
    const claim = parametros.get('claim') ?? '';
    const linha = parametros.get('linha') ?? '';
    const reserva = parametros.get('reserva') ?? '';
    if (UUID.test(reserva)) return { tipo: 'palete', id: segunda.toLowerCase(), reserva: reserva.toLowerCase() };
    return UUID.test(claim)
      ? { tipo: 'palete', id: segunda.toLowerCase(), claim: { id: claim.toLowerCase(), linha: UUID.test(linha) ? linha.toLowerCase() : null } }
      : { tipo: 'palete', id: segunda.toLowerCase() };
  }
  const acao = ACOES_PALETE.find((a) => a === terceira);
  if (primeira === 'paletes' && partes.length === 3 && segunda !== undefined && UUID.test(segunda) && acao !== undefined) {
    return { tipo: acao, id: segunda.toLowerCase() };
  }
  if (primeira === 'conferencias' && partes.length === 2 && segunda !== undefined && UUID.test(segunda)) {
    return { tipo: 'conferencia', id: segunda.toLowerCase() };
  }
  if (primeira === 'conteudos' && partes.length === 2 && segunda === 'novo') {
    const palete = parametros.get('palete') ?? '';
    return UUID.test(palete) ? { tipo: 'novo-conteudo', palete: palete.toLowerCase() } : { tipo: 'novo-conteudo' };
  }
  if (partes.length === 1 && primeira === 'bipagem') return { tipo: 'bipagem-escolher' };
  if (partes.length === 1 && primeira === 'importacoes') return { tipo: 'importacoes' };
  if (primeira === 'importacoes' && partes.length === 2 && segunda === 'nova') {
    const tipo = TipoImportacaoSchema.safeParse(parametros.get('tipo'));
    return tipo.success ? { tipo: 'nova-importacao', importar: tipo.data } : { tipo: 'nova-importacao' };
  }
  if (partes.length === 1 && primeira === 'selecoes') return { tipo: 'selecoes' };
  if (primeira === 'selecoes' && partes.length === 2 && segunda !== undefined && UUID.test(segunda)) {
    const situacao = (parametros.get('situacao') ?? '').trim();
    return { tipo: 'selecao', id: segunda.toLowerCase(), situacao: /^[A-Z_,]{1,300}$/.test(situacao) ? situacao : null };
  }
  if (partes.length === 1 && primeira === 'inventarios') return { tipo: 'inventarios' };
  if (partes.length === 1 && primeira === 'validacao') return { tipo: 'validacao' };
  if (primeira === 'inventarios' && partes.length === 2 && segunda !== undefined && UUID.test(segunda)) return { tipo: 'inventario', id: segunda.toLowerCase() };
  if (primeira === 'importacoes' && partes.length === 2 && segunda !== undefined && UUID.test(segunda)) return { tipo: 'importacao', id: segunda.toLowerCase() };
  if (partes.length === 1 && primeira === 'claims') return { tipo: 'claims' };
  if (primeira === 'claims' && partes.length === 2 && segunda === 'novo') return { tipo: 'novo-claim' };
  if (primeira === 'claims' && partes.length === 2 && segunda !== undefined && UUID.test(segunda)) {
    const linha = parametros.get('linha') ?? '';
    const aba = ABAS_CLAIM.find((a) => a === parametros.get('aba')) ?? null;
    return { tipo: 'claim', id: segunda.toLowerCase(), linha: UUID.test(linha) ? linha.toLowerCase() : null, aba };
  }
  if (primeira === 'claims' && partes.length === 3 && segunda !== undefined && UUID.test(segunda) && terceira === 'editar') {
    return { tipo: 'editar-claim', id: segunda.toLowerCase() };
  }
  if (partes.length === 1 && primeira === 'janelas') {
    const mes = parametros.get('mes') ?? '';
    return { tipo: 'janelas', mes: /^\d{4}-(0[1-9]|1[0-2])$/.test(mes) ? mes : null };
  }
  if (primeira === 'janelas' && partes.length === 2 && segunda === 'nova') return { tipo: 'nova-janela' };
  if (primeira === 'janelas' && partes.length === 2 && segunda !== undefined && UUID.test(segunda)) {
    return { tipo: 'janela', id: segunda.toLowerCase(), aba: ABAS_JANELA.find((a) => a === parametros.get('aba')) ?? null };
  }
  if (primeira === 'janelas' && partes.length === 3 && segunda !== undefined && UUID.test(segunda) && terceira === 'editar') {
    return { tipo: 'editar-janela', id: segunda.toLowerCase() };
  }
  if (primeira === 'reservas' && partes.length === 2 && segunda !== undefined && UUID.test(segunda)) return { tipo: 'reserva', id: segunda.toLowerCase() };
  if (primeira === 'expedicoes' && partes.length === 2 && segunda !== undefined && UUID.test(segunda)) return { tipo: 'expedicao', id: segunda.toLowerCase() };
  if (partes.length === 1 && primeira === 'layout') return { tipo: 'layout' };
  if (partes.length === 1 && primeira === 'acesso') return { tipo: 'acesso' };
  if (partes.length === 1 && primeira === 'aplicativo') return { tipo: 'aplicativo' };
  if (partes.length === 1 && primeira === 'ajuda') {
    const guia = parametros.get('guia');
    return { tipo: 'ajuda', guia: ehTarefa(guia) ? guia : null };
  }
  if (partes.length === 1 && primeira === 'indicadores') {
    const inicio = parametros.get('inicio') ?? '';
    const fim = parametros.get('fim') ?? '';
    const aba = ABAS_INDICADORES.find((a) => a === parametros.get('aba'));
    return { tipo: 'indicadores', inicio: DATA.test(inicio) ? inicio : null, fim: DATA.test(fim) ? fim : null, ...(aba ? { aba } : {}) };
  }
  if (partes.length === 1 && primeira === 'relatorios') return { tipo: 'relatorios', parametros: parametrosRelatorio(parametros) };
  if (partes.length === 1 && primeira === 'planilha') return { tipo: 'planilha' };
  if (partes.length === 1 && primeira === 'painel') return { tipo: 'painel', parametros: parametrosPainel(parametros) };
  if (primeira === 'painel' && partes.length === 2 && segunda === 'estoque') return { tipo: 'painel-estoque', parametros: parametrosPainel(parametros) };
  if (primeira === 'painel' && partes.length === 2 && segunda === 'cliente') return { tipo: 'painel-cliente', parametros: parametrosPainel(parametros) };
  if (primeira === 'painel' && partes.length === 3 && segunda === 'janelas' && terceira !== undefined && UUID.test(terceira)) return { tipo: 'painel-janela', id: terceira.toLowerCase() };
  if (partes.length === 1 && primeira === 'selecao-teste') {
    const solicitacao = parametros.get('solicitacao') ?? '';
    return { tipo: 'selecao-teste', solicitacao: UUID.test(solicitacao) ? solicitacao.toLowerCase() : null };
  }
  if (primeira === 'selecao-teste' && partes.length === 2 && segunda === 'solicitacoes') return { tipo: 'selecao-teste-solicitacoes' };
  if (primeira === 'selecao-teste' && partes.length === 3 && segunda === 'solicitacoes' && terceira !== undefined && UUID.test(terceira)) {
    return { tipo: 'selecao-teste-solicitacao', id: terceira.toLowerCase() };
  }
  if (partes.length === 1 && primeira === 'entrar') return { tipo: 'entrar', retorno: parametros.get('retorno') };
  if (partes.length === 1 && primeira === 'etiquetas') {
    const ids = [...new Set((parametros.get('ids') ?? '').split(',').map((id) => id.trim().toLowerCase()))].filter((id) => UUID.test(id));
    return ids.length > 0 && ids.length <= LIMITE_ETIQUETAS ? { tipo: 'etiquetas', ids } : { tipo: 'desconhecida' };
  }
  return { tipo: 'desconhecida' };
}

export function caminhoDe(rota: Rota): string {
  switch (rota.tipo) {
    case 'praca':
    case 'desconhecida':
      return '/';
    case 'palete':
      if (rota.reserva) return `/paletes/${rota.id}?reserva=${rota.reserva}`;
      return rota.claim
        ? `/paletes/${rota.id}?claim=${rota.claim.id}${rota.claim.linha ? `&linha=${rota.claim.linha}` : ''}`
        : `/paletes/${rota.id}`;
    case 'janelas':
      return rota.mes ? `/janelas?mes=${rota.mes}` : '/janelas';
    case 'nova-janela':
      return '/janelas/nova';
    case 'janela':
      return rota.aba ? `/janelas/${rota.id}?aba=${rota.aba}` : `/janelas/${rota.id}`;
    case 'editar-janela':
      return `/janelas/${rota.id}/editar`;
    case 'reserva':
      return `/reservas/${rota.id}`;
    case 'expedicao':
      return `/expedicoes/${rota.id}`;
    case 'claims':
      return '/claims';
    case 'novo-claim':
      return '/claims/novo';
    case 'claim': {
      const p = new URLSearchParams();
      if (rota.linha) p.set('linha', rota.linha);
      if (rota.aba) p.set('aba', rota.aba);
      const q = p.toString();
      return `/claims/${rota.id}${q ? `?${q}` : ''}`;
    }
    case 'editar-claim':
      return `/claims/${rota.id}/editar`;
    case 'conferencia':
      return `/conferencias/${rota.id}`;
    case 'mover':
    case 'transferir':
    case 'historico':
    case 'retirar':
    case 'bipagem':
    case 'volumes':
      return `/paletes/${rota.id}/${rota.tipo}`;
    case 'novo-palete':
      return rota.posicao ? `/paletes/novo?posicao=${rota.posicao}` : '/paletes/novo';
    case 'novo-conteudo':
      return rota.palete ? `/conteudos/novo?palete=${rota.palete}` : '/conteudos/novo';
    case 'bipagem-escolher':
      return '/bipagem';
    case 'importacoes':
      return '/importacoes';
    case 'nova-importacao':
      return rota.importar ? `/importacoes/nova?tipo=${rota.importar}` : '/importacoes/nova';
    case 'selecoes':
      return '/selecoes';
    case 'selecao':
      return rota.situacao ? `/selecoes/${rota.id}?situacao=${rota.situacao}` : `/selecoes/${rota.id}`;
    case 'inventarios':
      return '/inventarios';
    case 'validacao':
      return '/validacao';
    case 'inventario':
      return `/inventarios/${rota.id}`;
    case 'importacao':
      return `/importacoes/${rota.id}`;
    case 'layout':
      return '/layout';
    case 'acesso':
      return '/acesso';
    case 'aplicativo':
      return '/aplicativo';
    case 'ajuda':
      return rota.guia ? `/ajuda?guia=${rota.guia}` : '/ajuda';
    case 'indicadores': {
      const p = new URLSearchParams();
      if (rota.inicio) p.set('inicio', rota.inicio);
      if (rota.fim) p.set('fim', rota.fim);
      if (rota.aba) p.set('aba', rota.aba);
      const q = p.toString();
      return `/indicadores${q ? `?${q}` : ''}`;
    }
    case 'relatorios': {
      const q = parametrosRelatorio(rota.parametros);
      return `/relatorios${q ? `?${q}` : ''}`;
    }
    case 'planilha':
      return '/planilha';
    case 'painel':
    case 'painel-estoque':
    case 'painel-cliente': {
      const q = parametrosPainel(rota.parametros);
      const base = rota.tipo === 'painel' ? '/painel' : rota.tipo === 'painel-estoque' ? '/painel/estoque' : '/painel/cliente';
      return `${base}${q ? `?${q}` : ''}`;
    }
    case 'painel-janela':
      return `/painel/janelas/${rota.id}`;
    case 'selecao-teste':
      return rota.solicitacao === null ? '/selecao-teste' : `/selecao-teste?solicitacao=${rota.solicitacao}`;
    case 'selecao-teste-solicitacoes':
      return '/selecao-teste/solicitacoes';
    case 'selecao-teste-solicitacao':
      return `/selecao-teste/solicitacoes/${rota.id}`;
    case 'etiquetas':
      return `/etiquetas?ids=${rota.ids.join(',')}`;
    case 'entrar':
      return rota.retorno === null ? '/entrar' : `/entrar?retorno=${encodeURIComponent(rota.retorno)}`;
  }
}

const ORIGEM_FICTICIA = 'https://interno.invalid';

/**
 * Destino de retorno após o login. Só aceita caminhos internos conhecidos;
 * qualquer outra coisa (outro site, "//host", barra invertida, esquema) volta
 * para a praça. O caminho devolvido é reconstruído a partir da rota.
 */
export function destinoSeguro(retorno: string | null): string {
  if (retorno === null || retorno.length > 2_048) return '/';
  if (!retorno.startsWith('/') || retorno.startsWith('//') || retorno.includes('\\') || /\p{Cc}/u.test(retorno)) return '/';
  let url: URL;
  try {
    url = new URL(retorno, ORIGEM_FICTICIA);
  } catch {
    return '/';
  }
  if (url.origin !== ORIGEM_FICTICIA) return '/';
  const rota = lerRota(url.pathname, url.search);
  return rota.tipo === 'entrar' || rota.tipo === 'desconhecida' ? '/' : caminhoDe(rota);
}

/** Caminho interno da barra de endereços (fora do caminho-base: rota desconhecida). */
function localAtual(): { caminho: string; busca: string } {
  return { caminho: deEndereco(window.location.pathname) ?? '/__fora-do-caminho-base__', busca: window.location.search };
}

export type Navegar = (rota: Rota, opcoes?: { substituir?: boolean }) => void;

/**
 * Rota atual pela barra de endereços (History API). Substituir preserva o
 * estado do histórico (usado pelo detalhe no celular).
 */
export function useRota(): [Rota, Navegar] {
  const [local, setLocal] = useState(localAtual);
  useEffect(() => {
    const aoVoltar = () => {
      setLocal(localAtual());
    };
    window.addEventListener('popstate', aoVoltar);
    return () => {
      window.removeEventListener('popstate', aoVoltar);
    };
  }, []);
  const rota = useMemo(() => lerRota(local.caminho, local.busca), [local]);
  const navegar = useCallback<Navegar>((destino, opcoes) => {
    const caminho = caminhoDe(destino);
    const atual = (deEndereco(window.location.pathname) ?? '') + window.location.search;
    if (caminho !== atual) {
      if (opcoes?.substituir) window.history.replaceState(window.history.state, '', paraEndereco(caminho));
      else window.history.pushState(null, '', paraEndereco(caminho));
    }
    setLocal(localAtual());
  }, []);
  // Endereço antigo (ex.: /produtos/catalogo): a barra passa a mostrar o endereço da página que abriu (a rota já é a nova).
  const antigo = ehEnderecoAntigo(local.caminho);
  useEffect(() => {
    if (antigo) window.history.replaceState(window.history.state, '', paraEndereco(caminhoDe(rota)));
  }, [antigo, rota]);
  return [rota, navegar];
}
