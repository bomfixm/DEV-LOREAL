import type { AlertaSeguranca } from '@praca-reversa/contracts';
import type { Banco } from '../../db/cliente.js';

/**
 * Regras de atividade anormal, avaliadas sobre a auditoria já existente (nada novo
 * é gravado). Cada regra conta eventos numa janela; passou do limite, vira alerta.
 */
interface Regra {
  codigo: string;
  acoes: string[];
  janelaMinutos: number;
  limite: number;
  /** A partir deste total o alerta sobe de ATENCAO para ALTA. */
  limiteAlto: number;
  titulo: string;
  detalhe: (total: number) => string;
}

export const REGRAS_ALERTA: Regra[] = [
  {
    codigo: 'SENHAS_ERRADAS',
    acoes: ['LOGIN_FALHA'],
    janelaMinutos: 60,
    limite: 10,
    limiteAlto: 30,
    titulo: 'Muitas senhas erradas',
    detalhe: (n) => `${String(n)} tentativas de entrada falharam na última hora. Pode ser alguém tentando adivinhar uma senha.`,
  },
  {
    codigo: 'LOGIN_BLOQUEADO',
    acoes: ['LOGIN_BLOQUEADO'],
    janelaMinutos: 24 * 60,
    limite: 1,
    limiteAlto: 10,
    titulo: 'Entrada bloqueada por excesso de tentativas',
    detalhe: (n) => `O bloqueio automático de entrada foi acionado ${String(n)} vez(es) nas últimas 24 horas.`,
  },
  {
    codigo: 'ACESSOS_NEGADOS',
    acoes: ['ACESSO_NEGADO'],
    janelaMinutos: 60,
    limite: 10,
    limiteAlto: 40,
    titulo: 'Muitas ações negadas por falta de permissão',
    detalhe: (n) => `${String(n)} ações foram negadas na última hora. Alguém pode estar tentando fazer o que não pode.`,
  },
  {
    codigo: 'EXPORTACOES',
    acoes: ['BUSCA_EXPORTADA'],
    janelaMinutos: 60,
    limite: 5,
    limiteAlto: 15,
    titulo: 'Muitas exportações de dados',
    detalhe: (n) => `${String(n)} exportações de busca na última hora.`,
  },
  {
    codigo: 'MUDANCAS_DE_USUARIOS',
    acoes: ['USUARIO_CRIADO', 'VINCULO_ALTERADO', 'CONTA_DESATIVADA', 'CONTA_REATIVADA'],
    janelaMinutos: 60,
    limite: 3,
    limiteAlto: 8,
    titulo: 'Várias mudanças em usuários em pouco tempo',
    detalhe: (n) => `${String(n)} criações, trocas de perfil ou ativações/desativações de conta na última hora.`,
  },
  {
    codigo: 'PALETES_ARQUIVADOS',
    acoes: ['PALETE_ARQUIVADO'],
    janelaMinutos: 60,
    limite: 10,
    limiteAlto: 40,
    titulo: 'Muitos paletes arquivados em pouco tempo',
    detalhe: (n) => `${String(n)} paletes arquivados na última hora. Confira se foi uma operação planejada.`,
  },
];

export async function avaliarAlertas(db: Banco, agora: Date): Promise<AlertaSeguranca[]> {
  const alertas: AlertaSeguranca[] = [];
  for (const regra of REGRAS_ALERTA) {
    const desde = new Date(agora.getTime() - regra.janelaMinutos * 60_000);
    const total = await db.eventoAuditoria.count({ where: { acao: { in: regra.acoes }, ocorridoEm: { gte: desde } } });
    if (total < regra.limite) continue;
    alertas.push({
      code: regra.codigo,
      level: total >= regra.limiteAlto ? 'ALTA' : 'ATENCAO',
      title: regra.titulo,
      detail: regra.detalhe(total),
      count: total,
      windowMinutes: regra.janelaMinutos,
    });
  }
  // Os mais graves primeiro.
  return alertas.sort((a, b) => (a.level === b.level ? 0 : a.level === 'ALTA' ? -1 : 1));
}
