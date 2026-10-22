import { chaveIdentidadeBipagem } from '@praca-reversa/contracts';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ErroArquivo } from '../../src/modules/importacao/arquivo/erros.js';
import { interpretarBipagem, lerUltimaLeitura, reconhecerBipagem, type LinhaBipagemLida } from '../../src/modules/importacao/bipagem.js';
import { LIMITES_PLANILHA_PADRAO } from '../../src/modules/importacao/campos.js';

/**
 * Leitor fixo da bipagem "Etiquetas", isolado (sem banco), com os mesmos casos
 * dos 11 testes do leitor Python de referência (`testar_leitor.py`): amostra
 * real reconciliada (63/41/22/47), Lidos prevalece sobre Leituras, colunas
 * descartadas não influenciam, zero não gera entrada, quantidade inválida não
 * vira zero, identificadores e CNPJ preservados, cabeçalhos normalizados e
 * Última Leitura sem fuso inventado. A amostra (`amostras/Bipagem-real.xlsx`,
 * dado real fora do versionamento) é a mesma do pacote; sem ela, pulado.
 */
const AMOSTRA = fileURLToPath(new URL('../../../../amostras/Bipagem-real.xlsx', import.meta.url));

function ler(conteudo: Buffer, formato: 'XLSX' | 'CSV' = conteudo.subarray(0, 2).toString('latin1') === 'PK' ? 'XLSX' : 'CSV'): LinhaBipagemLida[] {
  const r = reconhecerBipagem(conteudo, formato, LIMITES_PLANILHA_PADRAO);
  return interpretarBipagem({ tabela: r.tabela, colunas: r.colunas, separador: 'VIRGULA', limites: LIMITES_PLANILHA_PADRAO });
}

/** CSV com o cabeçalho da exportação real (todas as colunas, inclusive as ignoradas). */
const CAB = 'Status;Baixa indevida;Tipo;Número;Série;Leituras;Lidos;Destino;Última Leitura;CNPJ Remetente;Remetente;Posicao;Area';
const linha = (x: Partial<Record<'status' | 'baixa' | 'tipo' | 'numero' | 'serie' | 'leituras' | 'lidos' | 'destino' | 'ultima' | 'cnpj' | 'remetente' | 'posicao' | 'area', string>>) =>
  [x.status ?? 'OK', x.baixa ?? 'N', x.tipo ?? 'NF-e', x.numero ?? '000123', x.serie ?? '1', x.leituras ?? '1', x.lidos ?? '5', x.destino ?? 'X', x.ultima ?? '', x.cnpj ?? '08.250.575/0002-55', x.remetente ?? 'Empresa Exemplo', x.posicao ?? 'P1', x.area ?? 'A'].join(';');
const csv = (...linhas: string[]) => Buffer.from(`${CAB}\r\n${linhas.join('\r\n')}\r\n`, 'utf8');

describe('leitor fixo da bipagem "Etiquetas"', () => {
  it.skipIf(!existsSync(AMOSTRA))('amostra real reconciliada: 63 linhas, 41 com volumes (47), 22 sem volumes, 0 erros; Lidos prevalece sobre Leituras', () => {
    const conteudo = readFileSync(AMOSTRA);
    const r = reconhecerBipagem(conteudo, 'XLSX', LIMITES_PLANILHA_PADRAO);
    expect(r.tabela.opcoes.sheet).toBe('Etiquetas_1');
    // Tipo C, Número D, Lidos G, Remetente K, CNPJ J, Última Leitura I (índices a partir de 0).
    expect(r.colunas).toEqual({ documentType: 2, documentNumber: 3, readVolumes: 6, sender: 10, senderCnpj: 9, lastRead: 8 });
    const linhas = ler(conteudo);
    expect(linhas).toHaveLength(63);
    expect(linhas.filter((l) => l.erros.length > 0)).toEqual([]);
    const positivos = linhas.filter((l) => (l.volumes ?? 0) > 0);
    expect([positivos.length, positivos.reduce((s, l) => s + (l.volumes ?? 0), 0), linhas.filter((l) => l.volumes === 0).length]).toEqual([41, 47, 22]);
    // NF-e 285987: Leituras = 1, Lidos = 5 → 5. Minuta 1379: Leituras 0,1, Lidos 1 → 1 (a linha zero é outra).
    expect(linhas.find((l) => l.numeroDocumento === '285987')).toMatchObject({ volumes: 5, tipoCodigo: 'NF', cnpj: '03.962.539/0002-09', cnpjDigitos: '03962539000209' });
    expect(linhas.filter((l) => l.numeroDocumento === '1379').map((l) => [l.numero, l.volumes])).toEqual([
      [12, 0],
      [13, 1],
    ]);
    expect(positivos.every((l) => l.ultimaLeitura === null || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(l.ultimaLeitura))).toBe(true);
    expect(new Set(positivos.map((l) => l.chave)).size).toBe(41);
  });

  it('colunas descartadas (Status, Baixa indevida, Série, Leituras, Destino, Posicao, Area) não influenciam a leitura', () => {
    const [a] = ler(csv(linha({})));
    const [b] = ler(csv(linha({ status: 'X', baixa: 'S', serie: '999', leituras: '999999', destino: 'outro', posicao: 'DEMO', area: 'qualquer' })));
    const sem = (l: LinhaBipagemLida | undefined) => ({ ...l, lidos: undefined });
    expect(sem(b)).toEqual(sem(a));
    expect(a).toMatchObject({ volumes: 5, numeroDocumento: '000123', cnpj: '08.250.575/0002-55', cnpjDigitos: '08250575000255', erros: [] });
  });

  it('Lidos = 0 não gera entrada (nem exige identificação); vazio, negativo, fracionário ou texto é erro, nunca zero', () => {
    const [zero] = ler(csv(linha({ lidos: '0', tipo: '', numero: '' })));
    expect(zero).toMatchObject({ volumes: 0, erros: [] });
    for (const valor of ['', '-1', '0.5', '0,5', '#VALUE!', 'NaN']) {
      const [l] = ler(csv(linha({ lidos: valor })));
      expect(l?.volumes, valor).toBeNull();
      expect(l?.erros.some((e) => e.field === 'readVolumes'), valor).toBe(true);
    }
  });

  it('identificação: número como texto (zeros preservados), CNPJ opcional e sem completar texto incompleto; tipo desconhecido é erro', () => {
    const [semCnpj] = ler(csv(linha({ cnpj: '' })));
    expect(semCnpj).toMatchObject({ cnpj: null, cnpjDigitos: null, erros: [], avisos: [] });
    const [curto] = ler(csv(linha({ cnpj: '8.250.575/0002-55' })));
    expect(curto).toMatchObject({ cnpj: '8.250.575/0002-55', cnpjDigitos: null, erros: [] });
    expect(curto?.avisos.map((a) => a.code)).toEqual(['CNPJ_INCOMPLETO']);
    const [cte] = ler(csv(linha({ tipo: 'CT-e' })));
    expect(cte?.erros.map((e) => e.code)).toEqual(['TIPO_DESCONHECIDO']);
    const [semRemetente] = ler(csv(linha({ remetente: '' })));
    expect(semRemetente?.erros.map((e) => e.field)).toEqual(['sender']);
    const [ok] = ler(csv(linha({})));
    expect(ok?.chave).toBe(chaveIdentidadeBipagem({ tipo: 'NF', numero: '000123', cnpj: '08250575000255', remetente: 'Empresa Exemplo' }));
  });

  it('cabeçalhos normalizados em outra ordem e linha; arquivo sem CNPJ nem Última Leitura é aceito', () => {
    const r = reconhecerBipagem(Buffer.from('Relatório;;;\r\n  REMETENTE ;Leituras;lidos;numero;TIPO\r\nRemetente Fictício;9;2;000123;nf-e\r\n', 'utf8'), 'CSV', LIMITES_PLANILHA_PADRAO);
    expect(r.tabela.opcoes.headerRow).toBe(2);
    expect(r.colunas).toEqual({ documentType: 4, documentNumber: 3, readVolumes: 2, sender: 0, senderCnpj: null, lastRead: null });
  });

  it('falta de coluna obrigatória: erro curto com o nome do que falta e a orientação de exportar no padrão', () => {
    const sem = Buffer.from('Tipo;Número;Leituras;CNPJ Remetente;Remetente\r\nNF-e;1;1;11.111.111/0001-11;X\r\n', 'utf8');
    expect(() => reconhecerBipagem(sem, 'CSV', LIMITES_PLANILHA_PADRAO)).toThrow(ErroArquivo);
    expect(() => reconhecerBipagem(sem, 'CSV', LIMITES_PLANILHA_PADRAO)).toThrow(/Não encontrei a coluna Lidos.*padrão "Etiquetas"/);
  });

  it('Última Leitura sem fuso inventado: serial do Excel, DD/MM/AAAA HH:MM e ISO; texto não reconhecido vira aviso', () => {
    const celula = (texto: string, tipo: 'NUMERO' | 'TEXTO' | 'DATA' = 'TEXTO') => ({ texto, tipo, formula: false, formatoTexto: false, longa: false });
    expect(lerUltimaLeitura(celula('46314.5', 'NUMERO')).valor).toBe('2026-10-19T12:00:00');
    expect(lerUltimaLeitura(celula('19/10/2026 12:00')).valor).toBe('2026-10-19T12:00:00');
    expect(lerUltimaLeitura(celula('2026-10-19T12:00:00', 'DATA')).valor).toBe('2026-10-19T12:00:00');
    expect(lerUltimaLeitura(celula('ontem')).aviso?.code).toBe('ULTIMA_LEITURA');
    const [l] = ler(csv(linha({ ultima: '19/10/2026 08:15:30' })));
    expect(l?.ultimaLeitura).toBe('2026-10-19T08:15:30');
  });
});
