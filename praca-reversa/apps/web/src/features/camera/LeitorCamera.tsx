import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  ROTULOS_FORMATO,
  TEXTO_FALHA_CAMERA,
  classificarErroCamera,
  criarDecodificador,
  verificarSuporte,
  type Decodificador,
  type Deteccao,
  type FalhaCamera,
} from './deteccao';

type Estado =
  | { tipo: 'abrindo' }
  | { tipo: 'lendo'; origem: Decodificador['origem'] }
  | { tipo: 'lido'; leitura: Deteccao; origem: Decodificador['origem'] }
  | { tipo: 'pausada' }
  | { tipo: 'falha'; falha: FalhaCamera };

export interface AcoesLeitura {
  /** Descarta o resultado e volta a ler (ação consciente: o mesmo código pode ser lido de novo). */
  lerProximo: () => void;
  /** Fecha e libera a câmera. */
  fechar: () => void;
}

interface Props {
  titulo: string;
  formatos: readonly string[];
  /** Interpretação da leitura e ações do contexto (usar o código, abrir o palete…). */
  renderizarResultado: (leitura: Deteccao, acoes: AcoesLeitura) => ReactNode;
  aoFechar: () => void;
}

/** Intervalo entre tentativas de decodificação (a leitura pausa no primeiro resultado). */
const INTERVALO_MS = 120;
/** Lado maior do quadro analisado (reduz custo no aparelho). */
const LADO_MAXIMO = 960;

function liberar(stream: MediaStream | null, video: HTMLVideoElement | null): void {
  for (const trilha of stream?.getTracks() ?? []) trilha.stop();
  if (video) {
    video.pause();
    video.srcObject = null;
  }
}

/**
 * Leitor por câmera (etapa 09). Aberto só depois da ação "Ler código";
 * pede somente vídeo, preferindo a câmera traseira. Uma leitura mostra um
 * resultado e pausa a decodificação até "Ler próximo", confirmação ou
 * fechamento — quadros repetidos do mesmo código não geram várias contagens.
 * Ao fechar, sair da tela ou esconder a aba: vídeo e decodificação param, as
 * trilhas são liberadas e respostas atrasadas (inclusive uma permissão
 * concedida depois do cancelamento) são descartadas.
 */
export function LeitorCamera({ titulo, formatos, renderizarResultado, aoFechar }: Props) {
  const ids = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const decodificadorRef = useRef<Decodificador | null>(null);
  const [estado, setEstado] = useState<Estado>(() => {
    const falha = verificarSuporte();
    return falha === null ? { tipo: 'abrindo' } : { tipo: 'falha', falha };
  });
  const [abertura, setAbertura] = useState(0);
  const formatosChave = formatos.join(',');

  // Abertura da câmera (de novo a cada "Retomar"/"Tentar de novo").
  useEffect(() => {
    if (verificarSuporte() !== null) return;
    const controle = { cancelado: false };
    // Consulta por função: o valor muda na limpeza, depois de cada await.
    const cancelado = () => controle.cancelado;
    const video = videoRef.current;
    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (erro) {
        if (!cancelado()) setEstado({ tipo: 'falha', falha: classificarErroCamera(erro) });
        return;
      }
      // Permissão resolvida depois do cancelamento: libera na hora.
      if (cancelado() || video === null) {
        liberar(stream, null);
        return;
      }
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      try {
        decodificadorRef.current ??= await criarDecodificador(formatosChave.split(','));
      } catch {
        if (!cancelado()) {
          liberar(streamRef.current, video);
          streamRef.current = null;
          setEstado({ tipo: 'falha', falha: 'decodificador' });
        }
        return;
      }
      if (!cancelado()) setEstado({ tipo: 'lendo', origem: decodificadorRef.current.origem });
    })();
    return () => {
      controle.cancelado = true;
      liberar(streamRef.current, video);
      streamRef.current = null;
    };
  }, [abertura, formatosChave]);

  // Decodificação: só enquanto "lendo"; o primeiro resultado pausa.
  const origemLeitura = estado.tipo === 'lendo' ? estado.origem : null;
  useEffect(() => {
    if (origemLeitura === null) return;
    const ciclo = { ativo: true, espera: undefined as ReturnType<typeof setTimeout> | undefined };
    const tentar = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const decodificador = decodificadorRef.current;
      if (video && canvas && decodificador && video.readyState >= 2 && video.videoWidth > 0) {
        const escala = Math.min(1, LADO_MAXIMO / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * escala);
        canvas.height = Math.round(video.videoHeight * escala);
        canvas.getContext('2d', { willReadFrequently: true })?.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          const achados = await decodificador.detectar(canvas);
          // Fechado, pausado ou trocado durante a decodificação: resultado descartado.
          if (!ciclo.ativo) return;
          const primeiro = achados.find((a) => a.valor.length > 0);
          if (primeiro) {
            setEstado({ tipo: 'lido', leitura: primeiro, origem: origemLeitura });
            return;
          }
        } catch {
          if (!ciclo.ativo) return;
          setEstado({ tipo: 'falha', falha: 'decodificador' });
          return;
        }
      }
      if (ciclo.ativo) ciclo.espera = setTimeout(() => void tentar(), INTERVALO_MS);
    };
    void tentar();
    return () => {
      ciclo.ativo = false;
      if (ciclo.espera !== undefined) clearTimeout(ciclo.espera);
    };
  }, [origemLeitura]);

  // Falha do decodificador: a câmera não fica ligada à toa.
  const falhou = estado.tipo === 'falha';
  useEffect(() => {
    if (!falhou) return;
    liberar(streamRef.current, videoRef.current);
    streamRef.current = null;
  }, [falhou]);

  // Aba escondida: libera a câmera; volta só por ação da pessoa.
  useEffect(() => {
    const aoMudar = () => {
      if (document.visibilityState === 'hidden' && streamRef.current !== null) {
        liberar(streamRef.current, videoRef.current);
        streamRef.current = null;
        setEstado({ tipo: 'pausada' });
      }
    };
    document.addEventListener('visibilitychange', aoMudar);
    return () => {
      document.removeEventListener('visibilitychange', aoMudar);
    };
  }, []);

  useEffect(() => {
    tituloRef.current?.focus();
  }, []);

  function reabrir() {
    setEstado({ tipo: 'abrindo' });
    setAbertura((a) => a + 1);
  }
  // Fechar: o componente sai da tela e a limpeza da abertura libera câmera e decodificação.
  const fechar = aoFechar;
  const lerProximo = () => {
    if (estado.tipo === 'lido') setEstado({ tipo: 'lendo', origem: estado.origem });
    else reabrir();
  };

  return (
    <div className="leitor-fundo">
      <div
        className="leitor-camera"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${ids}-titulo`}
        data-testid="leitor-camera"
        data-estado={estado.tipo}
        onKeyDown={(e) => {
          if (e.key === 'Escape') fechar();
        }}
      >
        <header className="leitor-topo">
          <h3 id={`${ids}-titulo`} ref={tituloRef} tabIndex={-1}>
            {titulo}
          </h3>
          <button type="button" className="botao-secundario botao-compacto" onClick={fechar} data-testid="fechar-camera">
            Fechar
          </button>
        </header>

        <div className={`leitor-video${estado.tipo === 'falha' || estado.tipo === 'pausada' ? ' leitor-video--oculto' : ''}`}>
          <video ref={videoRef} muted playsInline aria-label="Imagem da câmera" />
          {estado.tipo === 'lendo' && <span className="leitor-mira" aria-hidden="true" />}
        </div>
        <canvas ref={canvasRef} hidden />

        <div className="leitor-situacao" role="status" aria-live="polite">
          {estado.tipo === 'abrindo' && <p>Abrindo a câmera… Se o navegador perguntar, permita o uso da câmera (somente vídeo).</p>}
          {estado.tipo === 'lendo' && (
            <p>
              Aponte para o código. A leitura para no primeiro resultado
              {estado.origem === 'nativo' ? ' (leitor do navegador).' : ' (decodificador local; nenhuma imagem sai do aparelho).'}
            </p>
          )}
          {estado.tipo === 'pausada' && (
            <div className="acoes-linha">
              <p>Câmera liberada porque a tela saiu de foco.</p>
              <button type="button" className="botao-primario botao-compacto" onClick={reabrir}>
                Retomar câmera
              </button>
            </div>
          )}
          {estado.tipo === 'falha' && (
            <p className="estado-erro" role="alert" data-testid="falha-camera" data-falha={estado.falha}>
              {TEXTO_FALHA_CAMERA[estado.falha]}
            </p>
          )}
        </div>

        {estado.tipo === 'lido' && (
          <div className="leitor-resultado" data-testid="resultado-camera">
            <p>
              Lido: <code data-testid="valor-lido">{estado.leitura.valor}</code> ({ROTULOS_FORMATO[estado.leitura.formato] ?? estado.leitura.formato})
            </p>
            {renderizarResultado(estado.leitura, { lerProximo, fechar })}
            <div className="acoes-linha">
              <button type="button" className="botao-secundario" onClick={lerProximo} data-testid="ler-proximo">
                Ler próximo
              </button>
            </div>
          </div>
        )}
        {estado.tipo === 'falha' && (
          <div className="acoes-linha">
            <button type="button" className="botao-secundario" onClick={fechar}>
              Fechar e digitar o código
            </button>
            {(estado.falha === 'camera-ocupada' || estado.falha === 'outra') && (
              <button type="button" className="botao-link" onClick={reabrir}>
                Tentar de novo
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
