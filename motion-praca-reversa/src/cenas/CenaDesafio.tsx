import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";

const AMARELO = "#FFCC00";
const VERMELHO = "#D40511";
const GRAFITE = "#1E2328";

/** Entrada suave (frames → 0..1), determinística pelo frame do Remotion. */
function entrada(frame: number, inicio: number, duracao = 18): number {
  return interpolate(frame, [inicio, inicio + duracao], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
}

function Elemento({ x, rotulo, inicio }: { x: number; rotulo: string; inicio: number }) {
  const frame = useCurrentFrame();
  const t = entrada(frame, inicio);
  return (
    <div style={{ position: "absolute", left: x, top: 470, width: 260, height: 150, opacity: t, transform: `translateY(${(1 - t) * 30}px)`, border: `4px solid ${GRAFITE}`, borderRadius: 18, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, fontWeight: 700, color: GRAFITE }}>
      {rotulo}
    </div>
  );
}

/** Cena 1 — "Localizar. Organizar. Dar visibilidade." (00:00–00:10). */
export const CenaDesafio: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const linha = entrada(frame, 2.2 * fps, 30);
  const titulo = entrada(frame, 4.5 * fps, 20);
  return (
    <AbsoluteFill style={{ background: "#F4F7F5", fontFamily: "Inter, 'Segoe UI', Arial, sans-serif" }}>
      <Elemento x={300} rotulo="Documento" inicio={0} />
      <Elemento x={830} rotulo="Palete" inicio={8} />
      <Elemento x={1360} rotulo="Volumes" inicio={16} />
      <div style={{ position: "absolute", left: 560, top: 541, height: 8, width: 1060 * linha - 260 * linha, background: AMARELO, borderRadius: 4 }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 170, textAlign: "center", opacity: titulo, transform: `translateY(${(1 - titulo) * 24}px)` }}>
        <div style={{ fontSize: 76, fontWeight: 800, color: GRAFITE, letterSpacing: -1 }}>Localizar. Organizar. Dar visibilidade.</div>
        <div style={{ marginTop: 18, fontSize: 34, color: "#4A5058" }}>Logística reversa • Operação L’Oréal</div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 120, textAlign: "center", opacity: entrada(frame, 6.5 * fps), fontSize: 64, fontWeight: 800, color: GRAFITE }}>
        Praça <span style={{ color: VERMELHO }}>Reversa</span>
      </div>
    </AbsoluteFill>
  );
};
