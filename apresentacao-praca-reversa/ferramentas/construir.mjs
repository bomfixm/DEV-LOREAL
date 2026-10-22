// Gera a apresentação em um único arquivo HTML (CSS, scripts, fontes e imagens embutidos)
// e os arquivos de apoio (roteiro, guia, fontes e estado). Uso: node ferramentas/construir.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = join(raiz, 'fonte');
const entrega = join(raiz, 'entrega');
mkdirSync(entrega, { recursive: true });

const ler = (f) => readFileSync(join(fonte, f), 'utf8');
const MIME = { '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const dataUri = (rel) => `data:${MIME[extname(rel)]};base64,${readFileSync(join(fonte, rel)).toString('base64')}`;
const embutirUrls = (css) => css.replace(/url\((fontes|ativos)\/([^)]+)\)/g, (_, pasta, arq) => `url(${dataUri(`${pasta}/${arq}`)})`);
const scriptSeguro = (js) => js.replace(/<\/script/gi, '<\\/script');

// ---------- Apresentação ----------
let html = ler('index.html');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, arq) => `<style>\n${embutirUrls(ler(arq))}\n</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, arq) => `<script>\n${scriptSeguro(ler(arq))}\n</script>`);
html = html.replace('<head>', `<head>\n<!-- Praça Reversa — apresentação. Arquivo único gerado por ferramentas/construir.mjs; editar em fonte/. -->`);
writeFileSync(join(entrega, 'Praca-Reversa-Apresentacao.html'), html);

// ---------- Dados para os arquivos de apoio ----------
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(ler('dados.js'), ctx);
vm.runInContext(ler('roteiro.js'), ctx);
const D = ctx.window.PR_DADOS;
const R = ctx.window.PR_ROTEIRO;
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fonteInter = `@font-face{font-family:Inter;src:url(${dataUri('fontes/inter-latin-wght-normal.woff2')}) format('woff2');font-weight:100 900}
@font-face{font-family:Inter;src:url(${dataUri('fontes/inter-latin-ext-wght-normal.woff2')}) format('woff2');font-weight:100 900;unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113}`;
const pagina = (titulo, corpo, extraCss = '') => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(titulo)}</title>
<style>${fonteInter}
*{box-sizing:border-box} body{margin:0;background:#F5F3EB;color:#17191C;font-family:Inter,'Segoe UI',Arial,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.5}
main{max-width:860px;margin:0 auto;padding:36px 22px 60px}
h1{font-size:30px;line-height:1.15;margin:0 0 6px;letter-spacing:-.02em} h2{font-size:21px;margin:30px 0 8px;letter-spacing:-.01em}
.sub{color:#5A5F67;margin:0 0 22px} .cab{display:flex;align-items:center;gap:12px;margin-bottom:18px;font-weight:800}
.cab i{display:inline-block;width:14px;height:14px;border-radius:4px;background:#FFCC00;box-shadow:0 0 0 3px #D40511 inset}
table{width:100%;border-collapse:collapse;font-size:15px;background:#fff;border-radius:12px;overflow:hidden}
th,td{text-align:left;vertical-align:top;padding:9px 12px;border-bottom:1px solid #E5E0D3} th{background:#ECE8DC;font-size:13px;letter-spacing:.06em;text-transform:uppercase}
.estado{white-space:nowrap;font-weight:700} .DISPONIVEL{color:#17784A} .TESTE{color:#9A6400} .AJUSTE{color:#C2410C}
kbd{font:600 13px Inter,sans-serif;padding:2px 7px;border-radius:6px;background:#17191C;color:#F5F3EB}
@media print{body{background:#fff} main{padding:0;max-width:none} a{color:inherit}}
${extraCss}</style></head><body><main>${corpo}</main></body></html>`;

// ---------- Roteiro do apresentador ----------
const roteiro = pagina('Roteiro do apresentador — Praça Reversa', `
  <div class="cab"><i></i>Praça Reversa · roteiro do apresentador</div>
  <h1>Roteiro para apresentar</h1>
  <p class="sub">${R.length} cenas, na mesma ordem e com os mesmos números da apresentação. Duração sugerida: 6 a 9 minutos com pausas. Os lembretes são para você, não para ler em voz alta.</p>
  ${R.map((r) => `<section class="cena"><div class="num">Cena ${r.id}</div><h2>${esc(r.titulo)}</h2>${r.fala.map((p) => `<p>${esc(p)}</p>`).join('')}
    ${r.cuidados?.length ? `<ul class="cuid">${r.cuidados.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}</section>`).join('')}
  <p class="sub" style="margin-top:30px">Dados: recorte de ${esc(D.snapshot.data)}. Exemplo real do inventário (palete 256 e 257, NFD 9059802) com conferência informada em 16/10/2026; não é estoque atual.</p>`,
  `.cena{background:#fff;border-radius:16px;padding:18px 22px;margin:16px 0;break-inside:avoid;box-shadow:0 0 0 1px #E5E0D3}
   .cena .num{font-size:13px;font-weight:800;letter-spacing:.1em;color:#B88A00;text-transform:uppercase} .cena h2{margin:4px 0 10px}
   .cena p{font-size:19px;margin:0 0 10px} .cuid{margin:10px 0 0;padding:10px 14px 10px 30px;background:#F5F3EB;border-radius:10px;font-size:15px;color:#474C54}
   @media (max-width:600px){.cena p{font-size:18px}}`);
writeFileSync(join(entrega, 'Roteiro-do-apresentador.html'), roteiro);

// ---------- Guia de uma página ----------
const guia = pagina('Guia rápido — apresentação Praça Reversa', `
  <div class="cab"><i></i>Praça Reversa · guia rápido</div>
  <h1>Abrir, projetar e apresentar</h1>
  <p class="sub">Funciona sem internet, sem login e sem o servidor do aplicativo. Use Google Chrome ou Microsoft Edge atualizados.</p>
  <h2>1. Abrir</h2>
  <p>Copie a pasta <b>entrega</b> para o computador da sala (ou pendrive) e dê dois cliques em <b>Praca-Reversa-Apresentacao.html</b>. Se abrir em outro programa: botão direito → Abrir com → Chrome ou Edge.</p>
  <h2>2. Projetar com notas (recomendado)</h2>
  <p>No Windows, tecla <kbd>Win</kbd> + <kbd>P</kbd> → <b>Estender</b>. Arraste a janela da apresentação para o projetor e tecle <kbd>F</kbd> (tela cheia). No seu monitor, tecle <kbd>N</kbd>: abre a janela de notas com a fala, a próxima cena, os lembretes e o tempo. As duas janelas avançam juntas.</p>
  <p>Se o navegador bloquear a janela de notas, permita pop-ups para o arquivo (ícone na barra de endereço) e tecle <kbd>N</kbd> de novo.</p>
  <h2>3. Sem segundo monitor (tela espelhada)</h2>
  <p>Em tela <b>duplicada</b>, tudo o que estiver no seu monitor aparece no projetor — não abra as notas. Use o <b>Roteiro-do-apresentador.html</b> (ou o PDF) no celular ou impresso.</p>
  <h2>4. Avançar e voltar</h2>
  <table><tr><th>Ação</th><th>Teclas</th></tr>
  <tr><td>Próxima cena</td><td><kbd>→</kbd> <kbd>espaço</kbd> <kbd>PageDown</kbd> (passador comum)</td></tr>
  <tr><td>Cena anterior</td><td><kbd>←</kbd> <kbd>PageUp</kbd></td></tr>
  <tr><td>Primeira / última</td><td><kbd>Home</kbd> / <kbd>End</kbd></td></tr>
  <tr><td>Índice de cenas</td><td><kbd>I</kbd> (fechar: <kbd>Esc</kbd> ou <kbd>I</kbd>)</td></tr>
  <tr><td>Tela cheia / sair</td><td><kbd>F</kbd> / <kbd>Esc</kbd></td></tr>
  <tr><td>Reduzir movimentos</td><td><kbd>M</kbd> (os dados continuam iguais)</td></tr>
  <tr><td>Tela preta (pausa)</td><td><kbd>B</kbd> ou <kbd>.</kbd></td></tr>
  <tr><td>Ocultar controles</td><td><kbd>H</kbd> (somem sozinhos quando o mouse para)</td></tr></table>
  <p>Nada avança sozinho: cada cena fica parada, legível, pelo tempo que você precisar. Ao recarregar a página, ela volta à mesma cena.</p>
  <h2>5. Encerrar</h2>
  <p><kbd>Esc</kbd> sai da tela cheia; feche a aba normalmente. A apresentação não grava nada no sistema.</p>
  <h2>Backup</h2>
  <p><b>Praca-Reversa-Apresentacao-estatica.pdf</b>: as 12 cenas em páginas, sem animação, para um computador que não abra o HTML.</p>`,
  `@media print{body{font-size:13px;line-height:1.4} main{padding:0} h1{font-size:23px} .sub{margin-bottom:8px} h2{font-size:16px;margin:12px 0 3px} p{margin:3px 0} th,td{padding:4px 10px;font-size:12.5px} kbd{font-size:11px;padding:1px 5px}}`);
writeFileSync(join(entrega, 'Guia-rapido.html'), guia);

// ---------- Fontes dos números e estado das funções ----------
const r = D.registros;
const fontes = pagina('Fontes e estado verificado — Praça Reversa', `
  <div class="cab"><i></i>Praça Reversa · fontes e estado</div>
  <h1>Fontes dos números e estado verificado</h1>
  <p class="sub">Recorte congelado em ${esc(D.snapshot.data)}. A apresentação não consulta nenhum sistema durante a reunião e não contém senhas, endereços de conexão ou tokens.</p>
  <h2>Números exibidos</h2>
  <table><tr><th>Cena</th><th>Valor na tela</th><th>Fonte</th></tr>
  <tr><td>03, 04, 05, 06, 11</td><td>NFD ${esc(r.p256.numero)} · Palete ${esc(r.p256.palete)} · ${esc(r.p256.posicao)} · ${r.p256.volumes} volumes · FULL ${esc(r.p256.full)} · Delivery ${esc(r.p256.delivery)} · ${esc(r.p256.remetente)} · conferência ${esc(r.p256.conferencia)}</td><td>${esc(D.inventario.arquivo)}, aba ${esc(D.inventario.aba)}, linha ${r.p256.linha} (SHA-256 ${D.inventario.sha256.slice(0, 16)}…)</td></tr>
  <tr><td>03, 05</td><td>Palete ${esc(r.p257.palete)} · ${esc(r.p257.posicao)} · ${r.p257.volumes} volumes · FULL ${esc(r.p257.full)} · Delivery não informada ("*" na origem)</td><td>Mesmo arquivo, linha ${r.p257.linha}</td></tr>
  <tr><td>01, 05, 06, 09</td><td>Desenho do mapa (área da L’Oréal: 194 posições ativas, Ruas 11–16 e Grade; Rua 11 de A42 a A58)</td><td>Banco de desenvolvimento do Praça Reversa, escopo real, layout ativo “desenho-aprovado-2026-10-05”, revisão 37 — lido em 21/10/2026 só para consulta (transação somente leitura). Sem ocupação.</td></tr>
  <tr><td>08</td><td>20 dias</td><td>Regra operacional de reconferência (sem movimentação desde a última conferência completa)</td></tr></table>
  <h2>Conferência do recorte com o sistema (21/10/2026)</h2>
  <p>No sistema (versão de teste), o palete 256 está na posição 11 - A42 e o 257 na 11 - A43, como no inventário. O inventário em validação (INV-000005, base 20/10/2026) traz a NFD 9059802 em 9 linhas FULL (paletes 256 a 264, posições 11 - A42 a A50); a apresentação mostra só as duas linhas do pacote e não soma volumes. A data 16/10/2026 é a conferência informada na planilha; não atesta conferência registrada no sistema.</p>
  <h2>Estado das funções</h2>
  <p><b class="DISPONIVEL">Disponível na versão de teste</b>: funciona na versão de teste local e passou nos testes automáticos de interface em 21/10/2026 (21 aprovados, banco isolado de testes). Não está em produção; o piloto no piso não começou. <b class="TESTE">Em teste</b>: simulação ou base em validação. <b class="AJUSTE">Em ajuste</b>: erro conhecido ou integração pendente.</p>
  <table><tr><th>Função</th><th>Estado</th><th>Origem</th><th>Verificação</th><th>Cena</th></tr>
  ${D.funcoes.map((f) => `<tr><td>${esc(f.nome)}</td><td class="estado ${f.estado}">${esc(D.selos[f.estado])}</td><td>${esc(f.origem)}</td><td>${esc(f.verificacao)}</td><td>${f.cena}</td></tr>`).join('')}</table>
  <h2>O que não foi mostrado, de propósito</h2>
  <ul><li>Números de pendências, painéis, janelas, ocupação ou produtividade: não há série real nem janela real cadastrada.</li>
  <li>Redução de claims, economia, acuracidade ou tempo poupado: são indicadores a medir no piloto.</li>
  <li>Dados de demonstração (PR-000001 de demo, PAL-DEMO) e o arquivo de exemplo “Etiquetas”.</li></ul>
  <h2>Ativos</h2>
  <p>Fonte Inter (SIL Open Font License 1.1). Símbolo DHL fornecido pelo usuário. Ícone do aplicativo Praça Reversa. Nenhum trecho, texto, logotipo ou trilha dos vídeos de referência foi usado.</p>`);
writeFileSync(join(entrega, 'Fontes-e-estado.html'), fontes);

console.log('Gerados em entrega/: Praca-Reversa-Apresentacao.html (%s KB), Roteiro-do-apresentador.html, Guia-rapido.html, Fontes-e-estado.html', Math.round(html.length / 1024));
