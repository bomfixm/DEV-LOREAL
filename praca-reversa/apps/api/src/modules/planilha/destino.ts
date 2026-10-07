/**
 * Destino da planilha: uma pasta (destino independente = pasta sincronizada do
 * OneDrive/SharePoint ou compartilhamento de rede fora do servidor; ou a pasta
 * local da geração no próprio servidor). Publicação completa e ordenada:
 *
 * 1. o manifesto `<nome>.versao.json` guarda a versão publicada; versão igual
 *    ou mais antiga é recusada (trabalho atrasado não sobrescreve o mais novo);
 * 2. o arquivo é gravado num temporário, relido e conferido pelo hash;
 * 3. a cópia da versão vai para `versoes/` (nome com versão e instante);
 * 4. só então o temporário substitui o arquivo atual (renomear no mesmo
 *    volume; o anterior continua válido até esse instante);
 * 5. retenção: só versões além das `manter` mais novas são apagadas; nunca
 *    todas, nunca a atual.
 */
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export class VersaoAntigaError extends Error {
  constructor(readonly publicada: number, readonly tentada: number) {
    super(`O destino já tem a versão ${String(publicada)}; a versão ${String(tentada)} é mais antiga e não sobrescreve.`);
  }
}

export interface ResultadoDestino {
  identificacao: string;
  versaoAnterior: string | null;
}

interface Manifesto {
  versao: number;
  arquivo: string;
  instanteSnapshot: string;
  hash: string;
  copia: string;
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function gravarCompleto(caminho: string, conteudo: Buffer): void {
  const fd = openSync(caminho, 'wx', 0o600);
  try {
    let escrito = 0;
    while (escrito < conteudo.length) escrito += writeSync(fd, conteudo, escrito, conteudo.length - escrito);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function lerManifesto(caminho: string): Manifesto | null {
  if (!existsSync(caminho)) return null;
  try {
    const m = JSON.parse(readFileSync(caminho, 'utf8')) as Partial<Manifesto>;
    return typeof m.versao === 'number' ? (m as Manifesto) : null;
  } catch {
    return null;
  }
}

export function publicarEmPasta(raiz: string, nome: string, conteudo: Buffer, versao: number, instanteSnapshot: Date, manter: number): ResultadoDestino {
  mkdirSync(join(raiz, 'versoes'), { recursive: true });
  const base = nome.replace(/\.xlsx$/i, '');
  const caminhoManifesto = join(raiz, `${base}.versao.json`);
  const anterior = lerManifesto(caminhoManifesto);
  if (anterior !== null && anterior.versao >= versao) throw new VersaoAntigaError(anterior.versao, versao);
  const hash = sha(conteudo);
  const temporario = join(raiz, `.${base}.v${String(versao)}.${randomBytes(4).toString('hex')}.tmp`);
  try {
    gravarCompleto(temporario, conteudo);
    if (sha(readFileSync(temporario)) !== hash) throw new Error('O arquivo gravado no destino não confere com o gerado (hash diferente).');
    const instante = instanteSnapshot.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const copia = `${base}-v${String(versao).padStart(6, '0')}-${instante}.xlsx`;
    const caminhoCopia = join(raiz, 'versoes', copia);
    if (!existsSync(caminhoCopia)) copyFileSync(temporario, caminhoCopia);
    if (sha(readFileSync(caminhoCopia)) !== hash) throw new Error('A cópia da versão não confere com o arquivo gerado.');
    renameSync(temporario, join(raiz, nome));
    const manifesto: Manifesto = { versao, arquivo: nome, instanteSnapshot: instanteSnapshot.toISOString(), hash, copia: `versoes/${copia}` };
    const tmpManifesto = `${caminhoManifesto}.${randomBytes(4).toString('hex')}.tmp`;
    gravarCompleto(tmpManifesto, Buffer.from(`${JSON.stringify(manifesto, null, 2)}\n`, 'utf8'));
    renameSync(tmpManifesto, caminhoManifesto);
    aplicarRetencao(join(raiz, 'versoes'), base, manter);
    return { identificacao: `${nome} · versão ${String(versao)} · cópia versoes/${copia}`, versaoAnterior: anterior === null ? null : anterior.copia };
  } finally {
    rmSync(temporario, { force: true });
  }
}

/** Mantém as `manter` versões mais novas (pelo número); nunca apaga todas. */
export function aplicarRetencao(pasta: string, base: string, manter: number): number {
  const padrao = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-v(\\d{6,})-[0-9TZ]+\\.xlsx$`);
  const versoes = readdirSync(pasta)
    .flatMap((f) => {
      const m = padrao.exec(f);
      return m ? [{ f, v: Number(m[1]) }] : [];
    })
    .sort((a, b) => b.v - a.v);
  const sobra = versoes.slice(Math.max(1, manter));
  for (const s of sobra) rmSync(join(pasta, s.f), { force: true });
  return sobra.length;
}
