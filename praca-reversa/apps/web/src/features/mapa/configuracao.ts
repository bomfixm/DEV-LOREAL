/**
 * Configuração interna da tela do mapa (etapa 2, out. 2026).
 *
 * `mostrarListaPaletesNoMapa`: coluna de lista e filtros de paletes à esquerda
 * do mapa no computador (abaixo de "Posições livres"). Desativada a pedido da
 * operação para o mapa ocupar a largura: a coluna não é montada, não reserva
 * espaço no grid e não consulta nada próprio. O componente (`ListaPaletes`) e
 * toda a sua lógica continuam no código.
 *
 * Para reativar: troque para `true`, gere o build (`npm run build`) e reinicie
 * o servidor. A busca do cabeçalho, o leitor de QR, as posições livres e os
 * controles do mapa funcionam nos dois modos. No celular a lista continua na
 * aba "Lista" (não ocupa coluna ao lado do mapa).
 */
export const mostrarListaPaletesNoMapa = false as boolean;
