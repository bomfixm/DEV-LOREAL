import type { CargaJanela, PaleteEmbarque, VeiculoCarga } from '@praca-reversa/contracts';
import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { documentoDoEmbarque } from './conteudo-espelho';
import { FolhaEspelho } from './FolhaEspelho';
import { carregarFontes } from './fontes';
import type { LayoutEspelho } from './layout-modelo';
import { usePaginacao } from './usePaginacao';

/**
 * Espelho de embarque (via do cliente) desenhado com o layout do editor. O
 * layout chega já capturado no momento da emissão: a impressão daquele pedido
 * não muda se alguém editar o layout depois. As NFs são paginadas pela altura
 * medida (cabeçalho e palete repetidos; o total vai na última folha).
 * `aoPronto` avisa quando as folhas estão medidas e as fontes carregadas.
 */
export function EspelhoEmbarque({ carga, veiculo, p, final, layout, aoPronto }: { carga: CargaJanela; veiculo: VeiculoCarga; p: PaleteEmbarque; final: boolean; layout: LayoutEspelho; aoPronto: () => void }) {
  const documento = useMemo(() => documentoDoEmbarque(carga, veiculo, p, final), [carga, veiculo, p, final]);
  const chave = `${carga.generatedAt}|${p.id}|${String(p.revision)}`;
  const entradas = useMemo(() => [{ chave, documento, layout }], [chave, documento, layout]);
  const { pronto, paginas, medidor } = usePaginacao(entradas);
  useEffect(() => {
    if (!pronto) return;
    let ativo = true;
    void carregarFontes([layout]).then(() => { if (ativo) aoPronto(); });
    return () => { ativo = false; };
  }, [pronto, layout, aoPronto]);
  const folhas = paginas.get(chave)?.folhas ?? [documento.linhas];
  return <>
    {folhas.map((linhas, n) => <FolhaEspelho key={n} documento={documento} pagina={n} totalPaginas={folhas.length} linhas={linhas} layout={layout} />)}
    {/* A área de impressão da Expedição fica oculta na tela; a medição precisa estar fora dela. */}
    {createPortal(medidor, document.body)}
  </>;
}
