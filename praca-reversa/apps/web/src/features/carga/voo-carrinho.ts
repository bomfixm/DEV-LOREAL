import './voo-carrinho.css';

/**
 * "Pôr no carrinho" (fly-to-cart): uma cópia pequena da nota (ou do palete)
 * sai do ponto clicado, faz um arco, encolhe e entra no atalho "Expedição" do
 * mapa, que dá um pulso curto. Só enfeite, chamado depois que o servidor
 * confirmou a inclusão: roda fora do React (cópia `position: fixed` no body, em
 * coordenadas da tela, sem receber cliques) e não muda dados nem o contador.
 *
 * - Origem medida pelo chamador antes de a lista mudar (um `DOMRect`).
 * - Destino: o atalho flutuante; na primeira inclusão ele acaba de aparecer,
 *   então espera alguns quadros até estar na tela. Sem o atalho visível (outra
 *   tela, janela cobrindo no celular), usa o ícone da Expedição no menu; sem
 *   nenhum dos dois, não voa.
 * - Um voo por vez: um novo cancela o anterior (nada se empilha nem fica preso).
 * - "Reduzir movimento": sem voo e sem pulso (o contador e o aviso continuam).
 */

const DURACAO = 450;
const QUADROS_ESPERA = 12;

let vooAtual: (() => void) | null = null;

/** O elemento está na tela e não está coberto (o fundo escurecido da janela conta como visível). */
function visivel(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.right <= 0 || r.top >= window.innerHeight || r.left >= window.innerWidth) return false;
  const topo = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (topo === null) return false;
  return el.contains(topo) || topo.classList.contains('janela-fundo');
}

function acharAlvo(): HTMLElement | null {
  const atalho = document.querySelector<HTMLElement>('[data-atalho-expedicao]');
  if (atalho !== null && visivel(atalho)) return atalho;
  return [...document.querySelectorAll<HTMLElement>('a[data-destino="carga"]')].find(visivel) ?? null;
}

function pulsar(alvo: HTMLElement): void {
  // Tira e põe no quadro seguinte: reinicia o pulso se vier outra inclusão logo em seguida.
  alvo.classList.remove('voo-recebeu');
  window.requestAnimationFrame(() => {
    alvo.classList.add('voo-recebeu');
    window.setTimeout(() => alvo.classList.remove('voo-recebeu'), 400);
  });
}

const ICONE_NOTA =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>';
const ICONE_PALETE =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="11" rx="1"/><path d="M3 19h18M6 15v4M12 15v4M18 15v4"/></svg>';

/**
 * Faz o voo de `origem` até a Expedição. `tipo` escolhe o ícone da cópia
 * (documento para nota, palete para o palete inteiro).
 */
export function voarParaExpedicao(origem: DOMRect | null, rotulo: string, tipo: 'nota' | 'palete'): void {
  vooAtual?.();
  vooAtual = null;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let cancelado = false;
  let tentativas = 0;
  vooAtual = () => {
    cancelado = true;
  };
  const tentar = () => {
    if (cancelado) return;
    const alvo = acharAlvo();
    if (alvo === null && tentativas++ < QUADROS_ESPERA) {
      window.requestAnimationFrame(tentar);
      return;
    }
    if (alvo === null) {
      vooAtual = null;
      return;
    }
    if (origem === null || origem.width <= 0 || typeof document.body.animate !== 'function') {
      vooAtual = null;
      pulsar(alvo);
      return;
    }
    iniciar(origem, alvo, rotulo, tipo);
  };
  window.requestAnimationFrame(tentar);
}

function iniciar(de: DOMRect, alvo: HTMLElement, rotulo: string, tipo: 'nota' | 'palete'): void {
  const copia = document.createElement('div');
  copia.className = `voo-copia voo-copia--${tipo}`;
  copia.setAttribute('aria-hidden', 'true');
  const icone = document.createElement('span');
  icone.className = 'voo-copia-icone';
  icone.innerHTML = tipo === 'nota' ? ICONE_NOTA : ICONE_PALETE;
  const texto = document.createElement('span');
  texto.textContent = rotulo;
  copia.append(icone, texto);
  document.body.append(copia);

  const largura = copia.offsetWidth;
  const altura = copia.offsetHeight;
  const x0 = de.left + de.width / 2 - largura / 2;
  const y0 = de.top + de.height / 2 - altura / 2;
  copia.style.left = `${String(x0)}px`;
  copia.style.top = `${String(y0)}px`;
  const para = alvo.getBoundingClientRect();
  const dx = para.left + para.width / 2 - (x0 + largura / 2);
  const dy = para.top + para.height / 2 - (y0 + altura / 2);
  // Arco suave: curva de Bézier quadrática com o ponto de controle acima do caminho.
  const cx = dx * 0.5;
  const cy = Math.min(0, dy) - Math.min(140, 60 + Math.abs(dx) * 0.15);
  const passos = 8;
  const quadros: Keyframe[] = [];
  for (let i = 0; i <= passos; i++) {
    const t = i / passos;
    const u = 1 - t;
    const x = 2 * u * t * cx + t * t * dx;
    const y = 2 * u * t * cy + t * t * dy;
    const escala = 1 - 0.78 * t * t;
    quadros.push({ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${escala.toFixed(3)})`, opacity: t < 0.85 ? 1 : 1 - (t - 0.85) * 4, offset: t });
  }
  const animacao = copia.animate(quadros, { duration: DURACAO, easing: 'cubic-bezier(.45,0,.4,1)', fill: 'forwards' });

  let terminou = false;
  let seguranca = 0;
  let cancelar: (() => void) | null = null;
  const limpar = (comPulso: boolean) => {
    if (terminou) return;
    terminou = true;
    window.clearTimeout(seguranca);
    copia.remove();
    if (vooAtual === cancelar) vooAtual = null;
    if (comPulso && alvo.isConnected) pulsar(alvo);
  };
  cancelar = () => {
    animacao.cancel();
    limpar(false);
  };
  // Aba em segundo plano pode atrasar o "finish": a cópia nunca fica presa na tela.
  seguranca = window.setTimeout(() => {
    limpar(true);
  }, DURACAO * 4 + 600);
  vooAtual = cancelar;
  animacao.addEventListener('finish', () => {
    limpar(true);
  });
  animacao.addEventListener('cancel', () => {
    limpar(false);
  });
}
