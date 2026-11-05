// Copia os dados REAIS (escopo PRACA-REVERSA / LOREAL) do banco local de
// trabalho para um banco novo e vazio (Supabase). A origem só é lida.
// Fora da cópia: escopos de demonstração, usuários sem vínculo com o escopo real
// e sessões (ninguém herda um token de sessão antigo).
//
// Uso (na pasta praca-reversa):
//   node scripts/copiar-dados-reais.mjs --origem=<URL> --destino=<URL> [--aplicar]
// Sem --aplicar só mostra o plano (contagens) e não grava nada no destino.
// Recusa destino que já tenha dados. Tudo em UMA transação: erro = nada gravado.
import pg from 'pg';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const aplicar = process.argv.includes('--aplicar');
const ORIGEM = arg('origem');
const DESTINO = arg('destino');
const CODIGO_UNIDADE = 'PRACA-REVERSA';
const CODIGO_CLIENTE = 'LOREAL';
const PULAR = new Set(['_prisma_migrations', 'sessao']);
const LOTE = 2000;
if (!ORIGEM || !DESTINO) {
  console.error('Informe --origem e --destino.');
  process.exit(2);
}
const q = (n) => `"${n.replaceAll('"', '""')}"`;

const conectar = async (url, ca) => {
  const u = ca ? url.replace(/([?&])sslmode=[^&]*&?/i, '$1').replace(/[?&]$/, '') : url;
  const c = new pg.Client({ connectionString: u, ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}) });
  await c.connect();
  return c;
};
import { readFileSync } from 'node:fs';
const ca = readFileSync(new URL('../vercel/supabase-ca.pem', import.meta.url), 'utf8');
const src = await conectar(ORIGEM);
const dst = await conectar(DESTINO, /supabase\.com/.test(DESTINO) ? ca : undefined);

const esc = (await src.query(
  `select e.id from escopo e join unidade u on u.id=e.unidade_id join cliente c on c.id=e.cliente_id where u.codigo=$1 and c.codigo=$2`,
  [CODIGO_UNIDADE, CODIGO_CLIENTE],
)).rows;
if (esc.length !== 1) throw new Error(`Escopo real não encontrado de forma única (${esc.length}).`);
const ESCOPO = esc[0].id;

// Metadados do esquema (iguais nos dois bancos: mesmas migrações).
const tabelas = (await src.query(`select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' order by 1`)).rows.map((r) => r.relname).filter((t) => !PULAR.has(t));
const colunas = Object.fromEntries(tabelas.map((t) => [t, []]));
for (const r of (await src.query(`select table_name t, column_name c from information_schema.columns where table_schema='public' order by table_name, ordinal_position`)).rows) colunas[r.t]?.push(r.c);
const fks = (await src.query(`
  select conrelid::regclass::text t, confrelid::regclass::text p,
         (select array_agg(a.attname::text order by k.ord) from unnest(conkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid=conrelid and a.attnum=k.n) cols,
         (select array_agg(a.attname::text order by k.ord) from unnest(confkey) with ordinality k(n, ord) join pg_attribute a on a.attrelid=confrelid and a.attnum=k.n) pcols
  from pg_constraint where contype='f' and connamespace='public'::regnamespace`)).rows
  .map((f) => ({ ...f, t: f.t.replaceAll('"', ''), p: f.p.replaceAll('"', '') }));

// Filtro de cada tabela (SQL na origem).
const memo = new Map();
const emAndamento = new Set();
const lit = (v) => `'${v}'`;
function filtro(t) {
  if (memo.has(t)) return memo.get(t);
  if (emAndamento.has(t)) return null;
  emAndamento.add(t);
  let f;
  if (t === 'escopo') f = `id=${lit(ESCOPO)}`;
  else if (t === 'unidade') f = `id in (select unidade_id from escopo where id=${lit(ESCOPO)})`;
  else if (t === 'cliente') f = `id in (select cliente_id from escopo where id=${lit(ESCOPO)})`;
  else if (t === 'usuario') f = `id in (select usuario_id from vinculo where escopo_id=${lit(ESCOPO)})`;
  else if (colunas[t].includes('escopo_id')) f = `escopo_id=${lit(ESCOPO)}`;
  else {
    const conds = [];
    for (const fk of fks.filter((x) => x.t === t && x.p !== t && !PULAR.has(x.p))) {
      const fp = filtro(fk.p);
      if (fp === null) continue;
      const lista = fk.cols.map(q).join(',');
      const nulo = fk.cols.map((c) => `${q(c)} is null`).join(' or ');
      conds.push(`(${nulo} or (${lista}) in (select ${fk.pcols.map(q).join(',')} from ${q(fk.p)} where ${fp}))`);
    }
    f = conds.length ? conds.join(' and ') : 'true';
  }
  emAndamento.delete(t);
  memo.set(t, f);
  return f;
}

// Ordem de carga: pais antes dos filhos (ignora autorreferência).
const ordem = [];
const visitado = new Set();
const marca = new Set();
function visitar(t) {
  if (visitado.has(t)) return;
  if (marca.has(t)) throw new Error(`Ciclo de chaves estrangeiras envolvendo ${t}.`);
  marca.add(t);
  for (const fk of fks.filter((x) => x.t === t && x.p !== t && !PULAR.has(x.p))) visitar(fk.p);
  marca.delete(t);
  visitado.add(t);
  ordem.push(t);
}
tabelas.forEach(visitar);

// Plano
const plano = [];
for (const t of ordem) {
  const n = (await src.query(`select count(*)::int n from ${q(t)} where ${filtro(t)}`)).rows[0].n;
  plano.push([t, n]);
}
console.log('Escopo real:', ESCOPO);
console.log('Plano:', plano.filter(([, n]) => n).map(([t, n]) => `${t}:${n}`).join(' '));
console.log('Total de linhas:', plano.reduce((s, [, n]) => s + n, 0));

// Destino precisa estar vazio.
for (const t of ordem) {
  const n = (await dst.query(`select count(*)::int n from ${q(t)}`)).rows[0].n;
  if (n) throw new Error(`Destino não está vazio (${t} tem ${n} linhas). Nada foi alterado.`);
}
if (!aplicar) {
  console.log('Simulação: nada foi gravado. Rode com --aplicar para copiar.');
  process.exit(0);
}

await dst.query('begin');
try {
  for (const t of ordem) await dst.query(`alter table ${q(t)} disable trigger user`);
  for (const [t, total] of plano) {
    if (!total) continue;
    const cs = colunas[t].map(q).join(',');
    for (let off = 0; off < total; off += LOTE) {
      const json = (await src.query(`select coalesce(json_agg(r),'[]')::text j from (select * from ${q(t)} where ${filtro(t)} order by ctid limit ${LOTE} offset ${off}) r`)).rows[0].j;
      await dst.query(`insert into ${q(t)} (${cs}) select ${cs} from json_populate_recordset(null::${q(t)}, $1::json)`, [json]);
    }
  }
  // Conferência: contagem e somatório de hash por tabela, na mesma transação.
  const diferencas = [];
  for (const [t, total] of plano) {
    const h = (cx, w) => cx.query(`select count(*)::int n, coalesce(md5(string_agg(r::text, '|' order by r::text)),'') h from (select * from ${q(t)} ${w ? `where ${w}` : ''}) r`);
    const [a, b] = await Promise.all([h(src, filtro(t)), h(dst, '')]);
    if (a.rows[0].n !== b.rows[0].n || a.rows[0].h !== b.rows[0].h) diferencas.push(`${t} origem=${a.rows[0].n} destino=${b.rows[0].n}${a.rows[0].h !== b.rows[0].h ? ' (conteúdo difere)' : ''}`);
  }
  if (diferencas.length) throw new Error(`Conferência falhou:\n  ${diferencas.join('\n  ')}`);
  for (const t of ordem) await dst.query(`alter table ${q(t)} enable trigger user`);
  await dst.query('commit');
  console.log('Cópia concluída e conferida (contagem + hash por tabela).');
} catch (e) {
  await dst.query('rollback');
  console.error('Erro; NADA foi gravado no destino:', e.message);
  process.exitCode = 1;
}
await src.end();
await dst.end();
