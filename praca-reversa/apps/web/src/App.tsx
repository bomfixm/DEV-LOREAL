import { API_PREFIXO, PracaSchema, TIPOS_IMPORTACAO_GERAL, tiposImportacaoPermitidos, type Permissao, type Praca, type Sessao } from '@praca-reversa/contracts';
import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useConexao } from './api/conexao';
import { definirContexto } from './api/incertas';
import { useRecurso } from './api/use-recurso';
import { useVersao } from './api/versao';
import { AvisoConexao, Cabecalho, EstadoTela, SemPermissao } from './components/Moldura';
import { IconeCaixa } from './components/Icones';
import { NavegacaoPrincipal } from './components/Navegacao';
import { secaoDaRota } from './components/paginas';
import { ContextoAjudaReact, carregarPreferencia, encerrarTutorial, iniciarTutorial, useTutorial, type ContextoAjuda } from './features/ajuda/estado';
import { OfertaTutorial } from './features/ajuda/OfertaTutorial';
import { ROTULOS_PERFIL } from './sessao/perfis';
import { useMediaQuery } from './hooks/ambiente';
import { atualizarAgora } from './pwa/atualizacao';
import { AvisosAplicativo } from './pwa/AvisosAplicativo';
import { caminhoDe, destinoSeguro, lerRota, useRota, type ContextoClaim, type Navegar, type Rota } from './rotas';
import { TelaLogin } from './sessao/TelaLogin';
import { useSessao, type AcoesSessao } from './sessao/use-sessao';
import { TelaPraca } from './TelaPraca';

// Páginas carregadas sob demanda: o mapa abre sem o código de cadastro e de etiquetas (QR).
const TelaAcesso = lazy(() => import('./features/acesso/TelaAcesso').then((m) => ({ default: m.TelaAcesso })));
const TelaNovoPalete = lazy(() => import('./features/cadastro/TelaNovoPalete').then((m) => ({ default: m.TelaNovoPalete })));
const TelaEtiquetas = lazy(() => import('./features/etiquetas/TelaEtiquetas').then((m) => ({ default: m.TelaEtiquetas })));
const TelaLayout = lazy(() => import('./features/layout/TelaLayout').then((m) => ({ default: m.TelaLayout })));
const TelaRegistrarConteudo = lazy(() => import('./features/conteudos/TelaRegistrarConteudo').then((m) => ({ default: m.TelaRegistrarConteudo })));
const TelaConferenciaVolumes = lazy(() => import('./features/conteudos/TelaConferenciaVolumes').then((m) => ({ default: m.TelaConferenciaVolumes })));
const TelaConferencia = lazy(() => import('./features/conferencia/TelaConferencia').then((m) => ({ default: m.TelaConferencia })));
const TelaMover = lazy(() => import('./features/movimentos/TelaMover').then((m) => ({ default: m.TelaMover })));
const TelaTransferir = lazy(() => import('./features/movimentos/TelaTransferir').then((m) => ({ default: m.TelaTransferir })));
const TelaImportacoes = lazy(() => import('./features/importacao/TelaImportacoes').then((m) => ({ default: m.TelaImportacoes })));
const TelaNovaImportacao = lazy(() => import('./features/importacao/TelaNovaImportacao').then((m) => ({ default: m.TelaNovaImportacao })));
const TelaImportacao = lazy(() => import('./features/importacao/TelaImportacao').then((m) => ({ default: m.TelaImportacao })));
const TelaHistorico = lazy(() => import('./features/movimentos/TelaHistorico').then((m) => ({ default: m.TelaHistorico })));
const TelaClaims = lazy(() => import('./features/claims/TelaClaims').then((m) => ({ default: m.TelaClaims })));
const TelaClaim = lazy(() => import('./features/claims/TelaClaim').then((m) => ({ default: m.TelaClaim })));
const TelaFormularioClaim = lazy(() => import('./features/claims/TelaFormularioClaim').then((m) => ({ default: m.TelaFormularioClaim })));
const TelaJanelas = lazy(() => import('./features/janelas/TelaJanelas').then((m) => ({ default: m.TelaJanelas })));
const TelaJanela = lazy(() => import('./features/janelas/TelaJanela').then((m) => ({ default: m.TelaJanela })));
const TelaFormularioJanela = lazy(() => import('./features/janelas/TelaFormularioJanela').then((m) => ({ default: m.TelaFormularioJanela })));
const TelaReserva = lazy(() => import('./features/janelas/TelaReserva').then((m) => ({ default: m.TelaReserva })));
const TelaAplicativo = lazy(() => import('./pwa/TelaAplicativo').then((m) => ({ default: m.TelaAplicativo })));
const TelaExpedicao = lazy(() => import('./features/janelas/TelaExpedicao').then((m) => ({ default: m.TelaExpedicao })));
// Etapa 10: ajuda, tutorial, indicadores, relatórios e retirada de palete vazio.
const TelaAjuda = lazy(() => import('./features/ajuda/TelaAjuda').then((m) => ({ default: m.TelaAjuda })));
const Tutorial = lazy(() => import('./features/ajuda/Tutorial').then((m) => ({ default: m.Tutorial })));
const TelaIndicadores = lazy(() => import('./features/indicadores/TelaIndicadores').then((m) => ({ default: m.TelaIndicadores })));
const TelaPlanilha = lazy(() => import('./features/planilha/TelaPlanilha').then((m) => ({ default: m.TelaPlanilha })));
const TelaRelatorios = lazy(() => import('./features/indicadores/TelaRelatorios').then((m) => ({ default: m.TelaRelatorios })));
const TelaRetirarVazio = lazy(() => import('./features/movimentos/TelaRetirarVazio').then((m) => ({ default: m.TelaRetirarVazio })));
const TelaBipagem = lazy(() => import('./features/paletes/TelaBipagem').then((m) => ({ default: m.TelaBipagem })));
// Complemento: seleção do cliente, conciliação e inventários de referência.
const TelaSelecoes = lazy(() => import('./features/selecao/TelaSelecoes').then((m) => ({ default: m.TelaSelecoes })));
const TelaSelecao = lazy(() => import('./features/selecao/TelaSelecao').then((m) => ({ default: m.TelaSelecao })));
const TelaValidacao = lazy(() => import('./features/conteudos/TelaValidacao').then((m) => ({ default: m.TelaValidacao })));
const TelaInventarios = lazy(() => import('./features/selecao/TelaInventarios').then((m) => ({ default: m.TelaInventarios })));
const TelaInventario = lazy(() => import('./features/selecao/TelaInventario').then((m) => ({ default: m.TelaInventario })));
// Painéis: operação DHL (interno), volumes da janela e painel do cliente (projeção permitida).
const TelaPainelOperacao = lazy(() => import('./features/paineis/TelaPainelOperacao').then((m) => ({ default: m.TelaPainelOperacao })));
const TelaPainelEstoque = lazy(() => import('./features/paineis/TelaPainelEstoque').then((m) => ({ default: m.TelaPainelEstoque })));
const TelaVolumesJanela = lazy(() => import('./features/paineis/TelaVolumesJanela').then((m) => ({ default: m.TelaVolumesJanela })));
const TelaPainelCliente = lazy(() => import('./features/paineis/TelaPainelCliente').then((m) => ({ default: m.TelaPainelCliente })));
// "Seleção cliente — teste": carregada só por quem tem a concessão.
const TelaSelecaoTeste = lazy(() => import('./features/selecao-teste/TelaSelecaoTeste').then((m) => ({ default: m.TelaSelecaoTeste })));
const TelaSolicitacoesTeste = lazy(() => import('./features/selecao-teste/TelaSolicitacoesTeste').then((m) => ({ default: m.TelaSolicitacoesTeste })));
const TelaSolicitacaoTeste = lazy(() => import('./features/selecao-teste/TelaSolicitacaoTeste').then((m) => ({ default: m.TelaSolicitacaoTeste })));

const URL_PRACA = `${API_PREFIXO}/praca`;

/**
 * Parte da interface que não carregou (etapa 09): versão nova publicada
 * enquanto esta aba estava aberta, ou falta de conexão. Não recarrega
 * sozinha; "Atualizar" confere antes o que está pendente.
 */
class FalhaDeCarregamento extends Component<{ children: ReactNode; chave: string }, { erro: boolean; chave: string }> {
  override state = { erro: false, chave: this.props.chave };
  static getDerivedStateFromError() {
    return { erro: true };
  }
  static getDerivedStateFromProps(props: { chave: string }, state: { erro: boolean; chave: string }) {
    return props.chave === state.chave ? null : { erro: false, chave: props.chave };
  }
  override render() {
    if (!this.state.erro) return this.props.children;
    return (
      <main className="principal principal--estado">
        <div className="estado-erro estado-tela" role="alert" data-testid="falha-carregamento">
          <h2>Esta parte do aplicativo não carregou</h2>
          <p>Pode ser uma versão nova publicada no servidor ou falta de conexão. O que já foi confirmado está no servidor; nada foi enviado agora.</p>
          <button
            type="button"
            className="botao-primario"
            onClick={() => {
              void atualizarAgora().then((r) => {
                if (!r.ok) window.alert(`Resolva antes de atualizar: ${r.motivos.join(' ')}`);
              });
            }}
          >
            Atualizar
          </button>
        </div>
      </main>
    );
  }
}
/** Abaixo desta largura a interface se reorganiza para celular (abas e detalhe em tela própria). */
const CONSULTA_COMPACTA = '(max-width: 1023.98px)';

/**
 * Mantém o mesmo objeto de layout enquanto id e revisão não mudam: recarregar
 * a ocupação (por exemplo, depois de um cadastro) não recria o mapa nem perde
 * a câmera.
 */
function estabilizar(anterior: Praca | null, nova: Praca): Praca {
  const a = anterior?.layout ?? null;
  const n = nova.layout;
  if (a === null || n === null) return nova;
  // "Palete livre" muda sem nova revisão do layout: com outra marcação, o layout novo segue (o mapa atualiza as posições sem se recriar).
  const livres = (l: NonNullable<Praca['layout']>) => l.positions.map((p) => `${p.id}:${p.freeConfirmed?.at ?? ''}`).join(',');
  return a.id === n.id && a.revision === n.revision && livres(a) === livres(n) ? { ...nova, layout: a } : nova;
}

interface PropsPraca {
  compacto: boolean;
  versao: number;
  paleteRota: string | null;
  sessao: Sessao;
  aoNavegar: Navegar;
  aoTrocarEscopo: (escopoId: string) => Promise<string | null>;
}

function ConteudoPraca({ compacto, versao, paleteRota, sessao, aoNavegar, aoTrocarEscopo }: PropsPraca) {
  const { carga, recarregar } = useRecurso(URL_PRACA, PracaSchema, versao);
  const [ultima, setUltima] = useState<{ fonte: Praca; praca: Praca } | null>(null);
  // Prazo de reconferência (20 dias, calculado no servidor): consulta de novo a cada minuto com a tela visível,
  // ao voltar à aba e ao focar a janela, para o palete mudar de cor quando o prazo vence (sem recarregar a página).
  useEffect(() => {
    const atualizar = () => {
      if (document.visibilityState === 'visible') recarregar();
    };
    const relogio = window.setInterval(atualizar, 60_000);
    document.addEventListener('visibilitychange', atualizar);
    window.addEventListener('focus', atualizar);
    return () => {
      window.clearInterval(relogio);
      document.removeEventListener('visibilitychange', atualizar);
      window.removeEventListener('focus', atualizar);
    };
  }, [recarregar]);
  if (carga?.estado === 'pronto' && carga.dados !== ultima?.fonte) {
    setUltima({ fonte: carga.dados, praca: estabilizar(ultima?.praca ?? null, carga.dados) });
  }
  if (ultima === null) return <EstadoTela carga={carga} titulo="Não foi possível carregar a praça" aoTentarNovamente={recarregar} />;
  return (
    <TelaPraca
      praca={ultima.praca}
      compacto={compacto}
      paleteRota={paleteRota}
      permissoes={sessao.permissions}
      falhaAtualizacao={carga?.estado === 'erro' ? carga.mensagem : null}
      aoRepetirAtualizacao={recarregar}
      aoNavegar={aoNavegar}
      aoTrocarEscopo={aoTrocarEscopo}
      chaveMemoria={`${sessao.user.id}:${sessao.activeScope?.id ?? ''}`}
      versaoDados={versao}
    />
  );
}

/**
 * Área autenticada. É recriada quando muda o usuário ou o escopo ativo, para
 * que nenhum dado de outro escopo permaneça na memória da interface.
 */
function AreaAutenticada({
  sessao,
  acoes,
  compacto,
  rota,
  navegar,
}: {
  sessao: Sessao;
  acoes: AcoesSessao;
  compacto: boolean;
  rota: Rota;
  navegar: Navegar;
}) {
  // Aumenta depois de cada gravação confirmada: mapa e lista consultam de novo a API.
  const [versaoDados, setVersaoDados] = useState(0);
  const dadosAlterados = useCallback(() => {
    setVersaoDados((v) => v + 1);
  }, []);
  const pode = (p: Permissao) => sessao.permissions.includes(p);
  // Redesign: menu lateral no computador; no celular a navegação continua no menu da conta.
  const barraLateral = !compacto && sessao.activeScope !== null;
  // Acesso do cliente (só o painel do cliente): a página inicial é o painel, não o mapa.
  const soCliente = !pode('praca.consultar') && pode('painel.cliente');
  const naPraca = (rota.tipo === 'praca' || rota.tipo === 'palete') && !soCliente;
  const voltarAoMapa = () => {
    navegar({ tipo: 'praca' });
  };
  // Palete aberto a partir de um claim: o retorno ao caso (linha e candidatos) fica disponível no mapa.
  const [retornoClaim, setRetornoClaim] = useState<ContextoClaim | null>(null);
  const contextoRota = rota.tipo === 'palete' ? (rota.claim ?? null) : null;
  if (contextoRota !== null && (retornoClaim?.id !== contextoRota.id || retornoClaim.linha !== contextoRota.linha)) setRetornoClaim(contextoRota);
  if (retornoClaim !== null && (rota.tipo === 'claim' || rota.tipo === 'claims')) setRetornoClaim(null);
  // Palete aberto a partir da lista de preparação: o retorno à reserva fica disponível no mapa.
  const [retornoReserva, setRetornoReserva] = useState<string | null>(null);
  const reservaRota = rota.tipo === 'palete' ? (rota.reserva ?? null) : null;
  if (reservaRota !== null && retornoReserva !== reservaRota) setRetornoReserva(reservaRota);
  if (retornoReserva !== null && rota.tipo === 'reserva') setRetornoReserva(null);
  // Ajuda e tutorial (etapa 10): preferência do usuário, contexto dos guias e tutorial ativo.
  const usuarioId = sessao.user.id;
  useEffect(() => {
    void carregarPreferencia(usuarioId);
  }, [usuarioId]);
  const tutorial = useTutorial();
  const contextoAjuda = useMemo<ContextoAjuda>(
    () => ({
      usuarioId,
      permissoes: sessao.permissions,
      perfil: sessao.role ? ROTULOS_PERFIL[sessao.role] : null,
      escopo: sessao.activeScope?.name ?? '',
      demo: sessao.activeScope?.demo ?? false,
      navegar,
    }),
    [usuarioId, sessao.permissions, sessao.role, sessao.activeScope, navegar],
  );
  const comecarTutorial = () => {
    iniciarTutorial(usuarioId);
    navegar({ tipo: 'praca' });
  };
  const importacaoConsulta = tiposImportacaoPermitidos(sessao.permissions, 'consultar').length > 0;
  // A bipagem começa pelo palete (não pela tela genérica de nova importação).
  const importacaoExecucao = tiposImportacaoPermitidos(sessao.permissions, 'executar').some((t) => TIPOS_IMPORTACAO_GERAL.includes(t));

  let conteudo;
  if (sessao.activeScope === null) {
    conteudo = (
      <main className="principal principal--estado">
        <div className="estado-vazio estado-tela" data-testid="sem-escopo">
          <h2>Sem unidade/cliente ativo</h2>
          <p>
            {sessao.scopes.length === 0
              ? 'Sua conta não tem acesso ativo a nenhuma unidade/cliente. Fale com o administrador.'
              : 'Seu acesso ao escopo anterior foi removido. Escolha outra unidade/cliente no menu da conta.'}
          </p>
        </div>
      </main>
    );
  } else if (rota.tipo === 'aplicativo') {
    conteudo = <TelaAplicativo aoVoltar={voltarAoMapa} />;
  } else if (rota.tipo === 'ajuda') {
    conteudo = <TelaAjuda guia={rota.guia} />;
  } else if (rota.tipo === 'indicadores') {
    conteudo = pode('praca.consultar') ? (
      <TelaIndicadores inicio={rota.inicio} fim={rota.fim} aba={rota.aba ?? null} permissoes={sessao.permissions} aoNavegar={navegar} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'relatorios') {
    conteudo =
      pode('palete.consultar') || pode('claim.consultar') || pode('janela.consultar') ? (
        <TelaRelatorios parametros={rota.parametros} permissoes={sessao.permissions} aoNavegar={navegar} />
      ) : (
        <SemPermissao aoVoltar={voltarAoMapa} />
      );
  } else if (rota.tipo === 'planilha') {
    conteudo = pode('praca.consultar') ? <TelaPlanilha aoVoltar={voltarAoMapa} /> : <SemPermissao aoVoltar={voltarAoMapa} />;
  } else if (rota.tipo === 'bipagem-escolher') {
    conteudo = pode('palete.cadastrar') ? <TelaBipagem key="mapa" paleteId={null} sessao={sessao} aoNavegar={navegar} aoGravar={dadosAlterados} /> : <SemPermissao aoVoltar={voltarAoMapa} />;
  } else if (rota.tipo === 'bipagem') {
    conteudo = pode('palete.cadastrar') ? (
      <TelaBipagem key={rota.id} paleteId={rota.id} sessao={sessao} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'retirar') {
    conteudo = pode('movimento.registrar') ? (
      <TelaRetirarVazio key={rota.id} id={rota.id} sessao={sessao} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'acesso') {
    conteudo = pode('acesso.administrar') ? <TelaAcesso sessao={sessao} aoVoltar={voltarAoMapa} /> : <SemPermissao aoVoltar={voltarAoMapa} />;
  } else if (rota.tipo === 'novo-palete') {
    conteudo = pode('palete.cadastrar') ? (
      <TelaNovoPalete key={rota.posicao ?? ''} sessao={sessao} posicaoInicial={rota.posicao ?? null} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'novo-conteudo') {
    // Cadastro de conteúdo (out. 2026): substitui o "Novo produto" e o catálogo de SKU (endereços antigos levam para cá).
    conteudo = pode('palete.cadastrar') ? (
      <TelaRegistrarConteudo key={rota.palete ?? ''} sessao={sessao} paleteInicial={rota.palete ?? null} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'volumes') {
    conteudo = pode('palete.consultar') ? (
      <TelaConferenciaVolumes key={rota.id} id={rota.id} permissoes={sessao.permissions} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'importacoes') {
    conteudo = importacaoConsulta ? (
      <TelaImportacoes permissoes={sessao.permissions} aoNavegar={navegar} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'nova-importacao') {
    conteudo = importacaoExecucao ? <TelaNovaImportacao permissoes={sessao.permissions} inicial={rota.importar} aoNavegar={navegar} /> : <SemPermissao aoVoltar={voltarAoMapa} />;
  } else if (rota.tipo === 'selecoes') {
    conteudo = pode('selecao.consultar') ? <TelaSelecoes permissoes={sessao.permissions} aoNavegar={navegar} /> : <SemPermissao aoVoltar={voltarAoMapa} />;
  } else if (rota.tipo === 'selecao') {
    conteudo = pode('selecao.consultar') ? (
      <TelaSelecao key={rota.id} id={rota.id} situacao={rota.situacao} permissoes={sessao.permissions} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'validacao') {
    conteudo = pode('validacao.consultar') ? <TelaValidacao podeResolver={pode('conteudo.corrigir')} aoNavegar={navegar} aoGravar={dadosAlterados} /> : <SemPermissao aoVoltar={voltarAoMapa} />;
  } else if (rota.tipo === 'inventarios') {
    conteudo =
      pode('selecao.consultar') || pode('importacao.consultar') ? <TelaInventarios permissoes={sessao.permissions} aoNavegar={navegar} /> : <SemPermissao aoVoltar={voltarAoMapa} />;
  } else if (rota.tipo === 'inventario') {
    conteudo =
      pode('selecao.consultar') || pode('importacao.consultar') ? (
        <TelaInventario key={rota.id} id={rota.id} permissoes={sessao.permissions} aoNavegar={navegar} aoGravar={dadosAlterados} />
      ) : (
        <SemPermissao aoVoltar={voltarAoMapa} />
      );
  } else if (rota.tipo === 'importacao') {
    conteudo = importacaoConsulta ? (
      <TelaImportacao key={rota.id} id={rota.id} permissoes={sessao.permissions} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'claims') {
    conteudo = pode('claim.consultar') ? (
      <TelaClaims permissoes={sessao.permissions} chaveMemoria={`${sessao.user.id}:${sessao.activeScope.id}`} aoNavegar={navegar} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'novo-claim' || rota.tipo === 'editar-claim') {
    conteudo = pode('claim.tratar') ? (
      <TelaFormularioClaim key={rota.tipo === 'editar-claim' ? rota.id : 'novo'} id={rota.tipo === 'editar-claim' ? rota.id : null} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'claim') {
    conteudo = pode('claim.consultar') ? (
      <TelaClaim key={rota.id} id={rota.id} linha={rota.linha} aba={rota.aba} permissoes={sessao.permissions} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'janelas') {
    conteudo = pode('janela.consultar') ? <TelaJanelas mes={rota.mes} permissoes={sessao.permissions} aoNavegar={navegar} /> : <SemPermissao aoVoltar={voltarAoMapa} />;
  } else if (rota.tipo === 'nova-janela' || rota.tipo === 'editar-janela') {
    conteudo = pode('janela.gerenciar') ? (
      <TelaFormularioJanela key={rota.tipo === 'editar-janela' ? rota.id : 'nova'} id={rota.tipo === 'editar-janela' ? rota.id : null} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'janela') {
    conteudo = pode('janela.consultar') ? (
      <TelaJanela key={rota.id} id={rota.id} aba={rota.aba} permissoes={sessao.permissions} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'reserva') {
    conteudo = pode('janela.consultar') ? (
      <TelaReserva key={rota.id} id={rota.id} permissoes={sessao.permissions} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'expedicao') {
    conteudo = pode('janela.consultar') ? (
      <TelaExpedicao key={rota.id} id={rota.id} permissoes={sessao.permissions} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'layout') {
    conteudo = pode('praca.consultar') ? (
      <TelaLayout podeConfigurar={pode('layout.configurar')} demo={sessao.activeScope.demo} aoVoltar={voltarAoMapa} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'conferencia') {
    conteudo = pode('palete.consultar') ? (
      <TelaConferencia key={rota.id} id={rota.id} sessao={sessao} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'mover' || rota.tipo === 'transferir') {
    const Tela = rota.tipo === 'mover' ? TelaMover : TelaTransferir;
    conteudo = pode('movimento.registrar') ? (
      <Tela key={`${rota.tipo}:${rota.id}`} id={rota.id} sessao={sessao} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'historico') {
    conteudo = pode('palete.consultar') ? (
      <TelaHistorico key={rota.id} id={rota.id} sessao={sessao} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'painel') {
    conteudo = pode('painel.operacao') ? <TelaPainelOperacao parametros={rota.parametros} permissoes={sessao.permissions} aoNavegar={navegar} /> : <SemPermissao aoVoltar={voltarAoMapa} />;
  } else if (rota.tipo === 'painel-estoque') {
    conteudo = pode('painel.operacao') ? <TelaPainelEstoque parametros={rota.parametros} aoNavegar={navegar} /> : <SemPermissao aoVoltar={voltarAoMapa} />;
  } else if (rota.tipo === 'painel-janela') {
    conteudo = pode('painel.operacao') ? (
      <TelaVolumesJanela key={rota.id} id={rota.id} permissoes={sessao.permissions} aoNavegar={navegar} aoGravar={dadosAlterados} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'painel-cliente' || (soCliente && (rota.tipo === 'praca' || rota.tipo === 'palete' || rota.tipo === 'desconhecida'))) {
    conteudo = pode('painel.cliente') ? (
      <TelaPainelCliente parametros={rota.tipo === 'painel-cliente' ? rota.parametros : ''} aoNavegar={navegar} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'selecao-teste') {
    conteudo = pode('selecao_teste.solicitar') ? (
      <TelaSelecaoTeste solicitacaoId={rota.solicitacao} podeVerMapa={pode('praca.consultar')} aoNavegar={navegar} />
    ) : (
      <SemPermissao aoVoltar={voltarAoMapa} />
    );
  } else if (rota.tipo === 'selecao-teste-solicitacoes') {
    conteudo = pode('selecao_teste.solicitar') || pode('selecao_teste.responder') ? <TelaSolicitacoesTeste aoNavegar={navegar} /> : <SemPermissao aoVoltar={voltarAoMapa} />;
  } else if (rota.tipo === 'selecao-teste-solicitacao') {
    conteudo =
      pode('selecao_teste.solicitar') || pode('selecao_teste.responder') ? <TelaSolicitacaoTeste key={rota.id} id={rota.id} aoNavegar={navegar} /> : <SemPermissao aoVoltar={voltarAoMapa} />;
  } else if (rota.tipo === 'etiquetas') {
    conteudo = pode('etiqueta.imprimir') ? <TelaEtiquetas ids={rota.ids} aoVoltar={voltarAoMapa} /> : <SemPermissao aoVoltar={voltarAoMapa} />;
  } else {
    conteudo = (
      <ConteudoPraca
        compacto={compacto}
        versao={versaoDados}
        paleteRota={rota.tipo === 'palete' ? rota.id : null}
        sessao={sessao}
        aoNavegar={navegar}
        aoTrocarEscopo={acoes.trocarEscopo}
      />
    );
  }

  return (
    <ContextoAjudaReact value={contextoAjuda}>
      {barraLateral && <NavegacaoPrincipal sessao={sessao} rota={rota} aoNavegar={navegar} />}
      <div className="app-coluna">
      <Cabecalho
        sessao={sessao}
        rota={rota}
        barraLateral={barraLateral}
        secao={sessao.activeScope === null ? null : secaoDaRota(soCliente && (rota.tipo === 'praca' || rota.tipo === 'palete') ? { tipo: 'painel-cliente', parametros: '' } : rota)}
        pesquisa={!compacto && naPraca}
        acaoPrincipal={
          naPraca && pode('palete.cadastrar') ? (
            <button
              type="button"
              className="botao-primario topo-acao"
              onClick={() => {
                navegar({ tipo: 'novo-palete' });
              }}
              data-testid="acao-receber-palete"
            >
              <IconeCaixa />
              Receber palete
            </button>
          ) : null
        }
        aoNavegar={navegar}
        aoTrocarEscopo={acoes.trocarEscopo}
        aoSair={() => {
          encerrarTutorial();
          void acoes.sair();
        }}
      />
      {sessao.activeScope !== null && naPraca && <OfertaTutorial usuarioId={usuarioId} aoComecar={comecarTutorial} />}
      <AvisoConexao />
      <AvisosAplicativo autenticado />
      {retornoClaim !== null && (rota.tipo === 'palete' || rota.tipo === 'praca') && (
        <div className="retorno-claim" role="note" data-testid="retorno-claim">
          <span>Palete aberto a partir de um claim.</span>
          <button
            type="button"
            className="botao-primario botao-compacto"
            onClick={() => {
              navegar({ tipo: 'claim', id: retornoClaim.id, linha: retornoClaim.linha, aba: 'candidatos' });
            }}
            data-testid="voltar-ao-claim"
          >
            Voltar ao claim
          </button>
          <button
            type="button"
            className="botao-link"
            onClick={() => {
              setRetornoClaim(null);
            }}
          >
            Dispensar
          </button>
        </div>
      )}
      {retornoReserva !== null && (rota.tipo === 'palete' || rota.tipo === 'praca') && (
        <div className="retorno-claim" role="note" data-testid="retorno-reserva">
          <span>Palete aberto a partir da lista de preparação.</span>
          <button
            type="button"
            className="botao-primario botao-compacto"
            onClick={() => {
              navegar({ tipo: 'reserva', id: retornoReserva });
            }}
            data-testid="voltar-a-preparacao"
          >
            Voltar à preparação
          </button>
          <button
            type="button"
            className="botao-link"
            onClick={() => {
              setRetornoReserva(null);
            }}
          >
            Dispensar
          </button>
        </div>
      )}
      <FalhaDeCarregamento chave={caminhoDe(rota)}>
        <Suspense fallback={<EstadoTela carga={{ estado: 'carregando' }} titulo="" aoTentarNovamente={voltarAoMapa} />}>{conteudo}</Suspense>
      </FalhaDeCarregamento>
      </div>
      {tutorial.ativo && tutorial.usuarioId === usuarioId && sessao.activeScope !== null && (
        <Suspense fallback={null}>
          <Tutorial
            usuarioId={usuarioId}
            passo={tutorial.passo}
            rota={rota}
            compacto={compacto}
            demo={sessao.activeScope.demo}
            escopo={sessao.activeScope.name}
            perfil={sessao.role ? ROTULOS_PERFIL[sessao.role] : null}
            permissoes={sessao.permissions}
            navegar={navegar}
          />
        </Suspense>
      )}
    </ContextoAjudaReact>
  );
}

/** Caminho para onde a barra de endereços deve ir agora, ou `null`. */
function redirecionamento(estado: ReturnType<typeof useSessao>[0], rota: Rota): string | null {
  // Depois do login, /entrar leva ao destino pedido, validado.
  if (estado.estado === 'autenticado' && rota.tipo === 'entrar') return destinoSeguro(rota.retorno);
  // Sem sessão, páginas privadas viram /entrar?retorno=<caminho>, sem expor dados.
  if (estado.estado === 'anonimo' && rota.tipo !== 'entrar' && rota.tipo !== 'praca' && rota.tipo !== 'desconhecida' && rota.tipo !== 'aplicativo') {
    return caminhoDe({ tipo: 'entrar', retorno: caminhoDe(rota) });
  }
  return null;
}

export function App() {
  const compacto = useMediaQuery(CONSULTA_COMPACTA);
  const { rede } = useConexao();
  const [estado, acoes] = useSessao();
  const [rota, navegar] = useRota();
  const destino = redirecionamento(estado, rota);

  // Operações em confirmação: visíveis só para o usuário e o escopo em que foram enviadas.
  const politica = useVersao().servidor?.localDrafts ?? null;
  const usuarioId = estado.estado === 'autenticado' ? estado.sessao.user.id : null;
  const escopoId = estado.estado === 'autenticado' ? (estado.sessao.activeScope?.id ?? null) : null;
  useEffect(() => {
    definirContexto(usuarioId !== null && escopoId !== null ? { usuarioId, escopoId } : null, politica);
  }, [usuarioId, escopoId, politica]);

  useEffect(() => {
    if (destino === null) return;
    const url = new URL(destino, window.location.origin);
    navegar(lerRota(url.pathname, url.search), { substituir: true });
  }, [destino, navegar]);

  if (destino !== null) return null;

  if (estado.estado === 'autenticado') {
    const { sessao } = estado;
    return (
      <div className="app" data-layout={compacto ? 'compacto' : 'largo'}>
        <AreaAutenticada
          key={`${sessao.user.id}:${sessao.activeScope?.id ?? 'nenhum'}`}
          sessao={sessao}
          acoes={acoes}
          compacto={compacto}
          rota={rota}
          navegar={navegar}
        />
      </div>
    );
  }

  const retorno = rota.tipo === 'entrar' ? destinoSeguro(rota.retorno) : '/';

  return (
    <div className="app" data-layout={compacto ? 'compacto' : 'largo'}>
      <Cabecalho
        sessao={null}
        rota={rota}
        aoNavegar={navegar}
        aoTrocarEscopo={() => Promise.resolve(null)}
        aoSair={() => undefined}
      />
      <AvisoConexao />
      <AvisosAplicativo autenticado={false} />
      {rota.tipo === 'aplicativo' && estado.estado !== 'verificando' ? (
        <Suspense fallback={<EstadoTela carga={{ estado: 'carregando' }} titulo="" aoTentarNovamente={acoes.verificar} />}>
          <TelaAplicativo
            aoVoltar={() => {
              navegar({ tipo: 'praca' });
            }}
          />
        </Suspense>
      ) : estado.estado === 'anonimo' ? (
        <TelaLogin
          aviso={estado.aviso}
          retorno={retorno}
          aoEntrar={acoes.entrar}
          aoAbrirAplicativo={() => {
            navegar({ tipo: 'aplicativo' });
          }}
        />
      ) : estado.estado === 'erro' && estado.semResposta ? (
        <main className="principal principal--estado">
          <div className="estado-vazio estado-tela" role="alert" data-testid="tela-sem-conexao">
            <h2>{rede === 'sem-conexao' ? 'Sem conexão' : 'Servidor sem resposta'}</h2>
            <p>
              O aplicativo abriu neste aparelho, mas os dados da praça ficam no servidor e não são guardados para uso sem conexão. Não há entrada nem registro offline.
            </p>
            <button type="button" className="botao-primario" onClick={acoes.verificar}>
              Tentar novamente
            </button>
          </div>
        </main>
      ) : estado.estado === 'erro' ? (
        <EstadoTela
          carga={{ estado: 'erro', mensagem: estado.mensagem, codigo: null, status: null }}
          titulo="Não foi possível verificar a sessão"
          aoTentarNovamente={acoes.verificar}
        />
      ) : (
        <EstadoTela carga={{ estado: 'carregando' }} titulo="" aoTentarNovamente={acoes.verificar} />
      )}
    </div>
  );
}
