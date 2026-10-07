import { normalizarEndereco } from '@praca-reversa/contracts';
import { createHash } from 'node:crypto';
import { SCHEMA_PACOTE, type PacoteCarga, type VinculoPacote } from '../../src/modules/importacao/carga-lote.js';
import { contextoDocumental, hashContexto, lerMarcadoresFull } from '../../src/modules/importacao/identidade.js';

/**
 * Gera um pacote de carga em lote (schema v1) coerente a partir de linhas
 * simples, com as mesmas regras da preparação: vínculo = endereço × identidade
 * documental; linhas repetidas agrupadas sem somar volumes; endereço livre vira
 * referência fora da praça. Dados fictícios (nunca o pacote real).
 */
export interface LinhaTeste {
  linha: number;
  tipo?: string;
  numero?: string;
  delivery?: string;
  remetente?: string;
  endereco: string;
  livre?: boolean;
  /** Texto como na planilha ('' = não informado). */
  volumes?: string;
  marcador?: string;
  numeroPlanilha?: string;
}

const COR_LIVRE = 'FF00B050';
const CABECALHOS = { A: 'DELIVERY', B: 'TIPO', C: 'NUMERO', D: 'VOLUMES', E: 'REMETENTE', F: 'RUA', G: 'N° PALLET', H: 'DOCUMENTAÇÃO', I: 'PALLET FULL' } as const;

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

export function montarPacote(linhas: readonly LinhaTeste[], opcoes: { variante?: string; cidades?: Readonly<Record<string, string>> } = {}): PacoteCarga {
  const fonte = linhas.map((x) => {
    const tipo = x.tipo ?? '';
    const numero = x.numero ?? '';
    const delivery = x.delivery ?? '';
    const remetente = x.remetente ?? '';
    const n = normalizarEndereco(x.endereco);
    if (!n.ok) throw new Error(`Endereço de teste inválido: ${x.endereco}`);
    const volumesTexto = x.volumes ?? '';
    const volumes = /^\d+(\.\d+)?$/.test(volumesTexto) ? volumesTexto : null;
    const contexto = contextoDocumental(tipo, numero, delivery, remetente);
    const campos = { DELIVERY: delivery, TIPO: tipo, NUMERO: numero, VOLUMES: volumesTexto, REMETENTE: remetente, RUA: x.endereco, 'N° PALLET': x.numeroPlanilha ?? '', DOCUMENTAÇÃO: '', 'PALLET FULL': x.marcador ?? '' };
    return {
      linha: x.linha,
      chave_linha: sha(['linha', x.linha, opcoes.variante ?? '']),
      chave_conteudo: sha(['conteudo', campos]),
      tipo,
      numero,
      delivery,
      remetente,
      endereco_original: x.endereco,
      endereco: n.endereco,
      fileira: n.prefixo,
      codigo_local: n.codigoLocal,
      lado_regra: null,
      numero_na_planilha: x.numeroPlanilha ?? '',
      endereco_livre: x.livre === true,
      volumes,
      volumes_original: volumesTexto,
      marcador_full_original: x.marcador ?? '',
      documentacao: '',
      cidade_destino: '',
      produto_na_caixa: '',
      contexto_documental: [...contexto] as [string, string, string, string],
      chave_documento: numero === '' ? null : hashContexto(contexto),
      campos_originais: campos,
    };
  });

  // Vínculos: endereço × identidade documental (linhas agrupadas pela ordem de origem).
  const grupos = new Map<string, typeof fonte>();
  for (const l of fonte) {
    if (l.chave_documento === null) continue;
    const k = `${l.endereco}|${l.chave_documento}`;
    grupos.set(k, [...(grupos.get(k) ?? []), l]);
  }
  const porIdentidade = (chave: string) => fonte.filter((l) => l.chave_documento === chave);
  const vinculos: (VinculoPacote & { grupo: 'NFD' | 'PENDENTE' | 'FORA' })[] = [...grupos.values()].map((ls) => {
    const [p] = ls;
    if (!p?.chave_documento) throw new Error('grupo vazio');
    const mesmos = porIdentidade(p.chave_documento);
    const marcadores = lerMarcadoresFull(mesmos.map((l) => l.marcador_full_original));
    const enderecosNaPraca = [...new Set(mesmos.filter((l) => !l.endereco_livre).map((l) => l.endereco))];
    const volumes = ls.length === 1 ? p.volumes : null;
    const outrosContextos = fonte.some((l) => l.numero === p.numero && l.chave_documento !== p.chave_documento);
    const tipo = p.tipo === '' ? null : p.tipo;
    const pendencias = [
      ...(volumes === null ? [ls.length > 1 ? 'VOLUMES_EM_MULTIPLAS_LINHAS_A_CONFIRMAR' : 'VOLUMES_NAO_INFORMADOS_OU_INVALIDOS'] : []),
      ...(outrosContextos ? ['MESMO_NUMERO_EM_CONTEXTOS_DOCUMENTAIS_DISTINTOS'] : []),
      ...(tipo === null ? ['TIPO_DOCUMENTAL_PENDENTE'] : tipo !== 'NFD' ? ['DOCUMENTO_DE_OUTRO_TIPO'] : []),
    ];
    const naPosicao = fonte.filter((l) => l.endereco === p.endereco && l.chave_documento !== null);
    const identidadesNaPosicao = new Set(naPosicao.map((l) => l.chave_documento));
    const semNumero = fonte.some((l) => l.endereco === p.endereco && l.chave_documento === null);
    const grupo = p.endereco_livre ? ('FORA' as const) : tipo === 'NFD' ? ('NFD' as const) : ('PENDENTE' as const);
    return {
      grupo,
      chave_vinculo: sha(['vinculo', p.endereco, p.chave_documento]),
      chave_documento: p.chave_documento,
      nfd: tipo === 'NFD' ? p.numero : null,
      numero_documento: p.numero,
      tipo_documento: tipo,
      delivery: p.delivery === '' ? null : p.delivery,
      remetente: p.remetente,
      remetentes_na_origem: [...new Set(ls.map((l) => l.remetente))],
      cidade_destino: opcoes.cidades?.[p.numero] ?? '',
      produto_na_caixa: '',
      volumes,
      volumes_base: 'volumes informados no inventário',
      volumes_na_origem: ls.map((l) => ({ linha: l.linha, valor: l.volumes, texto_original: l.volumes_original })),
      palete_full: identidadesNaPosicao.size > 1 ? false : tipo === 'NFD' && !semNumero ? true : null,
      full_base: 'uma única identidade de NFD no endereço',
      marcadores_full_originais: ls.map((l) => l.marcador_full_original),
      mais_de_um_palete_da_nfd_no_inventario: (marcadores.total ?? 0) > 1 || new Set(mesmos.map((l) => l.endereco)).size > 1,
      quantidade_paletes_declarada_nfd: marcadores.total,
      quantidade_enderecos_nfd_na_praca: enderecosNaPraca.length,
      enderecos_nfd_na_praca: enderecosNaPraca,
      enderecos_nfd_na_origem: [...new Set(mesmos.map((l) => l.endereco))],
      partes_full_neste_endereco: lerMarcadoresFull(ls.map((l) => l.marcador_full_original)).partes,
      endereco: grupo === 'FORA' ? null : p.endereco,
      endereco_referencia: p.endereco,
      numero_palete_na_planilha: p.numero_na_planilha === '' ? null : p.numero_na_planilha,
      linhas_origem: ls.map((l) => l.linha),
      pendencias,
      situacao_localizacao: grupo === 'FORA' ? ('FORA_DA_PRACA_SEM_ENDERECO_ATUAL' as const) : ('INFORMADA_NO_INVENTARIO' as const),
    };
  });
  const semGrupo = (v: (typeof vinculos)[number]): VinculoPacote => {
    const { grupo: _grupo, ...resto } = v;
    return resto;
  };
  const N = vinculos.filter((v) => v.grupo === 'NFD');
  const T = vinculos.filter((v) => v.grupo === 'PENDENTE');
  const F = vinculos.filter((v) => v.grupo === 'FORA');

  const enderecos = [...new Set(fonte.map((l) => l.endereco))];
  const posicoes = enderecos.map((e) => {
    const ls = fonte.filter((l) => l.endereco === e);
    const livre = ls.some((l) => l.endereco_livre);
    const nfd = N.filter((v) => v.endereco === e);
    const pend = T.filter((v) => v.endereco === e);
    const identidades = new Set([...nfd, ...pend].map((v) => v.chave_documento));
    const semNumero = ls.some((l) => l.chave_documento === null);
    const n = normalizarEndereco(e);
    return {
      endereco: e,
      enderecos_originais: [...new Set(ls.map((l) => l.endereco_original))],
      fileira: n.ok ? n.prefixo : null,
      codigo_local: n.ok ? n.codigoLocal : null,
      bloco_referencia: null,
      lado_regra: null,
      coordenadas_mapa: null,
      numero_na_planilha: ls.find((l) => l.numero_na_planilha !== '')?.numero_na_planilha ?? null,
      numero_eh_id_permanente_palete: false as const,
      endereco_livre: livre,
      situacao: livre ? ('ENDERECO_LIVRE' as const) : nfd.length > 0 ? ('COM_NFD_INFORMADA' as const) : pend.length > 0 ? ('DOCUMENTO_PENDENTE' as const) : ('CONTEUDO_NAO_INFORMADO' as const),
      palete_full: livre ? null : identidades.size > 1 ? false : nfd.length === 1 && pend.length === 0 && !semNumero ? true : null,
      vinculos_nfd: nfd.map((v) => v.chave_vinculo),
      vinculos_tipo_pendente: pend.map((v) => v.chave_vinculo),
      linhas_origem: ls.map((l) => l.linha),
    };
  });
  const repeticoes = [...new Set(fonte.map((l) => l.chave_conteudo))]
    .map((c) => fonte.filter((l) => l.chave_conteudo === c))
    .filter((ls) => ls.length > 1)
    .map((ls) => ({ linhas: ls.map((l) => l.linha), endereco: ls[0]?.endereco ?? '', numero: ls[0]?.numero ?? '', tratamento: 'agrupadas sem somar' }));
  const numerosPlanilha = [...new Set(fonte.map((l) => l.numero_na_planilha).filter((x) => x !== ''))]
    .map((num) => ({ numero_na_planilha: num, enderecos: [...new Set(fonte.filter((l) => l.numero_na_planilha === num).map((l) => l.endereco))], tratamento: 'referência externa' }))
    .filter((x) => x.enderecos.length > 1);
  const ocupadas = posicoes.filter((x) => !x.endereco_livre);
  return {
    schema: SCHEMA_PACOTE,
    id_lote: sha(['lote', opcoes.variante ?? '', fonte.map((l) => l.chave_conteudo)]),
    fonte: { arquivo: 'inventario-ficticio.xlsx', sha256: sha(['fonte', opcoes.variante ?? '']), aba: 'Inventário fictício', cabecalhos: { ...CABECALHOS } },
    regras: {
      endereco_chave: 'endereço completo',
      cor_livre_rua: COR_LIVRE,
      produto_inicial: '',
      cidade_destino_inicial: '',
      volumes_desconhecidos: null,
      somar_linhas_repetidas: false,
      usar_numero_na_planilha_como_id_palete: false,
      criar_saldo_sku_automaticamente: false,
      criar_coordenadas_presumidas: false,
      full: 'uma única NFD',
      mais_de_um_palete: 'marcador ou outros endereços',
      quantidade_enderecos: 'locais não livres',
    },
    campos_visiveis_nota: ['NFD', 'Remetente', 'Cidade destino', 'Volumes', 'Palete full', 'Mesma NFD em mais de um palete', 'Produto na caixa'],
    blocos_fileiras: { FB01: '11', FB02: '12', FB03: '13', FB04: '14', FB05: '15', FB06: '16', FB07: 'GR' },
    resumo: {
      linhas_fonte: fonte.length,
      linhas_nfd_endereco_nao_livre: fonte.filter((l) => l.tipo === 'NFD' && !l.endereco_livre).length,
      vinculos_nfd_na_praca: N.length,
      numeros_nfd_distintos_na_praca: new Set(N.map((v) => v.numero_documento)).size,
      enderecos_com_nfd_na_praca: posicoes.filter((x) => x.situacao === 'COM_NFD_INFORMADA').length,
      enderecos_livres: posicoes.filter((x) => x.endereco_livre).length,
      vinculos_documentais_fora_da_praca: F.length,
      documentos_tipo_pendente_na_praca: T.length,
      grupos_de_linhas_exatamente_iguais: repeticoes.length,
      nfd_com_volumes_pendentes_na_praca: N.filter((v) => v.volumes === null).length,
      enderecos_com_full_sim: ocupadas.filter((x) => x.palete_full === true).length,
      enderecos_com_full_nao: ocupadas.filter((x) => x.palete_full === false).length,
      enderecos_com_full_pendente: ocupadas.filter((x) => x.palete_full === null).length,
    },
    posicoes,
    nfds_na_praca: N.map(semGrupo),
    documentos_fora_da_praca: F.map(semGrupo),
    documentos_tipo_pendente_na_praca: T.map(semGrupo),
    linhas_sem_numero_documento: fonte.filter((l) => l.chave_documento === null),
    repeticoes_exatas: repeticoes,
    numeros_na_planilha_em_varios_enderecos: numerosPlanilha,
    linhas_fonte: fonte,
  };
}

export function bytesDoPacote(p: PacoteCarga): Buffer {
  return Buffer.from(JSON.stringify(p), 'utf8');
}
