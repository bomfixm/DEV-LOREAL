# Retomada — vídeo de apresentação (Remotion), iniciado em 19 out. 2026

Arquivo de continuação (troca de conta/sessão). Sem dados reais nem credenciais.

## Pedido

- Instruções: `C:\Users\Administrator\Downloads\PROMPT-CLAUDE-MOTION-PRACA.txt` e `ROTEIRO-MOTION-PRACA-90S.txt` (ler inteiros).
- Preparar o ambiente (Node, pasta separada, Remotion, skills oficiais, Playwright + Chromium), conferir a prévia, renderizar primeiro a **prévia curta** (12–15 s: mapa, abertura de conteúdo, uma transição) e depois o **vídeo completo** (~90 s, 1920×1080, 30 fps, H.264). Preservar o aplicativo.
- Entregas: `motion-praca-reversa/out/praca-reversa-apresentacao.mp4`, `out/previa-motion.mp4`, `out/narracao.txt`, `out/legendas.srt`, README.

## Decisões

- Pasta do vídeo: `C:\Users\Administrator\Documents\PROJETOS\LR LOREAL\motion-praca-reversa` (ao lado de `praca-reversa`, sem tocar no app).
- Capturas: preferir ambiente isolado com dados **fictícios identificados** (servidor E2E/demonstração), não o escopo real `PRACA-REVERSA/LOREAL` (tem remetentes e NFs reais). Se usar o real para o mapa, pedir autorização ao usuário antes.
- Sem voz disponível: versão sem locução, com chamadas curtas e legendas; narração separada em `out/narracao.txt`. Sem trilha (nenhuma faixa licenciada fornecida).
- Reconferência (20 dias): na base real os primeiros paletes vencem em 26/10/2026; num ambiente novo não há alerta verdadeiro → mostrar como "Em validação"/gráfico explicativo, salvo se houver dado real vencido.

## Feito

- **Ambiente pronto (19 out. 2026)**: Node v24.20.0 / npm 11.19.0; `motion-praca-reversa/` criado com `create-video --blank` (remotion e @remotion/cli 4.0.537); skills oficiais em `motion-praca-reversa/.claude/skills` (remotion-best-practices, -create, -render, -captions, -multimedia, -studio, -docs, -markup, -maps, -saas, -interactivity, -upgrade; `skills-lock.json`); Playwright ^1.64.1 + Chromium headless shell instalado.
- Prévia: `npx remotion studio --no-open --port=3333` respondeu HTTP 200 (`npm run dev` abre o navegador).
- Teste de render: composição `CenaDesafio` (cena 1, só tipografia) → `out/teste-cena1.mp4` H.264 1920×1080 30 fps 10 s (ffprobe ok) e quadro `out/teste-cena1-quadro.png`. Ajustar: a linha amarela passa por cima do texto "Palete" (desenhar a linha antes dos cartões / zIndex).
- Licença: o instalador avisou "Remotion is free for teams of up to 3"; empresa maior precisa de licença (https://www.remotion.pro/license) — informar o usuário, não contratar.
- Ainda NÃO feito: inventário das funções, capturas Playwright, cenas 2–7, prévia curta, vídeo completo, narração/legendas, README.

## Próximos passos

1. Ambiente: `npx create-video@latest --yes --blank motion-praca-reversa`; `npx skills add remotion-dev/skills` (Claude Code); `npm install -D playwright`; `npx playwright install chromium`; `npm run dev` (prévia) e `npx remotion still` para confirmar a renderização.
2. Inventário do que é demonstrável (mapa, janela do palete, importação da bipagem com 5 campos, janela em volumes, reconferência, painel) — ver `docs/ESTADO.md` (etapas de 19 out.).
3. Script Playwright de captura (1920×1080, deviceScaleFactor 1, `recordVideo` com size explícito; fechar o contexto ao terminar).
4. Cenas Remotion (7) + prévia curta → inspecionar frames → vídeo completo → conferir metadados (ffprobe do Remotion) → README.
