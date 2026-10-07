import { describe, expect, it } from 'vitest';
import { lerConfiguracao } from '../../src/config.js';

const BASE = {
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5433/praca_reversa_dev',
  APP_SEGREDO: 'segredo-de-teste-com-mais-de-trinta-e-dois-caracteres',
  APP_URL_PUBLICA: 'https://praca.exemplo.interno',
};

describe('configuração', () => {
  it('sem APP_AMBIENTE assume produção: cookie Secure e API só local por padrão', () => {
    const config = lerConfiguracao(BASE, []);
    expect(config.ambiente).toBe('producao');
    expect(config.cookieSeguro).toBe(true);
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3000);
  });

  it('desenvolvimento local usa cookie sem Secure, salvo indicação explícita', () => {
    expect(lerConfiguracao({ ...BASE, APP_AMBIENTE: 'desenvolvimento' }, []).cookieSeguro).toBe(false);
    expect(lerConfiguracao({ ...BASE, APP_AMBIENTE: 'desenvolvimento', COOKIE_SEGURO: 'true' }, []).cookieSeguro).toBe(true);
  });

  it('exige DATABASE_URL PostgreSQL e segredo longo; recusa o valor de exemplo em produção', () => {
    expect(() => lerConfiguracao({ APP_SEGREDO: BASE.APP_SEGREDO }, [])).toThrow();
    expect(() => lerConfiguracao({ ...BASE, DATABASE_URL: 'sqlite://arquivo.db' }, [])).toThrow();
    expect(() => lerConfiguracao({ ...BASE, APP_SEGREDO: 'curto' }, [])).toThrow();
    expect(() => lerConfiguracao({ ...BASE, APP_SEGREDO: 'TROQUE_ESTE_SEGREDO_POR_UM_VALOR_ALEATORIO' }, [])).toThrow(/exemplo/);
  });

  it('--porta prevalece sobre um PORT genérico do ambiente (npm run dev)', () => {
    expect(lerConfiguracao({ ...BASE, PORT: '5173' }, ['--porta=3000']).port).toBe(3000);
    expect(lerConfiguracao({ ...BASE, PORT: '4310' }, []).port).toBe(4310);
  });

  it('--sem-interface desliga o build estático e porta inválida é recusada', () => {
    expect(lerConfiguracao(BASE, ['--sem-interface']).interfaceDir).toBeNull();
    expect(() => lerConfiguracao({ ...BASE, PORT: 'abc' }, [])).toThrow();
    expect(() => lerConfiguracao(BASE, ['--porta=70000'])).toThrow();
  });

  it('URL das etiquetas: obrigatória em produção, só origem, padrão local fora de produção', () => {
    const { APP_URL_PUBLICA: _url, ...semUrl } = BASE;
    expect(() => lerConfiguracao(semUrl, [])).toThrow(/APP_URL_PUBLICA/);
    expect(lerConfiguracao(BASE, []).urlPublica).toBe('https://praca.exemplo.interno');
    expect(lerConfiguracao({ ...BASE, APP_URL_PUBLICA: 'http://10.0.0.5:3000/' }, []).urlPublica).toBe('http://10.0.0.5:3000');
    for (const invalida of ['ftp://x', 'nao e url', 'https://x/caminho', 'https://x/?a=1', 'https://u:s@x']) {
      expect(() => lerConfiguracao({ ...BASE, APP_URL_PUBLICA: invalida }, []), invalida).toThrow(/APP_URL_PUBLICA/);
    }
    const dev = { ...semUrl, APP_AMBIENTE: 'desenvolvimento' };
    expect(lerConfiguracao({ ...dev, PORT: '3000' }, []).urlPublica).toBe('http://127.0.0.1:3000');
    expect(lerConfiguracao(dev, ['--sem-interface', '--porta=3000']).urlPublica).toBe('http://127.0.0.1:5173');
    expect(lerConfiguracao({ ...dev, HOST: '0.0.0.0', PORT: '4310' }, []).urlPublica).toBe('http://127.0.0.1:4310');
  });

  it('limites de sessão configuráveis com faixa segura', () => {
    const config = lerConfiguracao({ ...BASE, SESSAO_INATIVIDADE_MINUTOS: '30', SESSAO_DURACAO_MAXIMA_HORAS: '8' }, []);
    expect([config.sessaoInatividadeMinutos, config.sessaoDuracaoMaximaHoras]).toEqual([30, 8]);
    expect(() => lerConfiguracao({ ...BASE, SESSAO_DURACAO_MAXIMA_HORAS: '1000' }, [])).toThrow();
  });
});
