/**
 * Conversor do inventário L'Oréal preparado (formato "1.0" do pacote
 * `INVENTARIO-LOREAL-DADOS-E-PROMPT`, base de 20/10/2026) para o pacote de
 * carga em lote (`praca-reversa.importacao-inventario.v1` + extensão de
 * 20/10). Não grava nada: só monta o pacote, que passa pela mesma validação e
 * pelo mesmo carregador das cargas anteriores.
 *
 * Regras (prompt de 20/10/2026):
 * - todas as linhas com conteúdo entram em `linhas_fonte` (rastreáveis);
 * - candidatos à alocação provisória viram vínculos endereço × identidade
 *   documental (mesma chave das cargas anteriores: SHA-256 de
 *   [endereço, chave_documento]), sem somar linhas repetidas;
 * - registros com bloqueio da preparação ficam em `linhas_em_revisao`, com os
 *   motivos de `pendencias.json`: sem alocação, palete ou vínculo;
 * - tipo = código original (NFD, NFE, MI; ausente = pendente); número como
 *   texto; DELIVERY "*" ou erro do Excel = não informada; PF/CNPJ é
 *   classificação; INVENTÁRIO = data informada por linha (ou "VALIDAR"), sem
 *   virar conferência completa do palete; FULL n/m e FRACIONADO preservados;
 * - "GR 1"/"GR14" = Grade ("GR - 1"); "14 - 116" já vem como "14 - A116".
 * - Decisão de 21/10/2026 (`alocarRevisao`): linhas em revisão cujas causas de
 *   bloqueio estão todas entre as liberadas e cujo endereço é válido vão para o
 *   palete do endereço (mesmas regras: sem somar repetidas, N° Pallet só como
 *   referência) e o palete fica com "Reconferência necessária". As demais
 *   continuam em revisão. `corrigirEnderecos` (decisão do usuário, ex.:
 *   "15 - A22" é 15 - A122) troca só o endereço lido dessas linhas — o texto
 *   da planilha continua guardado — e resolve a causa "endereço fora da regra".
 */
import { ROTULOS_CAUSA_REVISAO, normalizarEndereco } from '@praca-reversa/contracts';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SCHEMA_PACOTE, type LinhaFonte, type PacoteCarga, type VinculoPacote } from './carga-lote.js';
import { contextoDocumental, hashContexto, lerMarcadoresFull } from './identidade.js';

export const FORMATO_LOREAL = '1.0';
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

const EtiquetaSchema = z.object({ parte: z.number().int().nullable(), total: z.number().int().nullable(), texto: z.string() });
const RegistroSchema = z.object({
  id_origem: z.string().min(1),
  linha_origem: z.number().int().positive(),
  numero_palete: z.string().nullable(),
  endereco_origem: z.string().nullable(),
  endereco: z.string().nullable(),
  tipo_documento_origem: z.string().nullable(),
  numero_documento: z.string().nullable(),
  delivery: z.string().nullable(),
  delivery_origem: z.string().nullable(),
  volumes: z.number().nonnegative().nullable(),
  remetente: z.string().nullable(),
  palete_full: z.boolean().nullable(),
  identificacao_full_origem: z.string().nullable(),
  etiquetas_full: z.array(EtiquetaSchema),
  classificacao_pf_pj_origem: z.string().nullable(),
  documentacao_origem: z.string().nullable(),
  inventario_origem: z.string().nullable(),
  data_conferencia_informada: z.iso.date().nullable(),
  mes_agenda_origem: z.string().nullable(),
  janela_origem: z.string().nullable(),
  provisorio: z.boolean(),
  pendencias: z.array(z.string()),
  elegivel_para_alocacao_apos_validacao_do_mapa: z.boolean(),
  estado_preparacao: z.enum(['candidato_a_importacao_provisoria', 'revisao_necessaria']),
});
type Registro = z.infer<typeof RegistroSchema>;

export const PreparadoLorealSchema = z.object({
  versao_formato: z.literal(FORMATO_LOREAL),
  resumo: z.object({
    arquivo_origem: z.string().min(1),
    sha256_arquivo: z.string().regex(/^[0-9a-f]{64}$/),
    aba: z.string().min(1),
    data_base: z.iso.date(),
    natureza: z.string(),
    linhas_com_conteudo: z.number().int().nonnegative(),
    candidatos_a_alocacao_provisoria: z.number().int().nonnegative(),
    linhas_para_revisao: z.number().int().nonnegative(),
  }),
  registros: z.array(RegistroSchema).min(1),
});
export type PreparadoLoreal = z.infer<typeof PreparadoLorealSchema>;

export const PendenciasLorealSchema = z.object({
  ocorrencias: z.array(z.object({ codigo: z.string().min(1), nivel: z.string(), linhas_origem: z.array(z.number().int().positive()), descricao: z.string() })),
});

export const OrigemLorealSchema = z.object({
  cabecalhos: z.record(z.string(), z.string()),
  linhas: z.array(z.object({ linha: z.number().int().positive(), valores: z.record(z.string(), z.string().nullable()) })),
});

/** Colunas A:M da aba (nomes como na planilha). */
const COLUNAS = { A: 'N° Pallet', B: 'DELIVERY', C: 'TIPO', D: 'NUMERO', E: 'VOLUMES', F: 'REMETENTE', G: 'MÊS AGENDA', H: 'JANELA', I: 'RUA', J: 'DOCUMENTAÇÃO', K: 'PALLET FULL', L: 'PF/CNPJ', M: 'INVENTÁRIO' } as const;

/** "GR 1", "GR14" e "GR - 9" = Grade; o restante segue a normalização do projeto. */
export function enderecoCanonico(bruto: string | null): string | null {
  if (bruto === null || bruto.trim() === '') return null;
  const grade = /^GR\s*-?\s*(\d{1,3})$/i.exec(bruto.trim());
  const n = normalizarEndereco(grade ? `GR - ${String(Number(grade[1]))}` : bruto.trim());
  return n.ok ? n.endereco : null;
}

const quantidade = (v: number | null) => (v === null || !Number.isFinite(v) ? null : Number.isInteger(v) ? String(v) : String(v));
const texto = (v: string | null | undefined) => (v ?? '').trim();

function conferencia(r: Registro): { situacao: 'INFORMADA' | 'A_VALIDAR' | 'SEM_DATA'; data: string | null; texto: string | null } {
  if (r.data_conferencia_informada !== null) return { situacao: 'INFORMADA', data: r.data_conferencia_informada, texto: r.inventario_origem };
  if (texto(r.inventario_origem).toUpperCase() === 'VALIDAR') return { situacao: 'A_VALIDAR', data: null, texto: r.inventario_origem };
  return { situacao: 'SEM_DATA', data: null, texto: r.inventario_origem };
}

export interface EntradaLoreal {
  preparado: unknown;
  pendencias: unknown;
  /** Valores originais A:M por linha (rastreabilidade); sem ele, os campos vêm do preparado. */
  origem?: unknown;
  /** Linhas em revisão levadas ao palete do endereço por decisão: causas de bloqueio liberadas (códigos de `pendencias.json`) e a decisão registrada. */
  alocarRevisao?: { causas: readonly string[]; decisao: string };
  /** Endereços da planilha lidos como outro endereço por decisão (ex.: "15 - A22" → "15 - A122"); exige `alocarRevisao`. */
  corrigirEnderecos?: readonly { de: string; para: string }[];
}

/** Monta o pacote de carga (v1 + extensão de 20/10) a partir do inventário preparado. */
export function converterInventarioLoreal(entrada: EntradaLoreal): PacoteCarga {
  const prep = PreparadoLorealSchema.parse(entrada.preparado);
  const ocorrencias = PendenciasLorealSchema.parse(entrada.pendencias).ocorrencias;
  const origem = entrada.origem === undefined ? null : OrigemLorealSchema.parse(entrada.origem);
  const valoresPor = new Map((origem?.linhas ?? []).map((l) => [l.linha, l.valores]));
  const motivosPor = new Map<number, { codigo: string; nivel: string; descricao: string }[]>();
  // Descrição da ocorrência é específica ("Palete 235: 16 - A117, 16 - A121"): vai precedida do nome da causa.
  const descrever = (codigo: string, descricao: string) => (ROTULOS_CAUSA_REVISAO[codigo] === undefined ? descricao : `${ROTULOS_CAUSA_REVISAO[codigo]}: ${descricao}`);
  for (const o of ocorrencias)
    for (const n of o.linhas_origem) motivosPor.set(n, [...(motivosPor.get(n) ?? []), { codigo: o.codigo, nivel: o.nivel, descricao: descrever(o.codigo, o.descricao) }]);
  // Endereço corrigido por decisão (o texto da planilha continua em endereco_original e nos campos originais).
  const correcoes = new Map((entrada.corrigirEnderecos ?? []).map((c) => [enderecoCanonico(c.de) ?? c.de, enderecoCanonico(c.para)]));
  if (correcoes.size > 0 && entrada.alocarRevisao === undefined) throw new Error('Corrigir endereço exige a decisão registrada (alocarRevisao).');
  for (const [de, para] of correcoes) if (para === null) throw new Error(`Endereço corrigido inválido para ${de}.`);
  const corrigido = (r: Registro) => {
    const lido = enderecoCanonico(r.endereco);
    return lido === null ? null : (correcoes.get(lido) ?? null);
  };
  const enderecoDe = (r: Registro) => corrigido(r) ?? enderecoCanonico(r.endereco);
  // Linha em revisão liberada pela decisão: todas as causas de bloqueio entre as liberadas e endereço válido.
  const liberadas = new Set(entrada.alocarRevisao?.causas ?? []);
  const causasDe = (linha: number) => [...new Set((motivosPor.get(linha) ?? []).filter((m) => m.nivel === 'bloqueio').map((m) => m.codigo))];
  const liberada = (r: Registro) =>
    r.estado_preparacao === 'revisao_necessaria' &&
    enderecoDe(r) !== null &&
    causasDe(r.linha_origem).length > 0 &&
    causasDe(r.linha_origem).every((c) => liberadas.has(c) || (c === 'endereco_fora_da_regra' && corrigido(r) !== null));

  const linhas: (LinhaFonte & { candidato: boolean })[] = prep.registros.map((r) => {
    const tipo = texto(r.tipo_documento_origem).toUpperCase();
    const numero = texto(r.numero_documento);
    const delivery = texto(r.delivery);
    const remetente = texto(r.remetente);
    const endereco = enderecoDe(r);
    const n = endereco === null ? null : normalizarEndereco(endereco);
    const valores = valoresPor.get(r.linha_origem);
    const campos = Object.fromEntries(
      Object.entries(COLUNAS).map(([col, nome]) => {
        const doPreparado: Record<string, string | null> = {
          A: r.numero_palete,
          B: r.delivery_origem,
          C: r.tipo_documento_origem,
          D: r.numero_documento,
          E: r.volumes === null ? null : String(r.volumes),
          F: r.remetente,
          G: r.mes_agenda_origem,
          H: r.janela_origem,
          I: r.endereco_origem,
          J: r.documentacao_origem,
          K: r.identificacao_full_origem,
          L: r.classificacao_pf_pj_origem,
          M: r.inventario_origem,
        };
        return [nome, texto(valores === undefined ? doPreparado[col] : (valores[col] ?? null))];
      }),
    );
    const contexto = contextoDocumental(tipo, numero, delivery, remetente);
    const conf = conferencia(r);
    return {
      candidato: r.estado_preparacao === 'candidato_a_importacao_provisoria' || liberada(r),
      linha: r.linha_origem,
      chave_linha: sha(['linha', r.id_origem]),
      chave_conteudo: sha(['conteudo', campos]),
      tipo,
      numero,
      delivery,
      remetente,
      endereco_original: texto(r.endereco_origem),
      endereco: endereco ?? '',
      fileira: n?.ok ? n.prefixo : null,
      codigo_local: n?.ok ? n.codigoLocal : null,
      lado_regra: null,
      numero_na_planilha: texto(r.numero_palete),
      endereco_livre: false,
      volumes: quantidade(r.volumes),
      volumes_original: campos.VOLUMES ?? '',
      marcador_full_original: texto(r.identificacao_full_origem),
      documentacao: texto(r.documentacao_origem),
      cidade_destino: '',
      produto_na_caixa: '',
      contexto_documental: [...contexto] as [string, string, string, string],
      chave_documento: numero === '' ? null : hashContexto(contexto),
      campos_originais: campos,
      extras: {
        idOrigem: r.id_origem,
        estadoPreparacao: r.estado_preparacao,
        provisorio: r.provisorio,
        classificacao: r.classificacao_pf_pj_origem,
        conferencia: conf,
        paleteFull: r.palete_full,
        identificacaoFull: r.identificacao_full_origem,
        etiquetasFull: r.etiquetas_full.map((e) => e.texto),
        pendencias: r.pendencias,
        enderecoPreparado: r.endereco,
        // Linha em revisão alocada por decisão (palete com reconferência necessária).
        decisaoRevisao: liberada(r) ? { decisao: entrada.alocarRevisao?.decisao ?? '', causas: causasDe(r.linha_origem) } : null,
        enderecoCorrigido: corrigido(r) === null ? null : { de: enderecoCanonico(r.endereco), para: corrigido(r) },
      },
    };
  });
  const semCandidato = (l: (typeof linhas)[number]): LinhaFonte => {
    const { candidato: _candidato, ...resto } = l;
    return resto;
  };

  // Candidatos com endereço: base dos vínculos e das posições.
  const fonte = linhas.filter((l) => l.candidato && l.endereco !== '');
  const semEndereco = linhas.filter((l) => l.candidato && l.endereco === '');
  const grupos = new Map<string, typeof fonte>();
  for (const l of fonte) {
    if (l.chave_documento === null) continue;
    const k = `${l.endereco}|${l.chave_documento}`;
    grupos.set(k, [...(grupos.get(k) ?? []), l]);
  }
  const porIdentidade = (chave: string) => fonte.filter((l) => l.chave_documento === chave);
  const vinculos: (VinculoPacote & { grupo: 'NFD' | 'PENDENTE' })[] = [...grupos.values()].map((ls) => {
    const [p] = ls;
    if (!p?.chave_documento) throw new Error('Grupo de vínculo vazio.');
    const mesmos = porIdentidade(p.chave_documento);
    const marcadores = lerMarcadoresFull(mesmos.map((l) => l.marcador_full_original));
    const enderecosNaPraca = [...new Set(mesmos.map((l) => l.endereco))];
    // Linhas repetidas do mesmo documento no mesmo endereço: volumes não somados (pendentes).
    const volumes = ls.length === 1 ? p.volumes : null;
    const outrosContextos = fonte.some((l) => l.numero === p.numero && l.chave_documento !== p.chave_documento);
    const tipo = p.tipo === '' ? null : p.tipo;
    const atencao = [...new Set(ls.flatMap((l) => (l.extras.pendencias as string[] | undefined) ?? []))].filter((c) => c !== 'conferencia_sem_data');
    const naPosicao = fonte.filter((l) => l.endereco === p.endereco && l.chave_documento !== null);
    const identidadesNaPosicao = new Set(naPosicao.map((l) => l.chave_documento));
    const semNumero = fonte.some((l) => l.endereco === p.endereco && l.chave_documento === null);
    const grupo = tipo === 'NFD' ? ('NFD' as const) : ('PENDENTE' as const);
    return {
      grupo,
      chave_vinculo: sha([p.endereco, p.chave_documento]),
      chave_documento: p.chave_documento,
      nfd: tipo === 'NFD' ? p.numero : null,
      numero_documento: p.numero,
      tipo_documento: tipo,
      delivery: p.delivery === '' ? null : p.delivery,
      remetente: p.remetente,
      remetentes_na_origem: [...new Set(ls.map((l) => l.remetente))],
      cidade_destino: '',
      produto_na_caixa: '',
      volumes,
      volumes_base: 'VOLUMES_INFORMADOS_NO_INVENTARIO',
      volumes_na_origem: ls.map((l) => ({ linha: l.linha, valor: l.volumes, texto_original: l.volumes_original })),
      palete_full: identidadesNaPosicao.size > 1 ? false : tipo === 'NFD' && !semNumero ? true : null,
      full_base: 'UMA_UNICA_IDENTIDADE_NFD_COM_IDENTIFICACAO_SUFICIENTE',
      marcadores_full_originais: ls.map((l) => l.marcador_full_original),
      mais_de_um_palete_da_nfd_no_inventario: (marcadores.total ?? 0) > 1 || enderecosNaPraca.length > 1,
      quantidade_paletes_declarada_nfd: marcadores.total,
      quantidade_enderecos_nfd_na_praca: enderecosNaPraca.length,
      enderecos_nfd_na_praca: enderecosNaPraca,
      enderecos_nfd_na_origem: enderecosNaPraca,
      partes_full_neste_endereco: lerMarcadoresFull(ls.map((l) => l.marcador_full_original)).partes,
      endereco: p.endereco,
      endereco_referencia: p.endereco,
      numero_palete_na_planilha: p.numero_na_planilha === '' ? null : p.numero_na_planilha,
      linhas_origem: ls.map((l) => l.linha),
      pendencias: [
        ...(volumes === null ? [ls.length > 1 ? 'VOLUMES_EM_MULTIPLAS_LINHAS_A_CONFIRMAR' : 'VOLUMES_NAO_INFORMADOS_OU_INVALIDOS'] : []),
        ...(outrosContextos ? ['MESMO_NUMERO_EM_CONTEXTOS_DOCUMENTAIS_DISTINTOS'] : []),
        ...(tipo === null ? ['TIPO_DOCUMENTAL_PENDENTE'] : tipo !== 'NFD' ? ['DOCUMENTO_DE_OUTRO_TIPO'] : []),
        ...atencao.map((c) => c.toUpperCase()),
      ],
      situacao_localizacao: 'INFORMADA_NO_INVENTARIO' as const,
    };
  });
  const semGrupo = (v: (typeof vinculos)[number]): VinculoPacote => {
    const { grupo: _grupo, ...resto } = v;
    return resto;
  };
  const N = vinculos.filter((v) => v.grupo === 'NFD');
  const T = vinculos.filter((v) => v.grupo === 'PENDENTE');

  const enderecos = [...new Set(fonte.map((l) => l.endereco))];
  const posicoes = enderecos.map((e) => {
    const ls = fonte.filter((l) => l.endereco === e);
    const nfd = N.filter((v) => v.endereco === e);
    const pend = T.filter((v) => v.endereco === e);
    const identidades = new Set([...nfd, ...pend].map((v) => v.chave_documento));
    const semNumero = ls.some((l) => l.chave_documento === null);
    const n = normalizarEndereco(e);
    return {
      endereco: e,
      // O endereço canônico vem primeiro (a forma original, como "14 - 116", fica em seguida).
      enderecos_originais: [...new Set([e, ...ls.map((l) => l.endereco_original).filter((x) => x !== '')])],
      fileira: n.ok ? n.prefixo : null,
      codigo_local: n.ok ? n.codigoLocal : null,
      bloco_referencia: null,
      lado_regra: null,
      coordenadas_mapa: null,
      numero_na_planilha: ls.find((l) => l.numero_na_planilha !== '')?.numero_na_planilha ?? null,
      numero_eh_id_permanente_palete: false as const,
      endereco_livre: false,
      situacao: nfd.length > 0 ? ('COM_NFD_INFORMADA' as const) : pend.length > 0 ? ('DOCUMENTO_PENDENTE' as const) : ('CONTEUDO_NAO_INFORMADO' as const),
      palete_full: identidades.size > 1 ? false : nfd.length === 1 && pend.length === 0 && !semNumero ? true : null,
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
  const emRevisao = linhas
    .filter((l) => !l.candidato)
    .map((l) => {
      const motivos = motivosPor.get(l.linha) ?? [];
      return {
        linha: l.linha,
        motivos: motivos.some((m) => m.nivel === 'bloqueio') ? motivos : [{ codigo: 'revisao_necessaria', nivel: 'bloqueio', descricao: 'Revisão indicada pela preparação.' }, ...motivos],
      };
    });
  const ocupadas = posicoes;
  // Reconferência necessária nos paletes que receberam linhas em revisão por decisão (um motivo por endereço).
  const alocadas = prep.registros.filter(liberada);
  const reconferencia = [...new Set(alocadas.map((r) => enderecoDe(r) ?? ''))].map((endereco) => {
    const daqui = alocadas.filter((r) => enderecoDe(r) === endereco);
    const causas = [...new Set(daqui.flatMap((r) => causasDe(r.linha_origem)))];
    const nomes = causas.map((c) => ROTULOS_CAUSA_REVISAO[c] ?? c).join('; ');
    const lidos = [...new Set(daqui.flatMap((r) => (corrigido(r) === null ? [] : [enderecoCanonico(r.endereco) ?? ''])))];
    const correcao = lidos.length === 0 ? '' : ` Endereço da planilha ${lidos.join(', ')} lido como ${endereco}.`;
    return { endereco, motivo: `Inventário de ${prep.resumo.data_base}: notas de linhas em revisão (${nomes}) mantidas neste palete por decisão — ${entrada.alocarRevisao?.decisao ?? ''}.${correcao} Conferir o palete.`.slice(0, 500) };
  });
  const decisao =
    entrada.alocarRevisao === undefined
      ? []
      : [[...entrada.alocarRevisao.causas].sort(), entrada.alocarRevisao.decisao, ...[...correcoes].map(([de, para]) => `${de}=${para ?? ''}`).sort()];
  return {
    schema: SCHEMA_PACOTE,
    id_lote: sha(['inventario-loreal-preparado', FORMATO_LOREAL, prep.resumo.sha256_arquivo, prep.resumo.data_base, ...decisao]),
    fonte: { arquivo: prep.resumo.arquivo_origem.slice(0, 200), sha256: prep.resumo.sha256_arquivo, aba: prep.resumo.aba.slice(0, 120), cabecalhos: { ...(origem?.cabecalhos ?? COLUNAS) } },
    regras: {
      endereco_chave: 'FILEIRA_OU_GR_E_CODIGO_LOCAL',
      cor_livre_rua: 'FF00B050',
      produto_inicial: '',
      cidade_destino_inicial: '',
      volumes_desconhecidos: null,
      somar_linhas_repetidas: false,
      usar_numero_na_planilha_como_id_palete: false,
      criar_saldo_sku_automaticamente: false,
      criar_coordenadas_presumidas: false,
      full: 'PALLET FULL preservado como na planilha (n/m = etiqueta/parte; FRACIONADO); volumes não multiplicados nem divididos.',
      mais_de_um_palete: 'Denominador de PALLET FULL ou vários endereços da mesma identidade documental. Não multiplicar volumes.',
      quantidade_enderecos: 'Endereços normalizados distintos; não equivale ao número físico de paletes.',
    },
    campos_visiveis_nota: ['NF/NFD/MI', 'DELIVERY', 'REMETENTE', 'VOLUMES', 'PALETE FULL', 'MESMA NOTA EM VARIOS PALETES', 'PRODUTO NA CAIXA'],
    blocos_fileiras: { 11: 'FB01', 12: 'FB02', 13: 'FB03', 14: 'FB04', 15: 'FB05', 16: 'FB06', GR: 'FB07' },
    resumo: {
      linhas_fonte: linhas.length,
      linhas_nfd_endereco_nao_livre: fonte.filter((l) => l.tipo === 'NFD').length,
      vinculos_nfd_na_praca: N.length,
      numeros_nfd_distintos_na_praca: new Set(N.map((v) => v.numero_documento)).size,
      enderecos_com_nfd_na_praca: posicoes.filter((x) => x.situacao === 'COM_NFD_INFORMADA').length,
      enderecos_livres: 0,
      vinculos_documentais_fora_da_praca: 0,
      documentos_tipo_pendente_na_praca: T.length,
      grupos_de_linhas_exatamente_iguais: repeticoes.length,
      nfd_com_volumes_pendentes_na_praca: N.filter((v) => v.volumes === null).length,
      enderecos_com_full_sim: ocupadas.filter((x) => x.palete_full === true).length,
      enderecos_com_full_nao: ocupadas.filter((x) => x.palete_full === false).length,
      enderecos_com_full_pendente: ocupadas.filter((x) => x.palete_full === null).length,
    },
    posicoes,
    nfds_na_praca: N.map(semGrupo),
    documentos_fora_da_praca: [],
    documentos_tipo_pendente_na_praca: T.map(semGrupo),
    linhas_sem_numero_documento: fonte.filter((l) => l.chave_documento === null).map(semCandidato),
    linhas_sem_endereco: semEndereco.map(semCandidato),
    linhas_em_revisao: emRevisao,
    em_validacao: true,
    data_base: prep.resumo.data_base,
    reconferencia_exigida: reconferencia,
    repeticoes_exatas: repeticoes,
    numeros_na_planilha_em_varios_enderecos: numerosPlanilha,
    linhas_fonte: linhas.map(semCandidato),
  };
}
