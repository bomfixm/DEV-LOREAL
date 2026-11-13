import {
  API_PREFIXO,
  SegundoFatorAtivadoSchema,
  SegundoFatorInicioSchema,
  SegundoFatorSituacaoSchema,
  type SegundoFatorInicio,
} from '@praca-reversa/contracts';
import { useMemo, useState, type SubmitEvent } from 'react';
import { z } from 'zod';
import { enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { caminhoSvgQr, gerarMatrizQr, ladoComMargem } from '../etiquetas/qr';
import { Carregando } from '../../components/carregamento/Carregando';

const URL_2FA = `${API_PREFIXO}/sessao/segundo-fator`;

function QrCadastro({ uri }: { uri: string }) {
  const desenho = useMemo(() => {
    const matriz = gerarMatrizQr(uri);
    const lado = ladoComMargem(matriz);
    return { caminho: caminhoSvgQr(matriz), lado };
  }, [uri]);
  return (
    <svg
      viewBox={`0 0 ${String(desenho.lado)} ${String(desenho.lado)}`}
      width={200}
      height={200}
      role="img"
      aria-label="QR para cadastrar a conta no aplicativo autenticador"
      shapeRendering="crispEdges"
      data-testid="qr-segundo-fator"
    >
      <rect width="100%" height="100%" fill="#fff" />
      <path d={desenho.caminho} fill="#000" />
    </svg>
  );
}

/** Verificação em duas etapas da própria conta: ativar com aplicativo autenticador, ver situação e desativar. */
export function TelaSeguranca({ aoVoltar }: { aoVoltar: () => void }) {
  const situacao = useRecurso(URL_2FA, SegundoFatorSituacaoSchema);
  const [cadastro, setCadastro] = useState<SegundoFatorInicio | null>(null);
  const [codigo, setCodigo] = useState('');
  const [recuperacao, setRecuperacao] = useState<string[] | null>(null);
  const [senha, setSenha] = useState('');
  const [codigoDesativar, setCodigoDesativar] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  async function comecar() {
    setOcupado(true);
    setMensagem(null);
    try {
      setCadastro(await enviarJson('POST', `${URL_2FA}/iniciar`, SegundoFatorInicioSchema, {}));
    } catch (erro) {
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar(evento: SubmitEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (ocupado) return;
    setOcupado(true);
    setMensagem(null);
    try {
      const r = await enviarJson('POST', `${URL_2FA}/ativar`, SegundoFatorAtivadoSchema, { corpo: { code: codigo } });
      setRecuperacao(r.recoveryCodes);
      setCadastro(null);
      setCodigo('');
      situacao.recarregar();
    } catch (erro) {
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
    } finally {
      setOcupado(false);
    }
  }

  async function desativar(evento: SubmitEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (ocupado) return;
    if (!window.confirm('Desativar a verificação em duas etapas? A conta volta a entrar só com a senha.')) return;
    setOcupado(true);
    setMensagem(null);
    try {
      await enviarJson('POST', `${URL_2FA}/desativar`, z.null(), { corpo: { password: senha, code: codigoDesativar } });
      setSenha('');
      setCodigoDesativar('');
      setMensagem({ tipo: 'ok', texto: 'Verificação em duas etapas desativada.' });
      situacao.recarregar();
    } catch (erro) {
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
    } finally {
      setOcupado(false);
    }
  }

  const ativa = situacao.carga?.estado === 'pronto' && situacao.carga.dados.enabled;

  return (
    <main className="principal principal--pagina" data-testid="tela-seguranca">
      <div className="pagina-conteudo">
        <header className="pagina-topo">
          <h2>Segurança da conta</h2>
          <button type="button" className="botao-secundario" onClick={aoVoltar}>
            Voltar
          </button>
        </header>

        {mensagem !== null && (
          <p className={mensagem.tipo === 'ok' ? 'aviso-login' : 'estado-erro'} role={mensagem.tipo === 'ok' ? 'status' : 'alert'}>
            {mensagem.texto}
          </p>
        )}

        <section className="cartao" aria-labelledby="titulo-2fa">
          <h3 id="titulo-2fa">Verificação em duas etapas</h3>
          {situacao.carga?.estado === 'erro' ? (
            <p className="estado-erro" role="alert">
              {situacao.carga.mensagem}
            </p>
          ) : situacao.carga?.estado !== 'pronto' ? (
            <Carregando mensagem="Carregando…" variante="principal" />
          ) : recuperacao !== null ? (
            <div data-testid="codigos-recuperacao">
              <p>
                <strong>Ativada.</strong> Guarde estes códigos de recuperação em lugar seguro (um papel guardado, um cofre de senhas). Cada um vale uma vez e
                serve se você perder o celular. <strong>Eles não aparecem de novo.</strong>
              </p>
              <ul className="lista-simples">
                {recuperacao.map((c) => (
                  <li key={c}>
                    <code>{c}</code>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="botao-primario"
                onClick={() => {
                  setRecuperacao(null);
                }}
              >
                Guardei os códigos
              </button>
            </div>
          ) : ativa ? (
            <>
              <p data-testid="situacao-2fa">
                Ativada. Ao entrar, além da senha, você digita o código do aplicativo autenticador. Códigos de recuperação restantes:{' '}
                <strong>{situacao.carga.dados.recoveryCodesLeft}</strong>.
              </p>
              <form
                onSubmit={(e) => {
                  void desativar(e);
                }}
              >
                <p>Para desativar, confirme com a senha e um código atual (do aplicativo ou de recuperação).</p>
                <label className="campo">
                  <span className="campo-rotulo">Senha</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={senha}
                    onChange={(e) => {
                      setSenha(e.target.value);
                    }}
                  />
                </label>
                <label className="campo">
                  <span className="campo-rotulo">Código</span>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={codigoDesativar}
                    onChange={(e) => {
                      setCodigoDesativar(e.target.value);
                    }}
                  />
                </label>
                <button type="submit" className="botao-secundario" disabled={ocupado || senha === '' || codigoDesativar.trim() === ''}>
                  Desativar verificação em duas etapas
                </button>
              </form>
            </>
          ) : cadastro !== null ? (
            <form
              onSubmit={(e) => {
                void confirmar(e);
              }}
            >
              <ol>
                <li>Instale um aplicativo autenticador no celular (Google Authenticator, Microsoft Authenticator ou Authy).</li>
                <li>No aplicativo, adicione uma conta lendo este QR (ou digite a chave abaixo).</li>
                <li>Digite aqui o código de 6 dígitos que o aplicativo mostrar e confirme.</li>
              </ol>
              <QrCadastro uri={cadastro.otpauthUri} />
              <p>
                Chave para digitar à mão: <code data-testid="chave-2fa">{cadastro.secret}</code>
              </p>
              <label className="campo">
                <span className="campo-rotulo">Código de 6 dígitos</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={codigo}
                  onChange={(e) => {
                    setCodigo(e.target.value);
                  }}
                  data-testid="codigo-confirmar"
                />
              </label>
              <button type="submit" className="botao-primario" disabled={ocupado || codigo.trim() === ''}>
                Confirmar e ativar
              </button>
            </form>
          ) : (
            <>
              <p>
                Desativada. Com a verificação em duas etapas, quem descobrir a sua senha ainda não consegue entrar sem o código do seu celular. Recomendado
                para administradores.
              </p>
              <button type="button" className="botao-primario" disabled={ocupado} onClick={() => void comecar()} data-testid="ativar-2fa">
                Ativar verificação em duas etapas
              </button>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
