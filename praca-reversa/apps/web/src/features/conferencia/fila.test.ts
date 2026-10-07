import type { NovaObservacao } from '@praca-reversa/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Armazenamento } from '../../api/incertas';
import {
  ROTULO_NAO_ENVIADO,
  contarNaoEnviadas,
  descartarDeOutrosUsuarios,
  descartarTodasNaoEnviadas,
  gravarNaoEnviadas,
  lerNaoEnviadas,
  usarArmazenamentoFila,
  type EnvioPendente,
} from './fila';

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

const CORPO = { mode: 'MANUAL', code: '0007891234567895', quantity: '2', unit: 'CX' } as unknown as NovaObservacao;
const CTX = { usuarioId: 'u-1', escopoId: 'e-1', conferenciaId: 'c-1' };

function entrada(id: string, estado: EnvioPendente['estado'] = 'nao-enviada'): EnvioPendente {
  return { id, chave: `chave-${id}-000`, corpo: CORPO, resumo: `2 CX (${id})`, estado, erro: null, criadaEm: 1 };
}

let armazenamento: ArmazenamentoFalso;
beforeEach(() => {
  armazenamento = new ArmazenamentoFalso();
  usarArmazenamentoFila(() => armazenamento);
  descartarTodasNaoEnviadas();
});

describe('entradas não confirmadas da conferência', () => {
  it('política desligada: só memória (sobrevive à sessão expirada do mesmo usuário), nada no navegador', () => {
    gravarNaoEnviadas(CTX, [entrada('a')], false);
    expect(armazenamento.dados.size).toBe(0);
    expect(lerNaoEnviadas(CTX, false).map((e) => e.id)).toEqual(['a']);
    expect(contarNaoEnviadas('u-1')).toBe(1);
  });

  it('política ligada: versão, data, rótulo "não enviado", isolado por usuário, escopo e conferência; zeros preservados', () => {
    gravarNaoEnviadas(CTX, [entrada('a'), entrada('b', 'enviando')], true);
    const [chave, texto] = [...armazenamento.dados.entries()][0] ?? ['', ''];
    expect(chave).toContain('v2:u-1:e-1:c-1');
    const gravado = JSON.parse(texto) as { versao: number; rotulo: string; salvoEm: string; itens: { id: string; estado: string; corpo: { code: string } }[] };
    expect(gravado.versao).toBe(2);
    expect(gravado.rotulo).toBe(ROTULO_NAO_ENVIADO);
    expect(Date.parse(gravado.salvoEm)).not.toBeNaN();
    // Em curso quando a aba fechar conta como incerta: precisa de verificação antes de qualquer reenvio.
    expect(gravado.itens.map((i) => [i.id, i.estado])).toEqual([
      ['a', 'nao-enviada'],
      ['b', 'incerta'],
    ]);
    expect(gravado.itens[0]?.corpo.code).toBe('0007891234567895');

    // Reabrir a aplicação (memória vazia): só o mesmo contexto recupera.
    descartarDeOutrosUsuarios('u-1');
    const memoriaVazia = { ...CTX, conferenciaId: 'c-2' };
    expect(lerNaoEnviadas(memoriaVazia, true)).toEqual([]);
    expect(lerNaoEnviadas({ ...CTX, escopoId: 'e-2' }, true)).toEqual([]);
  });

  it('política desconhecida não toca no navegador', () => {
    gravarNaoEnviadas(CTX, [entrada('a')], true);
    const antes = new Map(armazenamento.dados);
    gravarNaoEnviadas(CTX, [], null);
    expect(armazenamento.dados).toEqual(antes);
  });

  it('outro usuário: o do anterior some (memória e navegador), inclusive formato antigo da etapa 04', () => {
    gravarNaoEnviadas(CTX, [entrada('a')], true);
    armazenamento.setItem('pr-conferencia-nao-enviadas:u-1:c-velha', '[]');
    descartarDeOutrosUsuarios('u-2');
    expect(armazenamento.dados.size).toBe(0);
    expect(contarNaoEnviadas()).toBe(0);
    expect(lerNaoEnviadas(CTX, true)).toEqual([]);
  });

  it('sair da conta apaga tudo', () => {
    gravarNaoEnviadas(CTX, [entrada('a')], true);
    descartarTodasNaoEnviadas();
    expect(armazenamento.dados.size).toBe(0);
    expect(contarNaoEnviadas()).toBe(0);
  });
});
