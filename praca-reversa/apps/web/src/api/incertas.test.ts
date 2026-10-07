import { LIMITE_PROCESSAMENTO_MS, type ResultadoOperacao } from '@praca-reversa/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  aindaPodeProcessar,
  bloqueioPara,
  concluirPorChave,
  definirContexto,
  incertasDoContexto,
  limparIncertas,
  registrarIncerta,
  usarArmazenamento,
  type Armazenamento,
} from './incertas';
import { decidir } from './recuperacao';

/** sessionStorage em memória (o teste roda em Node). */
class ArmazenamentoFalso implements Armazenamento {
  dados = new Map<string, string>();
  get length() {
    return this.dados.size;
  }
  getItem(k: string) {
    return this.dados.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.dados.set(k, v);
  }
  removeItem(k: string) {
    this.dados.delete(k);
  }
  key(i: number) {
    return [...this.dados.keys()][i] ?? null;
  }
}

const A = { usuarioId: 'u-a', escopoId: 'e-1' };
const B = { usuarioId: 'u-b', escopoId: 'e-1' };
let armazenamento: ArmazenamentoFalso;

function registrar(chave: string, url = '/api/v1/paletes/p1/movimentos', corpo: unknown = { destino: 'F01-P01' }) {
  return registrarIncerta({ chave, metodo: 'POST', url, corpo, descricao: 'Movimento de palete' });
}

beforeEach(() => {
  armazenamento = new ArmazenamentoFalso();
  usarArmazenamento(() => armazenamento);
  limparIncertas();
});

describe('operações incertas', () => {
  it('bloqueiam outro pedido (outra chave) ao mesmo alvo até a resolução; a mesma chave passa', () => {
    definirContexto(A, false);
    registrar('chave-0001');
    expect(bloqueioPara('POST', '/api/v1/paletes/p1/movimentos', 'chave-0002')?.chave).toBe('chave-0001');
    expect(bloqueioPara('POST', '/api/v1/paletes/p1/movimentos', 'chave-0001')).toBeNull();
    expect(bloqueioPara('POST', '/api/v1/paletes/p2/movimentos', 'chave-0002')).toBeNull();
    concluirPorChave('chave-0001', 'confirmada', 'ok');
    expect(bloqueioPara('POST', '/api/v1/paletes/p1/movimentos', 'chave-0002')).toBeNull();
  });

  it('isoladas por usuário e escopo; outro usuário apaga as do anterior', () => {
    definirContexto(A, true);
    registrar('chave-a-001');
    definirContexto({ ...A, escopoId: 'e-2' }, true);
    expect(incertasDoContexto()).toHaveLength(0);
    expect(bloqueioPara('POST', '/api/v1/paletes/p1/movimentos', 'outra-000')).toBeNull();
    definirContexto(A, true);
    expect(incertasDoContexto().map((i) => i.chave)).toEqual(['chave-a-001']);
    definirContexto(B, true);
    expect(incertasDoContexto()).toHaveLength(0);
    expect([...armazenamento.dados.keys()].some((k) => k.includes(':u-a:'))).toBe(false);
  });

  it('política desligada: nada no navegador; ligada: versão, data, rótulo e sem senha', () => {
    definirContexto(A, false);
    registrar('chave-mem-01');
    expect(armazenamento.dados.size).toBe(0);
    definirContexto(A, true);
    registrar('chave-sen-01', '/api/v1/admin/usuarios', { login: 'x', senha: 'segredo-ficticio' });
    const [gravado] = [...armazenamento.dados.values()];
    expect(gravado).toBeDefined();
    const conteudo = JSON.parse(gravado ?? '{}') as { versao: number; salvoEm: string; rotulo: string; itens: { chave: string; corpo?: unknown }[] };
    expect(conteudo.versao).toBe(1);
    expect(conteudo.rotulo).toMatch(/não confirmado/);
    expect(Date.parse(conteudo.salvoEm)).not.toBeNaN();
    expect(gravado).not.toContain('segredo-ficticio');
    expect(conteudo.itens.find((i) => i.chave === 'chave-sen-01')?.corpo).toBeUndefined();
  });

  it('política desconhecida (null) não grava nem apaga o que já estava guardado', () => {
    definirContexto(A, true);
    registrar('chave-guard-1');
    const antes = new Map(armazenamento.dados);
    limparIncertas();
    for (const [k, v] of antes) armazenamento.setItem(k, v);
    definirContexto(A, null);
    expect(armazenamento.dados).toEqual(antes);
    // Ao conhecer a política, recupera o pedido para verificação (nunca para reenvio automático).
    definirContexto(A, true);
    const [recuperada] = incertasDoContexto();
    expect(recuperada?.chave).toBe('chave-guard-1');
    expect(recuperada?.situacao).toBe('incerta');
  });

  it('sair da conta apaga memória e navegador', () => {
    definirContexto(A, true);
    registrar('chave-sair-1');
    limparIncertas();
    expect(armazenamento.dados.size).toBe(0);
    definirContexto(A, true);
    expect(incertasDoContexto()).toHaveLength(0);
  });

  it('decisão da verificação: registrada encerra; não encontrada só vira "não registrada" depois do tempo-limite', () => {
    definirContexto(A, false);
    const item = registrar('chave-dec-01');
    expect(item).not.toBeNull();
    if (item === null) return;
    const registrada: ResultadoOperacao = {
      key: 'chave-dec-01',
      state: 'REGISTRADA',
      operations: [{ operation: 'movimento.mover', status: 200, recordedAt: '2026-10-04T12:00:00.000Z', response: {} }],
      checkedAt: '2026-10-04T12:00:01.000Z',
    };
    expect(decidir(item, registrada).situacao).toBe('confirmada');
    const ausente: ResultadoOperacao = { key: 'chave-dec-01', state: 'NAO_ENCONTRADA', operations: [], checkedAt: '2026-10-04T12:00:01.000Z' };
    expect(decidir(item, ausente, item.criadaEm + 1_000).situacao).toBe('incerta');
    expect(aindaPodeProcessar(item, item.criadaEm + LIMITE_PROCESSAMENTO_MS + 1)).toBe(false);
    expect(decidir(item, ausente, item.criadaEm + LIMITE_PROCESSAMENTO_MS + 1).situacao).toBe('nao-registrada');
  });
});
