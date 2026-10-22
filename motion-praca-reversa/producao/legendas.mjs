// Texto de narração (base editorial do roteiro, ajustada ao que o filme comprova)
// e legendas SRT sincronizadas às cenas. Sem voz gravada: o texto serve para
// locução futura ou para legendas.
// Uso (pasta motion-praca-reversa): node producao/legendas.mjs
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RAIZ = resolve(import.meta.dirname);
const q = (quadro) => quadro / 30;
// [início, fim (quadros), título da cena, falas]; cada fala vira uma ou mais legendas.
const CENAS = [
  [0, 360, '1. O problema tem um custo operacional', [
    'Na reversa, muitos paletes e pouca visibilidade do conteúdo tornam a localização mais difícil.',
    'A busca consome equipe e pode aumentar o risco de divergências e claims.',
  ]],
  [360, 660, '2. Apresentar o sistema', [
    'O Praça Reversa conecta documentos, volumes e endereços',
    'para apoiar a conferência, preparar as janelas e dar visibilidade ao trabalho da operação.',
  ]],
  [660, 1200, '3. Aproveitar a informação que já existe', [
    'A planilha da bipagem alimenta o conteúdo do palete.',
    'Tipo, número, volumes lidos, CNPJ e remetente entram com revisão da equipe.',
    'Delivery, SKU e validade continuam opcionais.',
  ]],
  [1200, 1770, '4. Saber onde está e o que tem', [
    'No mapa, que abre na área da L’Oréal, cada palete tem sua localização e seu conteúdo consultável.',
    'A equipe identifica notas, volumes e composição, como neste palete misto.',
  ]],
  [1770, 2250, '5. Encontrar e tratar divergências', [
    'A busca direciona a equipe ao endereço registrado.',
    'Divergências de alocação ficam visíveis, e a correção fica no histórico, com origem e destino.',
    'O QR da etiqueta abre a consulta do palete.',
  ]],
  [2250, 2900, '6. Preparar exatamente o que o cliente pediu', [
    'Nas janelas de saída, o pedido do cliente define a meta em volumes.',
    'A equipe localiza e separa o conteúdo escolhido: aqui, uma nota de um palete misto.',
    'Solicitado, separado e expedido permanecem distintos.',
  ]],
  [2900, 3360, '7. Direcionar a conferência', [
    'A regra de vinte dias sem movimentação sinaliza o que precisa de nova conferência.',
    'A equipe ganha uma prioridade visual, e a verificação deixa um registro consultável.',
  ]],
  [3360, 3840, '8. Visibilidade para quem opera e decide', [
    'O painel reúne estoque, janelas e prioridades.',
    'A gestão acompanha a operação, e o cliente consulta as informações permitidas pelo seu perfil.',
  ]],
  [3840, 4190, '9. Informação que continua disponível', [
    'Os registros gravados e o histórico preservam o acompanhamento.',
    'A exportação manual em CSV leva a informação para a planilha de consulta.',
  ]],
  [4190, 4500, '10. Proposta de piloto', [
    'Vamos validar em um piloto: medir localização, acuracidade e atendimento das janelas.',
    'Evoluir com a equipe.',
  ]],
];

/** Divide palavras em n partes de tamanho parecido (sem deixar palavra solta no fim). */
function dividir(palavras, n) {
  const total = palavras.join(' ').length;
  const partes = [];
  let atual = [];
  for (const p of palavras) {
    atual.push(p);
    if (partes.length < n - 1 && atual.join(' ').length >= total / n) {
      partes.push(atual);
      atual = [];
    }
  }
  if (atual.length) partes.push(atual);
  return partes;
}
/** Quebra uma fala em legendas de até 2 linhas equilibradas com no máximo 42 caracteres. */
function quebrar(texto) {
  const palavras = texto.split(' ');
  const blocos = dividir(palavras, Math.ceil(texto.length / 78));
  return blocos.map((b) => {
    const linha = b.join(' ');
    if (linha.length <= 42) return linha;
    let melhor = 1;
    for (let i = 1; i < b.length; i++) {
      const dif = Math.abs(b.slice(0, i).join(' ').length - b.slice(i).join(' ').length);
      if (dif < Math.abs(b.slice(0, melhor).join(' ').length - b.slice(melhor).join(' ').length)) melhor = i;
    }
    return `${b.slice(0, melhor).join(' ')}\n${b.slice(melhor).join(' ')}`;
  });
}
const hora = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, d = 2) => String(n).padStart(d, '0');
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

const srt = [];
const txt = ['PRAÇA REVERSA — TEXTO DE NARRAÇÃO (versão do filme de 150 s)', 'Base: ROTEIRO-MOTION-PRACA-150S.txt, ajustada ao que o aplicativo atual comprova nas telas do filme.', 'O filme foi entregue sem locução (nenhuma voz autorizada disponível); este texto serve para gravar a voz depois ou para legendas.', ''];
for (const [ini, fim, titulo, falas] of CENAS) {
  const blocos = falas.flatMap(quebrar);
  const t0 = q(ini) + 0.4;
  const t1 = q(fim) - 0.3;
  const pesos = blocos.map((b) => b.replace(/\n/g, ' ').length + 12);
  const soma = pesos.reduce((a, b) => a + b, 0);
  let t = t0;
  blocos.forEach((b, i) => {
    const d = ((t1 - t0) * pesos[i]) / soma;
    srt.push(`${String(srt.length + 1)}\n${hora(t)} --> ${hora(t + d - 0.12)}\n${b}\n`);
    t += d;
  });
  txt.push(`[${hora(q(ini)).slice(3, 8)}–${hora(q(fim)).slice(3, 8)}] ${titulo}`, falas.join(' '), '');
}
writeFileSync(resolve(RAIZ, 'out', 'praca-reversa-apresentacao.srt'), `${srt.join('\n')}\n`);
writeFileSync(resolve(RAIZ, 'out', 'narracao.txt'), `${txt.join('\n')}\n`);
console.log(`Legendas: ${String(srt.length)} · out/praca-reversa-apresentacao.srt e out/narracao.txt`);
