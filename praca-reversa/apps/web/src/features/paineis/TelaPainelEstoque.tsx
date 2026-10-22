import { API_PREFIXO, PainelOperacaoSchema } from '@praca-reversa/contracts';
import { useRecurso } from '../../api/use-recurso';
import { Pagina } from '../../components/Moldura';
import type { Navegar } from '../../rotas';
import { ConsultaEstoque } from './ConsultaEstoque';

/** Lista aberta pelos cards do painel da operação (mesmos filtros, na URL). */
export function TelaPainelEstoque({ parametros, aoNavegar }: { parametros: string; aoNavegar: Navegar }) {
  const { carga } = useRecurso(`${API_PREFIXO}/painel/operacao`, PainelOperacaoSchema);
  const janelas = carga?.estado === 'pronto' ? [...(carga.dados.nextWindow ? [carga.dados.nextWindow] : []), ...carga.dados.windows.filter((j) => j.id !== carga.dados.nextWindow?.id)] : [];
  return (
    <Pagina
      titulo="Estoque e histórico"
      testId="tela-painel-estoque"
      rotuloVoltar="Voltar ao painel"
      aoVoltar={() => {
        aoNavegar({ tipo: 'painel', parametros: '' });
      }}
      descricao={<p>Uma linha por NF × palete (palete sem conteúdo aparece como identificação não informada). Os totais são a soma destas linhas.</p>}
    >
      <ConsultaEstoque
        base="operacao"
        parametros={parametros}
        janelas={janelas}
        aoMudar={(p) => {
          aoNavegar({ tipo: 'painel-estoque', parametros: p });
        }}
        aoAbrirPalete={(id) => {
          aoNavegar({ tipo: 'palete', id });
        }}
      />
    </Pagina>
  );
}
