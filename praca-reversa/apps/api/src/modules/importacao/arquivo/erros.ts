/**
 * Arquivo incompatível, corrompido ou acima dos limites. A mensagem vai para
 * quem importa (português, sem detalhes internos); o código ajuda nos testes
 * e no relatório.
 */
export class ErroArquivo extends Error {
  readonly codigo: string;

  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.name = 'ErroArquivo';
    this.codigo = codigo;
  }
}

/** Prazo de processamento: interrompe a leitura de arquivos que consomem tempo demais. */
export class Prazo {
  private readonly limite: number;
  private contador = 0;

  constructor(
    private readonly ms: number,
    private readonly agora: () => number = () => performance.now(),
  ) {
    this.limite = agora() + ms;
  }

  /** Chamado nos laços de leitura; consulta o relógio a cada 2.048 passos. */
  verificar(): void {
    this.contador = (this.contador + 1) & 2047;
    if (this.contador === 0 && this.agora() > this.limite) {
      throw new ErroArquivo('TEMPO_EXCEDIDO', `O processamento do arquivo passou do limite de ${String(Math.round(this.ms / 1000))} s. Divida o arquivo em partes menores.`);
    }
  }
}
