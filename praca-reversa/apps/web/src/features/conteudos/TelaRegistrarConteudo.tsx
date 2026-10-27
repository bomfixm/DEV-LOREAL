import {
  API_PREFIXO,
  ConteudosPaleteSchema,
  NovoConteudoSchema,
  PracaSchema,
  TipoDocumentoConteudoSchema,
  type ConteudoPalete,
  type NovoConteudo,
  type Sessao,
  type TipoDocumentoConteudo,
} from '@praca-reversa/contracts';
import { useId, useMemo, useRef, useState, type SubmitEvent } from 'react';
import { useChaves } from '../../api/chaves';
import { enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { MensagemAcao, Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import type { Navegar } from '../../rotas';
import { normalizar } from '../paletes/filtro';
import { textoDocumento } from './textos';

const URL_PRACA = `${API_PREFIXO}/praca`;

interface Form {
  remetente: string;
  tipo: TipoDocumentoConteudo | '';
  numero: string;
  delivery: string;
  descricao: string;
}

const VAZIO: Form = { remetente: '', tipo: '', numero: '', delivery: '', descricao: '' };

/**
 * Escolha na lista de sugestões (datalist): o Chrome preenche o código inteiro
 * com um "input" que não é InputEvent; Firefox e Safari usam
 * "insertReplacementText". Digitar, colar e apagar nunca passam por aqui.
 */
function escolhaDaLista(evento: Event): boolean {
  return !(evento instanceof InputEvent) || evento.inputType === 'insertReplacementText';
}

/**
 * Registrar conteúdo (out. 2026): o conteúdo recebido que fica no palete,
 * identificado pelo remetente e, quando houver, pela nota (NF, NFD ou MI) e
 * pelo Delivery. Nada de SKU, unidade, código de barras ou volumes aqui: a
 * quantidade é tratada na conferência de volumes. NF e Delivery podem ficar
 * ambos vazios; o servidor valida tudo de novo.
 */
export function TelaRegistrarConteudo({ sessao, paleteInicial, aoNavegar, aoGravar }: { sessao: Sessao; paleteInicial: string | null; aoNavegar: Navegar; aoGravar: () => void }) {
  const ids = useId();
  const chaves = useChaves();
  const conectado = useConectado();
  const praca = useRecurso(URL_PRACA, PracaSchema);
  const [paleteId, setPaleteId] = useState<string | null>(paleteInicial);
  const [paleteTexto, setPaleteTexto] = useState('');
  const [paleteAviso, setPaleteAviso] = useState<{ tipo: 'carregando' | 'invalido'; texto: string } | null>(null);
  const focarEntrada = useRef(false);
  const [form, setForm] = useState<Form>(VAZIO);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null>(null);
  const [salvo, setSalvo] = useState<{ item: ConteudoPalete; total: number } | null>(null);

  const dados = praca.carga?.estado === 'pronto' ? praca.carga.dados : null;
  const paletes = useMemo(() => dados?.pallets ?? [], [dados]);
  const porCodigo = useMemo(() => {
    const mapa = new Map<string, typeof paletes>();
    for (const p of paletes) mapa.set(normalizar(p.code), [...(mapa.get(normalizar(p.code)) ?? []), p]);
    return mapa;
  }, [paletes]);
  const palete = paleteId === null ? null : (paletes.find((p) => p.id === paleteId) ?? null);
  // O aviso de carregamento some quando a lista chega; escolher continua exigindo um novo Enter.
  const avisoPalete = paleteAviso?.tipo === 'carregando' && dados !== null ? null : paleteAviso;

  /**
   * Confirma o palete pelo número completo escrito agora (Enter no campo ou
   * escolha na lista): só a correspondência exata e única. Nunca por prefixo,
   * primeira sugestão, tempo ou digitação parcial; sem ela, avisa e o campo
   * continua para correção.
   */
  function confirmarPalete(texto: string, origem: 'enter' | 'lista') {
    const numero = texto.trim();
    const achados = numero === '' ? [] : (porCodigo.get(normalizar(numero)) ?? []);
    const exato = achados.length === 1 ? achados[0] : achados.find((p) => p.code === numero.toUpperCase());
    if (exato) {
      setPaleteAviso(null);
      setPaleteId(exato.id);
      return;
    }
    if (origem === 'lista') return;
    if (numero === '') setPaleteAviso({ tipo: 'invalido', texto: 'Digite o número do palete e aperte Enter.' });
    else if (praca.carga?.estado === 'erro') setPaleteAviso({ tipo: 'invalido', texto: `Não foi possível carregar os paletes: ${praca.carga.mensagem}` });
    else if (dados === null) setPaleteAviso({ tipo: 'carregando', texto: 'Carregando os paletes… aperte Enter de novo em instantes.' });
    else if (achados.length > 1) setPaleteAviso({ tipo: 'invalido', texto: `Mais de um palete corresponde a ${numero}: escolha o código exato na lista.` });
    else setPaleteAviso({ tipo: 'invalido', texto: `Nenhum palete com o número ${numero} neste escopo. Confira o número.` });
  }
  const enderecoDe = (posicaoId: string | null) => {
    const pos = posicaoId === null ? undefined : dados?.layout?.positions.find((p) => p.id === posicaoId);
    return pos?.address?.state === 'CONFIRMADO' ? `${pos.address.text} · posição ${pos.code}` : pos ? `Posição ${pos.code}` : 'Sem endereço registrado';
  };
  const mudar = (parcial: Partial<Form>) => {
    setForm((f) => ({ ...f, ...parcial }));
  };

  async function salvar(evento: SubmitEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando || paleteId === null) return;
    setMensagem(null);
    const corpo: NovoConteudo = {
      sender: form.remetente,
      documentType: form.tipo === '' ? null : form.tipo,
      documentNumber: form.numero,
      delivery: form.delivery,
      description: form.descricao,
    };
    const validacao = NovoConteudoSchema.safeParse(corpo);
    if (!validacao.success) {
      setMensagem({ tipo: 'erro', texto: validacao.error.issues[0]?.message ?? 'Confira os dados do conteúdo.' });
      return;
    }
    const assinatura = `conteudo:${paleteId}:${JSON.stringify(corpo)}`;
    setEnviando(true);
    try {
      const lista = await enviarJson('POST', `${API_PREFIXO}/paletes/${paleteId}/conteudos`, ConteudosPaleteSchema, { corpo, idempotencia: chaves.para(assinatura) });
      chaves.concluir(assinatura);
      const registrados = lista.items.filter((i) => i.kind === 'REGISTRADO');
      const item = registrados[registrados.length - 1];
      if (item) setSalvo({ item, total: lista.items.length });
      aoGravar();
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
    } finally {
      setEnviando(false);
    }
  }

  const etapas = (atual: 'conteudo' | 'conferencia') => (
    <ol className="etapas-recebimento" aria-label="Etapas do recebimento">
      <li className="etapa-recebimento etapa-recebimento--feita">Palete e destino</li>
      <li className={atual === 'conteudo' ? 'etapa-recebimento etapa-recebimento--atual' : 'etapa-recebimento etapa-recebimento--feita'}>Conteúdo</li>
      <li className={atual === 'conferencia' ? 'etapa-recebimento etapa-recebimento--atual' : 'etapa-recebimento'}>Conferência de volumes</li>
    </ol>
  );

  const voltar = () => {
    aoNavegar(paleteId === null ? { tipo: 'praca' } : { tipo: 'palete', id: paleteId });
  };

  if (salvo !== null && paleteId !== null) {
    const i = salvo.item;
    return (
      <Pagina titulo="Conteúdo salvo" testId="tela-registrar-conteudo" aoVoltar={voltar} rotuloVoltar="Voltar ao palete">
        {etapas('conferencia')}
        <section className="cartao cartao-sucesso" data-testid="conteudo-salvo" aria-live="polite">
          <p className="sucesso-codigo">{i.sender}</p>
          <dl className="situacao">
            <div>
              <dt>Palete</dt>
              <dd>{palete?.code ?? '—'}</dd>
            </div>
            <div>
              <dt>Documento</dt>
              <dd className={i.documentNumber === null ? 'pendente' : undefined}>{textoDocumento(i)}</dd>
            </div>
            <div>
              <dt>Delivery</dt>
              <dd className={i.delivery === null ? 'pendente' : undefined}>{i.delivery ?? 'Delivery não informado'}</dd>
            </div>
            <div>
              <dt>Volumes</dt>
              <dd className="pendente" data-testid="conteudo-salvo-volumes">
                Aguardando conferência
              </dd>
            </div>
          </dl>
          <p className="campo-ajuda">A quantidade é registrada na conferência de volumes: conte agora ou informe uma contagem já feita. Também dá para conferir depois.</p>
          <div className="acoes-linha">
            <button
              type="button"
              className="botao-primario"
              onClick={() => {
                aoNavegar({ tipo: 'volumes', id: paleteId });
              }}
              data-testid="ir-conferencia"
            >
              Ir à conferência
            </button>
            <button
              type="button"
              className="botao-secundario"
              onClick={() => {
                setSalvo(null);
                setForm(VAZIO);
                setMensagem(null);
              }}
              data-testid="registrar-outro"
            >
              Registrar outro conteúdo
            </button>
            <button type="button" className="botao-link" onClick={voltar} data-testid="conferir-depois">
              Conferir depois
            </button>
          </div>
        </section>
      </Pagina>
    );
  }

  return (
    <Pagina
      titulo="Registrar conteúdo"
      testId="tela-registrar-conteudo"
      aoVoltar={voltar}
      rotuloVoltar={paleteId === null ? 'Voltar ao mapa' : 'Voltar ao palete'}
      descricao={<p>Remetente e a identificação que estiver disponível. Nota e Delivery são opcionais; a quantidade de volumes fica para a conferência.</p>}
    >
      {etapas('conteudo')}
      <section className="cartao" aria-labelledby={`${ids}-palete`} data-testid="conteudo-palete-destino">
        <h3 id={`${ids}-palete`}>Palete</h3>
        {palete !== null ? (
          <div className="destino-escolhido">
            <p>
              <strong className="sucesso-codigo" data-testid="conteudo-palete-codigo">
                {palete.code}
              </strong>{' '}
              <span className="campo-ajuda">{enderecoDe(palete.positionId)}</span>
            </p>
            {paleteInicial === null && (
              <button
                type="button"
                className="botao-link"
                onClick={() => {
                  focarEntrada.current = true;
                  setPaleteId(null);
                  setPaleteTexto('');
                  setPaleteAviso(null);
                }}
              >
                Trocar palete
              </button>
            )}
          </div>
        ) : paleteId !== null && praca.carga?.estado !== 'pronto' ? (
          <p className="estado-carregando">Carregando o palete…</p>
        ) : paleteId !== null ? (
          <p className="estado-erro">Palete não encontrado neste escopo (arquivado ou de outra unidade).</p>
        ) : (
          <label className="campo">
            <span className="campo-rotulo">Número do palete</span>
            <input
              ref={(campo) => {
                // "Trocar palete": o campo volta com o foco para digitar o novo número.
                if (campo && focarEntrada.current) {
                  focarEntrada.current = false;
                  campo.focus();
                }
              }}
              value={paleteTexto}
              list={`${ids}-paletes`}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="Ex.: PR-000248"
              aria-invalid={avisoPalete?.tipo === 'invalido' || undefined}
              aria-describedby={avisoPalete ? `${ids}-palete-aviso` : undefined}
              onChange={(e) => {
                // Digitar só muda o texto; o palete é escolhido por Enter ou pela lista.
                setPaleteTexto(e.target.value);
                setPaleteAviso(null);
                if (escolhaDaLista(e.nativeEvent)) confirmarPalete(e.target.value, 'lista');
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                // Este Enter é só do campo do palete: não submete nada e não se repete ao segurar a tecla.
                e.preventDefault();
                if (!e.repeat) confirmarPalete(e.currentTarget.value, 'enter');
              }}
              data-testid="conteudo-palete-entrada"
            />
            <datalist id={`${ids}-paletes`}>
              {paletes.map((p) => (
                <option key={p.id} value={p.code} />
              ))}
            </datalist>
            {avisoPalete ? (
              <span id={`${ids}-palete-aviso`} className="campo-erro" role="alert" data-testid="conteudo-palete-aviso">
                {avisoPalete.texto}
              </span>
            ) : (
              <span className="campo-ajuda">Digite o número completo e aperte Enter, ou escolha na lista.</span>
            )}
            <span className="campo-ajuda">
              Palete ainda não cadastrado?{' '}
              <button
                type="button"
                className="botao-link"
                onClick={() => {
                  aoNavegar({ tipo: 'novo-palete' });
                }}
              >
                Receber palete
              </button>
            </span>
          </label>
        )}
      </section>

      <form className="formulario-cadastro" noValidate onSubmit={(e) => void salvar(e)} data-testid="form-conteudo">
        <fieldset className="cartao">
          <legend>Conteúdo</legend>
          <label className="campo">
            <span className="campo-rotulo">Remetente</span>
            <input
              value={form.remetente}
              maxLength={200}
              autoComplete="off"
              required
              onChange={(e) => {
                mudar({ remetente: e.target.value });
              }}
              data-testid="conteudo-remetente"
            />
          </label>
          <fieldset className="campo grupo-tipo-documento">
            <legend className="campo-rotulo">Tipo de documento (quando identificado)</legend>
            <div className="opcoes-tipo-documento" role="radiogroup">
              {TipoDocumentoConteudoSchema.options.map((t) => (
                <label key={t} className={t === 'NF' ? 'chip-opcao chip-opcao--destaque' : 'chip-opcao'}>
                  <input
                    type="radio"
                    name={`${ids}-tipo`}
                    checked={form.tipo === t}
                    onChange={() => {
                      mudar({ tipo: t });
                    }}
                    data-testid={`conteudo-tipo-${t}`}
                  />
                  {t}
                </label>
              ))}
              <label className="chip-opcao">
                <input
                  type="radio"
                  name={`${ids}-tipo`}
                  checked={form.tipo === ''}
                  onChange={() => {
                    mudar({ tipo: '' });
                  }}
                  data-testid="conteudo-tipo-nenhum"
                />
                Sem documento identificado
              </label>
            </div>
          </fieldset>
          <div className="formulario-grade">
            <label className="campo">
              <span className="campo-rotulo">Número do documento (opcional)</span>
              <input
                value={form.numero}
                maxLength={60}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  mudar({ numero: e.target.value });
                }}
                data-testid="conteudo-numero"
              />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Delivery (opcional)</span>
              <input
                value={form.delivery}
                maxLength={60}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  mudar({ delivery: e.target.value });
                }}
                data-testid="conteudo-delivery"
              />
            </label>
          </div>
          <details className="informacoes-adicionais">
            <summary>Informações adicionais</summary>
            <label className="campo">
              <span className="campo-rotulo">Descrição (opcional)</span>
              <textarea
                rows={2}
                maxLength={500}
                value={form.descricao}
                onChange={(e) => {
                  mudar({ descricao: e.target.value });
                }}
                data-testid="conteudo-descricao"
              />
            </label>
          </details>
          <p className="campo-ajuda">Pode salvar só com o remetente: nota e Delivery podem ser completados depois, sem perder a contagem.</p>
        </fieldset>
        <MensagemAcao mensagem={mensagem} testId="erro-conteudo" />
        {!conectado && <p className="estado-erro">Sem conexão: nada é registrado. Tente quando a rede voltar.</p>}
        <div className="acoes-linha">
          <button type="submit" className="botao-primario" disabled={enviando || !conectado || paleteId === null || palete === null} aria-busy={enviando} data-testid="salvar-conteudo">
            {enviando ? 'Salvando…' : 'Salvar conteúdo'}
          </button>
          <button type="button" className="botao-link" onClick={voltar}>
            Cancelar
          </button>
        </div>
        {sessao.activeScope?.demo && <p className="campo-ajuda">Escopo de demonstração: o conteúdo registrado aqui também é fictício.</p>}
      </form>
    </Pagina>
  );
}
