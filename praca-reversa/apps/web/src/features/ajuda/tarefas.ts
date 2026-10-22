/**
 * Guias por tarefa (etapa 10). Só os identificadores e títulos ficam aqui
 * (rotas e menu); o conteúdo é carregado sob demanda (conteudo.ts).
 */
export const TAREFAS = ['consultar', 'cadastrar', 'bipagem', 'conferir', 'divergencia', 'mover', 'claim', 'janela', 'selecao', 'saida', 'camera', 'interrupcao', 'painel', 'painel-cliente'] as const;
export type IdTarefa = (typeof TAREFAS)[number];

export const TITULOS_TAREFA: Readonly<Record<IdTarefa, string>> = {
  consultar: 'Consultar palete ou produto',
  cadastrar: 'Cadastrar palete',
  bipagem: 'Importar a bipagem no palete',
  conferir: 'Conferir material',
  divergencia: 'Tratar divergência',
  mover: 'Mover palete ou transferir produtos',
  claim: 'Investigar claim',
  janela: 'Preparar uma janela de devolução',
  selecao: 'Localizar o que o cliente pediu',
  saida: 'Confirmar saída (expedição)',
  camera: 'Usar a câmera e o aplicativo instalado',
  interrupcao: 'Resolver uma interrupção',
  painel: 'Acompanhar o painel e registrar a separação por volumes',
  'painel-cliente': 'Consultar o painel do cliente',
};

export function ehTarefa(valor: string | null): valor is IdTarefa {
  return valor !== null && (TAREFAS as readonly string[]).includes(valor);
}
