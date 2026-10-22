import { API_PREFIXO, IndicadoresSchema, type Indicadores, type Permissao } from '@praca-reversa/contracts';
import { useId, useState, type ReactNode } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar, IconeImprimir, IconeInfo } from '../../components/Icones';
import type { AbaIndicadores, Navegar } from '../../rotas';
import { FUSO_OPERACAO, formatarDataHora } from '../../utils/datas';
import { JanelaModal } from '../paletes/JanelaPalete';
import { intervaloCurto } from './dashboard-dados';
import { Metodologia, PainelClaims, PainelConferencias, PainelEstoque, PainelPraca } from './detalhes';
import { VisaoGeral } from './visao-geral';
import './indicadores.css';

interface Props {
  inicio: string | null;
  fim: string | null;
  aba: AbaIndicadores | null;
  permissoes: readonly Permissao[];
  aoNavegar: Navegar;
}

type Aba = AbaIndicadores | 'visao';

const ABAS: readonly { aba: Aba; rotulo: string; testId: string }[] = [
  { aba: 'visao', rotulo: 'Visão geral', testId: 'ind-aba-visao' },
  { aba: 'movimentacoes', rotulo: 'Praça e movimentações', testId: 'ind-aba-movimentacoes' },
  { aba: 'conferencias', rotulo: 'Conferências', testId: 'ind-aba-conferencias' },
  { aba: 'estoque', rotulo: 'Estoque e idade', testId: 'ind-aba-estoque' },
  { aba: 'claims', rotulo: 'Claims e valores', testId: 'ind-aba-claims' },
];

const formatoAtualizado = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO_OPERACAO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Última resposta da mesma consulta (mesma URL): o botão Atualizar mantém os
 * números na tela enquanto consulta de novo; um período novo nunca mostra os
 * números do período anterior (a resposta fica associada à URL que a gerou).
 */
function useConsultaIndicadores(url: string, versao: number) {
  const { carga, recarregar } = useRecurso(url, IndicadoresSchema, versao);
  const [ultimo, setUltimo] = useState<{ url: string; dados: Indicadores } | null>(null);
  if (carga?.estado === 'pronto' && ultimo?.dados !== carga.dados) setUltimo({ url, dados: carga.dados });
  const dados = ultimo !== null && ultimo.url === url ? ultimo.dados : null;
  return { dados, carga, recarregar };
}

/**
 * Indicadores (etapa 10; dashboard de 22/10/2026). Toda a área útil ao lado
 * do menu: cabeçalho compacto com período e ações, quatro indicadores,
 * módulos principais e detalhes em abas. Tudo vem do servidor numa única
 * leitura; áreas fora do perfil não são devolvidas pela API. "Sobre os
 * números" reúne base, período, regras e limites (também na impressão).
 */
export function TelaIndicadores({ inicio, fim, aba, permissoes, aoNavegar }: Props) {
  const ids = useId();
  const [versao, setVersao] = useState(0);
  const [sobre, setSobre] = useState(false);
  const consulta = new URLSearchParams();
  if (inicio) consulta.set('inicio', inicio);
  if (fim) consulta.set('fim', fim);
  const q = consulta.toString();
  const { dados: d, carga, recarregar } = useConsultaIndicadores(`${API_PREFIXO}/indicadores${q ? `?${q}` : ''}`, versao);
  const podeRelatorio = permissoes.includes('palete.consultar');
  const temClaims = d !== null && (d.claims !== null || d.valores !== null);
  const abas = ABAS.filter((a) => a.aba !== 'claims' || temClaims);
  const atual: Aba = aba === null || (aba === 'claims' && d !== null && !temClaims) ? 'visao' : aba;

  const irPara = (destino: Aba) => {
    aoNavegar({ tipo: 'indicadores', inicio, fim, ...(destino === 'visao' ? {} : { aba: destino }) }, { substituir: true });
  };
  const relatorio = (parametros: Record<string, string>) => {
    const p = new URLSearchParams(parametros);
    if (d !== null) {
      p.set('inicio', d.period.start);
      p.set('fim', d.period.end);
    }
    aoNavegar({ tipo: 'relatorios', parametros: p.toString() });
  };
  const atualizar = () => {
    setVersao((v) => v + 1);
  };
  const aplicar = (novoInicio: string, novoFim: string) => {
    // Mesmo período já aplicado: só consulta de novo; senão a URL leva o período novo (e a aba atual).
    if (d !== null && novoInicio === d.period.start && novoFim === d.period.end) atualizar();
    else aoNavegar({ tipo: 'indicadores', inicio: novoInicio || null, fim: novoFim || null, ...(aba ? { aba } : {}) });
  };
  const revalidando = d !== null && carga?.estado === 'carregando';

  let conteudo: ReactNode;
  if (d === null) {
    conteudo =
      carga?.estado === 'erro' ? (
        <div className="ind-estado ind-estado--erro" role="alert" data-testid="indicadores-erro">
          <p>
            <strong>Não foi possível calcular os indicadores.</strong> {carga.mensagem}
          </p>
          <button type="button" className="botao-secundario botao-compacto" onClick={recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      ) : (
        <p className="ind-estado" aria-busy="true" data-testid="indicadores-carregando">
          Consultando os indicadores…
        </p>
      );
  } else {
    const painel = (chave: Aba, filho: ReactNode) => (
      <div
        key={chave}
        id={`${ids}-painel-${chave}`}
        role="tabpanel"
        aria-labelledby={`${ids}-aba-${chave}`}
        className="ind-painel"
        hidden={atual !== chave}
        data-painel={chave}
      >
        <h3 className="ind-so-impressao ind-titulo-impressao">{ABAS.find((a) => a.aba === chave)?.rotulo}</h3>
        {filho}
      </div>
    );
    conteudo = (
      <div className="ind-paineis" aria-busy={revalidando}>
        {painel(
          'visao',
          <VisaoGeral
            d={d}
            podeRelatorio={podeRelatorio}
            aoRelatorio={relatorio}
            aoAbrirAba={(a) => {
              irPara(a);
            }}
          />,
        )}
        {painel('movimentacoes', <PainelPraca d={d} podeRelatorio={podeRelatorio} aoRelatorio={relatorio} aoNavegar={aoNavegar} />)}
        {painel('conferencias', <PainelConferencias d={d} podeRelatorio={podeRelatorio} aoRelatorio={relatorio} />)}
        {painel('estoque', <PainelEstoque d={d} podeRelatorio={podeRelatorio} aoRelatorio={relatorio} />)}
        {temClaims && painel('claims', <PainelClaims d={d} aoRelatorio={relatorio} />)}
        {/* Na impressão, a metodologia sai junto (na tela ela abre em "Sobre os números"). */}
        <section className="ind-so-impressao ind-metodologia-impressao" aria-hidden="true">
          <h3 className="ind-titulo-impressao">Sobre os números</h3>
          <Metodologia d={d} impressao />
        </section>
      </div>
    );
  }

  return (
    <main className="principal principal--pagina principal--indicadores" data-testid="tela-indicadores">
      <div className="ind-tela" data-testid="ind-tela">
        <h2 className="visualmente-oculto">Indicadores</h2>
        <header className="ind-topo" data-testid="indicadores-cabecalho">
          <div className="ind-contexto">
            <p className="ind-escopo">
              <strong>{d?.scope.name ?? 'Indicadores'}</strong>
              {d?.scope.demo === true && <span className="ind-selo ind-selo--demo">Demonstração · dados fictícios</span>}
            </p>
            {d !== null && (
              <p className="ind-meta">
                <span data-testid="indicadores-periodo" title={`${d.period.timezone}, início e fim inclusivos`}>
                  Período {intervaloCurto(d.period)}
                  {d.period.includesToday ? ' · inclui hoje' : ''}
                </span>
                <span>
                  Atualizado em{' '}
                  <time dateTime={d.consultedAt} title={`${formatarDataHora(d.consultedAt)} (horário de Brasília)`} data-testid="indicadores-consultado-em">
                    {formatoAtualizado.format(new Date(d.consultedAt))}
                  </time>
                  {revalidando ? ' · atualizando…' : ''}
                </span>
              </p>
            )}
          </div>
          <form
            className="ind-filtros nao-imprimir"
            aria-label="Período"
            key={d === null ? `${inicio ?? ''}-${fim ?? ''}` : `${d.period.start}-${d.period.end}`}
            onSubmit={(evento) => {
              evento.preventDefault();
              const f = new FormData(evento.currentTarget);
              const texto = (nome: string) => {
                const x = f.get(nome);
                return typeof x === 'string' ? x : '';
              };
              aplicar(texto('inicio'), texto('fim'));
            }}
          >
            <label className="ind-campo">
              <span>De</span>
              <input type="date" name="inicio" defaultValue={d?.period.start ?? inicio ?? ''} aria-label="Data inicial" data-testid="indicadores-inicio" />
            </label>
            <label className="ind-campo">
              <span>até</span>
              <input type="date" name="fim" defaultValue={d?.period.end ?? fim ?? ''} aria-label="Data final" data-testid="indicadores-fim" />
            </label>
            <button type="submit" className="botao-primario botao-compacto" data-testid="indicadores-aplicar">
              Aplicar período
            </button>
            <button
              type="button"
              className="botao-link"
              onClick={() => {
                if (inicio === null && fim === null) atualizar();
                else aoNavegar({ tipo: 'indicadores', inicio: null, fim: null, ...(aba ? { aba } : {}) });
              }}
              data-testid="indicadores-mes-atual"
            >
              Mês atual
            </button>
          </form>
          {d !== null && carga?.estado === 'erro' && (
            <p className="ind-falha" role="alert" data-testid="indicadores-falha-atualizacao">
              <strong>Falha ao atualizar:</strong> {carga.mensagem} Os números são da consulta de {formatarDataHora(d.consultedAt)}.
            </p>
          )}
        </header>

        <div className="ind-barra-abas nao-imprimir">
          <div className="ind-abas" role="tablist" aria-label="Seções dos indicadores">
            {abas.map((a) => (
              <button
                key={a.aba}
                id={`${ids}-aba-${a.aba}`}
                type="button"
                role="tab"
                aria-selected={atual === a.aba}
                aria-controls={d === null ? undefined : `${ids}-painel-${a.aba}`}
                onClick={() => {
                  irPara(a.aba);
                }}
                data-testid={a.testId}
              >
                {a.rotulo}
              </button>
            ))}
          </div>
          <div className="ind-acoes">
            <button type="button" className="botao-secundario botao-compacto" onClick={atualizar} disabled={revalidando} data-testid="indicadores-atualizar">
              <IconeAtualizar />
              Atualizar
            </button>
            <button
              type="button"
              className="botao-secundario botao-compacto"
              onClick={() => {
                window.print();
              }}
              disabled={d === null}
              data-testid="indicadores-imprimir"
            >
              <IconeImprimir />
              Imprimir
            </button>
            <button
              type="button"
              className="botao-secundario botao-compacto"
              onClick={() => {
                setSobre(true);
              }}
              disabled={d === null}
              aria-haspopup="dialog"
              data-testid="indicadores-sobre"
            >
              <IconeInfo />
              Sobre os números
            </button>
          </div>
        </div>

        {conteudo}

        {d !== null && (
          <footer className="ind-rodape">
            <span>
              Consultado em {formatarDataHora(d.consultedAt)} (horário de Brasília), numa única leitura do banco: todos os números desta tela são da mesma consulta.
            </span>
            <button
              type="button"
              className="botao-link nao-imprimir"
              onClick={() => {
                setSobre(true);
              }}
            >
              Base, período e metodologia
            </button>
          </footer>
        )}
      </div>
      {sobre && d !== null && (
        <JanelaModal
          titulo="Sobre os números"
          subtitulo={`${d.scope.name} · consulta de ${formatarDataHora(d.consultedAt)}`}
          aoFechar={() => {
            setSobre(false);
          }}
          testId="ind-sobre"
          classe="ind-sobre-fundo"
        >
          <Metodologia d={d} />
        </JanelaModal>
      )}
    </main>
  );
}
