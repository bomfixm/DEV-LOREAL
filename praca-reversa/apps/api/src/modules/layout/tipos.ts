/** Representação intermediária dos layouts gerados para as fixtures (unidades de desenho). */
export interface RetanguloUd {
  x: number;
  y: number;
  largura: number;
  altura: number;
}

export interface ElementoGerado extends RetanguloUd {
  codigo: string;
  tipo: 'ZONA' | 'BLOCO' | 'CORREDOR' | 'DOCA';
  rotulo: string;
  ficticio: boolean;
  /** Espaço reservado ao título; nunca sobre posições selecionáveis. */
  caixaRotulo: RetanguloUd | null;
  /** Bloco: nome operacional autorizado e prefixo dos endereços reais. */
  nomeOperacional?: string | null;
  prefixoEndereco?: string | null;
}

export interface FileiraGerada extends RetanguloUd {
  codigo: string;
  rotulo: string;
  ordem: number;
  blocoCodigo: string | null;
  caixaRotulo: RetanguloUd;
  /** Lado na vista de referência (faixa dupla) ou faixa única. */
  lado?: 'ESQUERDO' | 'DIREITO' | 'UNICO' | null;
}

export interface PosicaoGerada extends RetanguloUd {
  codigo: string;
  fileiraCodigo: string;
  numero: number;
  disponivel: boolean;
  ocupacaoLevantada: boolean;
  /** Área desativada (pronta para ativar): sempre indisponível. */
  desativada?: boolean;
  motivoIndisponibilidade?: string | null;
}

export interface LayoutGerado {
  largura: number;
  altura: number;
  elementos: ElementoGerado[];
  fileiras: FileiraGerada[];
  posicoes: PosicaoGerada[];
}

export const doisDigitos = (n: number) => String(n).padStart(2, '0');
