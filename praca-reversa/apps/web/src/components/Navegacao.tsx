import type { Permissao, Sessao } from '@praca-reversa/contracts';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { paraEndereco } from '../base';
import { caminhoDe, type Navegar, type Rota } from '../rotas';
import { IconeCaixa, IconeCalendario, IconeExpandirMenu, IconeMapa, IconePainel, IconePrancheta, IconeRecolherMenu, IconeReticencias } from './Icones';
import { Marca } from './Moldura';
import { ITENS_MENU, ROTAS_AGENDA } from './paginas';
import { escolherEstadoMenu, useEstadoMenu } from './preferencia-menu';
import { SeletorTema } from './SeletorTema';

interface ItemNavegacao {
  rotulo: string;
  icone: ReactNode;
  rota: Rota;
  permissoes: readonly Permissao[];
  ativo: (rota: Rota) => boolean;
}

/** Funções principais da operação; as demais páginas ficam em "Mais". */
const ITENS: readonly ItemNavegacao[] = [
  { rotulo: 'Mapa da praça', icone: <IconeMapa />, rota: { tipo: 'praca' }, permissoes: ['praca.consultar'], ativo: (r) => r.tipo === 'praca' || r.tipo === 'palete' },
  {
    rotulo: 'Inventário',
    icone: <IconePrancheta />,
    rota: { tipo: 'inventarios' },
    permissoes: ['selecao.consultar', 'importacao.consultar'],
    ativo: (r) => r.tipo === 'inventarios' || r.tipo === 'inventario',
  },
  {
    rotulo: 'Recebimento',
    icone: <IconeCaixa />,
    rota: { tipo: 'novo-palete' },
    permissoes: ['palete.cadastrar'],
    ativo: (r) => r.tipo === 'novo-palete' || r.tipo === 'bipagem' || r.tipo === 'bipagem-escolher' || r.tipo === 'novo-conteudo' || r.tipo === 'volumes',
  },
  { rotulo: 'Agendas', icone: <IconeCalendario />, rota: { tipo: 'janelas', mes: null }, permissoes: ['janela.consultar'], ativo: (r) => ROTAS_AGENDA.includes(r.tipo) },
  {
    rotulo: 'Painel',
    icone: <IconePainel />,
    rota: { tipo: 'painel', parametros: '' },
    permissoes: ['painel.operacao'],
    ativo: (r) => r.tipo === 'painel' || r.tipo === 'painel-estoque' || r.tipo === 'painel-janela',
  },
];

/** Páginas que já estão nas funções principais (não se repetem em "Mais"). */
const JA_PRINCIPAIS = new Set(['Mapa da praça', 'Cadastrar palete', 'Janelas de devolução', 'Painel da operação']);
// "Registrar conteúdo" continua em "Mais" (atalho do recebimento).

/**
 * Menu lateral do computador (etapa 2): compacto (só ícones, padrão) ou
 * expandido (ícones e nomes), pelo botão do topo; a escolha é só visual e fica
 * neste navegador. Funções principais sempre à vista; as demais páginas
 * permitidas ao perfil abrem em "Mais". Com o menu compacto, cada ícone mostra
 * o nome ao passar o mouse ou focar (o nome também é o nome acessível). No
 * celular não há coluna: as páginas ficam no menu da conta.
 */
export function NavegacaoPrincipal({ sessao, rota, aoNavegar }: { sessao: Sessao; rota: Rota; aoNavegar: Navegar }) {
  const ids = useId();
  const estado = useEstadoMenu();
  const expandido = estado === 'expandido';
  const [maisAberto, setMaisAberto] = useState(false);
  const maisRef = useRef<HTMLLIElement>(null);
  const botaoMaisRef = useRef<HTMLButtonElement>(null);
  const pode = (lista: readonly Permissao[]) => lista.length === 0 || lista.some((p) => sessao.permissions.includes(p));
  // Acesso do cliente: o painel do cliente é a função principal.
  const soCliente = !sessao.permissions.includes('praca.consultar') && sessao.permissions.includes('painel.cliente');
  const itens: ItemNavegacao[] = soCliente
    ? [{ rotulo: 'Painel do cliente', icone: <IconePainel />, rota: { tipo: 'painel-cliente', parametros: '' }, permissoes: ['painel.cliente'], ativo: (r) => r.tipo === 'painel-cliente' || r.tipo === 'praca' }]
    : ITENS.filter((i) => pode(i.permissoes));
  // Só um item fica em destaque: a função principal, quando a página pertence a ela.
  const algumPrincipal = itens.some((i) => i.ativo(rota));
  const mais = ITENS_MENU.filter((i) => !JA_PRINCIPAIS.has(i.rotulo) && !(soCliente && i.rotulo === 'Painel do cliente') && pode(i.permissoes));
  const maisAtivo = !algumPrincipal && mais.some((i) => i.ativo(rota));

  // "Mais" fecha ao tocar fora, com Esc (o foco volta ao botão) e ao trocar de página.
  useEffect(() => {
    if (!maisAberto) return;
    const aoTocar = (evento: PointerEvent) => {
      if (evento.target instanceof Node && !maisRef.current?.contains(evento.target)) setMaisAberto(false);
    };
    document.addEventListener('pointerdown', aoTocar);
    return () => {
      document.removeEventListener('pointerdown', aoTocar);
    };
  }, [maisAberto]);

  const link = (rotulo: string, ativo: boolean, destino: Rota, icone: ReactNode, classe: string, aoIr?: () => void) => (
    <li key={rotulo}>
      {/* Link de navegação (abre em nova aba com o botão do meio); o clique comum navega sem recarregar. */}
      <a
        href={paraEndereco(caminhoDe(destino))}
        className={classe}
        aria-current={ativo ? 'page' : undefined}
        data-dica={rotulo}
        onClick={(evento) => {
          if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
          evento.preventDefault();
          aoIr?.();
          aoNavegar(destino);
        }}
      >
        {icone}
        <span className="navegacao-texto">{rotulo}</span>
      </a>
    </li>
  );

  return (
    <aside className="barra-lateral" data-estado={estado} data-testid="barra-lateral">
      <div className="barra-marca">
        <Marca />
        <div className="barra-marca-texto">
          <p className="barra-marca-nome">Praça Reversa</p>
          <p className="barra-marca-cliente">DHL / L’Oréal</p>
        </div>
      </div>
      <button
        type="button"
        className="barra-alternar"
        aria-expanded={expandido}
        aria-controls={`${ids}-nav`}
        aria-label={expandido ? 'Recolher menu' : 'Expandir menu'}
        data-dica={expandido ? 'Recolher menu' : 'Expandir menu'}
        onClick={() => {
          setMaisAberto(false);
          escolherEstadoMenu(expandido ? 'compacto' : 'expandido');
        }}
        data-testid="alternar-menu"
      >
        {expandido ? <IconeRecolherMenu /> : <IconeExpandirMenu />}
        <span className="navegacao-texto" aria-hidden="true">
          {expandido ? 'Recolher menu' : 'Expandir menu'}
        </span>
      </button>
      <nav id={`${ids}-nav`} className="navegacao-principal" aria-label="Funções principais" data-testid="navegacao-principal">
        <ul>
          {itens.map((i) => link(i.rotulo, i.ativo(rota), i.rota, i.icone, 'navegacao-item'))}
          {mais.length > 0 && (
            <li
              ref={maisRef}
              className="navegacao-mais"
              onKeyDown={(evento) => {
                if (evento.key === 'Escape' && maisAberto) {
                  evento.stopPropagation();
                  setMaisAberto(false);
                  botaoMaisRef.current?.focus();
                }
              }}
            >
              <button
                ref={botaoMaisRef}
                type="button"
                className="navegacao-item"
                aria-expanded={maisAberto}
                aria-controls={`${ids}-mais`}
                data-ativo={maisAtivo ? 'sim' : undefined}
                data-dica="Mais páginas"
                onClick={() => {
                  setMaisAberto((a) => !a);
                }}
                data-testid="navegacao-mais-botao"
              >
                <IconeReticencias />
                <span className="navegacao-texto">Mais</span>
              </button>
              <div id={`${ids}-mais`} className="navegacao-mais-painel" hidden={!maisAberto} data-testid="navegacao-mais">
                <p className="barra-grupo">Mais páginas</p>
                <ul aria-label="Mais páginas">
                  {mais.map((i) =>
                    link(i.rotulo, i.ativo(rota) && !algumPrincipal, i.rota, null, 'navegacao-item navegacao-item--secundario', () => {
                      setMaisAberto(false);
                    }),
                  )}
                </ul>
              </div>
            </li>
          )}
        </ul>
      </nav>
      <div className="barra-rodape">
        <p className="barra-escopo" title="Unidade / cliente ativo">
          {sessao.activeScope?.name ?? 'Sem escopo ativo'}
        </p>
        <SeletorTema />
      </div>
    </aside>
  );
}
