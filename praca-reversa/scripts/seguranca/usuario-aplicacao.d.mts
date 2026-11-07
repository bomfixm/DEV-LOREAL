import type { Client } from 'pg';

export function prepararUsuarioAplicacao(admin: Client, opcoes: { papel: string; senha: string }): Promise<void>;
export function urlDoUsuario(urlDono: string, papel: string, senha: string): string;
