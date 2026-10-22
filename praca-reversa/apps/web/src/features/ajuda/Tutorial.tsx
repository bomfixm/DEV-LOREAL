import { API_PREFIXO, ExemploTutorialSchema, type ExemploTutorial, type Permissao } from '@praca-reversa/contracts';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { useRecurso, type Carga } from '../../api/use-recurso';
import type { Navegar, Rota } from '../../rotas';
import { encerrarTutorial, gravarPreferencia, irParaPasso } from './estado';
import { TITULOS_TAREFA, type IdTarefa } from './tarefas';

/**
 * Tutorial de primeiro uso (etapa 10): "encontrar um produto e saber em qual
 * palete/endereço ele está". Cada passo diz o que fazer, onde e o que deve
 * aparecer, e destaca o elemento real da tela (atributo data-tutorial ou
 * test id estável). O tutorial só observa e orienta: nunca clica, digita ou
 * confirma nada — a única gravação é a preferência do próprio usuário.
 * O balão espera o elemento existir e estar visível; sem ele, diz como fazê-lo
 * aparecer. No celular o balão fica encostado no lado oposto ao elemento.
 */

interface Contexto {
  rota: Rota;
  compacto: boolean;
  demo: boolean;
  escopo: string;
  perfil: string | null;
  permissoes: readonly Permissao[];
  exemplo: Carga<ExemploTutorial> | null;
}

interface Passo {
  titulo: string;
  fazer: string;
  onde: string;
  aparece: string;
  /** Elemento real a destacar (visível) ou null. */
  alvo: () => HTMLElement | null;
  /** Instrução quando o elemento ainda não está na tela. */
  semAlvo: string;
  feito?: () => boolean;
  /** Passo que não se aplica a este escopo (sem exemplo). */
  indisponivel?: boolean;
}

function visivel(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement) || !el.isConnected) return false;
  if (el.closest('[hidden], [aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none';
}

function primeiro(...seletores: string[]): HTMLElement | null {
  for (const seletor of seletores) {
    for (const el of document.querySelectorAll(seletor)) if (visivel(el)) return el;
  }
  return null;
}

const normal = (t: string) => t.trim().toUpperCase().replace(/\s+/g, '');

function campoBusca(): HTMLInputElement | null {
  const el = primeiro('[data-testid="campo-busca"]');
  return el instanceof HTMLInputElement ? el : null;
}

/** Próximos guias sugeridos conforme o que o perfil executa. */
function proximosGuias(permissoes: readonly Permissao[]): IdTarefa[] {
  const lista: IdTarefa[] = [];
  if (permissoes.includes('conferencia.registrar')) lista.push('conferir');
  if (permissoes.includes('palete.cadastrar')) lista.push('cadastrar');
  if (permissoes.includes('conferencia.reconciliar')) lista.push('divergencia');
  if (permissoes.includes('movimento.registrar')) lista.push('mover');
  if (permissoes.includes('claim.tratar')) lista.push('claim');
  if (permissoes.includes('janela.reservar')) lista.push('janela');
  if (permissoes.includes('selecao.consultar')) lista.push('selecao');
  lista.push('camera', 'interrupcao');
  return lista.slice(0, 4);
}

function montarPassos(c: Contexto): Passo[] {
  const ex = c.exemplo?.estado === 'pronto' ? c.exemplo.dados : null;
  const codigo = ex?.product?.sku ?? ex?.pallet?.code ?? null;
  const palete = ex?.pallet ?? null;
  const semExemplo = ex?.kind === 'NENHUM';
  const naPraca = c.rota.tipo === 'praca' || c.rota.tipo === 'palete';
  const detalheVisivel = () => primeiro('[data-tutorial="identificacao-palete"]') !== null;
  const carregandoExemplo = c.exemplo === null || c.exemplo.estado === 'carregando';

  const passos: Passo[] = [
    {
      titulo: c.demo ? 'Você está na demonstração' : 'Você está no escopo da operação',
      fazer: 'Confira o ambiente antes de começar.',
      onde: c.demo ? 'Selo "Demonstração" no topo e faixa "Modo demonstração".' : `Menu no topo: ${c.escopo}${c.perfil ? ` — perfil ${c.perfil}` : ''}.`,
      aparece: c.demo
        ? 'Os dados desta praça são fictícios: nada aqui é estoque real. O tutorial só consulta; não grava nada no estoque.'
        : 'Os dados são da operação. O tutorial só consulta: não cria, não move e não confirma nada.',
      alvo: () => (c.demo ? primeiro('[data-tutorial="ambiente"]') : primeiro('[data-testid="menu-conta"] > summary')),
      semAlvo: 'O topo da tela mostra o ambiente.',
    },
  ];

  if (semExemplo) {
    const podeCadastrar = c.permissoes.includes('palete.cadastrar');
    passos.push({
      titulo: 'Sem exemplo neste escopo',
      fazer: `${ex.reason ?? 'Ainda não há paletes para consultar.'} Você não precisa criar estoque para aprender.`,
      onde: 'Botão "Ajuda" no topo: guias por tarefa, glossário e dúvidas.',
      aparece: podeCadastrar
        ? 'Próximo passo válido: o guia "Cadastrar palete" explica como registrar o primeiro palete.'
        : 'Próximo passo válido: peça ao supervisor de estoque para cadastrar os paletes; enquanto isso, leia os guias.',
      alvo: () => primeiro('[data-tutorial="ajuda"]'),
      semAlvo: 'Use o botão "Ajuda" no topo da tela.',
    });
    for (const titulo of ['Pesquisar e escolher', 'Abrir o palete', 'Quantidades e pendências']) {
      passos.push({ titulo, fazer: 'Este passo precisa de um palete cadastrado neste escopo.', onde: '—', aparece: 'Indisponível agora.', alvo: () => null, semAlvo: '', indisponivel: true });
    }
  } else {
    const campo = campoBusca();
    passos.push({
      titulo: 'Onde pesquisar',
      fazer:
        codigo === null
          ? carregandoExemplo
            ? 'Procurando um exemplo neste escopo…'
            : 'Digite um SKU ou o código de um palete que você conhece.'
          : campo
            ? `Digite ${codigo} no campo "Buscar".`
            : c.compacto
              ? 'Toque na aba "Busca", embaixo.'
              : 'Toque em "Buscar conteúdo".',
      onde: campo ? (c.compacto ? 'Campo "Buscar", no painel de busca.' : 'Caixa de pesquisa no topo do mapa; os resultados aparecem sobre o mapa.') : c.compacto ? 'Barra de abas embaixo da tela.' : 'Caixa de pesquisa no topo do mapa.',
      aparece:
        ex?.kind === 'PALETE'
          ? `${ex.reason ?? ''} Os resultados aparecem em cartões logo abaixo do campo.`
          : 'Os resultados aparecem em cartões logo abaixo do campo, cada um com a base da informação.',
      alvo: () => campoBusca() ?? (c.compacto ? primeiro('[data-tutorial="aba-busca"]') : primeiro('[data-testid="painel-busca-botao"]')),
      semAlvo: naPraca ? 'A busca fica no mapa da praça.' : 'Volte ao mapa da praça para pesquisar.',
      feito: () => {
        const f = campoBusca();
        return f !== null && codigo !== null && normal(f.value) === normal(codigo) && primeiro('[data-testid="resultado-busca"]') !== null;
      },
    });
    const basesTexto = (ex?.occurrences.bases ?? []).map((b) => ({ SALDO_VALIDADO: 'saldo validado', OBSERVADO: 'observado em conferência', DECLARADO_PALETE: 'declarado no palete', DOCUMENTO: 'documento importado', PALETE: 'palete', INVENTARIO: 'vínculo do inventário', CONTEUDO: 'conteúdo registrado', ORIGEM_INVENTARIO: 'origem do inventário sem alocação' })[b]);
    passos.push({
      titulo: 'Escolher o resultado',
      fazer: palete ? `Toque em "Ver no mapa" no cartão do palete ${palete.code}${ex?.kind === 'PRODUTO' ? ' com a base "Saldo validado"' : ''}.` : 'Toque em "Ver no mapa" no cartão escolhido.',
      onde: 'Cartões de resultado da busca.',
      aparece:
        ex?.kind === 'PRODUTO' && (ex.occurrences.pallets > 1 || ex.occurrences.bases.length > 1)
          ? `O mesmo SKU pode aparecer em vários paletes e origens: este aparece em ${String(ex.occurrences.pallets)} palete(s), com as bases ${basesTexto.join(', ')}. As bases não se somam; o mapa centraliza o palete escolhido.`
          : 'Cada cartão mostra a base da informação. O mapa centraliza o palete escolhido.',
      alvo: () =>
        palete === null
          ? primeiro('[data-testid="resultado-abrir"]')
          : primeiro(
              `[data-testid="resultado-busca"][data-palete="${CSS.escape(palete.code)}"][data-base="SALDO_VALIDADO"] [data-testid="resultado-abrir"]`,
              `[data-testid="resultado-busca"][data-palete="${CSS.escape(palete.code)}"] [data-testid="resultado-abrir"]`,
              '[data-testid="resultado-abrir"]',
            ),
      semAlvo: 'Ainda não há resultado na tela: volte ao passo anterior e pesquise o código.',
      feito: () => c.rota.tipo === 'palete',
    });
    passos.push({
      titulo: 'Abrir o palete: ID e endereço',
      fazer:
        !detalheVisivel()
          ? `${c.compacto ? 'Toque' : 'Clique'} no palete${palete ? ` ${palete.code}` : ''} no mapa: a janela do palete abre.`
          : `Confira o número do palete${palete ? ` (${palete.code})` : ''} e o endereço no topo da janela.`,
      onde: !detalheVisivel() ? 'Mapa da praça.' : 'Topo da janela do palete.',
      aparece:
        'O endereço mostra onde o palete está agora: pode mudar num movimento. O ID permanente, que vai no QR da etiqueta, nunca muda (em "Detalhes completos e outras ações").',
      alvo: () => primeiro('[data-tutorial="identificacao-palete"]'),
      semAlvo: c.rota.tipo === 'palete' ? 'O detalhe do palete ainda está carregando…' : 'Escolha um resultado da busca (passo anterior) para abrir o palete.',
      feito: detalheVisivel,
    });
    passos.push({
      titulo: 'Quantidades e pendências',
      fazer: 'Leia o resumo (volumes e notas/minutas) e a tabela de conteúdo da janela.',
      onde: 'Janela do palete, abaixo do endereço.',
      aparece:
        'Cada linha é um documento: tipo, número, remetente e os volumes dele neste palete, com a base (lidos na bipagem, contados ou do inventário). "Não informado" significa que ainda falta informação — não que o palete está vazio.',
      alvo: () => primeiro('[data-tutorial="conteudo-palete"]'),
      semAlvo: 'Abra o palete (passo anterior) para ver o conteúdo.',
    });
  }

  const guias = proximosGuias(c.permissoes).map((g) => TITULOS_TAREFA[g]);
  passos.push({
    titulo: 'Repetir e continuar',
    fazer: c.compacto
      ? 'Para repetir: aba "Busca" → código → "Ver no mapa" (ou toque no palete no mapa). "Fechar" fecha a janela.'
      : 'Para repetir: pesquise no topo → "Ver no mapa" (ou clique no palete no mapa). "Fechar" ou Esc fecha a janela; o mapa continua onde estava.',
    onde: 'Botão "Ajuda" no topo: "Começar aqui" repete este tutorial; os guias por tarefa ficam na mesma página.',
    aparece: `Próximos guias para o seu perfil: ${guias.join('; ')}.`,
    alvo: () => primeiro('[data-tutorial="ajuda"]'),
    semAlvo: 'O botão "Ajuda" fica no topo da tela.',
  });
  return passos;
}

interface Retangulo {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Medidas lidas da tela (fora da renderização, em callbacks). */
interface Medida {
  alvo: Retangulo | null;
  feito: boolean;
  alturaBalao: number;
  larguraJanela: number;
  alturaJanela: number;
  abas: number;
}

const MEDIDA_INICIAL: Medida = { alvo: null, feito: false, alturaBalao: 0, larguraJanela: 1024, alturaJanela: 768, abas: 0 };

function mesmaMedida(a: Medida, b: Medida): boolean {
  const ra = a.alvo;
  const rb = b.alvo;
  const alvos = ra === rb || (ra !== null && rb !== null && ra.top === rb.top && ra.left === rb.left && ra.width === rb.width && ra.height === rb.height);
  return alvos && a.feito === b.feito && Math.abs(a.alturaBalao - b.alturaBalao) < 2 && a.larguraJanela === b.larguraJanela && a.alturaJanela === b.alturaJanela && a.abas === b.abas;
}

interface Props {
  usuarioId: string;
  passo: number;
  rota: Rota;
  compacto: boolean;
  demo: boolean;
  escopo: string;
  perfil: string | null;
  permissoes: readonly Permissao[];
  navegar: Navegar;
}

export function Tutorial({ usuarioId, passo, rota, compacto, demo, escopo, perfil, permissoes, navegar }: Props) {
  const ids = useId();
  const balaoRef = useRef<HTMLDivElement>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const atualRef = useRef<Passo | null>(null);
  const [recolhidoNoPasso, setRecolhidoNoPasso] = useState<number | null>(null);
  const [medida, setMedida] = useState<Medida>(MEDIDA_INICIAL);
  const { carga: exemplo, recarregar } = useRecurso(`${API_PREFIXO}/ajuda/exemplo`, ExemploTutorialSchema);
  const passos = montarPassos({ rota, compacto, demo, escopo, perfil, permissoes, exemplo });
  const total = passos.length;
  const indice = Math.min(Math.max(passo, 1), total) - 1;
  const atual = passos[indice] ?? null;
  const naPraca = rota.tipo === 'praca' || rota.tipo === 'palete';
  const recolhido = recolhidoNoPasso === indice;

  // O passo mais recente fica disponível para as medições (feitas fora da renderização).
  useEffect(() => {
    atualRef.current = atual;
  });

  // Foco no título ao começar e a cada passo.
  useEffect(() => {
    tituloRef.current?.focus();
  }, [indice]);

  // Acompanha o elemento real: espera ele existir e estar visível, rola até ele uma vez por passo e segue a posição.
  useEffect(() => {
    let rolado = false;
    const medir = () => {
      const p = atualRef.current;
      if (!p) return;
      const el = p.alvo();
      if (el && !rolado) {
        rolado = true;
        el.scrollIntoView({ block: compacto ? 'center' : 'nearest', inline: 'nearest' });
      }
      const r = el?.getBoundingClientRect() ?? null;
      const larguraJanela = window.innerWidth;
      const alturaJanela = window.innerHeight;
      const ret = r ? { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) } : null;
      // Fora da área visível não conta como apontado.
      const dentro = ret !== null && ret.top < alturaJanela && ret.top + ret.height > 0 && ret.left < larguraJanela && ret.left + ret.width > 0;
      const nova: Medida = {
        alvo: dentro ? ret : null,
        feito: p.feito?.() ?? false,
        alturaBalao: balaoRef.current?.getBoundingClientRect().height ?? 0,
        larguraJanela,
        alturaJanela,
        abas: compacto ? (document.querySelector('.abas')?.getBoundingClientRect().height ?? 0) : 0,
      };
      setMedida((m) => (mesmaMedida(m, nova) ? m : nova));
    };
    const quadro = requestAnimationFrame(medir);
    const relogio = setInterval(medir, 250);
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    return () => {
      cancelAnimationFrame(quadro);
      clearInterval(relogio);
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
    };
  }, [indice, compacto]);

  function sair(motivo: 'interromper' | 'concluir'): void {
    encerrarTutorial();
    void gravarPreferencia(usuarioId, motivo === 'concluir' ? { state: 'CONCLUIDO', step: null } : { state: 'INTERROMPIDO', step: indice + 1 });
  }

  if (!atual) return null;

  const { alvo, feito, alturaBalao, larguraJanela, alturaJanela, abas } = medida;
  // Posição do balão: perto do elemento no computador; encostado no lado oposto no celular.
  const margem = 12;
  const largura = Math.min(380, larguraJanela - 2 * margem);
  let estilo: CSSProperties;
  if (compacto) {
    // Celular: o balão vai para o lado com mais espaço livre (acima ou abaixo do elemento) e não passa desse espaço
    // (rola por dentro), para nunca cobrir o elemento apontado.
    const topo = margem + 56;
    const espacoCima = alvo === null ? 0 : alvo.top - margem - topo;
    const espacoBaixo = alvo === null ? alturaJanela : alturaJanela - margem - abas - (alvo.top + alvo.height + margem);
    estilo =
      alvo !== null && espacoCima >= espacoBaixo
        ? { top: topo, left: margem, right: margem, maxHeight: Math.max(120, espacoCima), overflowY: 'auto' }
        : { bottom: margem + abas, left: margem, right: margem, ...(alvo === null ? {} : { maxHeight: Math.max(120, espacoBaixo), overflowY: 'auto' as const }) };
  } else if (alvo === null) {
    estilo = { bottom: margem, right: margem, width: largura };
  } else {
    const abaixo = alvo.top + alvo.height + margem;
    const acima = alvo.top - margem - alturaBalao;
    const left = Math.min(Math.max(margem, alvo.left), larguraJanela - largura - margem);
    if (abaixo + alturaBalao <= alturaJanela - margem) estilo = { top: abaixo, left, width: largura };
    else if (acima >= margem) estilo = { top: acima, left, width: largura };
    else {
      // Elemento alto: ao lado, sem cobrir.
      const direita = alvo.left + alvo.width + margem;
      const esquerda = alvo.left - margem - largura;
      const lado = direita + largura <= larguraJanela - margem ? direita : esquerda >= margem ? esquerda : larguraJanela - largura - margem;
      estilo = { top: Math.min(Math.max(margem, alvo.top), alturaJanela - alturaBalao - margem), left: lado, width: largura };
    }
  }

  const ultimo = indice === total - 1;
  const codigoExemplo = exemplo?.estado === 'pronto' ? (exemplo.dados.product?.sku ?? exemplo.dados.pallet?.code ?? null) : null;

  return (
    <>
      {alvo !== null && !recolhido && (
        <div
          className="tutorial-destaque"
          aria-hidden="true"
          data-testid="tutorial-destaque"
          style={{ top: alvo.top - 6, left: alvo.left - 6, width: alvo.width + 12, height: alvo.height + 12 }}
        />
      )}
      {recolhido ? (
        <button
          type="button"
          className="tutorial-recolhido"
          style={compacto ? { bottom: margem + abas } : undefined}
          onClick={() => {
            setRecolhidoNoPasso(null);
          }}
          data-testid="tutorial-mostrar"
        >
          Tutorial · passo {indice + 1} de {total} — mostrar
        </button>
      ) : (
        <div
          ref={balaoRef}
          className={`tutorial-balao${compacto ? ' tutorial-balao--compacto' : ''}`}
          role="dialog"
          aria-modal="false"
          aria-labelledby={`${ids}-titulo`}
          aria-describedby={`${ids}-corpo`}
          style={estilo}
          data-testid="tutorial"
          data-passo={indice + 1}
          data-apontando={alvo !== null ? 'sim' : 'nao'}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              sair('interromper');
            }
          }}
        >
          <div className="tutorial-topo">
            <p className="tutorial-progresso" data-testid="tutorial-progresso">
              Passo {indice + 1} de {total}
            </p>
            <div className="tutorial-barra" aria-hidden="true">
              <span style={{ width: `${String(((indice + 1) / total) * 100)}%` }} />
            </div>
            <button
              type="button"
              className="botao-link tutorial-recolher"
              onClick={() => {
                setRecolhidoNoPasso(indice);
              }}
              aria-label="Recolher o tutorial"
            >
              Recolher
            </button>
          </div>
          <h2 id={`${ids}-titulo`} ref={tituloRef} tabIndex={-1} className="tutorial-titulo">
            {atual.titulo}
          </h2>
          <div id={`${ids}-corpo`} className="tutorial-corpo">
            <p>
              <strong>O que fazer:</strong> {atual.fazer}
            </p>
            {codigoExemplo !== null && indice === 1 && atual.indisponivel !== true && (
              <p className="tutorial-exemplo" data-testid="tutorial-exemplo">
                Exemplo {demo ? 'fictício ' : ''}deste escopo: <code>{codigoExemplo}</code>
              </p>
            )}
            <p>
              <strong>Onde:</strong> {atual.onde}
            </p>
            <p>
              <strong>O que deve aparecer:</strong> {atual.aparece}
            </p>
            {atual.indisponivel !== true && alvo === null && atual.semAlvo !== '' && (
              <p className="tutorial-aviso" role="status" data-testid="tutorial-sem-alvo">
                {atual.semAlvo}
              </p>
            )}
            {!naPraca && (
              <p className="tutorial-aviso">
                O tutorial acontece no mapa da praça.{' '}
                <button
                  type="button"
                  className="botao-link"
                  onClick={() => {
                    navegar({ tipo: 'praca' });
                  }}
                >
                  Voltar ao mapa
                </button>
              </p>
            )}
            {exemplo?.estado === 'erro' && indice >= 1 && (
              <p className="tutorial-aviso" role="alert">
                Não foi possível consultar um exemplo agora ({exemplo.mensagem}). Continue com um código que você conheça ou{' '}
                <button type="button" className="botao-link" onClick={recarregar}>
                  tente de novo
                </button>
                .
              </p>
            )}
            {atual.feito !== undefined && (
              <p className={feito ? 'tutorial-estado tutorial-estado--feito' : 'tutorial-estado'} data-testid="tutorial-estado" data-feito={feito ? 'sim' : 'nao'}>
                {feito ? '✓ Pronto. Toque em "Próximo".' : '… Aguardando você fazer este passo.'}
              </p>
            )}
            {ultimo && (
              <p className="tutorial-guias">
                <button
                  type="button"
                  className="botao-link"
                  onClick={() => {
                    sair('concluir');
                    navegar({ tipo: 'ajuda', guia: null });
                  }}
                  data-testid="tutorial-abrir-ajuda"
                >
                  Concluir e abrir a Ajuda
                </button>
              </p>
            )}
          </div>
          <div className="tutorial-acoes">
            <button
              type="button"
              className="botao-secundario botao-compacto"
              disabled={indice === 0}
              onClick={() => {
                irParaPasso(indice);
              }}
              data-testid="tutorial-anterior"
            >
              Anterior
            </button>
            {ultimo ? (
              <button
                type="button"
                className="botao-primario botao-compacto"
                onClick={() => {
                  sair('concluir');
                }}
                data-testid="tutorial-concluir"
              >
                Concluir
              </button>
            ) : (
              <button
                type="button"
                className={feito || atual.feito === undefined ? 'botao-primario botao-compacto' : 'botao-secundario botao-compacto'}
                onClick={() => {
                  irParaPasso(indice + 2);
                }}
                data-testid="tutorial-proximo"
              >
                Próximo
              </button>
            )}
            <button
              type="button"
              className="botao-link"
              onClick={() => {
                sair('interromper');
              }}
              data-testid="tutorial-sair"
            >
              Sair do tutorial
            </button>
          </div>
          <p className="visualmente-oculto" aria-live="polite">
            Tutorial, passo {indice + 1} de {total}: {atual.titulo}.
          </p>
        </div>
      )}
    </>
  );
}

