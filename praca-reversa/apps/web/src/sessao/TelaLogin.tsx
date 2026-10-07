import { useState, type SubmitEvent } from 'react';

interface Props {
  aviso: string | null;
  /** Destino interno (já validado) aberto depois do login. */
  retorno: string;
  aoEntrar: (login: string, senha: string) => Promise<string | null>;
  /** Instalação, aparelho e versões (sem dados da operação). */
  aoAbrirAplicativo: () => void;
}

function descreverRetorno(retorno: string): string | null {
  if (retorno.startsWith('/paletes/') && retorno !== '/paletes/novo') return 'Entre para abrir o palete do link ou QR.';
  if (retorno.startsWith('/etiquetas')) return 'Entre para continuar a impressão das etiquetas.';
  if (retorno !== '/') return 'Entre para continuar na página pedida.';
  return null;
}

/** Acesso individual. Não há cadastro público: contas são criadas pelo administrador. */
export function TelaLogin({ aviso, retorno, aoEntrar, aoAbrirAplicativo }: Props) {
  const destino = descreverRetorno(retorno);
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(evento: SubmitEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    if (login.trim() === '' || senha === '') {
      setErro('Informe usuário e senha.');
      return;
    }
    setEnviando(true);
    setErro(null);
    const falha = await aoEntrar(login, senha);
    if (falha !== null) {
      setErro(falha);
      setSenha('');
      setEnviando(false);
    }
  }

  return (
    <main className="principal principal--estado">
      <form
        className="cartao-login"
        aria-labelledby="titulo-login"
        noValidate
        onSubmit={(evento) => {
          void enviar(evento);
        }}
      >
        <h2 id="titulo-login">Entrar</h2>
        {aviso !== null && (
          <p className="aviso-login" role="status" data-testid="aviso-login">
            {aviso}
          </p>
        )}
        {destino !== null && (
          <p className="aviso-login aviso-login--destino" data-testid="aviso-retorno">
            {destino}
          </p>
        )}
        <label className="campo">
          <span className="campo-rotulo">Usuário</span>
          <input
            name="login"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={login}
            onChange={(e) => {
              setLogin(e.target.value);
            }}
          />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Senha</span>
          <input
            name="senha"
            type="password"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => {
              setSenha(e.target.value);
            }}
          />
        </label>
        <button type="submit" className="botao-primario" disabled={enviando} aria-busy={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
        {erro !== null && (
          <p className="estado-erro" role="alert" data-testid="erro-login">
            {erro}
          </p>
        )}
        <p className="nota-login">Contas individuais, criadas pelo administrador. Não há cadastro público.</p>
        <button type="button" className="botao-link" onClick={aoAbrirAplicativo} data-testid="abrir-aplicativo">
          Instalar o aplicativo e ver este aparelho
        </button>
      </form>
    </main>
  );
}
