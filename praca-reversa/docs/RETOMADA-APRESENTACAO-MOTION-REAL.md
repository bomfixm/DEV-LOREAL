# Retomada — apresentação com motion, dados reais e avanço manual (21 out. 2026)

Pedido: `Downloads/APRESENTACAO-MOTION-REAL-REFERENCIAS.zip` (prompt, roteiro de 12 cenas, direção das 4 referências, 2 registros reais). Substitui o filme de 150 s. **Só a apresentação**: o importador Python e as correções de paletes/recontagem são outras tarefas; o banco não é alterado.

## Onde está

- Projeto: `LR LOREAL/apresentacao-praca-reversa/` (fora do app).
  - `fonte/` — fontes editáveis: `index.html`, `estilos.css`, `dados.js` (snapshot congelado), `roteiro.js` (texto de tela + falas), `cenas.js`, `motor.js`, `fontes/` (Inter), `ativos/`.
  - `ferramentas/` — `construir.mjs` (gera o HTML único e os arquivos de apoio), `verificar.mjs` (Playwright).
  - `entrega/` — o que vai para a reunião.
- Snapshot: geometria do mapa lida do banco de desenvolvimento em 21/10/2026 (somente consulta, transação READ ONLY); registros 256/257 do inventário (linhas 3–4, conferência informada 16/10/2026).

## Decisões

- HTML único, abre por arquivo (sem servidor, sem internet); notas do apresentador em janela própria (about:blank aberta pela apresentação).
- Selos: Disponível = versão de teste + testes automáticos; Em teste = simulação/base em validação; Em ajuste = erro conhecido/integração pendente.
- Sem números de pendências, painéis ou janelas (não há série real nem janela real); 20 dias = regra.
- Sem Remotion (licença); MP4 só se sobrar tempo, por captura determinística.

## Feito / falta

Ver o fim deste arquivo (atualizado a cada parte).

- [x] Parte A: leitura do pacote, referências (folhas de quadros), snapshot somente leitura, E2E dirigido (21 aprovados, 2 de celular pulados)
- [x] Parte B/C: 12 cenas + notas em janela própria + roteiro/guia/fontes-e-estado
- [x] Parte D: `ferramentas/verificar.mjs` (43 verificações; log em `apresentacao-praca-reversa/verificacao/`), PDFs (estático 12 p., guia 1 p., roteiro)
- [x] MP4 complementar: 78 s, 1920×1080, 30 fps, H.264, sem áudio

Próximo passo se algo faltar: `node ferramentas/construir.mjs && node ferramentas/exportar-pdf.mjs && node ferramentas/verificar.mjs verificacao/evidencias`.
