import type { CargaJanela, PaleteEmbarque, VeiculoCarga } from '@praca-reversa/contracts';
import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { documentoDoEmbarque } from './conteudo-espelho';
import { FolhaEspelho } from './FolhaEspelho';
import { carregarFontes } from './fontes';
import type { LayoutEspelho } from './layout-modelo';
import { usePaginacao } from './usePaginacao';

/**
 * Espelhos de embarque (via do cliente) desenhados com o layout do editor, um
 * ou vários paletes na mesma impressão (na ordem recebida). O layout chega já
 * capturado no momento da emissão: a impressão daquele pedido não muda se
 * alguém editar o layout depois. As NFs são paginadas pela altura medida
 * (cabeçalho e palete repetidos; o total vai na última folha de cada palete).
 * `aoPronto` avisa quando todas as folhas estão medidas e as fontes carregadas.
 */
export function EspelhoEmbarque({ carga, veiculo, paletes, final, layout, aoPronto }: { carga: CargaJanela; veiculo: VeiculoCarga; paletes: PaleteEmbarque[]; final: boolean; layout: LayoutEspelho; aoPronto: () => void }) {
  const entradas = useMemo(
    () => paletes.map((p) => ({ chave: `${carga.generatedAt}|${p.id}|${String(p.revision)}`, documento: documentoDoEmbarque(carga, veiculo, p, final), layout })),
    [carga, veiculo, paletes, final, layout],
  );
  const { pronto, paginas, medidor } = usePaginacao(entradas);
  useEffect(() => {
    if (!pronto) return;
    let ativo = true;
    void carregarFontes([layout]).then(() => { if (ativo) aoPronto(); });
    return () => { ativo = false; };
  }, [pronto, layout, aoPronto]);
  return <>
    {entradas.map(({ chave, documento }) => {
      const folhas = paginas.get(chave)?.folhas ?? [documento.linhas];
      return folhas.map((linhas, n) => <FolhaEspelho key={`${chave}|${String(n)}`} documento={documento} pagina={n} totalPaginas={folhas.length} linhas={linhas} layout={layout} />);
    })}
    {/* A área de impressão da Expedição fica oculta na tela; a medição precisa estar fora dela. */}
    {createPortal(medidor, document.body)}
  </>;
}
