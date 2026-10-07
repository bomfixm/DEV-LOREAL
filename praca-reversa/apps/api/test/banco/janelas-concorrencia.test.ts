import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bancoDeTeste, codigoErro, mutar } from './apoio.js';
import { palete, type Ambiente, montarAmbiente } from './claims-apoio.js';
import { API, cancelar, corpoExpedicao, expedir, janela, janelaConfirmada, materialLiberado, pecas, reservar, reservarOk, restricao, saldoAtual } from './janelas-apoio.js';

/**
 * Concorrência real no PostgreSQL (READ COMMITTED + bloqueios em ordem fixa:
 * janela → reserva → paletes → saldo). Cada cenário roda algumas rodadas
 * com pedidos simultâneos.
 */
const db = bancoDeTeste();
let a: Ambiente;
const RODADAS = 3;

beforeAll(async () => {
  a = await montarAmbiente(db);
});
afterAll(async () => {
  await a.app.close();
  await db.$disconnect();
});

describe('concorrência de reservas, capacidade e saída', () => {
  it('T21 / cenário 3: dois usuários disputam a última capacidade da janela; só o que cabe confirma', async () => {
    for (let i = 0; i < RODADAS; i++) {
      const x = await materialLiberado(a, `T21-X${String(i)}`, '10');
      const y = await materialLiberado(a, `T21-Y${String(i)}`, '10');
      const j = await janelaConfirmada(a, [pecas('10')]);
      const [r1, r2] = await Promise.all([reservar(a, j, [{ p: x.p, seg: x.seg, q: '6' }], [], a.sup), reservar(a, j, [{ p: y.p, seg: y.seg, q: '6' }], [], a.sup)]);
      const status = [r1.statusCode, r2.statusCode].sort();
      expect(status).toEqual([200, 409]);
      const recusada = r1.statusCode === 409 ? r1 : r2;
      expect(codigoErro(recusada)).toBe('CAPACIDADE_INSUFICIENTE');
      const res = restricao(await janela(a, j.id), 'QUANTIDADE');
      expect([res.reserved, res.remaining]).toEqual(['6', '4']);
      const reservado = [(await saldoAtual(a, x.p.id, x.seg))?.reservada, (await saldoAtual(a, y.p.id, y.seg))?.reservada].sort();
      expect(reservado).toEqual(['0', '6']);
    }
  });

  it('cenário 4: duas janelas disputam o mesmo saldo; reservas somadas nunca passam do estoque validado', async () => {
    for (let i = 0; i < RODADAS; i++) {
      const m = await materialLiberado(a, `C4-${String(i)}`, '10');
      const [j1, j2] = await Promise.all([janelaConfirmada(a, [pecas('100')]), janelaConfirmada(a, [pecas('100')])]);
      const [r1, r2] = await Promise.all([reservar(a, j1, [{ p: m.p, seg: m.seg, q: '7' }]), reservar(a, j2, [{ p: m.p, seg: m.seg, q: '7' }])]);
      expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 409]);
      expect(codigoErro(r1.statusCode === 409 ? r1 : r2)).toBe('SALDO_INSUFICIENTE');
      expect(await saldoAtual(a, m.p.id, m.seg)).toMatchObject({ quantidade: '10', reservada: '7' });
    }
  });

  it('cenário 10: duas confirmações simultâneas da mesma reserva com chaves diferentes geram uma única baixa', async () => {
    for (let i = 0; i < RODADAS; i++) {
      const m = await materialLiberado(a, `C10-${String(i)}`, '9');
      const j = await janelaConfirmada(a, [pecas('100')]);
      const r = await reservarOk(a, j, [{ p: m.p, seg: m.seg, q: '5' }]);
      const corpo = await corpoExpedicao(a, r);
      const [e1, e2] = await Promise.all([expedir(a, r, corpo), expedir(a, r, corpo)]);
      expect([e1.statusCode, e2.statusCode].sort()).toEqual([200, 409]);
      expect(await db.eventoEstoque.count({ where: { paleteId: m.p.id, tipo: 'EXPEDICAO' } })).toBe(1);
      expect(await saldoAtual(a, m.p.id, m.seg)).toMatchObject({ quantidade: '4', reservada: '0', liberada: '4' });
      expect(restricao(await janela(a, j.id), 'QUANTIDADE')).toMatchObject({ reserved: '0', shipped: '5' });
    }
  });

  it('cenário 14: cancelar e expedir ao mesmo tempo — se o cancelamento veio antes, a saída é recusada; se a saída veio antes, nada é reposto', async () => {
    const vistos = new Set<string>();
    for (let i = 0; i < RODADAS + 2; i++) {
      const m = await materialLiberado(a, `C14-${String(i)}`, '8');
      const j = await janelaConfirmada(a, [pecas('100')]);
      const r = await reservarOk(a, j, [{ p: m.p, seg: m.seg, q: '8' }]);
      const corpo = await corpoExpedicao(a, r);
      const [c, e] = await Promise.all([cancelar(a, r), expedir(a, r, corpo)]);
      expect([c.statusCode, e.statusCode].sort()).toEqual([200, 409]);
      const saldo = await saldoAtual(a, m.p.id, m.seg);
      const res = restricao(await janela(a, j.id), 'QUANTIDADE');
      if (e.statusCode === 200) {
        vistos.add('saida');
        expect(saldo).toBeNull();
        expect([res.reserved, res.shipped]).toEqual(['0', '8']);
        expect(codigoErro(c)).toBe('SITUACAO_INVALIDA');
      } else {
        vistos.add('cancelamento');
        expect(saldo).toMatchObject({ quantidade: '8', reservada: '0' });
        expect([res.reserved, res.shipped]).toEqual(['0', '0']);
        expect(codigoErro(e)).toBe('SITUACAO_INVALIDA');
      }
    }
    expect(vistos.size).toBeGreaterThan(0);
  });

  it('T13: reserva e transferência simultâneas sobre o mesmo saldo nunca reservam nem movem a mesma quantidade', async () => {
    for (let i = 0; i < RODADAS; i++) {
      const m = await materialLiberado(a, `T13-${String(i)}`, '10');
      const destino = await materialLiberado(a, `T13-D${String(i)}`, '1');
      const j = await janelaConfirmada(a, [pecas('100')]);
      const atualDestino = await palete(a, destino.p.id);
      const [r, t] = await Promise.all([
        reservar(a, j, [{ p: m.p, seg: m.seg, q: '5' }]),
        mutar(a.app, a.op, 'POST', `${API}/transferencias`, {
          sourcePalletId: m.p.id,
          destinationPalletId: destino.p.id,
          segmentId: m.seg,
          quantity: '6',
          expectedSourceVersion: m.p.version,
          expectedDestinationVersion: atualDestino.version,
          reason: 'Consolidação simultânea (fictício)',
        }),
      ]);
      const s = await saldoAtual(a, m.p.id, m.seg);
      // Nunca as duas: 5 reservados + 6 transferidos passariam dos 10.
      expect([r.statusCode, t.statusCode]).not.toEqual([200, 200]);
      if (r.statusCode === 200) expect(s).toMatchObject({ quantidade: '10', reservada: '5' });
      if (t.statusCode === 200) expect(s).toMatchObject({ quantidade: '4', reservada: '0' });
      expect(Number(s?.reservada ?? '0')).toBeLessThanOrEqual(Number(s?.quantidade ?? '0'));
    }
  });
});
