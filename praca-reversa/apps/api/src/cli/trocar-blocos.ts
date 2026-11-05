/**
 * Troca de lugar, no desenho, de dois blocos de fileiras (5 nov. 2026: Rua 16 /
 * Rua 15 estavam invertidas em relação ao chão da praça). Só mudam as coordenadas
 * horizontais do bloco, das fileiras e das posições; códigos, endereços, IDs e
 * paletes ficam como estão (o palete acompanha a posição). Fecha a alteração
 * pelo mesmo caminho do layout (revisão, histórico e auditoria).
 *
 * Uso: npm run layout:trocar-blocos -- --unidade <cód> --cliente <cód> --usuario <login> --a FB05 --b FB06 [--executar]
 * Sem --executar: só mostra o que mudaria. Faça antes `npm run backup:rotina -- --motivo=MANUAL --sem-retencao`.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { carregarEnvLocal } from '../config.js';
import { criarBanco } from '../db/cliente.js';
import { bloquearLayoutAtivo, concluirAlteracao } from '../modules/layout/servico.js';

/** Simulação: lançada dentro da transação para DESFAZER tudo (nada é gravado). */
class Simulacao extends Error {}

async function principal(): Promise<void> {
  const { values } = parseArgs({ options: { unidade: { type: 'string' }, cliente: { type: 'string' }, usuario: { type: 'string' }, a: { type: 'string' }, b: { type: 'string' }, executar: { type: 'boolean', default: false } } });
  if (!values.unidade || !values.cliente || !values.usuario || !values.a || !values.b) throw new Error('Informe --unidade, --cliente, --usuario, --a e --b.');
  carregarEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definido.');
  // Banco do Supabase: certificado raiz próprio (validação continua ligada).
  const ca = /supabase\.com/.test(url) ? readFileSync(new URL('../../../../vercel/supabase-ca.pem', import.meta.url), 'utf8') : undefined;
  const db = criarBanco(url, (e) => { console.error(e.message); }, ca ? { ca, max: 2 } : {});
  try {
    const escopo = await db.escopo.findFirst({ where: { ativo: true, unidade: { codigo: values.unidade }, cliente: { codigo: values.cliente } }, select: { id: true, nome: true } });
    if (!escopo) throw new Error('Escopo não encontrado.');
    const usuario = await db.vinculo.findFirst({ where: { escopoId: escopo.id, ativo: true, usuario: { login: values.usuario.trim().toLowerCase(), ativo: true } }, select: { usuarioId: true } });
    if (!usuario) throw new Error(`O usuário ${values.usuario} não tem vínculo ativo no escopo.`);
    const [a, b] = [values.a, values.b];
    const r = await db.$transaction(async (tx) => {
      const layout = await bloquearLayoutAtivo(tx, escopo.id);
      const blocos = await tx.$queryRaw<{ codigo: string; x: number; largura: number }[]>`
        SELECT codigo, x, largura FROM elemento_layout WHERE layout_id = ${layout.id}::uuid AND tipo = 'BLOCO' AND codigo IN (${a}, ${b})`;
      const ba = blocos.find((x) => x.codigo === a);
      const bb = blocos.find((x) => x.codigo === b);
      if (!ba || !bb) throw new Error('Bloco não encontrado no layout ativo.');
      if (ba.largura !== bb.largura) throw new Error('Os blocos têm larguras diferentes: a troca simples não se aplica.');
      const dxA = bb.x - ba.x; // A vai para onde B está
      const dxB = ba.x - bb.x;
      const antes = await tx.$queryRaw<{ n: bigint; ocupadas: bigint }[]>`
        SELECT count(*) n, count(pa.id) ocupadas FROM posicao p JOIN fileira f ON f.id = p.fileira_id LEFT JOIN palete pa ON pa.posicao_id = p.id
         WHERE f.layout_id = ${layout.id}::uuid AND f.bloco_codigo IN (${a}, ${b})`;
      const mover = async (codigo: string, dx: number) => {
        await tx.$executeRaw`UPDATE elemento_layout SET x = x + ${dx}, rotulo_x = rotulo_x + ${dx} WHERE layout_id = ${layout.id}::uuid AND tipo = 'BLOCO' AND codigo = ${codigo}`;
        await tx.$executeRaw`UPDATE posicao SET x = x + ${dx} WHERE fileira_id IN (SELECT id FROM fileira WHERE layout_id = ${layout.id}::uuid AND bloco_codigo = ${codigo})`;
        await tx.$executeRaw`UPDATE fileira SET x = x + ${dx}, rotulo_x = rotulo_x + ${dx} WHERE layout_id = ${layout.id}::uuid AND bloco_codigo = ${codigo}`;
      };
      await mover(a, dxA);
      await mover(b, dxB);
      const depois = await tx.$queryRaw<{ n: bigint; ocupadas: bigint }[]>`
        SELECT count(*) n, count(pa.id) ocupadas FROM posicao p JOIN fileira f ON f.id = p.fileira_id LEFT JOIN palete pa ON pa.posicao_id = p.id
         WHERE f.layout_id = ${layout.id}::uuid AND f.bloco_codigo IN (${a}, ${b})`;
      if (String(antes[0]?.n) !== String(depois[0]?.n) || String(antes[0]?.ocupadas) !== String(depois[0]?.ocupadas)) throw new Error('Conferência falhou: contagem de posições ou paletes mudou.');
      const resumo = `Blocos ${a} e ${b} trocaram de lugar no desenho (${String(antes[0]?.n)} posições, ${String(antes[0]?.ocupadas)} com palete; códigos e endereços não mudaram).`;
      if (!values.executar) throw new Simulacao(`SIMULAÇÃO: ${resumo} A nova ordem: ${a} vai de x=${String(ba.x)} para x=${String(bb.x)}; ${b} vai de x=${String(bb.x)} para x=${String(ba.x)}.`);
      await concluirAlteracao(tx, escopo.id, layout, { usuarioId: usuario.usuarioId, requestId: `cli-${randomUUID()}` }, { acao: 'TROCAR_BLOCOS', alvoTipo: 'ELEMENTO', alvoId: null, resumo, antes: { [a]: ba.x, [b]: bb.x }, depois: { [a]: bb.x, [b]: ba.x } });
      return { resumo };
    }, { timeout: 120_000, maxWait: 30_000 }).catch((e: unknown) => {
      if (e instanceof Simulacao) {
        console.log(e.message);
        console.log('Nada foi gravado (transação desfeita). Use --executar para aplicar.');
        return null;
      }
      throw e;
    });
    if (r !== null) console.log(`Aplicado. ${r.resumo}`);
  } finally {
    await db.$disconnect();
  }
}

principal().catch((e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
