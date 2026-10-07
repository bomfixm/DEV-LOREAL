import { Suspense, lazy, useState } from 'react';
import { useContextoAjuda } from './estado';
import { TITULOS_TAREFA, type IdTarefa } from './tarefas';

// O texto dos guias é carregado só quando a ajuda é aberta.
const GuiaTarefa = lazy(() => import('./GuiaTarefa').then((m) => ({ default: m.GuiaTarefa })));

/**
 * Ajuda curta da tarefa, na própria tela: fechada por padrão (não atrapalha
 * quem já sabe), abre o guia com o que fazer, onde e o que deve aparecer.
 */
export function AjudaTarefa({ tarefa }: { tarefa: IdTarefa }) {
  const contexto = useContextoAjuda();
  const [aberta, setAberta] = useState(false);
  return (
    <details
      className="ajuda-tarefa"
      data-testid={`ajuda-${tarefa}`}
      onToggle={(e) => {
        setAberta(e.currentTarget.open);
      }}
    >
      <summary>
        <span aria-hidden="true">?</span> Como fazer: {TITULOS_TAREFA[tarefa]}
      </summary>
      {aberta && (
        <Suspense fallback={<p className="estado-carregando">Carregando o guia…</p>}>
          <GuiaTarefa tarefa={tarefa} permissoes={contexto?.permissoes ?? []} />
          {contexto && (
            <button
              type="button"
              className="botao-link"
              onClick={() => {
                contexto.navegar({ tipo: 'ajuda', guia: tarefa });
              }}
            >
              Abrir na Ajuda (glossário, dúvidas e versão para imprimir)
            </button>
          )}
        </Suspense>
      )}
    </details>
  );
}
