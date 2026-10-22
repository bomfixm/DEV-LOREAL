import { escolherTema, useTema } from '../tema';
import { IconeLua, IconeSol } from './Icones';

/** Alternância Claro/Escuro (menu lateral no computador; menu da conta no celular). */
export function SeletorTema() {
  const tema = useTema();
  return (
    <div className="seletor-tema" role="group" aria-label="Tema da tela" data-testid="seletor-tema">
      <button
        type="button"
        aria-pressed={tema === 'claro'}
        onClick={() => {
          escolherTema('claro');
        }}
      >
        <IconeSol />
        <span className="seletor-tema-texto">Claro</span>
      </button>
      <button
        type="button"
        aria-pressed={tema === 'escuro'}
        onClick={() => {
          escolherTema('escuro');
        }}
      >
        <IconeLua />
        <span className="seletor-tema-texto">Escuro</span>
      </button>
    </div>
  );
}
