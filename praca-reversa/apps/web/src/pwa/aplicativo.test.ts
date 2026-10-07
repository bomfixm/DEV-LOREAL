import { describe, expect, it } from 'vitest';
import { comBase, semBase } from '../base';
import { classificarErroCamera } from '../features/camera/deteccao';
import { lerRota } from '../rotas';
import { plataformaProvavel } from './instalacao';

const ID = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

describe('caminho-base', () => {
  it('rota interna ↔ endereço com /praca/', () => {
    expect(comBase('/praca/', `/paletes/${ID}`)).toBe(`/praca/paletes/${ID}`);
    expect(comBase('/praca/', '/')).toBe('/praca/');
    expect(comBase('/', '/janelas')).toBe('/janelas');
    expect(semBase('/praca/', `/praca/paletes/${ID}`)).toBe(`/paletes/${ID}`);
    expect(semBase('/praca/', '/praca')).toBe('/');
    expect(semBase('/praca/', '/praca/')).toBe('/');
    expect(semBase('/praca/', `/paletes/${ID}`)).toBeNull();
    expect(semBase('/praca/', '/pracas/x')).toBeNull();
  });

  it('rota profunda do QR continua reconhecida depois de remover o caminho-base', () => {
    const interno = semBase('/praca/', `/praca/paletes/${ID.toUpperCase()}`) ?? '';
    expect(lerRota(interno, '')).toEqual({ tipo: 'palete', id: ID });
    expect(lerRota('/aplicativo', '')).toEqual({ tipo: 'aplicativo' });
  });
});

describe('câmera', () => {
  it('cada falha de getUserMedia vira uma situação com alternativa manual', () => {
    const erro = (name: string) => Object.assign(new Error(name), { name });
    expect(classificarErroCamera(erro('NotAllowedError'))).toBe('permissao-negada');
    expect(classificarErroCamera(erro('SecurityError'))).toBe('permissao-negada');
    expect(classificarErroCamera(erro('NotFoundError'))).toBe('sem-camera');
    expect(classificarErroCamera(erro('OverconstrainedError'))).toBe('sem-camera');
    expect(classificarErroCamera(erro('NotReadableError'))).toBe('camera-ocupada');
    expect(classificarErroCamera(erro('AbortError'))).toBe('camera-ocupada');
    expect(classificarErroCamera(erro('TypeError'))).toBe('sem-recurso');
    expect(classificarErroCamera('qualquer coisa')).toBe('outra');
  });
});

describe('instruções de instalação', () => {
  it('pista da plataforma pelo navegador (só para escolher o texto)', () => {
    expect(plataformaProvavel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('ios');
    expect(plataformaProvavel('Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36')).toBe('android-chromium');
    expect(plataformaProvavel('Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0')).toBe('android-firefox');
    expect(plataformaProvavel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36 Edg/141.0')).toBe('desktop-chromium');
    expect(plataformaProvavel('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('desktop-firefox');
    expect(plataformaProvavel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15')).toBe('desktop-safari');
  });
});
