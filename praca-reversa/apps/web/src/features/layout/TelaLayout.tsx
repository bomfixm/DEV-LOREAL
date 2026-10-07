import {
  API_PREFIXO,
  HistoricoLayoutSchema,
  PracaSchema,
  ResultadoLayoutSchema,
  type ElementoLayout,
  type Layout,
  type Posicao,
} from '@praca-reversa/contracts';
import { useId, useMemo, useState, type SubmitEvent } from 'react';
import { ehConflitoDeVersao, useChaves } from '../../api/chaves';
import { enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { EstadoTela, MensagemAcao, Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import { formatarDataHora } from '../../utils/datas';
import { EnderecosReais } from './EnderecosReais';

const URL_PRACA = `${API_PREFIXO}/praca`;
const URL_LAYOUT = `${API_PREFIXO}/layout`;

type Mensagem = { tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null;
type Metodo = 'POST' | 'PATCH' | 'PUT';

const ROTULO_TIPO: Record<ElementoLayout['kind'], string> = { ZONA: 'Zona', BLOCO: 'Bloco', CORREDOR: 'Corredor', DOCA: 'Doca' };

const inteiro = (texto: string) => (texto.trim() === '' ? 0 : Number.parseInt(texto, 10));

interface Props {
  podeConfigurar: boolean;
  demo: boolean;
  aoVoltar: () => void;
  aoGravar: () => void;
}

/**
 * Configuração do layout: blocos de fileiras, zonas e posições, com revisão,
 * histórico e proteção contra alteração desatualizada. Geometria separada da
 * ocupação: nada aqui muda o vínculo de um palete.
 */
export function TelaLayout({ podeConfigurar, demo, aoVoltar, aoGravar }: Props) {
  const ids = useId();
  const conectado = useConectado();
  const chaves = useChaves();
  const [versao, setVersao] = useState(0);
  const praca = useRecurso(URL_PRACA, PracaSchema, versao);
  const historico = useRecurso(`${URL_LAYOUT}/historico?limite=50`, HistoricoLayoutSchema, versao);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [ocupado, setOcupado] = useState(false);

  async function executar(metodo: Metodo, url: string, corpo: object): Promise<boolean> {
    if (ocupado) return false;
    const assinatura = `${metodo}:${url}:${JSON.stringify(corpo)}`;
    setOcupado(true);
    setMensagem(null);
    try {
      const resultado = await enviarJson(metodo, url, ResultadoLayoutSchema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      setMensagem({ tipo: 'ok', texto: `Revisão ${String(resultado.revision)}: ${resultado.summary}` });
      setVersao((v) => v + 1);
      aoGravar();
      return true;
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      setMensagem({ tipo: ehConflitoDeVersao(erro) ? 'conflito' : 'erro', texto: mensagemDeFalha(erro) });
      if (ehConflitoDeVersao(erro)) setVersao((v) => v + 1);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  if (praca.carga?.estado !== 'pronto') {
    return <EstadoTela carga={praca.carga} titulo="Não foi possível carregar o layout" aoTentarNovamente={praca.recarregar} />;
  }
  const { layout, pallets } = praca.carga.dados;
  const configura = podeConfigurar && conectado;

  return (
    <Pagina
      titulo="Layout da praça"
      testId="tela-layout"
      aoVoltar={aoVoltar}
      descricao={
        <p>
          Medidas em unidades de desenho, sem escala física. Códigos <code>F01-P01</code> são provisórios até o endereçamento oficial. Uma posição
          desenhada não comprova ocupação.
        </p>
      }
    >
      <MensagemAcao mensagem={mensagem} testId="mensagem-layout" />
      {layout === null ? (
        <SemLayout
          podeConfigurar={configura}
          ocupado={ocupado}
          aoCriar={(nome) => executar('POST', URL_LAYOUT, { name: nome })}
          aoCriarDesenho={() => executar('POST', `${URL_LAYOUT}/desenho-aprovado`, {})}
        />
      ) : (
        <>
          <ResumoLayout layout={layout} />
          <EnderecosReais versao={versao} podeConfigurar={configura} ocupado={ocupado} executar={executar} />
          {configura && <NovoBloco layout={layout} ocupado={ocupado} aoEnviar={(corpo) => executar('POST', `${URL_LAYOUT}/blocos`, corpo)} />}
          <Elementos
            layout={layout}
            ocupados={pallets.flatMap((p) => (p.positionId === null ? [] : [p.positionId]))}
            podeConfigurar={configura}
            ocupado={ocupado}
            aoAlterar={(codigo, corpo) => executar('PATCH', `${URL_LAYOUT}/elementos/${encodeURIComponent(codigo)}`, corpo)}
          />
          {configura && (
            <NovaZona layout={layout} demo={demo} ocupado={ocupado} aoEnviar={(corpo) => executar('POST', `${URL_LAYOUT}/zonas`, corpo)} />
          )}
          <Posicoes
            layout={layout}
            ocupantes={new Map(pallets.flatMap((p) => (p.positionId === null ? [] : [[p.positionId, p.code] as const])))}
            podeConfigurar={configura}
            ocupado={ocupado}
            aoAlterar={(id, corpo) => executar('PATCH', `${URL_LAYOUT}/posicoes/${id}`, corpo)}
            aoRetirar={(id, corpo) => executar('POST', `${URL_LAYOUT}/posicoes/${id}/retirar`, corpo)}
          />
        </>
      )}
      <section className="cartao" aria-labelledby={`${ids}-historico`}>
        <h3 id={`${ids}-historico`}>Histórico de alterações</h3>
        {historico.carga?.estado === 'pronto' ? (
          historico.carga.dados.items.length === 0 ? (
            <p className="sem-itens">Nenhuma alteração registrada: o layout está na revisão inicial.</p>
          ) : (
            <ol className="lista-auditoria" data-testid="historico-layout">
              {historico.carga.dados.items.map((h) => (
                <li key={h.revision}>
                  <span className="auditoria-acao">Revisão {h.revision}</span>
                  <time dateTime={h.at}>{formatarDataHora(h.at)}</time>
                  <span>{h.actor ? h.actor.name : 'sistema'}</span>
                  <span>{h.summary}</span>
                </li>
              ))}
            </ol>
          )
        ) : historico.carga?.estado === 'erro' ? (
          <p className="estado-erro">{historico.carga.mensagem}</p>
        ) : (
          <p className="estado-carregando">Carregando histórico…</p>
        )}
      </section>
    </Pagina>
  );
}

function SemLayout({
  podeConfigurar,
  ocupado,
  aoCriar,
  aoCriarDesenho,
}: {
  podeConfigurar: boolean;
  ocupado: boolean;
  aoCriar: (nome: string) => Promise<boolean>;
  aoCriarDesenho: () => Promise<boolean>;
}) {
  const [nome, setNome] = useState('Praça (esquema a confirmar)');
  return (
    <section className="cartao" data-testid="sem-layout-config">
      <h3>Nenhum layout ativo neste escopo</h3>
      {podeConfigurar ? (
        <form
          className="formulario-coluna"
          onSubmit={(e) => {
            e.preventDefault();
            void aoCriar(nome);
          }}
        >
          <p className="bloco-nota">O layout começa vazio; depois acrescente os blocos de fileiras na ordem da praça (início → outro extremo).</p>
          <label className="campo">
            <span className="campo-rotulo">Nome do layout</span>
            <input value={nome} maxLength={120} onChange={(e) => { setNome(e.target.value); }} />
          </label>
          <button type="submit" className="botao-primario" disabled={ocupado || nome.trim().length < 2}>
            Criar layout
          </button>
          <p className="bloco-nota">
            Ou crie a partir do desenho aprovado (PDF de referência): 194 posições ativas nas Fileiras 11–16 e GR e 300 desativadas, prontas para ativar. Endereços reais e
            ocupação continuam a confirmar.
          </p>
          <button type="button" className="botao-secundario" disabled={ocupado} onClick={() => { void aoCriarDesenho(); }} data-testid="criar-desenho-aprovado">
            Criar do desenho aprovado
          </button>
        </form>
      ) : (
        <p>Peça ao supervisor de estoque a configuração do layout.</p>
      )}
    </section>
  );
}

function ResumoLayout({ layout }: { layout: Layout }) {
  return (
    <section className="cartao" data-testid="resumo-layout">
      <h3>{layout.name}</h3>
      <dl className="situacao">
        <div>
          <dt>Esquema</dt>
          <dd>{layout.version}</dd>
        </div>
        <div>
          <dt>Revisão</dt>
          <dd data-testid="revisao-layout">{layout.revision}</dd>
        </div>
        <div>
          <dt>Fileiras / posições desenhadas</dt>
          <dd>
            {layout.rows.length} / {layout.positions.length}
            {layout.positions.some((p) => p.deactivated)
              ? ` (${String(layout.positions.filter((p) => !p.deactivated).length)} ativas, ${String(layout.positions.filter((p) => p.deactivated).length)} desativadas)`
              : ''}
          </dd>
        </div>
        <div>
          <dt>Capacidade total</dt>
          <dd>{layout.totalCapacity === null ? 'Não confirmada (depende de levantamento)' : String(layout.totalCapacity)}</dd>
        </div>
        <div>
          <dt>Área do desenho</dt>
          <dd>
            {layout.width} × {layout.height} unidades de desenho{layout.schematic ? ' (esquemático)' : ''}
            {layout.fictional ? ' · fictício' : ''}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function NovoBloco({ layout, ocupado, aoEnviar }: { layout: Layout; ocupado: boolean; aoEnviar: (corpo: object) => Promise<boolean> }) {
  const [tipo, setTipo] = useState<'UNICA' | 'PAR'>('PAR');
  const [posicoes, setPosicoes] = useState('17');
  const [titulo, setTitulo] = useState('Par de fileiras de 17');
  function enviar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    void aoEnviar({ expectedRevision: layout.revision, kind: tipo, positionsPerRow: inteiro(posicoes), title: titulo });
  }
  return (
    <form className="cartao formulario-cadastro" onSubmit={enviar} data-testid="form-bloco" aria-label="Acrescentar bloco">
      <h3>Acrescentar bloco ao final</h3>
      <p className="bloco-nota">
        O bloco entra depois do último desenhado, com fileiras numeradas em sequência. Quantidade de pares e posições depende do levantamento:
        cadastre só o que foi confirmado.
      </p>
      <div className="formulario-grade">
        <label className="campo">
          <span className="campo-rotulo">Tipo de bloco</span>
          <select value={tipo} onChange={(e) => { setTipo(e.target.value as 'UNICA' | 'PAR'); }}>
            <option value="UNICA">Fileira única</option>
            <option value="PAR">Par de fileiras próximas</option>
          </select>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Posições por fileira</span>
          <input value={posicoes} inputMode="numeric" onChange={(e) => { setPosicoes(e.target.value); }} />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Título do bloco</span>
          <input value={titulo} maxLength={80} onChange={(e) => { setTitulo(e.target.value); }} />
        </label>
      </div>
      <button type="submit" className="botao-primario" disabled={ocupado}>
        Acrescentar bloco
      </button>
    </form>
  );
}

function Elementos({
  layout,
  ocupados,
  podeConfigurar,
  ocupado,
  aoAlterar,
}: {
  layout: Layout;
  ocupados: readonly string[];
  podeConfigurar: boolean;
  ocupado: boolean;
  aoAlterar: (codigo: string, corpo: object) => Promise<boolean>;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [rotulo, setRotulo] = useState('');
  const [dx, setDx] = useState('0');
  const [dy, setDy] = useState('0');
  const [largura, setLargura] = useState('');
  const [altura, setAltura] = useState('');
  const comOcupacao = useMemo(() => new Set(ocupados), [ocupados]);
  const elementos = layout.elements.filter((e) => e.kind === 'BLOCO' || e.kind === 'ZONA');
  return (
    <section className="cartao" aria-label="Blocos e zonas" data-testid="lista-elementos">
      <h3>Blocos e zonas</h3>
      {elementos.length === 0 && <p className="sem-itens">Nenhum bloco ou zona desenhado.</p>}
      <ul className="lista-elementos">
        {elementos.map((e) => {
          const fileiras = layout.rows.filter((f) => f.blockCode === e.code);
          const posicoes = layout.positions.filter((p) => fileiras.some((f) => f.id === p.rowId));
          const ocupadas = posicoes.filter((p) => comOcupacao.has(p.id)).length;
          return (
            <li key={e.code} className="elemento-linha" data-codigo={e.code}>
              <div>
                <strong>
                  {ROTULO_TIPO[e.kind]} {e.code}
                </strong>{' '}
                {e.label}
                {e.fictional && <span className="produto-situacao"> · fictício</span>}
                <span className="produto-situacao">
                  {' '}
                  · {fileiras.map((f) => `${f.code} (${String(posicoes.filter((p) => p.rowId === f.id).length)})`).join(', ') || 'sem fileiras'} ·{' '}
                  {ocupadas} com palete · x {e.x}, y {e.y}
                </span>
              </div>
              {podeConfigurar &&
                (editando === e.code ? (
                  <form
                    className="formulario-grade"
                    onSubmit={(evento) => {
                      evento.preventDefault();
                      const corpo = {
                        expectedRevision: layout.revision,
                        ...(rotulo !== e.label ? { label: rotulo } : {}),
                        ...(inteiro(dx) !== 0 ? { dx: inteiro(dx) } : {}),
                        ...(inteiro(dy) !== 0 ? { dy: inteiro(dy) } : {}),
                        ...(e.kind === 'ZONA' && inteiro(largura) !== e.width ? { width: inteiro(largura) } : {}),
                        ...(e.kind === 'ZONA' && inteiro(altura) !== e.height ? { height: inteiro(altura) } : {}),
                      };
                      void aoAlterar(e.code, corpo).then((ok) => {
                        if (ok) setEditando(null);
                      });
                    }}
                  >
                    <label className="campo">
                      <span className="campo-rotulo">Título</span>
                      <input value={rotulo} maxLength={80} onChange={(ev) => { setRotulo(ev.target.value); }} />
                    </label>
                    <label className="campo">
                      <span className="campo-rotulo">Deslocar x</span>
                      <input value={dx} inputMode="numeric" onChange={(ev) => { setDx(ev.target.value); }} />
                    </label>
                    <label className="campo">
                      <span className="campo-rotulo">Deslocar y</span>
                      <input value={dy} inputMode="numeric" onChange={(ev) => { setDy(ev.target.value); }} />
                    </label>
                    {e.kind === 'ZONA' && (
                      <>
                        <label className="campo">
                          <span className="campo-rotulo">Largura</span>
                          <input value={largura} inputMode="numeric" onChange={(ev) => { setLargura(ev.target.value); }} />
                        </label>
                        <label className="campo">
                          <span className="campo-rotulo">Altura</span>
                          <input value={altura} inputMode="numeric" onChange={(ev) => { setAltura(ev.target.value); }} />
                        </label>
                      </>
                    )}
                    <div className="acoes-linha">
                      <button type="submit" className="botao-primario" disabled={ocupado}>
                        Gravar {e.code}
                      </button>
                      <button type="button" className="botao-link" onClick={() => { setEditando(null); }}>
                        Cancelar
                      </button>
                    </div>
                    <p className="bloco-nota">Deslocar move o bloco com fileiras e posições; IDs e vínculos de paletes não mudam.</p>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="botao-secundario"
                    onClick={() => {
                      setEditando(e.code);
                      setRotulo(e.label);
                      setDx('0');
                      setDy('0');
                      setLargura(String(e.width));
                      setAltura(String(e.height));
                    }}
                  >
                    Editar {e.code}
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function NovaZona({ layout, demo, ocupado, aoEnviar }: { layout: Layout; demo: boolean; ocupado: boolean; aoEnviar: (corpo: object) => Promise<boolean> }) {
  const [codigo, setCodigo] = useState('Z-01');
  const [rotulo, setRotulo] = useState(demo ? 'Zona (fictícia)' : 'Zona');
  const [x, setX] = useState('0');
  const [y, setY] = useState('0');
  const [largura, setLargura] = useState(String(layout.width));
  const [altura, setAltura] = useState('40');
  return (
    <form
      className="cartao formulario-cadastro"
      aria-label="Criar zona"
      onSubmit={(e) => {
        e.preventDefault();
        void aoEnviar({
          expectedRevision: layout.revision,
          code: codigo,
          label: rotulo,
          x: inteiro(x),
          y: inteiro(y),
          width: inteiro(largura),
          height: inteiro(altura),
        });
      }}
    >
      <h3>Criar zona</h3>
      <p className="bloco-nota">
        Área identificada para orientação (ex.: triagem, acesso). Coordenadas a partir do canto superior esquerdo; área atual {layout.width} ×{' '}
        {layout.height}. O título fica na faixa superior e só aparece se não cobrir posições.
      </p>
      <div className="formulario-grade">
        <label className="campo">
          <span className="campo-rotulo">Código da zona</span>
          <input value={codigo} maxLength={16} autoCapitalize="characters" onChange={(e) => { setCodigo(e.target.value.toUpperCase()); }} />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Nome da zona</span>
          <input value={rotulo} maxLength={80} onChange={(e) => { setRotulo(e.target.value); }} />
        </label>
        <label className="campo">
          <span className="campo-rotulo">x</span>
          <input value={x} inputMode="numeric" onChange={(e) => { setX(e.target.value); }} />
        </label>
        <label className="campo">
          <span className="campo-rotulo">y</span>
          <input value={y} inputMode="numeric" onChange={(e) => { setY(e.target.value); }} />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Largura</span>
          <input value={largura} inputMode="numeric" onChange={(e) => { setLargura(e.target.value); }} />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Altura</span>
          <input value={altura} inputMode="numeric" onChange={(e) => { setAltura(e.target.value); }} />
        </label>
      </div>
      <button type="submit" className="botao-primario" disabled={ocupado}>
        Criar zona
      </button>
    </form>
  );
}

function Posicoes({
  layout,
  ocupantes,
  podeConfigurar,
  ocupado,
  aoAlterar,
  aoRetirar,
}: {
  layout: Layout;
  ocupantes: ReadonlyMap<string, string>;
  podeConfigurar: boolean;
  ocupado: boolean;
  aoAlterar: (id: string, corpo: object) => Promise<boolean>;
  aoRetirar: (id: string, corpo: object) => Promise<boolean>;
}) {
  const ids = useId();
  const [fileiraId, setFileiraId] = useState(layout.rows[0]?.id ?? '');
  const [editando, setEditando] = useState<{ posicao: Posicao; modo: 'editar' | 'retirar' } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [oficial, setOficial] = useState(false);
  const [disponivel, setDisponivel] = useState(true);
  const [motivo, setMotivo] = useState('');
  const posicoes = layout.positions.filter((p) => p.rowId === fileiraId);

  function abrir(posicao: Posicao, modo: 'editar' | 'retirar') {
    setEditando({ posicao, modo });
    setCodigo(posicao.code);
    setOficial(!posicao.provisionalCode);
    setDisponivel(posicao.available);
    setMotivo(posicao.unavailableReason ?? '');
  }

  return (
    <section className="cartao" aria-labelledby={`${ids}-titulo`} data-testid="lista-posicoes">
      <h3 id={`${ids}-titulo`}>Posições</h3>
      <label className="campo">
        <span className="campo-rotulo">Fileira</span>
        <select
          value={fileiraId}
          onChange={(e) => {
            setFileiraId(e.target.value);
            setEditando(null);
          }}
        >
          {layout.rows.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <ul className="lista-posicoes">
        {posicoes.map((p) => {
          const ocupante = ocupantes.get(p.id);
          const situacao = ocupante
            ? `palete ${ocupante}`
            : p.deactivated
              ? 'desativada · pronta para ativar'
              : !p.available
              ? `indisponível${p.unavailableReason ? `: ${p.unavailableReason}` : ''}`
              : p.occupancySurveyed
                ? 'sem palete registrado'
                : 'ocupação desconhecida';
          return (
            <li key={p.id} className="posicao-linha" data-posicao-codigo={p.code}>
              <span>
                <strong>{p.code}</strong>
                {p.provisionalCode ? ' (provisório)' : ' (oficial)'}
                {p.address ? ` · ${p.address.text}${p.address.state === 'PROPOSTO' ? ' (proposto)' : ''}` : ''} · {situacao}
              </span>
              {podeConfigurar && (
                <span className="acoes-linha">
                  <button type="button" className="botao-link" onClick={() => { abrir(p, 'editar'); }}>
                    Editar {p.code}
                  </button>
                  <button type="button" className="botao-link" onClick={() => { abrir(p, 'retirar'); }}>
                    Retirar {p.code}
                  </button>
                </span>
              )}
              {editando?.posicao.id === p.id &&
                (editando.modo === 'editar' ? (
                  <form
                    className="formulario-grade"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const corpo = {
                        expectedRevision: layout.revision,
                        ...(codigo !== p.code ? { code: codigo } : {}),
                        ...(oficial === p.provisionalCode ? { officialCode: oficial } : {}),
                        ...(disponivel !== p.available ? { available: disponivel } : {}),
                        ...(!disponivel ? { unavailableReason: motivo } : {}),
                      };
                      void aoAlterar(p.id, corpo).then((ok) => {
                        if (ok) setEditando(null);
                      });
                    }}
                  >
                    <label className="campo">
                      <span className="campo-rotulo">Código da posição</span>
                      <input value={codigo} maxLength={32} autoCapitalize="characters" onChange={(e) => { setCodigo(e.target.value.toUpperCase()); }} />
                    </label>
                    <label className="opcao">
                      <input type="checkbox" checked={oficial} onChange={(e) => { setOficial(e.target.checked); }} />
                      Código é o endereço oficial
                    </label>
                    <label className="opcao">
                      <input type="checkbox" checked={disponivel} onChange={(e) => { setDisponivel(e.target.checked); }} />
                      {p.deactivated ? 'Ativar: sair da área desativada e receber paletes' : 'Disponível para paletes'}
                    </label>
                    {!disponivel && (
                      <label className="campo">
                        <span className="campo-rotulo">Motivo da indisponibilidade</span>
                        <input value={motivo} maxLength={200} onChange={(e) => { setMotivo(e.target.value); }} />
                      </label>
                    )}
                    <div className="acoes-linha">
                      <button type="submit" className="botao-primario" disabled={ocupado}>
                        Gravar {p.code}
                      </button>
                      <button type="button" className="botao-link" onClick={() => { setEditando(null); }}>
                        Cancelar
                      </button>
                    </div>
                    {ocupante && <p className="bloco-nota">O palete {ocupante} continua vinculado pelo ID da posição se o código mudar.</p>}
                  </form>
                ) : (
                  <form
                    className="formulario-grade"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void aoRetirar(p.id, { expectedRevision: layout.revision, reason: motivo }).then((ok) => {
                        if (ok) setEditando(null);
                      });
                    }}
                  >
                    <p className="bloco-nota">Retirar tira a posição do desenho. O código não será reutilizado. Posição com palete não pode ser retirada.</p>
                    <label className="campo">
                      <span className="campo-rotulo">Motivo da retirada</span>
                      <input value={motivo} maxLength={300} onChange={(e) => { setMotivo(e.target.value); }} />
                    </label>
                    <div className="acoes-linha">
                      <button type="submit" className="botao-perigo" disabled={ocupado || motivo.trim().length < 3}>
                        Confirmar retirada de {p.code}
                      </button>
                      <button type="button" className="botao-link" onClick={() => { setEditando(null); }}>
                        Cancelar
                      </button>
                    </div>
                  </form>
                ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
