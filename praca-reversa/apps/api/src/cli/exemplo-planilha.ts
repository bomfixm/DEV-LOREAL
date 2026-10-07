/**
 * Gera o arquivo de exemplo da planilha única com dados FICTÍCIOS (sem banco),
 * pelo mesmo montador da publicação: examples/planilha/Praca-Reversa-EXEMPLO-FICTICIO.xlsx.
 *
 * Uso: npm run planilha:exemplo
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ_REPOSITORIO } from '../config.js';
import type { LinhaInventarioPlanilha, SnapshotPlanilha } from '../modules/planilha/dados.js';
import { montarPlanilha } from '../modules/planilha/montar.js';
import type { ConfigPlanilha } from '../modules/planilha/situacao.js';

const linha = (x: Partial<LinhaInventarioPlanilha> & Pick<LinhaInventarioPlanilha, 'endereco' | 'situacao'>): LinhaInventarioPlanilha => ({
  palete: null,
  nfd: null,
  remetente: null,
  cidade: null,
  volumes: null,
  paleteFull: 'Não informado',
  maisDeUmPalete: 'Não',
  produto: null,
  delivery: null,
  semAlocacao: false,
  semNota: false,
  identidade: null,
  ...x,
});

const instante = new Date('2026-10-06T15:00:00Z');
const snapshot: SnapshotPlanilha = {
  escopo: { id: '00000000-0000-4000-8000-000000000001', nome: 'Exemplo', unidade: 'EXEMPLO', unidadeNome: 'Unidade fictícia', cliente: 'FICTICIO', clienteNome: 'Cliente fictício', demonstracao: true },
  instante,
  inventario: [
    linha({ endereco: '11 - A50', palete: 'PR-000001', nfd: '00001001', remetente: 'Loja Alfa (fictícia)', cidade: 'Campinas', volumes: '20', paleteFull: 'Sim', maisDeUmPalete: 'Sim', produto: 'Shampoo (exemplo)', situacao: 'Conferido e validado · Posição F01-P05', delivery: '0089000001', identidade: 'a' }),
    linha({ endereco: '12 - A102', palete: 'PR-000002', nfd: '00001001', remetente: 'Loja Alfa (fictícia)', cidade: 'Campinas', volumes: '15', paleteFull: 'Sim', maisDeUmPalete: 'Sim', produto: 'Shampoo (exemplo)', situacao: 'Não conferido · Posição no mapa pendente', delivery: '0089000001', identidade: 'a' }),
    linha({ endereco: '13 - A103', palete: 'PR-000003', nfd: '00001002', remetente: 'Loja Beta (fictícia)', volumes: '6', paleteFull: 'Não', situacao: 'Não conferido · Posição no mapa pendente', delivery: '0089000002', identidade: 'b' }),
    linha({ endereco: '13 - A103', palete: 'PR-000003', nfd: '00001003', remetente: 'Loja Beta (fictícia)', volumes: '4', paleteFull: 'Não', produto: 'Caixa 1: Sérum (exemplo)', situacao: 'Não conferido · Posição no mapa pendente', delivery: '0089000003', identidade: 'c' }),
    linha({ endereco: '14 - A108', palete: 'PR-000004', nfd: '00001004', remetente: 'Loja Gama (fictícia)', situacao: 'Não conferido · Posição no mapa pendente · volumes pendentes', delivery: '0089000004', identidade: 'd' }),
    linha({ endereco: '15 - A110', palete: 'PR-000005', remetente: 'Loja Delta (fictícia)', volumes: '2', situacao: 'Documento MI 00002001 (não é NFD) · Não conferido · Posição no mapa pendente', identidade: 'e' }),
    linha({ endereco: 'Sem alocação', nfd: '00001005', remetente: 'Loja Épsilon (fictícia)', volumes: '8', situacao: 'Sem alocação: saiu desta praça (endereço antigo 15 - A126 livre no INV-000001, linha 40); local atual não informado', delivery: '0089000005', semAlocacao: true, identidade: 'f' }),
  ],
  eventos: [
    { id: '7a1e0c3e-0000-4000-8000-000000000003', em: new Date('2026-10-06T13:15:00Z'), alteracao: 'Produto na caixa informado', nfd: '00001003', palete: 'PR-000003', origem: null, destino: null, responsavel: 'Operador fictício B (operador.b)', descricao: 'Produto na caixa: "" → "Sérum (exemplo)".' },
    { id: '7a1e0c3e-0000-4000-8000-000000000002', em: new Date('2026-10-06T12:40:00Z'), alteracao: 'Movimentação', nfd: null, palete: 'PR-000001', origem: 'Sem posição', destino: 'F01-P05', responsavel: 'Operador fictício A (operador.a)', descricao: 'Palete misto não se repete por nota: um evento.' },
    { id: '7a1e0c3e-0000-4000-8000-000000000001', em: new Date('2026-10-06T12:00:00Z'), alteracao: 'Inventário importado', nfd: null, palete: null, origem: null, destino: null, responsavel: 'Supervisor fictício (supervisor.x)', descricao: 'INV-000001: 6 vínculos, 5 paletes cadastrados.' },
  ],
  eventosTotal: 3,
  alteracoesVistas: [],
  pendentes: { quantidade: 2, desde: new Date('2026-10-06T14:59:20Z') },
  controle: { falhasSeguidas: 0, ultimaFalha: null, ultimaFalhaEm: null },
  ultimaPublicada: null,
  ultimaGerada: null,
  ultimaFalha: null,
  ultimoBackupVerificado: null,
  ultimoBackup: null,
  ultimoTesteRestauracao: null,
};

const config: ConfigPlanilha = {
  automatica: false,
  destino: null,
  pastaLocal: '',
  intervaloMs: 20_000,
  agruparMs: 30_000,
  reconciliarMs: 3_600_000,
  versoesManter: 60,
  eventosMax: 20_000,
  concessaoMs: 600_000,
  backup: { prazoHoras: 26, destinoDescricao: null, responsavel: null, restauracaoPrazoDias: 90 },
};

const pasta = join(RAIZ_REPOSITORIO, 'examples', 'planilha');
mkdirSync(pasta, { recursive: true });
const destino = join(pasta, 'Praca-Reversa-EXEMPLO-FICTICIO.xlsx');
writeFileSync(destino, montarPlanilha(snapshot, 1, config).buffer);
console.log(`Exemplo fictício gerado: ${destino}`);
