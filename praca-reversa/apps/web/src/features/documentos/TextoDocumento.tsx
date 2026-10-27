import { Fragment } from 'react';

/**
 * Texto do documento como texto puro (nunca HTML): parágrafos separados por
 * linha em branco; linha iniciada por "#" vira subtítulo e por "- " vira
 * item de lista. O conteúdo vem do banco; nada é interpretado como marcação.
 */
export function TextoDocumento({ conteudo }: { conteudo: string }) {
  const blocos = conteudo.split(/\n{2,}/).map((b) => b.trim()).filter((b) => b !== '');
  return (
    <div className="documento-texto">
      {blocos.map((bloco, i) => {
        const titulo = /^#{1,4}\s+(.*)$/s.exec(bloco);
        if (titulo) return <h3 key={i}>{titulo[1]}</h3>;
        const linhas = bloco.split('\n');
        if (linhas.every((l) => l.startsWith('- '))) {
          return (
            <ul key={i}>
              {linhas.map((l, j) => (
                <li key={j}>{l.slice(2)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i}>
            {linhas.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {l}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
