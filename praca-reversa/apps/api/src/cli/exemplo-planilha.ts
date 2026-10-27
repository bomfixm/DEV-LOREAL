/**
 * Gera o arquivo de exemplo da planilha com dados FICTÍCIOS (sem banco), pelo
 * mesmo montador e pela mesma validação da geração real:
 * examples/planilha/Praca-Reversa-EXEMPLO-FICTICIO.xlsx. Serve para ver o
 * formato; a planilha da operação é gerada automaticamente pelo aplicativo.
 *
 * Uso: npm run planilha:exemplo
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ_REPOSITORIO } from '../config.js';
import { totalizar, type LinhaInventarioPlanilha, type SnapshotPlanilha } from '../modules/planilha/dados.js';
import { montarArquivos } from '../modules/planilha/montar.js';
import { validarArquivos } from '../modules/planilha/validar.js';
import { PLANILHA_PADRAO } from '../modules/protecao/configuracao.js';

const linha = (x: Partial<LinhaInventarioPlanilha> & Pick<LinhaInventarioPlanilha, 'grupo' | 'situacao' | 'referencia'>): LinhaInventarioPlanilha => ({
  palete: null,
  delivery: null,
  tipo: null,
  numero: null,
  volumes: null,
  volumesTexto: null,
  remetente: null,
  mesAgenda: null,
  janela: null,
  endereco: null,
  documentacao: null,
  palletFull: null,
  categoria: null,
  dataInventario: null,
  pendencia: null,
  origemVolumes: 'Informado no inventário',
  conferencia: null,
  fileira: null,
  tipoPalete: null,
  produto: null,
  origemRegistro: 'INV-000001 · linha 3',
  ...x,
});

const instante = new Date('2026-10-26T15:00:00Z');
const inventario: LinhaInventarioPlanilha[] = [
  linha({ grupo: 'ESTOQUE', referencia: '00000000-0000-4000-8000-000000000101', palete: '256', delivery: '0089000001', tipo: 'NFD', numero: '00001001', volumes: 20, remetente: 'Loja Alfa (fictícia)', endereco: '11 - A42', documentacao: 'VALIDADA', palletFull: '01/02', categoria: 'CNPJ', dataInventario: '20/10/2026', situacao: 'No palete', conferencia: 'Conferido em 21/10/2026', fileira: '11', tipoPalete: 'Full (uma nota)', origemVolumes: 'Contado no aplicativo' }),
  linha({ grupo: 'ESTOQUE', referencia: '00000000-0000-4000-8000-000000000102', palete: '257', delivery: '0089000001', tipo: 'NFD', numero: '00001001', volumes: 15, remetente: 'Loja Alfa (fictícia)', endereco: '11 - A44', documentacao: 'VALIDADA', palletFull: '02/02', categoria: 'CNPJ', situacao: 'No palete', conferencia: 'Não conferido', fileira: '11', tipoPalete: 'Full (uma nota)', origemRegistro: 'INV-000001 · linha 4' }),
  linha({ grupo: 'ESTOQUE', referencia: '00000000-0000-4000-8000-000000000103', palete: '301', delivery: '0089000002', tipo: 'NFD', numero: '00001002', volumesTexto: 'Não informado', origemVolumes: 'Não informado', remetente: 'Loja Beta (fictícia)', endereco: '12 - A80', palletFull: 'FRACIONADO', situacao: 'No palete', pendencia: 'Reconferência exigida', fileira: '12', tipoPalete: 'Misto (várias notas)', origemRegistro: 'INV-000001 · linha 5' }),
  linha({ grupo: 'ESTOQUE', referencia: '00000000-0000-4000-8000-000000000104', palete: '301', tipo: 'NF', numero: '=2+2', volumes: 4, remetente: 'Loja Gama (fictícia)', endereco: '12 - A80', situacao: 'No palete · saída parcial de 2 volume(s)', fileira: '12', tipoPalete: 'Misto (várias notas)', origemRegistro: 'Cadastro no aplicativo em 22/10/2026', origemVolumes: 'Contado no aplicativo' }),
  linha({ grupo: 'VALIDACAO', referencia: '00000000-0000-4000-8000-000000000105', delivery: '0089000005', tipo: 'NFD', numero: '00001005', volumesTexto: 'Pendente: 8 volume(s) a localizar', remetente: 'Loja Delta (fictícia)', situacao: 'Em validação — sem endereço (fora do estoque físico)', pendencia: 'Validação desde 21/10/2026: N° Pallet de outro endereço · último palete conhecido 1 (11 - A42)', origemVolumes: 'Última quantidade registrada', origemRegistro: 'INV-000001 · linha 7' }),
  linha({ grupo: 'PENDENTE', referencia: '00000000-0000-4000-8000-000000000106', delivery: '0089000006', tipo: 'NFD', numero: '00001006', volumesTexto: 'Pendente: 3 informado(s)', remetente: 'Loja Épsilon (fictícia)', situacao: 'Pendente no lote ativo (endereço na fonte: 13 - A10, N° Pallet 12)', pendencia: 'Em revisão: Endereço com mais de um N° Pallet', origemVolumes: 'Informado na fonte (não somado)', origemRegistro: 'INV-000001 · linha 9' }),
];
const snapshot: SnapshotPlanilha = {
  escopo: { id: '00000000-0000-4000-8000-000000000001', nome: 'Exemplo', unidade: 'EXEMPLO', unidadeNome: 'Unidade fictícia', cliente: 'FICTICIO', clienteNome: 'Cliente fictício', demonstracao: true },
  instante,
  loteAtivo: { codigo: 'INV-000001', descricao: 'Inventário fictício', criadoEm: new Date('2026-10-20T12:00:00Z'), dataConferencia: null },
  inventario,
  totais: totalizar(inventario, 0),
  eventos: [
    { id: 'C-7a1e0c3e-0000-4000-8000-000000000003', em: new Date('2026-10-26T13:15:00Z'), acao: 'Contagem de volumes', palete: '256', documento: 'NFD 00001001', antes: '18 (informado)', depois: '20', responsavel: 'Operador fictício B (operador.b)', descricao: 'Contado no aplicativo', fonte: 'Contagem' },
    { id: 'A-7a1e0c3e-0000-4000-8000-000000000002', em: new Date('2026-10-26T12:40:00Z'), acao: 'Movimentação do palete', palete: '256', documento: null, antes: 'Sem posição', depois: '11 - A42', responsavel: 'Operador fictício A (operador.a)', descricao: 'Palete misto não se repete por nota: um evento.', fonte: 'Auditoria' },
    { id: 'A-7a1e0c3e-0000-4000-8000-000000000001', em: new Date('2026-10-20T12:00:00Z'), acao: 'Inventário importado', palete: null, documento: null, antes: null, depois: null, responsavel: 'Supervisor fictício (supervisor.x)', descricao: 'INV-000001: 6 vínculo(s), 4 palete(s) cadastrado(s).', fonte: 'Auditoria' },
  ],
  alteracoes: { ids: ['1', '2'], ultimaEm: new Date('2026-10-26T14:59:20Z') },
  ultimaPlanilhaPublicada: null,
  ultimoBackupLocal: null,
  ultimoBackupExterno: null,
  ultimoTesteRestauracao: null,
};

const arquivos = montarArquivos(snapshot, { revisao: 1, geradoEm: instante, rotulo: 'INV-000001', config: PLANILHA_PADRAO, destino: null }, 'Praca-Reversa-EXEMPLO-FICTICIO');
validarArquivos(arquivos, snapshot, 1);
const pasta = join(RAIZ_REPOSITORIO, 'examples', 'planilha');
mkdirSync(pasta, { recursive: true });
const destino = join(pasta, 'Praca-Reversa-EXEMPLO-FICTICIO.xlsx');
writeFileSync(destino, arquivos[0]?.buffer ?? Buffer.alloc(0));
console.log(`Exemplo fictício gerado e validado: ${destino}`);
