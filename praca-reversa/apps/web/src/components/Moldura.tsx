import type { Sessao } from '@praca-reversa/contracts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TEXTO_REDE, useConexao, type EstadoRede } from '../api/conexao';
import { pendente, useIncertas } from '../api/incertas';
import type { Carga } from '../api/use-recurso';
import { instalar, useInstalacao } from '../pwa/instalacao';
import type { Navegar, Rota } from '../rotas';
import { ITENS_MENU } from './paginas';
import { registrarSlotPesquisa } from './slot-pesquisa';
import { formatarHora } from '../utils/datas';
import { ROTULOS_PERFIL } from '../sessao/perfis';
import { IconeAtualizar } from './Icones';
import { SeletorTema } from './SeletorTema';
import { AjudaTarefa } from '../features/ajuda/AjudaTarefa';
import { useContextoAjuda } from '../features/ajuda/estado';
import type { IdTarefa } from '../features/ajuda/tarefas';

export function Marca() {
  return (
    <svg className="marca-icone" viewBox="0 0 512 512" width="32" height="32" aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="96" fill="#D40511" />
      <path d="M352 232V184Q352 136 304 136H190" fill="none" stroke="#FFCC00" strokeWidth="40" strokeLinecap="round" />
      <path d="M226 92L178 136L226 180" fill="none" stroke="#FFCC00" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="104" y="282" width="304" height="36" rx="6" fill="#FFCC00" />
      <rect x="120" y="318" width="56" height="50" fill="#FFCC00" />
      <rect x="228" y="318" width="56" height="50" fill="#FFCC00" />
      <rect x="336" y="318" width="56" height="50" fill="#FFCC00" />
      <rect x="104" y="368" width="304" height="30" rx="6" fill="#FFCC00" />
    </svg>
  );
}

interface PropsCabecalho {
  sessao: Sessao | null;
  rota: Rota;
  /** Computador com menu lateral: a marca fica no menu e o cabeçalho mostra a seção. */
  barraLateral?: boolean;
  /** Título e descrição curta da seção atual. */
  secao?: { titulo: string; descricao: string } | null;
  /** Espaço da pesquisa em destaque (mapa da praça, computador). */
  pesquisa?: boolean;
  /** Ação principal da seção (ex.: "Receber palete" no mapa). */
  acaoPrincipal?: ReactNode;
  aoNavegar: Navegar;
  aoTrocarEscopo: (escopoId: string) => Promise<string | null>;
  aoSair: () => void;
}



function classeRede(rede: EstadoRede): 'ok' | 'verificando' | 'erro' {
  return rede === 'conectado' ? 'ok' : rede === 'verificando' ? 'verificando' : 'erro';
}

export function Cabecalho({ sessao, rota, barraLateral = false, secao = null, pesquisa = false, acaoPrincipal = null, aoNavegar, aoTrocarEscopo, aoSair }: PropsCabecalho) {
  const { rede } = useConexao();
  const emConfirmacao = useIncertas().filter(pendente).length;
  const instalacao = useInstalacao();
  const [trocando, setTrocando] = useState(false);
  const [erroEscopo, setErroEscopo] = useState<string | null>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const fecharMenu = () => {
    if (menuRef.current) menuRef.current.open = false;
  };

  // Fecha o menu ao tocar/clicar fora dele.
  useEffect(() => {
    const aoTocar = (evento: PointerEvent) => {
      const menu = menuRef.current;
      if (menu?.open && evento.target instanceof Node && !menu.contains(evento.target)) menu.open = false;
    };
    document.addEventListener('pointerdown', aoTocar);
    return () => {
      document.removeEventListener('pointerdown', aoTocar);
    };
  }, []);
  const demo = sessao?.activeScope?.demo ?? false;
  const itens = sessao?.activeScope
    ? ITENS_MENU.filter((i) => (i.permissoes.length === 0 || i.permissoes.some((p) => sessao.permissions.includes(p))) && !i.ativo(rota))
    : [];

  return (
    <header className={barraLateral ? 'topo topo--com-barra' : 'topo'}>
      <div className="marca">
        {!barraLateral && <Marca />}
        {secao !== null ? (
          <div className="topo-secao">
            <h1 className="topo-titulo">{secao.titulo}</h1>
            {secao.descricao !== '' && <p className="topo-descricao">{secao.descricao}</p>}
          </div>
        ) : (
          <h1 className="marca-nome">Praça Reversa</h1>
        )}
      </div>
      {pesquisa && <div className="topo-pesquisa" ref={registrarSlotPesquisa} />}
      {demo && <IndicadorDemo />}
      <p className={`status-api status-api--${classeRede(rede)}`} role="status" data-testid="status-api" data-rede={rede} title={TEXTO_REDE[rede]}>
        <span className="status-ponto" aria-hidden="true" />
        <span className="status-texto">{TEXTO_REDE[rede]}</span>
      </p>
      {acaoPrincipal}
      {emConfirmacao > 0 && (
        <span className="selo-confirmacao" role="status" data-testid="selo-em-confirmacao">
          Em confirmação ({emConfirmacao})
        </span>
      )}
      {sessao !== null && (
        <button
          type="button"
          className="botao-ajuda"
          onClick={() => {
            aoNavegar({ tipo: 'ajuda', guia: null });
          }}
          aria-current={rota.tipo === 'ajuda' ? 'page' : undefined}
          data-testid="botao-ajuda"
          data-tutorial="ajuda"
        >
          <span className="botao-ajuda-icone" aria-hidden="true">
            ?
          </span>
          <span className="botao-ajuda-texto">Ajuda</span>
        </button>
      )}
      {sessao !== null && (
        <details
          className="menu-conta"
          data-testid="menu-conta"
          ref={menuRef}
          onKeyDown={(evento) => {
            if (evento.key === 'Escape' && menuRef.current?.open) {
              fecharMenu();
              menuRef.current.querySelector('summary')?.focus();
            }
          }}
        >
          <summary>
            <span className="menu-conta-avatar" aria-hidden="true">
              {sessao.user.name.trim().charAt(0).toUpperCase()}
            </span>
            <span className="menu-conta-rotulo">Menu</span>
            <span className="menu-conta-nome">{sessao.user.name}</span>
            <span className="menu-conta-escopo">{sessao.activeScope?.name ?? 'Sem escopo ativo'}</span>
          </summary>
          <div className="menu-conta-painel">
            <p>
              <strong>{sessao.user.name}</strong> ({sessao.user.login})
              <br />
              Perfil: {sessao.role ? ROTULOS_PERFIL[sessao.role] : 'sem perfil neste escopo'}
            </p>
            {sessao.scopes.length > 0 && (
              <label className="campo">
                <span className="campo-rotulo">Unidade / cliente</span>
                <select
                  value={sessao.activeScope?.id ?? ''}
                  disabled={trocando}
                  onChange={(evento) => {
                    const destino = evento.target.value;
                    if (!destino) return;
                    setTrocando(true);
                    setErroEscopo(null);
                    void aoTrocarEscopo(destino).then((falha) => {
                      setErroEscopo(falha);
                      setTrocando(false);
                      if (falha === null) fecharMenu();
                    });
                  }}
                >
                  {sessao.activeScope === null && <option value="">Escolher…</option>}
                  {sessao.scopes.map((escopo) => (
                    <option key={escopo.id} value={escopo.id}>
                      {escopo.name} — {ROTULOS_PERFIL[escopo.role]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {erroEscopo !== null && (
              <p className="estado-erro" role="alert">
                {erroEscopo}
              </p>
            )}
            <div className="menu-conta-tema">
              <p className="menu-conta-grupo">Tema da tela</p>
              <SeletorTema />
            </div>
            {itens.length > 0 && (
              <nav className="menu-conta-paginas" aria-label="Páginas">
                <p className="menu-conta-grupo">Todas as páginas</p>
                {itens.map((item) => (
                  <button
                    key={item.rotulo}
                    type="button"
                    className="botao-secundario"
                    onClick={() => {
                      fecharMenu();
                      aoNavegar(item.rota);
                    }}
                  >
                    {item.rotulo}
                  </button>
                ))}
              </nav>
            )}
            {instalacao.disponivel && !instalacao.standalone && (
              <button
                type="button"
                className="botao-secundario"
                onClick={() => {
                  fecharMenu();
                  void instalar();
                }}
                data-testid="menu-instalar"
              >
                Instalar aplicativo
              </button>
            )}
            <button
              type="button"
              className="botao-secundario"
              onClick={() => {
                fecharMenu();
                aoSair();
              }}
            >
              Sair
            </button>
          </div>
        </details>
      )}
    </header>
  );
}

/**
 * Escopo de demonstração (etapa 2): indicador compacto no cabeçalho, sempre
 * visível enquanto o escopo for fictício; a explicação abre ao tocar (no lugar
 * da faixa larga que se repetia em todas as páginas).
 */
function IndicadorDemo() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const aoTocar = (evento: PointerEvent) => {
      const el = ref.current;
      if (el?.open && evento.target instanceof Node && !el.contains(evento.target)) el.open = false;
    };
    document.addEventListener('pointerdown', aoTocar);
    return () => {
      document.removeEventListener('pointerdown', aoTocar);
    };
  }, []);
  return (
    <details
      ref={ref}
      className="indicador-demo"
      data-tutorial="ambiente"
      onKeyDown={(evento) => {
        if (evento.key === 'Escape' && ref.current?.open) {
          ref.current.open = false;
          ref.current.querySelector('summary')?.focus();
        }
      }}
    >
      <summary className="selo-demo" data-testid="selo-demo" title="Dados fictícios: toque para ver o que isso significa">
        Demonstração
      </summary>
      <div className="indicador-demo-explicacao" role="note" data-testid="aviso-demo">
        <strong>Modo demonstração.</strong> Escopo com layout e paletes fictícios; não representam o estoque DHL / L’Oréal. Cadastros feitos aqui
        também são fictícios. Navegar no mapa não altera posições nem estoque.
      </div>
    </details>
  );
}

/** Página sem permissão no escopo ativo (a API também recusaria). */
export function SemPermissao({ aoVoltar }: { aoVoltar: () => void }) {
  return (
    <main className="principal principal--estado">
      <div className="estado-vazio estado-tela" data-testid="sem-permissao">
        <h2>Sem permissão</h2>
        <p>Seu perfil neste escopo não permite esta função.</p>
        <button type="button" className="botao-secundario" onClick={aoVoltar}>
          Voltar ao mapa
        </button>
      </div>
    </main>
  );
}

/** Estrutura comum das páginas de cadastro e configuração. */
export function Pagina({
  titulo,
  testId,
  aoVoltar,
  children,
  descricao,
  rotuloVoltar = 'Voltar ao mapa',
  ajuda,
}: {
  titulo: string;
  testId: string;
  aoVoltar: () => void;
  children: ReactNode;
  descricao?: ReactNode;
  rotuloVoltar?: string;
  /** Guia curto da tarefa desta página (etapa 10). */
  ajuda?: IdTarefa;
}) {
  return (
    <main className="principal principal--pagina" data-testid={testId}>
      <div className="pagina-conteudo">
        <header className="pagina-topo">
          <h2>{titulo}</h2>
          {descricao !== undefined && <div className="pagina-descricao">{descricao}</div>}
          <button type="button" className="botao-secundario" onClick={aoVoltar}>
            {rotuloVoltar}
          </button>
        </header>
        {ajuda !== undefined && <AjudaTarefa tarefa={ajuda} />}
        {children}
      </div>
    </main>
  );
}

/** Mensagem de resultado de uma ação: sucesso, erro ou conflito de versão. */
export function MensagemAcao({ mensagem, testId }: { mensagem: { tipo: 'ok' | 'erro' | 'conflito' | 'aviso'; texto: string } | null; testId: string }) {
  if (mensagem === null) return null;
  return (
    <p
      className={mensagem.tipo === 'ok' ? 'mensagem-ok' : mensagem.tipo === 'conflito' || mensagem.tipo === 'aviso' ? 'mensagem-conflito' : 'estado-erro'}
      role={mensagem.tipo === 'ok' ? 'status' : 'alert'}
      data-testid={testId}
    >
      {mensagem.tipo === 'conflito' && <strong>Conflito: </strong>}
      {mensagem.tipo === 'aviso' && <strong>Atenção: </strong>}
      {mensagem.texto}
    </p>
  );
}

const TEXTO_AVISO: Partial<Record<EstadoRede, string>> = {
  'sem-conexao': 'Sem conexão com a rede.',
  'servidor-sem-resposta': 'Servidor sem resposta.',
  'servidor-indisponivel': 'Servidor indisponível.',
  'banco-indisponivel': 'Banco de dados indisponível no servidor.',
};

/**
 * Estado real da conexão (etapa 09): sem rede no aparelho, servidor sem
 * resposta ou indisponível. Nada é confirmado nesses estados; o que está na
 * tela é da última consulta.
 */
export function AvisoConexao() {
  const { rede, ultimaRespostaEm } = useConexao();
  const ajuda = useContextoAjuda();
  const texto = TEXTO_AVISO[rede];
  if (texto === undefined) return null;
  return (
    <div className="aviso-conexao" role="alert" data-testid="aviso-conexao" data-rede={rede}>
      <strong>{texto}</strong> Nada é confirmado até o servidor responder; os dados exibidos são da última consulta
      {ultimaRespostaEm !== null ? ` (${formatarHora(new Date(ultimaRespostaEm).toISOString())})` : ''} e podem estar desatualizados.{' '}
      {ajuda && (
        <button
          type="button"
          className="botao-link"
          onClick={() => {
            ajuda.navegar({ tipo: 'ajuda', guia: 'interrupcao' });
          }}
        >
          Como resolver
        </button>
      )}
    </div>
  );
}

export function EstadoTela({
  carga,
  titulo,
  aoTentarNovamente,
}: {
  carga: Carga<unknown> | { estado: 'carregando' } | null;
  titulo: string;
  aoTentarNovamente: () => void;
}) {
  return (
    <main className="principal principal--estado">
      {carga?.estado === 'erro' ? (
        <div className="estado-erro estado-tela" role="alert" data-testid="erro-praca">
          <h2>{titulo}</h2>
          <p>{carga.mensagem}</p>
          <button type="button" className="botao-primario" onClick={aoTentarNovamente}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      ) : (
        <div className="estado-carregando estado-tela" aria-busy="true" data-testid="carregando">
          <p>Carregando…</p>
        </div>
      )}
    </main>
  );
}
