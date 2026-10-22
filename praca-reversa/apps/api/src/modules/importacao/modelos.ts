/**
 * Modelos de importação (dados fictícios), alinhados aos campos realmente
 * aceitos. Os dois tipos podem ser importados pelo próprio fluxo: primeiro
 * produtos, depois devoluções (que exigem os SKUs cadastrados).
 */
import { CAMPOS_IMPORTACAO, type ArquivoModelo, type TipoImportacao } from '@praca-reversa/contracts';
import { celulaCsv, documentoCsv } from '../../http/csv-seguro.js';
import { escreverXlsx, type PlanilhaModelo } from './arquivo/xlsx-escrita.js';

type Valor = string | number | null;

/** Linhas fictícias: códigos com zeros à esquerda, lote pendente, fator pendente e quantidade decimal. */
const DADOS: Readonly<Record<TipoImportacao, readonly (readonly Valor[])[]>> = {
  PRODUTOS: [
    ['000123', 'Xampu fictício 300 ml', 'UN', '0200000123001', 'UN', 1],
    ['000123', 'Xampu fictício 300 ml', 'UN', '10200000123008', 'CX', 12],
    ['000456', 'Condicionador fictício 200 ml', 'UN', '0200000456005', 'UN', 1],
    ['000456', 'Condicionador fictício 200 ml', 'UN', '10200000456002', 'CX', null],
    ['MODELO-789', 'Máscara capilar fictícia 1 kg', 'UN', null, null, null],
    ['MODELO-KG', 'Pó descolorante fictício a granel', 'KG', null, null, null],
  ],
  DEVOLUCOES: [
    ['DEV-MODELO-0001', '1', '000123', 100, 'UN', '000045678', 'L0001', '15/09/2026'],
    ['DEV-MODELO-0001', '2', '000123', 2, 'CX', '000045678', null, '15/09/2026'],
    ['DEV-MODELO-0002', '1', '000456', 5, 'UN', null, null, null],
    ['DEV-MODELO-0002', '2', 'MODELO-789', 7, 'UN', '000045679', 'L0789', '16/09/2026'],
    ['DEV-MODELO-0002', '3', 'MODELO-KG', 1.5, 'KG', '000045679', null, '16/09/2026'],
  ],
  // Referência, linha, motivo, SKU, quantidade, unidade, descrição, lote, lote exigido, tipo/ref./linha da origem,
  // abertura, ocorrência, prazo, responsável, prioridade, valor, base, moeda, fonte, situação externa,
  // cobrança, cobrança finalizada e observações — dados do caso repetidos em cada linha do mesmo caso.
  CLAIMS: [
    ['CLM-MODELO-0001', '1', 'FALTA', '000123', 12, 'UN', 'Xampu fictício 300 ml', 'L0001', 'NAO', 'DEVOLUCAO', 'DEV-MODELO-0001', '1', '10/09/2026', null, '30/10/2026', null, 'ALTA', 15.9, 'UNITARIO', 'BRL', 'Tabela de preço fictícia', 'Aberto no portal (fictício)', 'COB-MODELO-0001', 'NAO', 'Exemplo fictício'],
    ['CLM-MODELO-0001', '2', 'FALTA', '000456', 3, 'UN', 'Condicionador fictício 200 ml', null, 'NAO', 'DEVOLUCAO', 'DEV-MODELO-0002', '1', '10/09/2026', null, '30/10/2026', null, 'ALTA', null, null, 'BRL', 'Tabela de preço fictícia', 'Aberto no portal (fictício)', 'COB-MODELO-0001', 'NAO', 'Exemplo fictício'],
    ['CLM-MODELO-0002', '1', 'AVARIA', '000123', 2, 'UN', null, null, 'NAO', null, null, null, '12/09/2026', '11/09/2026', null, null, null, 120, 'TOTAL', 'BRL', 'Portal do cliente (fictício)', null, null, 'SIM', 'Origem e prazo não informados: ficam pendentes'],
  ],
  // RUA, N° Pallet, NUMERO, TIPO, DELIVERY, VOLUMES, DOCUMENTAÇÃO, PALLET FULL, REMETENTE, MÊS AGENDA, JANELA, PF/CNPJ,
  // situação do endereço: NF em dois paletes, duas NFs no mesmo palete, volumes zero e endereço livre por texto (fictícios).
  INVENTARIO: [
    ['15 - A101', 'M9001', 'MOD000123401', 'NFD', 'DLV00000012', 3, 'VALIDADA', '01\\02', 'Remetente fictício A', 'Outubro', '2', 'CNPJ', null],
    ['15 - A101', 'M9001', 'MOD000123402', 'NFD', 'DLV00000013', 2, 'VALIDAR', null, 'Remetente fictício B', 'Outubro', '2', 'PF', null],
    ['15 - A103', 'M9002', 'MOD000123401', 'NFD', 'DLV00000012', 1, 'VALIDADA', '02\\02', 'Remetente fictício A', 'Outubro', '2', 'CNPJ', null],
    ['GR - 5', 'M9003', 'MOD000555', 'MI', null, 0, null, null, null, null, null, null, null],
    ['13 - A120', 'M9004', 'MOD000777', 'NFD', null, 4, 'VALIDADA', null, null, null, null, 'CNPJ', 'LIVRE'],
  ],
  // Palete, NF, tipo, delivery, linha do inventário, linha do pedido, SKU, lote, quantidade, unidade, marcação,
  // abrangência, janela, endereço informado, observação (fictícios).
  // Tipo, Número, Lidos, CNPJ Remetente, Remetente (layout da exportação real; demais colunas são ignoradas) — fictícios.
  BIPAGEM: [
    ['NF-e', '900001', 3, '11.111.111/0001-11', 'Remetente fictício A'],
    ['NF-e', '900002', 0, '11.111.111/0001-11', 'Remetente fictício A'],
    ['Minuta', '501', 1, '22.222.222/0001-22', 'Remetente fictício B'],
  ],
  SELECAO_CLIENTE: [
    [null, 'MOD000123401', 'NFD', null, null, '1', null, null, null, null, null, 'NF', '2', null, 'Material da NF que consta do inventário'],
    ['M9003', null, null, null, null, '2', null, null, null, null, null, 'PALETE', '2', 'GR - 5', 'Palete inteiro'],
    [null, 'MOD000123402', 'NFD', null, null, '3', 'MODELO-789', null, 10, 'UN', null, 'LINHA', '2', null, 'Linha/produto com quantidade'],
  ],
};

const NOMES: Readonly<Record<TipoImportacao, string>> = {
  PRODUTOS: 'Produtos',
  DEVOLUCOES: 'Devoluções',
  CLAIMS: 'Claims',
  INVENTARIO: 'Inventário',
  SELECAO_CLIENTE: 'Seleção',
  BIPAGEM: 'Bipagem',
};

/** Tipo do modelo pelo nome do arquivo. */
export function tipoDoModelo(arquivo: ArquivoModelo): TipoImportacao {
  if (arquivo.startsWith('produtos')) return 'PRODUTOS';
  if (arquivo.startsWith('claims')) return 'CLAIMS';
  if (arquivo.startsWith('inventario')) return 'INVENTARIO';
  if (arquivo.startsWith('selecao')) return 'SELECAO_CLIENTE';
  if (arquivo.startsWith('bipagem')) return 'BIPAGEM';
  return 'DEVOLUCOES';
}

function instrucoes(tipo: TipoImportacao): PlanilhaModelo {
  const campos = CAMPOS_IMPORTACAO[tipo];
  const gerais: (readonly Valor[])[] = [
    ['Observação', '', 'Modelo com dados fictícios. Apague as linhas de exemplo e preencha com os dados reais na planilha da primeira aba.'],
    ['Observação', '', 'Identificadores (SKU, códigos, lote, NF, referências) ficam em colunas de Texto: zeros à esquerda são preservados. Não use fórmulas.'],
    ['Observação', '', 'Quantidade e fator: números com até 3 casas decimais; no CSV, escolha na prévia se o decimal é vírgula (padrão) ou ponto; sem separador de milhar.'],
    ['Observação', '', 'Data: DD/MM/AAAA ou AAAA-MM-DD. Campo opcional vazio fica pendente (nada é presumido).'],
    ...(tipo === 'DEVOLUCOES'
      ? [['Observação', '', 'Importar devoluções registra a declaração documental: não cria recebimento, contagem, saldo, ocupação nem liberação.'] as const]
      : tipo === 'CLAIMS'
        ? ([
            ['Observação', '', 'Importar claims cria só registros de investigação: não altera estoque, condição, localização, recuperação, valor confirmado nem nada no sistema do cliente.'],
            ['Observação', '', 'Cada linha é uma linha de um caso: referência do claim + linha identificam a linha. Dados do caso (motivo, datas, prazo, responsável, prioridade, moeda, fonte, situação externa, cobrança, observações) se repetem iguais em todas as linhas do mesmo caso.'],
            ['Observação', '', 'Valor estimado: TOTAL = valor da linha inteira (nunca multiplicado de novo); UNITARIO = multiplicado pela quantidade em análise. Estimativa nunca é valor evitado confirmado.'],
            ['Observação', '', 'Mesma referência e linha já registradas com o mesmo conteúdo: duplicata ignorada. Com conteúdo diferente: conflito (nada é sobrescrito; recuperações, decisões e casos encerrados nunca são alterados por importação).'],
          ] as const)
        : tipo === 'INVENTARIO'
          ? ([
              ['Observação', '', 'Inventário conferido: registra NF/documento × palete × endereço × volumes, com a referência da conferência. Não cria saldo validado por produto, não libera e não altera reservas.'],
              ['Observação', '', 'RUA é o endereço completo (fileira ou GR + código local, ex.: 15 - A120). Sem a tabela de correspondência confirmada, a posição visual fica pendente.'],
              ['Observação', '', 'Endereço livre: escolha na prévia a cor de fonte da coluna RUA (XLSX) ou os valores da coluna "Situação do endereço" (CSV) que significam endereço livre.'],
              ['Observação', '', 'Mesma NF em várias linhas do mesmo palete = parcelas (volumes nunca somados). PALLET FULL (ex.: 01\\07) é preservado como texto.'],
            ] as const)
          : tipo === 'BIPAGEM'
            ? ([
                ['Observação', '', 'Modelo fictício no layout da exportação da bipagem: Tipo (NF-e ou Minuta), Número, Lidos, CNPJ Remetente e Remetente, em qualquer ordem. Outras colunas (Status, Série, Leituras, Destino…) podem ficar no arquivo e são ignoradas.'],
                ['Observação', '', 'Lidos = volumes lidos daquele documento no palete (Leituras não é usada). Lidos = 0 fica registrado no lote e não muda o palete.'],
                ['Observação', '', 'Cada documento com leitura vira um conteúdo do palete com a contagem informada. Reenvio com a mesma contagem não duplica; contagem nova substitui a anterior (nunca soma).'],
                ['Observação', '', 'Delivery, SKU e validade são complementos opcionais, preenchidos depois. Importar não libera, não reserva e não expede.'],
              ] as const)
            : tipo === 'SELECAO_CLIENTE'
            ? ([
                ['Observação', '', 'Seleção do cliente: cada linha é uma solicitação (ou, no inventário com marcação, só as linhas com o valor escolhido na prévia).'],
                ['Observação', '', 'Abrangência: PALETE (palete inteiro), NF (material da NF/devolução) ou LINHA (produto e quantidade). Vazio = regra pela identificação da linha.'],
                ['Observação', '', 'Quantidade vazia = não informada (nunca zero). Importar não reserva, não libera e não altera estoque.'],
              ] as const)
            : [['Observação', '', 'Cadastrar produto não cria saldo físico. Repita o SKU em outra linha para acrescentar outro código de barras.'] as const]),
  ];
  return {
    nome: 'Instruções',
    colunas: [
      { titulo: 'Campo', largura: 28, texto: true },
      { titulo: 'Obrigatório', largura: 12, texto: true },
      { titulo: 'Regra', largura: 110, texto: true },
    ],
    linhas: [...campos.map((c) => [c.rotulo, c.obrigatorio ? 'Sim' : 'Não', c.ajuda] as const), ...gerais],
  };
}

function planilhaDados(tipo: TipoImportacao): PlanilhaModelo {
  const numericos = new Set(['factor', 'quantity', 'estimatedValue', 'volumes']);
  return {
    nome: NOMES[tipo],
    colunas: CAMPOS_IMPORTACAO[tipo].map((c) => ({ titulo: c.rotulo, largura: Math.max(14, c.rotulo.length + 4), texto: !numericos.has(c.campo) })),
    linhas: DADOS[tipo],
  };
}

export function gerarModelo(arquivo: ArquivoModelo): { conteudo: Buffer; tipoConteudo: string } {
  const tipo = tipoDoModelo(arquivo);
  if (arquivo.endsWith('.xlsx')) {
    return {
      conteudo: escreverXlsx([planilhaDados(tipo), instrucoes(tipo)]),
      tipoConteudo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
  const cabecalho = CAMPOS_IMPORTACAO[tipo].map((c) => celulaCsv(c.rotulo));
  const linhas = DADOS[tipo].map((l) => l.map((v) => (v === null ? '' : celulaCsv(typeof v === 'number' ? String(v).replace('.', ',') : v))));
  return { conteudo: documentoCsv([cabecalho, ...linhas]), tipoConteudo: 'text/csv; charset=utf-8' };
}
