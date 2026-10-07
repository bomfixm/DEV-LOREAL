/**
 * Caminho-base da instalação (etapa 09): `base` do Vite, vindo de CAMINHO_BASE
 * no build, sempre terminado em "/". As rotas da interface são internas
 * ("/paletes/<id>"); só a barra de endereços e os pedidos à API levam o
 * caminho-base ("/praca/paletes/<id>", "/praca/api/v1/...").
 */
export const CAMINHO_BASE: string = import.meta.env.BASE_URL;

/** Caminho interno ("/paletes/x") → endereço com o caminho-base. */
export function comBase(base: string, interno: string): string {
  return base === '/' ? interno : `${base.slice(0, -1)}${interno}`;
}

/** Endereço da barra → caminho interno; fora do caminho-base → `null`. */
export function semBase(base: string, endereco: string): string | null {
  if (base === '/') return endereco;
  if (endereco === base.slice(0, -1)) return '/';
  return endereco.startsWith(base) ? endereco.slice(base.length - 1) : null;
}

export const paraEndereco = (interno: string): string => comBase(CAMINHO_BASE, interno);
export const deEndereco = (endereco: string): string | null => semBase(CAMINHO_BASE, endereco);

/** Versão da interface (package.json da raiz, injetada no build). */
export const VERSAO_INTERFACE: string = typeof __VERSAO_INTERFACE__ === 'string' ? __VERSAO_INTERFACE__ : 'desenvolvimento';
