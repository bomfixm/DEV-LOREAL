import type React from 'react';
import type { PaleteEmbarque, VeiculoCarga } from '@praca-reversa/contracts';

/** Selo curto da documentação (sempre com texto, não só cor). */
export function textoDocs(p: PaleteEmbarque): string {
  switch (p.docs.state) {
    case 'AGUARDANDO_FISICO':
      return 'Aguarda físico';
    case 'PENDENTE':
      return `Docs ${String(p.docs.checked)}/${String(p.docs.total)}`;
    case 'COM_PROBLEMA':
      return `Docs: ${String(p.docs.missing + p.docs.divergent)} problema(s)`;
    case 'CONFERIDA':
      return 'Docs conferidos';
  }
}

/**
 * Vista de cima do veículo: frente (cabine) no alto, porta embaixo. Posições
 * numeradas da frente para a porta, da esquerda para a direita. Tracejado =
 * posição planejada; contorno cheio = confirmada no carregamento.
 */
export function MapaVeiculo({
  veiculo,
  selecionado,
  posicaoEscolhida,
  movendo,
  aoEscolherPosicao,
  aoEscolherPalete,
  impressao = false,
}: {
  veiculo: VeiculoCarga;
  selecionado: string | null;
  posicaoEscolhida: number | null;
  movendo: PaleteEmbarque | null;
  aoEscolherPosicao: (posicao: number) => void;
  aoEscolherPalete: (palete: PaleteEmbarque) => void;
  /** Mapa para impressão: só posições, sem botões. `soConfirmadas` para o mapa final. */
  impressao?: false | { soConfirmadas: boolean };
}) {
  const ativos = veiculo.pallets.filter((p) => p.state === 'ATIVO');
  const porPosicao = new Map(ativos.flatMap((p) => (p.position === null ? [] : [[p.position, p] as const])));
  const celulas: (number | null)[] = [];
  for (let i = 1; i <= veiculo.rows * veiculo.cols; i++) celulas.push(i <= veiculo.capacity ? i : null);
  return (
    <div className={`mapa-veiculo${impressao ? ' mapa-veiculo--impressao' : ''}`} data-testid="mapa-veiculo">
      <div className="mapa-veiculo-ponta mapa-veiculo-frente" aria-hidden="true">
        <span className="seta-vertical">▲</span>
        <span className="seta-horizontal">◀</span> FRENTE (cabine)
      </div>
      <div
        className="mapa-veiculo-grade"
        style={{ '--colunas': String(veiculo.cols), '--fileiras': String(veiculo.rows) } as React.CSSProperties}
        role="grid"
        aria-label={`${veiculo.label}: vista de cima, frente no alto e porta embaixo`}
      >
        {celulas.map((pos, i) => {
          if (pos === null) return <div key={`x${String(i)}`} className="mapa-celula mapa-celula--fora" aria-hidden="true" />;
          const p = porPosicao.get(pos);
          const mostrar = p !== undefined && (!impressao || !impressao.soConfirmadas || p.positionConfirmed) ? p : undefined;
          if (impressao) {
            return (
              <div key={pos} className={`mapa-celula ${mostrar ? 'mapa-celula--ocupada' : 'mapa-celula--livre'}${mostrar && !mostrar.positionConfirmed ? ' mapa-celula--planejada' : ''}`}>
                <span className="mapa-celula-pos">{String(pos).padStart(2, '0')}</span>
                {mostrar && (
                  <>
                    <strong className="mapa-celula-num">{mostrar.label}</strong>
                    <span className="mapa-celula-info">
                      {mostrar.kind === 'FULL' ? 'FULL' : 'FRAC.'} · {mostrar.volumes} vol
                    </span>
                  </>
                )}
              </div>
            );
          }
          if (!mostrar) {
            const alvo = movendo !== null;
            return (
              <button
                key={pos}
                type="button"
                className={`mapa-celula mapa-celula--livre${posicaoEscolhida === pos ? ' mapa-celula--escolhida' : ''}${alvo ? ' mapa-celula--alvo' : ''}`}
                onClick={() => {
                  aoEscolherPosicao(pos);
                }}
                aria-label={alvo ? `Mover ${movendo.label} para a posição ${String(pos)}` : `Posição ${String(pos)} livre`}
                data-testid={`posicao-${String(pos)}`}
              >
                <span className="mapa-celula-pos">{String(pos).padStart(2, '0')}</span>
                <span className="mapa-celula-livre-texto">{alvo ? 'Mover aqui' : 'Livre'}</span>
              </button>
            );
          }
          const problema = mostrar.docs.state === 'COM_PROBLEMA';
          return (
            <button
              key={pos}
              type="button"
              className={`mapa-celula mapa-celula--ocupada${mostrar.positionConfirmed ? ' mapa-celula--confirmada' : ' mapa-celula--planejada'}${selecionado === mostrar.id ? ' mapa-celula--selecionada' : ''}${problema ? ' mapa-celula--problema' : ''}`}
              onClick={() => {
                aoEscolherPalete(mostrar);
              }}
              aria-label={`${mostrar.label} na posição ${String(pos)}: ${mostrar.positionConfirmed ? 'confirmada' : 'planejada'}, ${String(mostrar.volumes)} volumes`}
              data-testid={`palete-${mostrar.label}`}
            >
              <span className="mapa-celula-pos">{String(pos).padStart(2, '0')}</span>
              <strong className="mapa-celula-num">{mostrar.label}</strong>
              <span className="mapa-celula-info">
                {mostrar.kind === 'FULL' ? 'FULL' : 'Frac.'} · {mostrar.volumes} vol
              </span>
              <span className="mapa-celula-marcas">
                <span className={mostrar.physical.checked ? 'marca-ok' : 'marca-pendente'}>{mostrar.physical.checked ? '✓ Físico' : '○ Físico'}</span>
                <span className={mostrar.docs.state === 'CONFERIDA' ? 'marca-ok' : problema ? 'marca-erro' : 'marca-pendente'}>{textoDocs(mostrar)}</span>
              </span>
              <span className="mapa-celula-situacao">{mostrar.positionConfirmed ? '■ Confirmada' : '┄ Planejada'}</span>
              {/* Versão curta (veículo deitado no computador): volumes e marcas F (físico) e D (documentos). */}
              <span className="mapa-celula-curto" aria-hidden="true">
                <span>{mostrar.volumes} vol</span>
                <span>
                  <span className={mostrar.physical.checked ? 'marca-ok' : 'marca-pendente'}>F{mostrar.physical.checked ? '✓' : '○'}</span>{' '}
                  <span className={mostrar.docs.state === 'CONFERIDA' ? 'marca-ok' : problema ? 'marca-erro' : 'marca-pendente'}>D{mostrar.docs.state === 'CONFERIDA' ? '✓' : problema ? '!' : '○'}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mapa-veiculo-ponta mapa-veiculo-porta" aria-hidden="true">
        PORTA <span className="seta-vertical">▼</span>
        <span className="seta-horizontal">▶</span>
      </div>
    </div>
  );
}
