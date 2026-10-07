import type { Permissao } from '@praca-reversa/contracts';
import { guiaPorId, podeExecutar } from './conteudo';
import type { IdTarefa } from './tarefas';

/**
 * Um guia por tarefa: para quê, quem faz, passos (o que fazer, onde, o que
 * deve aparecer) e cuidados. Passos que o perfil não executa aparecem como
 * "outro perfil" — o guia não ensina a contornar permissões.
 */
export function GuiaTarefa({ tarefa, permissoes, comTitulo = false }: { tarefa: IdTarefa; permissoes: readonly Permissao[]; comTitulo?: boolean }) {
  const g = guiaPorId(tarefa);
  const executa = g.executam.length === 0 || g.executam.some((p) => permissoes.includes(p));
  return (
    <div className="guia-tarefa" data-testid={`guia-${tarefa}`}>
      {comTitulo && <h3 id={`guia-${tarefa}`}>{g.titulo}</h3>}
      <p>
        <strong>Para quê:</strong> {g.objetivo}
      </p>
      <p>
        <strong>Quem faz:</strong> {g.quem}
      </p>
      {!executa && (
        <p className="mensagem-conflito" data-testid="guia-sem-permissao">
          <strong>Seu perfil:</strong> {g.semPermissao}
        </p>
      )}
      <ol className="guia-passos">
        {g.passos.map((p, i) => {
          const pode = podeExecutar(p, permissoes);
          return (
            <li key={i} className={pode ? undefined : 'guia-passo--outro-perfil'} data-pode={pode ? 'sim' : 'nao'}>
              <p>
                <strong>O que fazer:</strong> {p.fazer}
                {!pode && <span className="selo-perfil"> Outro perfil executa este passo</span>}
              </p>
              <p>
                <strong>Onde:</strong> {p.onde}
              </p>
              <p>
                <strong>O que deve aparecer:</strong> {p.aparece}
              </p>
            </li>
          );
        })}
      </ol>
      <ul className="guia-atencao" aria-label="Atenção">
        {g.atencao.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </div>
  );
}
