import type { Permissao, Sessao } from '@praca-reversa/contracts';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TEXTO_REDE, useConexao, type EstadoRede } from '../api/conexao';
import { pendente, useIncertas } from '../api/incertas';
import type { Carga } from '../api/use-recurso';
import { instalar, useInstalacao } from '../pwa/instalacao';
import type { Navegar, Rota } from '../rotas';
import { formatarHora } from '../utils/datas';
import { ROTULOS_PERFIL } from '../sessao/perfis';
import { IconeAtualizar } from './Icones';
import { AjudaTarefa } from '../features/ajuda/AjudaTarefa';
import { useContextoAjuda } from '../features/ajuda/estado';
import type { IdTarefa } from '../features/ajuda/tarefas';

function Marca() {
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
  aoNavegar: Navegar;
  aoTrocarEscopo: (escopoId: string) => Promise<string | null>;
  aoSair: () => void;
}

interface ItemMenu {
  rotulo: string;
  rota: Rota;
  /** Basta uma das permissões. */
  permissoes: readonly Permissao[];
  ativo: (rota: Rota) => boolean;
}

/** Páginas do menu da conta, exibidas conforme as permissões do escopo ativo. */
const ITENS_MENU: readonly ItemMenu[] = [
  { rotulo: 'Mapa da praça', rota: { tipo: 'praca' }, permissoes: ['praca.consultar'], ativo: (r) => r.tipo === 'praca' || r.tipo === 'palete' },
  { rotulo: 'Cadastrar palete', rota: { tipo: 'novo-palete' }, permissoes: ['palete.cadastrar'], ativo: (r) => r.tipo === 'novo-palete' },
  { rotulo: 'Produtos', rota: { tipo: 'produtos' }, permissoes: ['produto.consultar'], ativo: (r) => r.tipo === 'produtos' },
  {
    rotulo: 'Importações',
    rota: { tipo: 'importacoes' },
    permissoes: ['importacao.consultar', 'claim.consultar'],
    ativo: (r) => r.tipo === 'importacoes' || r.tipo === 'nova-importacao' || r.tipo === 'importacao',
  },
  {
    rotulo: 'Seleção do cliente',
    rota: { tipo: 'selecoes' },
    permissoes: ['selecao.consultar'],
    ativo: (r) => r.tipo === 'selecoes' || r.tipo === 'selecao' || r.tipo === 'inventarios' || r.tipo === 'inventario',
  },
  {
    rotulo: 'Claims',
    rota: { tipo: 'claims' },
    permissoes: ['claim.consultar'],
    ativo: (r) => r.tipo === 'claims' || r.tipo === 'novo-claim' || r.tipo === 'claim' || r.tipo === 'editar-claim',
  },
  {
    rotulo: 'Janelas de devolução',
    rota: { tipo: 'janelas', mes: null },
    permissoes: ['janela.consultar'],
    ativo: (r) => ['janelas', 'nova-janela', 'janela', 'editar-janela', 'reserva', 'expedicao'].includes(r.tipo),
  },
  { rotulo: 'Indicadores', rota: { tipo: 'indicadores', inicio: null, fim: null }, permissoes: ['praca.consultar'], ativo: (r) => r.tipo === 'indicadores' },
  {
    rotulo: 'Relatórios',
    rota: { tipo: 'relatorios', parametros: '' },
    permissoes: ['palete.consultar', 'claim.consultar', 'janela.consultar'],
    ativo: (r) => r.tipo === 'relatorios',
  },
  // Planilha única e proteção dos dados: situação para quem consulta a praça.
  { rotulo: 'Planilha e proteção', rota: { tipo: 'planilha' }, permissoes: ['praca.consultar'], ativo: (r) => r.tipo === 'planilha' },
  { rotulo: 'Layout da praça', rota: { tipo: 'layout' }, permissoes: ['praca.consultar'], ativo: (r) => r.tipo === 'layout' },
  { rotulo: 'Administração de acesso', rota: { tipo: 'acesso' }, permissoes: ['acesso.administrar'], ativo: (r) => r.tipo === 'acesso' },
  // Sem dados da operação: disponível para todos (etapa 09).
  { rotulo: 'Aplicativo e aparelho', rota: { tipo: 'aplicativo' }, permissoes: [], ativo: (r) => r.tipo === 'aplicativo' },
  // Etapa 10: tutorial e guias por tarefa.
  { rotulo: 'Ajuda e tutorial', rota: { tipo: 'ajuda', guia: null }, permissoes: [], ativo: (r) => r.tipo === 'ajuda' },
];

function classeRede(rede: EstadoRede): 'ok' | 'verificando' | 'erro' {
  return rede === 'conectado' ? 'ok' : rede === 'verificando' ? 'verificando' : 'erro';
}

export function Cabecalho({ sessao, rota, aoNavegar, aoTrocarEscopo, aoSair }: PropsCabecalho) {
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
    <header className="topo">
      <div className="marca">
        <Marca />
        <h1 className="marca-nome">Praça Reversa</h1>
      </div>
      {demo && (
        <span className="selo-demo" data-testid="selo-demo" data-tutorial="ambiente">
          Demonstração
        </span>
      )}
      <p className={`status-api status-api--${classeRede(rede)}`} role="status" data-testid="status-api" data-rede={rede}>
        <span className="status-ponto" aria-hidden="true" />
        {TEXTO_REDE[rede]}
      </p>
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
            {itens.length > 0 && (
              <nav className="menu-conta-paginas" aria-label="Páginas">
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

/** Faixa permanente enquanto o escopo ativo for de demonstração. */
export function AvisoDemo() {
  return (
    <div className="aviso-demo" role="note" data-testid="aviso-demo">
      <strong>Modo demonstração.</strong>{' '}
      <span>Escopo com layout e paletes fictícios; não representam o estoque DHL / L’Oréal.</span>{' '}
      <span className="aviso-demo-extra">Cadastros feitos aqui também são fictícios. Navegar no mapa não altera posições nem estoque.</span>
    </div>
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
export function MensagemAcao({ mensagem, testId }: { mensagem: { tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null; testId: string }) {
  if (mensagem === null) return null;
  return (
    <p
      className={mensagem.tipo === 'ok' ? 'mensagem-ok' : mensagem.tipo === 'conflito' ? 'mensagem-conflito' : 'estado-erro'}
      role={mensagem.tipo === 'ok' ? 'status' : 'alert'}
      data-testid={testId}
    >
      {mensagem.tipo === 'conflito' && <strong>Conflito: </strong>}
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
