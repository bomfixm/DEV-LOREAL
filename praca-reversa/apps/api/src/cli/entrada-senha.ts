import { createInterface } from 'node:readline';

/** Lê uma linha do terminal sem exibir o que é digitado. */
function lerOculto(pergunta: string): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const entrada = process.stdin;
    process.stdout.write(pergunta);
    let valor = '';
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    const aoDigitar = (tecla: string) => {
      for (const c of tecla) {
        if (c === '\r' || c === '\n') {
          finalizar();
          resolver(valor);
          return;
        }
        if (c === '\u0003') {
          finalizar();
          rejeitar(new Error('Cancelado.'));
          return;
        }
        if (c === '\u007f' || c === '\b') valor = valor.slice(0, -1);
        else valor += c;
      }
    };
    const finalizar = () => {
      entrada.off('data', aoDigitar);
      entrada.setRawMode(false);
      entrada.pause();
      process.stdout.write('\n');
    };
    entrada.on('data', aoDigitar);
  });
}

/** Primeira linha da entrada padrão (uso não interativo: `... < arquivo` ou pipe). */
function lerLinhaDaEntrada(): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = createInterface({ input: process.stdin });
    let recebida = false;
    leitor.once('line', (linha) => {
      // Resolve antes de fechar: o evento "close" é emitido de forma síncrona.
      recebida = true;
      resolver(linha);
      leitor.close();
    });
    leitor.once('close', () => {
      if (!recebida) rejeitar(new Error('Nenhuma senha recebida na entrada padrão.'));
    });
  });
}

/**
 * Senha do operador: digitada duas vezes sem eco no terminal, ou a primeira
 * linha da entrada padrão quando não há terminal. Nunca por argumento de
 * linha de comando (ficaria no histórico do shell).
 */
export async function obterSenhaDoOperador(): Promise<string> {
  if (!process.stdin.isTTY) return lerLinhaDaEntrada();
  const senha = await lerOculto('Senha do administrador (mín. 12 caracteres): ');
  const confirmacao = await lerOculto('Repita a senha: ');
  if (senha !== confirmacao) throw new Error('As senhas não conferem.');
  return senha;
}
