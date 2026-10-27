/**
 * Validação dos arquivos gerados ANTES de qualquer gravação: reabre cada XLSX
 * com o leitor do próprio projeto e confere com o snapshot que o originou —
 * abas e cabeçalhos, uma linha por registro na mesma ordem (N° PALLET,
 * NUMERO, DELIVERY, RUA e ID), identificadores como texto, nenhuma fórmula
 * no corpo, volumes conhecidos como número e a soma igual à do snapshot,
 * desconhecidos/pendentes como texto, escopo e revisão na aba Proteção e
 * ajuda, e cada evento de Movimentações uma vez, no arquivo certo.
 * Qualquer diferença é erro: o arquivo não é gravado nem publicado.
 */
import type { LimitesImportacao } from '@praca-reversa/contracts';
import { lerTabela, type Tabela } from '../importacao/arquivo/ler.js';
import type { SnapshotPlanilha } from './dados.js';
import { ABA_INVENTARIO, ABA_MOVIMENTOS, ABA_PROTECAO, COL, COLUNAS_INVENTARIO, COLUNAS_MOVIMENTOS, LINHA_CABECALHO_INVENTARIO, LINHA_CABECALHO_MOVIMENTOS, type ArquivoMontado } from './montar.js';

class ErroValidacao extends Error {
  constructor(mensagem: string) {
    super(`Validação: ${mensagem}`);
  }
}

function limites(linhas: number): LimitesImportacao {
  return {
    maxBytes: 1_024 * 1_048_576,
    maxRows: linhas + 100,
    maxColumns: 60,
    maxCellChars: 32_767,
    maxUncompressedBytes: 4_096 * 1_048_576,
    maxZipEntries: 60,
    maxProcessingMs: 600_000,
  };
}

const ler = (buffer: Buffer, aba: string, cabecalho: number, linhas: number): Tabela => lerTabela(buffer, 'XLSX', { sheet: aba, headerRow: cabecalho, encoding: null, delimiter: null }, limites(linhas));

function cabecalhoIgual(t: Tabela, esperado: readonly string[], aba: string): void {
  const lido = esperado.map((_, i) => t.cabecalho.find((c) => c.indice === i)?.texto ?? '');
  if (lido.join('|') !== esperado.join('|')) throw new ErroValidacao(`cabeçalho da aba ${aba} diferente do esperado.`);
}

export function validarArquivos(arquivos: readonly ArquivoMontado[], s: SnapshotPlanilha, revisao: number): void {
  const principal = arquivos[0];
  if (principal?.papel !== 'PRINCIPAL') throw new ErroValidacao('arquivo principal ausente.');

  // Inventário: linha a linha, na ordem do snapshot.
  const inv = ler(principal.buffer, ABA_INVENTARIO, LINHA_CABECALHO_INVENTARIO, s.inventario.length);
  cabecalhoIgual(inv, COLUNAS_INVENTARIO, ABA_INVENTARIO);
  if (inv.linhas.length !== s.inventario.length) throw new ErroValidacao(`Inventário com ${String(inv.linhas.length)} linha(s); esperadas ${String(s.inventario.length)}.`);
  let soma = 0;
  s.inventario.forEach((x, i) => {
    const l = inv.linhas[i];
    const numero = LINHA_CABECALHO_INVENTARIO + 1 + i;
    if (l?.numero !== numero) throw new ErroValidacao(`Inventário sem a linha ${String(numero)}.`);
    const cel = (c: number) => l.celulas[c];
    const txt = (c: number) => cel(c)?.texto ?? null;
    if (l.celulas.some((c) => c?.formula)) throw new ErroValidacao(`linha ${String(numero)} do Inventário com fórmula.`);
    for (const [c, esperado] of [
      [COL['N° PALLET'], x.palete],
      [COL.NUMERO, x.numero],
      [COL.DELIVERY, x.delivery],
      [COL.RUA, x.endereco],
      [COL['ID DO REGISTRO'], x.referencia],
    ] as const) {
      if (txt(c) !== (esperado === '' ? null : esperado)) throw new ErroValidacao(`linha ${String(numero)} do Inventário não confere (${COLUNAS_INVENTARIO[c] ?? ''}).`);
      if (esperado !== null && cel(c)?.tipo !== 'TEXTO') throw new ErroValidacao(`linha ${String(numero)}: ${COLUNAS_INVENTARIO[c] ?? ''} não ficou como texto.`);
    }
    const v = cel(COL.VOLUMES);
    if (x.volumes !== null) {
      if (v?.tipo !== 'NUMERO' || Number(v.texto) !== x.volumes) throw new ErroValidacao(`linha ${String(numero)}: VOLUMES diferente do snapshot.`);
      soma += x.volumes;
    } else if (v?.tipo !== 'TEXTO' || v.texto !== x.volumesTexto) throw new ErroValidacao(`linha ${String(numero)}: volume desconhecido/pendente precisa ficar como texto explícito.`);
  });
  if (soma !== s.totais.volumesConhecidos) throw new ErroValidacao(`soma de VOLUMES (${String(soma)}) diferente do snapshot (${String(s.totais.volumesConhecidos)}).`);
  if (new Set(s.inventario.map((x) => x.referencia)).size !== s.inventario.length) throw new ErroValidacao('registro repetido no Inventário.');

  // Proteção e ajuda: escopo e revisão do arquivo.
  const prot = ler(principal.buffer, ABA_PROTECAO, 2, 200);
  const valor = (rotulo: string) => prot.linhas.find((l) => l.celulas[0]?.texto === rotulo)?.celulas[1]?.texto ?? null;
  if (valor('Revisão dos dados') !== String(revisao)) throw new ErroValidacao('revisão da aba Proteção e ajuda diferente da gerada.');
  if (!(valor('Escopo') ?? '').endsWith(`[${s.escopo.unidade}/${s.escopo.cliente}]`)) throw new ErroValidacao('escopo da aba Proteção e ajuda diferente do snapshot.');

  // Movimentações: cada evento uma vez, no arquivo e na ordem previstos.
  const vistos = new Set<string>();
  for (const a of arquivos) {
    const mov = ler(a.buffer, ABA_MOVIMENTOS, LINHA_CABECALHO_MOVIMENTOS, a.eventos.length);
    cabecalhoIgual(mov, COLUNAS_MOVIMENTOS, `${ABA_MOVIMENTOS} (${a.nome})`);
    if (mov.linhas.length !== a.eventos.length) throw new ErroValidacao(`${a.nome}: ${String(mov.linhas.length)} evento(s); esperados ${String(a.eventos.length)}.`);
    a.eventos.forEach((e, i) => {
      const l = mov.linhas[i];
      if (l?.celulas[9]?.texto !== e.id || l.celulas[0]?.tipo !== 'DATA' || l.celulas.some((c) => c?.formula)) throw new ErroValidacao(`${a.nome}: evento ${String(i + 1)} não confere.`);
      if (vistos.has(e.id)) throw new ErroValidacao(`evento ${e.id} repetido.`);
      vistos.add(e.id);
    });
  }
  if (vistos.size !== s.eventos.length) throw new ErroValidacao(`Movimentações com ${String(vistos.size)} evento(s); o snapshot tem ${String(s.eventos.length)}.`);
}
