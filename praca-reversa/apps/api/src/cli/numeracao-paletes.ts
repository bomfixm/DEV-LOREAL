/**
 * Numeração operacional dos paletes novos (série física do piso, D285) —
 * comando local, com acesso direto ao banco; não há rota HTTP equivalente.
 *
 * Uso:
 *   npm run paletes:numeracao -- --unidade <código> --cliente <código> --usuario <login>
 *     [--ultimo 278] [--reservar 1000-1015 …] [--executar]
 *
 * Sem --ultimo: só mostra a situação (próximo número previsto, faixas
 * reservadas, de onde veio). Com --ultimo e --executar: o próximo palete novo
 * recebe o primeiro número livre depois do último informado, pulando as faixas
 * reservadas e qualquer número já usado (palete ou N° Pallet da planilha).
 * Fica registrado na auditoria. O usuário precisa poder cadastrar paletes.
 */
import { perfilPossui, type Escopo } from '@praca-reversa/contracts';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { carregarEnvLocal } from '../config.js';
import { criarBanco, type Banco } from '../db/cliente.js';
import { registrarEvento } from '../modules/auditoria/registrar.js';
import { definirNumeracao, faixaDeTexto, inicioPadrao, lerNumeracao, previsaoNumeroPalete, type FaixaReservada } from '../modules/paletes/numeracao.js';

async function resolverEscopo(db: Banco, unidade: string | undefined, cliente: string | undefined): Promise<Escopo> {
  if (!unidade || !cliente) throw new Error('Informe --unidade e --cliente (ou PRACA_UNIDADE e PRACA_CLIENTE).');
  const e = await db.escopo.findFirst({ where: { ativo: true, unidade: { codigo: unidade }, cliente: { codigo: cliente } }, include: { unidade: true, cliente: true } });
  if (!e) throw new Error(`Escopo ${unidade}/${cliente} não encontrado ou inativo.`);
  return { id: e.id, name: e.nome, unitCode: e.unidade.codigo, unitName: e.unidade.nome, clientCode: e.cliente.codigo, clientName: e.cliente.nome, demo: e.demonstracao };
}

async function resolverAutor(db: Banco, escopo: Escopo, login: string | undefined): Promise<{ usuarioId: string; login: string }> {
  if (!login) throw new Error('Informe --usuario <login> (quem define a numeração fica registrado).');
  const v = await db.vinculo.findFirst({
    where: { escopoId: escopo.id, ativo: true, usuario: { login: login.trim().toLowerCase(), ativo: true } },
    select: { perfil: true, usuario: { select: { id: true, login: true } } },
  });
  if (!v) throw new Error(`O usuário ${login} não tem vínculo ativo no escopo ${escopo.name}.`);
  if (!perfilPossui(v.perfil, 'palete.cadastrar')) throw new Error(`O perfil ${v.perfil} de ${login} não cadastra paletes.`);
  return { usuarioId: v.usuario.id, login: v.usuario.login };
}

const textoFaixas = (fs: readonly FaixaReservada[]) => (fs.length === 0 ? 'nenhuma' : fs.map((f) => (f.de === f.ate ? String(f.de) : `${String(f.de)}–${String(f.ate)}`)).join(', '));

async function principal(): Promise<number> {
  const { values } = parseArgs({
    options: {
      unidade: { type: 'string' },
      cliente: { type: 'string' },
      usuario: { type: 'string' },
      ultimo: { type: 'string' },
      reservar: { type: 'string', multiple: true },
      executar: { type: 'boolean', default: false },
    },
  });
  carregarEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definido.');
  const db = criarBanco(url, (erro) => {
    console.error(erro.message);
  });
  try {
    const escopo = await resolverEscopo(db, values.unidade ?? process.env.PRACA_UNIDADE, values.cliente ?? process.env.PRACA_CLIENTE);
    const atual = await lerNumeracao(db, escopo.id);
    const padrao = await inicioPadrao(db, escopo.id);
    console.log(`Escopo: ${escopo.name} (${escopo.unitCode}/${escopo.clientCode})${escopo.demo ? ' · DEMONSTRAÇÃO' : ''}`);
    console.log(
      atual === null
        ? `Numeração ainda não definida: começaria em ${String(padrao)} (maior número conhecido até 999 + 1).`
        : `Numeração atual: próximo ${String(atual.proximo)} · reservadas ${textoFaixas(atual.reservados)} · origem: ${atual.origem}`,
    );
    console.log(`Próximo palete novo receberia: ${String(await previsaoNumeroPalete(db, escopo.id))}`);
    if (values.ultimo === undefined) return 0;

    const ultimo = Number(values.ultimo);
    if (!Number.isInteger(ultimo) || ultimo < 0) throw new Error('--ultimo deve ser o último número inteiro já usado no piso (ex.: 278).');
    const reservados = (values.reservar ?? []).map(faixaDeTexto);
    const autor = await resolverAutor(db, escopo, values.usuario);
    console.log(`\nNova definição: último usado ${String(ultimo)} → próximo ${String(ultimo + 1)} · reservadas ${textoFaixas(reservados)} · por ${autor.login}`);
    if (ultimo + 1 < padrao) console.log(`Atenção: já há números até ${String(padrao - 1)} nos registros; os usados são pulados (nunca reutilizados).`);
    if (!values.executar) {
      console.log('Prévia: nada foi gravado. Rode de novo com --executar.');
      return 0;
    }
    const agora = new Date();
    const origem = `Informado por ${autor.login} em ${agora.toISOString().slice(0, 10)}: último N° Pallet usado ${String(ultimo)}${reservados.length > 0 ? `; reservadas ${textoFaixas(reservados)}` : ''}.`;
    await db.$transaction(async (tx) => {
      await definirNumeracao(tx, escopo.id, { ultimo, reservados, origem }, autor.usuarioId, agora);
      await registrarEvento(tx, {
        acao: 'NUMERACAO_PALETE_DEFINIDA',
        resultado: 'SUCESSO',
        atorUsuarioId: autor.usuarioId,
        escopoId: escopo.id,
        alvoTipo: 'ESCOPO',
        alvoId: escopo.id,
        detalhes: { ultimo, proximo: ultimo + 1, reservados: textoFaixas(reservados), anterior: atual === null ? null : atual.proximo, origem: 'comando_local' },
        requestId: `cli-numeracao-${randomUUID()}`,
      });
    });
    console.log(`Gravado. Próximo palete novo receberá: ${String(await previsaoNumeroPalete(db, escopo.id))}`);
    return 0;
  } finally {
    await db.$disconnect();
  }
}

principal().then(
  (codigo) => {
    process.exitCode = codigo;
  },
  (erro: unknown) => {
    console.error(erro instanceof Error ? erro.message : String(erro));
    process.exitCode = 1;
  },
);
