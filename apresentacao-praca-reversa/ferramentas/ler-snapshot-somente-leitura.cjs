// Leitura SOMENTE de consulta (transação READ ONLY) do banco de desenvolvimento.
// Uso: node ler-snapshot.cjs <pasta praca-reversa> <arquivo saída mapa> <arquivo saída verificação>
const fs = require('fs');
const path = require('path');
const raiz = process.argv[2];
const { createRequire } = require('module');
const req = createRequire(path.join(raiz, 'package.json'));
const { Client } = req('pg');

const env = fs.readFileSync(path.join(raiz, '.env'), 'utf8');
const url = /^DATABASE_URL=(.*)$/m.exec(env)[1].trim().replace(/^"|"$/g, '');

(async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('BEGIN TRANSACTION READ ONLY');
  const q = async (sql, p = []) => (await c.query(sql, p)).rows;
  const escopos = await q('select id, nome, demonstracao, ativo from escopo order by nome');
  const real = escopos.filter((e) => !e.demonstracao && e.ativo);
  const ver = { escopos: escopos.map((e) => ({ nome: e.nome, demonstracao: e.demonstracao, ativo: e.ativo })) };
  const e = real.find((x) => /LOREAL/i.test(x.nome)) || real[0];
  ver.escopoUsado = e.nome;
  const [lay] = await q('select id, codigo, nome, versao, revisao, largura, altura, esquematico, ficticio from layout where escopo_id=$1 and ativo order by criado_em desc limit 1', [e.id]);
  const elementos = await q('select tipo, codigo, rotulo, x, y, largura, altura, rotulo_x, rotulo_y, rotulo_largura, rotulo_altura, nome_operacional, prefixo_endereco from elemento_layout where layout_id=$1 order by codigo', [lay.id]);
  const fileiras = await q('select id, codigo, rotulo, ordem, bloco_codigo, x, y, largura, altura, lado from fileira where layout_id=$1 order by ordem', [lay.id]);
  const posicoes = await q(`select p.codigo, p.numero, p.x, p.y, p.largura, p.altura, p.desativada, f.codigo as fileira, ep.endereco, ep.situacao
    from posicao p join fileira f on f.id=p.fileira_id left join endereco_posicao ep on ep.posicao_id=p.id
    where p.layout_id=$1 and p.retirada_em is null order by f.ordem, p.numero`, [lay.id]);
  const mapa = {
    origem: 'Banco de desenvolvimento do Praça Reversa, escopo real, layout ativo (somente geometria e endereços; sem ocupação).',
    lidoEm: new Date().toISOString(),
    layout: { codigo: lay.codigo, nome: lay.nome, versao: lay.versao, revisao: lay.revisao, largura: lay.largura, altura: lay.altura, esquematico: lay.esquematico },
    elementos, fileiras: fileiras.map(({ id, ...f }) => f), posicoes,
  };
  fs.writeFileSync(process.argv[3], JSON.stringify(mapa, null, 1));

  ver.layout = mapa.layout;
  ver.contagem = { elementos: elementos.length, fileiras: fileiras.length, posicoes: posicoes.length, ativas: posicoes.filter((p) => !p.desativada).length };
  ver.paletes = await q(`select pa.codigo, pa.codigo_legado, ep.endereco, pa.estado_conferencia, pa.estado_fluxo, pa.arquivado_em,
      pa.ultima_reconferencia_em, pa.reconferencia_exigida_em, pa.relogio_inicio_em, pa.ultima_movimentacao_em
    from palete pa left join posicao p on p.id=pa.posicao_id left join endereco_posicao ep on ep.posicao_id=p.id
    where pa.escopo_id=$1 and pa.codigo in ('256','257')`, [e.id]);
  ver.posicoesA42A43 = await q(`select ep.endereco, pa.codigo as palete_atual from endereco_posicao ep join posicao p on p.id=ep.posicao_id
    left join palete pa on pa.posicao_id=p.id where ep.escopo_id=$1 and ep.endereco in ('11 - A42','11 - A43')`, [e.id]);
  ver.inventarios = await q('select * from inventario_referencia where escopo_id=$1 order by 1', [e.id]).then((r) => r.map((x) => {
    const o = {}; for (const k of Object.keys(x)) if (!/id$|_por/.test(k) || k === 'id') o[k] = x[k]; delete o.id; return o; }));
  ver.linhasNF = await q(`select i.codigo as inventario, l.linha_arquivo, l.tipo_documento, l.numero_documento, l.volumes, l.endereco_canonico, l.numero_palete, l.pallet_full, l.delivery, l.acao, l.aplicada, pa.codigo as palete_vinculado
    from linha_inventario l join inventario_referencia i on i.id=l.inventario_id left join palete pa on pa.id=l.palete_id
    where l.escopo_id=$1 and l.numero_documento='9059802' order by i.codigo, l.linha_arquivo`, [e.id]).catch((err) => 'erro: ' + err.message);
  ver.conteudosNF = await q(`select pa.codigo as palete, cp.tipo_documento, cp.numero_documento, cp.delivery, cp.situacao, cp.origem
    from conteudo_palete cp join palete pa on pa.id=cp.palete_id where cp.escopo_id=$1 and cp.numero_documento='9059802'`, [e.id]);
  ver.colunasVinculo = (await q("select column_name from information_schema.columns where table_name='vinculo_documento_palete' order by ordinal_position")).map((r) => r.column_name);
  ver.totais = (await q(`select (select count(*) from palete where escopo_id=$1 and arquivado_em is null) as paletes,
     (select count(*) from janela_devolucao where escopo_id=$1) as janelas,
     (select count(*) from selecao_teste_solicitacao) as selecoes_teste,
     (select count(*) from reconferencia_palete where escopo_id=$1) as reconferencias,
     (select count(*) from conferencia_volumes where escopo_id=$1) as conferencias_volumes`, [e.id]).catch((err) => [{ erro: err.message }]))[0];
  await c.query('ROLLBACK');
  await c.end();
  fs.writeFileSync(process.argv[4], JSON.stringify(ver, null, 1));
  console.log('ok', ver.contagem);
})().catch((err) => { console.error(err.message); process.exit(1); });
