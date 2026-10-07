import { API_PREFIXO, LoteEtiquetasSchema, type Etiqueta, type LoteEtiquetas } from '@praca-reversa/contracts';
import { useId, useMemo, useState } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { IconeImprimir } from '../../components/Icones';
import { EstadoTela } from '../../components/Moldura';
import { formatarData } from '../../utils/datas';
import { caminhoSvgQr, gerarMatrizQr, ladoComMargem } from './qr';

type Formato = 'A4_1' | 'A4_2';

const FORMATOS: Record<Formato, { rotulo: string; porFolha: number }> = {
  A4_1: { rotulo: 'A4 — 1 etiqueta por folha', porFolha: 1 },
  A4_2: { rotulo: 'A4 — 2 etiquetas por folha', porFolha: 2 },
};

const ROTULO_AMBIENTE: Record<LoteEtiquetas['environment'], string> = {
  desenvolvimento: 'desenvolvimento',
  teste: 'teste',
  producao: 'produção',
};

/** QR desenhado em SVG a partir da matriz da biblioteca, com zona de silêncio. */
function CodigoQr({ url, rotulo }: { url: string; rotulo: string }) {
  const matriz = useMemo(() => gerarMatrizQr(url), [url]);
  const lado = ladoComMargem(matriz);
  return (
    <svg
      className="etiqueta-qr"
      viewBox={`0 0 ${String(lado)} ${String(lado)}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={rotulo}
      data-testid="etiqueta-qr"
      data-url={url}
    >
      <rect width={lado} height={lado} fill="#fff" />
      <path d={caminhoSvgQr(matriz)} fill="#000" />
    </svg>
  );
}

/** Tamanho do código conforme o comprimento, para nunca ser cortado. */
function classeCodigo(codigo: string): string {
  if (codigo.length <= 10) return 'etiqueta-codigo etiqueta-codigo--curto';
  if (codigo.length <= 14) return 'etiqueta-codigo';
  if (codigo.length <= 22) return 'etiqueta-codigo etiqueta-codigo--longo';
  return 'etiqueta-codigo etiqueta-codigo--muito-longo';
}

function UmaEtiqueta({ etiqueta, lote }: { etiqueta: Etiqueta; lote: LoteEtiquetas }) {
  const data = formatarData(lote.generatedAt);
  return (
    <article className="etiqueta" data-testid="etiqueta" data-palete-id={etiqueta.palletId}>
      <p className="etiqueta-topo">
        <span>Praça Reversa · etiqueta interna</span>
        <span>{lote.scope.name}</span>
      </p>
      {lote.scope.demo && <p className="etiqueta-demo">DEMONSTRAÇÃO — DADOS FICTÍCIOS</p>}
      <p className={classeCodigo(etiqueta.code)} data-testid="etiqueta-codigo">
        {etiqueta.code}
      </p>
      <div className="etiqueta-qr-area">
        <CodigoQr url={etiqueta.url} rotulo={`QR do palete ${etiqueta.code}`} />
      </div>
      <p className="etiqueta-instrucao">Leia com a câmera do celular para abrir o palete (exige login).</p>
      <p className="etiqueta-posicao" data-testid="etiqueta-posicao">
        {etiqueta.positionCode === null
          ? `Sem posição registrada em ${data}.`
          : `Posição na data da impressão (${data}): ${etiqueta.positionCode}${etiqueta.positionProvisional ? ' — código provisório' : ''}. A posição pode mudar; o QR identifica o palete.`}
      </p>
      <p className="etiqueta-rodape">
        Ambiente: {ROTULO_AMBIENTE[lote.environment]} · {lote.baseUrl}
        <br />
        Não é SSCC nem substitui a identificação oficial da operação.
      </p>
    </article>
  );
}

/**
 * Prévia e impressão de etiquetas internas em folha A4. O QR contém só o
 * link do palete (ID permanente); os dados atuais são consultados ao abrir.
 */
export function TelaEtiquetas({ ids, aoVoltar }: { ids: readonly string[]; aoVoltar: () => void }) {
  const idFormato = useId();
  const [formato, setFormato] = useState<Formato>('A4_1');
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/etiquetas?ids=${ids.join(',')}`, LoteEtiquetasSchema);

  if (carga?.estado !== 'pronto') {
    return <EstadoTela carga={carga} titulo="Não foi possível preparar as etiquetas" aoTentarNovamente={recarregar} />;
  }
  const lote = carga.dados;
  const porFolha = FORMATOS[formato].porFolha;
  const folhas: Etiqueta[][] = [];
  for (let i = 0; i < lote.labels.length; i += porFolha) folhas.push(lote.labels.slice(i, i + porFolha));

  return (
    <main className="principal principal--pagina tela-etiquetas" data-testid="tela-etiquetas">
      <div className="pagina-conteudo">
        <header className="pagina-topo nao-imprimir">
          <h2>Etiquetas internas ({lote.labels.length})</h2>
          <div className="pagina-descricao">
            <p>
              Prévia em folha A4 (margem de 10 mm). Dimensões para uma impressora específica dependem da impressora da operação, ainda não
              informada.
            </p>
            {lote.localAddress && (
              <div className="estado-erro" role="alert" data-testid="aviso-endereco-local">
                <p>
                  <strong>Endereço local:</strong> o QR aponta para {lote.baseUrl}, que só funciona neste computador. Um celular não abrirá
                  este link. Para etiquetas definitivas, configure APP_URL_PUBLICA com um endereço estável e acessível na rede dos aparelhos.
                </p>
              </div>
            )}
            {lote.environment !== 'producao' && !lote.localAddress && (
              <p className="mensagem-conflito">
                Ambiente de {ROTULO_AMBIENTE[lote.environment]}: use estas etiquetas só para teste. Etiquetas definitivas dependem do endereço
                do piloto.
              </p>
            )}
          </div>
          <div className="acoes-linha">
            <label className="campo campo--compacto" htmlFor={idFormato}>
              <span className="campo-rotulo">Formato</span>
              <select
                id={idFormato}
                value={formato}
                onChange={(e) => {
                  setFormato(e.target.value as Formato);
                }}
              >
                {Object.entries(FORMATOS).map(([valor, f]) => (
                  <option key={valor} value={valor}>
                    {f.rotulo}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="botao-primario"
              onClick={() => {
                window.print();
              }}
            >
              <IconeImprimir />
              Imprimir
            </button>
            <button type="button" className="botao-secundario" onClick={aoVoltar}>
              Voltar ao mapa
            </button>
          </div>
        </header>
        <div className={`folhas folhas--${formato}`} data-testid="folhas">
          {folhas.map((folha, indice) => (
            <section key={indice} className="folha-a4" aria-label={`Folha ${String(indice + 1)} de ${String(folhas.length)}`} data-testid="folha">
              {folha.map((etiqueta) => (
                <UmaEtiqueta key={etiqueta.palletId} etiqueta={etiqueta} lote={lote} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
