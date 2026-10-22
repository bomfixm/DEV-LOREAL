import { Composition } from "remotion";
import { CenaDesafio } from "./cenas/CenaDesafio";

/** Composições do vídeo do Praça Reversa (1920×1080, 30 fps). */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="CenaDesafio" component={CenaDesafio} durationInFrames={300} fps={30} width={1920} height={1080} />
    </>
  );
};
