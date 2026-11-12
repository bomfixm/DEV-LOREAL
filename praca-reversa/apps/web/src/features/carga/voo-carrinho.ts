import './voo-carrinho.css';

/**
 * Animação "pôr no carrinho": um cartão pequeno do palete sai do botão clicado,
 * faz um arco, encolhe e entra no ícone da Expedição no menu lateral, que dá um
 * pulinho. Só enfeite: roda fora do React (elemento fixo no body, removido no
 * fim) e não muda nada nos dados. Com "reduzir movimento" no sistema, só o pulo.
 * Sem o ícone visível (menu do celular fechado, por exemplo), o cartão só encolhe no lugar.
 */
export function voarParaExpedicao(origem: HTMLElement, rotulo: string): void {
  const alvo = [...document.querySelectorAll<HTMLElement>('a[data-destino="carga"]')].find((a) => a.getClientRects().length > 0 && a.getBoundingClientRect().width > 0) ?? null;
  const pular = () => {
    if (alvo === null) return;
    // Tira e põe no quadro seguinte: reinicia o pulo se vier outro palete logo em seguida.
    alvo.classList.remove('voo-recebeu');
    window.requestAnimationFrame(() => {
      alvo.classList.add('voo-recebeu');
      window.setTimeout(() => alvo.classList.remove('voo-recebeu'), 700);
    });
  };
  const reduzir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduzir || typeof document.body.animate !== 'function') {
    pular();
    return;
  }

  const de = origem.getBoundingClientRect();
  const cartao = document.createElement('div');
  cartao.className = 'voo-palete';
  cartao.setAttribute('aria-hidden', 'true');
  cartao.textContent = rotulo;
  document.body.append(cartao);
  const largura = cartao.offsetWidth;
  const altura = cartao.offsetHeight;
  const x0 = de.left + de.width / 2 - largura / 2;
  const y0 = de.top + de.height / 2 - altura / 2;
  cartao.style.left = `${String(x0)}px`;
  cartao.style.top = `${String(y0)}px`;

  let dx = 0;
  let dy = -40;
  if (alvo !== null) {
    const para = alvo.getBoundingClientRect();
    dx = para.left + para.width / 2 - (x0 + largura / 2);
    dy = para.top + para.height / 2 - (y0 + altura / 2);
  }
  // Arco: sobe um pouco antes de cair no destino (como o produto indo para a sacola).
  const subida = Math.min(-60, dy / 2 - 80);
  const animacao = cartao.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
      { transform: 'translate(0, -6px) scale(1.12)', opacity: 1, offset: 0.12 },
      { transform: `translate(${String(dx * 0.45)}px, ${String(subida)}px) scale(0.7)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${String(dx)}px, ${String(dy)}px) scale(0.12)`, opacity: alvo === null ? 0 : 0.35, offset: 1 },
    ],
    { duration: 850, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'forwards' },
  );
  const fim = () => {
    cartao.remove();
    pular();
  };
  animacao.addEventListener('finish', fim);
  animacao.addEventListener('cancel', () => {
    cartao.remove();
  });
}
