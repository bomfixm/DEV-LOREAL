import { PASSOS_TUTORIAL } from '@praca-reversa/contracts';
import { useEffect } from 'react';
import { Pagina } from '../../components/Moldura';
import { DUVIDAS, GLOSSARIO, GUIAS, INDISPONIVEIS } from './conteudo';
import { iniciarTutorial, usePreferencia, useContextoAjuda, useTutorial } from './estado';
import { GuiaTarefa } from './GuiaTarefa';
import type { IdTarefa } from './tarefas';

/**
 * Central de ajuda (etapa 10): "Começar aqui" (tutorial), guias por tarefa,
 * glossário, dúvidas frequentes e o que ainda não existe nesta versão. A
 * página inteira é a versão imprimível do guia do operador.
 */
export function TelaAjuda({ guia }: { guia: IdTarefa | null }) {
  const contexto = useContextoAjuda();
  const usuarioId = contexto?.usuarioId ?? '';
  const preferencia = usePreferencia(usuarioId);
  const tutorial = useTutorial();
  const permissoes = contexto?.permissoes ?? [];

  // Guia pedido pela tela de origem (?guia=…): rola até ele.
  useEffect(() => {
    if (guia === null) return;
    document.getElementById(`guia-${guia}`)?.scrollIntoView({ block: 'start' });
  }, [guia]);

  function comecar(passo: number): void {
    if (!contexto) return;
    iniciarTutorial(contexto.usuarioId, passo);
    contexto.navegar({ tipo: 'praca' });
  }

  const voltar = () => {
    contexto?.navegar({ tipo: 'praca' });
  };
  const interrompido = preferencia?.state === 'INTERROMPIDO' && preferencia.step !== null ? preferencia.step : null;

  return (
    <Pagina titulo="Ajuda" testId="tela-ajuda" aoVoltar={voltar} descricao={<p>Guias da versão em uso, com os nomes reais dos botões. Os exemplos são fictícios.</p>}>
      <section className="cartao ajuda-comecar" aria-labelledby="ajuda-comecar" data-testid="ajuda-comecar">
        <h3 id="ajuda-comecar">Começar aqui</h3>
        <p>
          Primeira tarefa: <strong>encontrar um produto e saber em qual palete e endereço ele está</strong>, em {PASSOS_TUTORIAL} passos. O tutorial
          aponta os botões da tela real, espera você fazer cada passo e não grava nada no estoque{contexto?.demo ? ' (aqui, na demonstração, com dados fictícios)' : ''}.
        </p>
        {preferencia?.state === 'CONCLUIDO' && <p className="bloco-nota">Você já concluiu o tutorial. Pode repetir quando quiser.</p>}
        {interrompido !== null && <p className="bloco-nota">Você parou no passo {interrompido} de {PASSOS_TUTORIAL}.</p>}
        <div className="acoes-linha">
          {interrompido !== null && (
            <button type="button" className="botao-primario" onClick={() => { comecar(interrompido); }} data-testid="ajuda-continuar">
              Continuar do passo {interrompido}
            </button>
          )}
          <button
            type="button"
            className={interrompido !== null ? 'botao-secundario' : 'botao-primario'}
            disabled={tutorial.ativo}
            onClick={() => {
              comecar(1);
            }}
            data-testid="ajuda-comecar-tutorial"
          >
            {tutorial.ativo ? 'Tutorial em andamento' : preferencia?.state === 'CONCLUIDO' || interrompido !== null ? 'Recomeçar o tutorial' : 'Começar o tutorial'}
          </button>
          <button type="button" className="botao-secundario" onClick={() => { window.print(); }}>
            Imprimir o guia do operador
          </button>
        </div>
      </section>

      <nav className="cartao ajuda-indice" aria-label="Guias por tarefa">
        <h3>Guias por tarefa</h3>
        <ul>
          {GUIAS.map((g) => (
            <li key={g.id}>
              <a href={`#guia-${g.id}`}>{g.titulo}</a>
            </li>
          ))}
          <li>
            <a href="#ajuda-glossario">Glossário</a>
          </li>
          <li>
            <a href="#ajuda-duvidas">Dúvidas frequentes</a>
          </li>
        </ul>
      </nav>

      {GUIAS.map((g) => (
        <section key={g.id} className={`cartao ajuda-guia${guia === g.id ? ' ajuda-guia--pedido' : ''}`} aria-labelledby={`guia-${g.id}`}>
          <GuiaTarefa tarefa={g.id} permissoes={permissoes} comTitulo />
        </section>
      ))}

      <section className="cartao" aria-labelledby="ajuda-glossario">
        <h3 id="ajuda-glossario">Glossário</h3>
        <dl className="glossario">
          {GLOSSARIO.map((t) => (
            <div key={t.termo}>
              <dt>{t.termo}</dt>
              <dd>
                {t.explicacao} <span className="glossario-exemplo">Exemplo: {t.exemplo}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="cartao" aria-labelledby="ajuda-duvidas">
        <h3 id="ajuda-duvidas">Dúvidas frequentes</h3>
        {DUVIDAS.map((d) => (
          <div key={d.pergunta} className="duvida">
            <p>
              <strong>{d.pergunta}</strong>
            </p>
            <p>{d.resposta}</p>
          </div>
        ))}
      </section>

      <section className="cartao" aria-labelledby="ajuda-indisponivel">
        <h3 id="ajuda-indisponivel">O que esta versão ainda não faz</h3>
        <ul>
          {INDISPONIVEIS.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
        <p className="bloco-nota">Instalação, banco, migrações e backup são material técnico de manutenção (docs/IMPLANTACAO.md), fora deste guia.</p>
      </section>
    </Pagina>
  );
}
