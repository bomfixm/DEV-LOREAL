# Retomada — planilha única automática e proteção dos dados (CONCLUÍDA em 6 out. 2026)

> Etapa concluída no desenvolvimento local: ver `docs/ESTADO.md` (seção "Planilha única e proteção dos dados"). Este arquivo fica como histórico.

Arquivo de continuação (troca de conta/sessão). Sem dados reais nem credenciais. Iniciado em 6 out. 2026.

## Pedido

- Prompt: `C:\Users\Administrator\Downloads\PROMPT-PLANILHA-UNICA-AUTOMATICA-E-BACKUP.md` (ler inteiro).
- Modelo (fictício, só referência visual): `C:\Users\Administrator\Downloads\MODELO-PLANILHA-UNICA-PRACA-REVERSA (1).xlsx` — abas Inventário (tabela `InventarioPraca`, B10:L…, painel fixo xSplit=4/ySplit=10), Movimentações (`MovimentosPraca`, B9:J…, xSplit=3/ySplit=9), Proteção e ajuda (`ProtecaoPraca`, B9:E…); faixa amarela na linha 1, título "Praça Reversa" na linha 2, subtítulo na 3, avisos nas 4–6, indicadores nas 7–8 (Inventário).
- Escopo real local: `PRACA-REVERSA/LOREAL` (dados reais; ver `docs/ESTADO.md`). Demonstração = tutorial (dados fictícios).

## Desenho decidido

- **Marcação durável** (outbox): tabela `alteracao_planilha` (bigserial, escopo, origem) preenchida por gatilhos de instrução (AFTER … FOR EACH STATEMENT com tabela de transição) nas tabelas exportadas (palete, vínculos, linhas do inventário, cidade/produto/caixas, endereços, conferência, eventos de localização/estoque e auditoria operacional). Grava na mesma transação da alteração (some se ela for desfeita); só inserções → sem disputa de bloqueio.
- **Controle por escopo** `controle_planilha` (versão atual, concessão `publicando_desde/por` com expiração = trabalho único e recuperação após reinício, falhas, próxima tentativa) e histórico `publicacao_planilha` (versão, instante do snapshot, registros, hash, tamanho, destino, identificação, resultado, erro).
- **Geração**: snapshot REPEATABLE READ READ ONLY → XLSX próprio (estilos DHL #FFCC00/#D40511, Arial 11, tabelas com filtro, painéis fixos, tipos, `quotePrefix` em textos que começam com = + - @) → arquivo temporário → validação (reabre o ZIP e confere linhas) → publicação. As alterações vistas no snapshot só são apagadas depois do sucesso.
- **Destino**: `PLANILHA_DESTINO=pasta:<caminho>` (pasta sincronizada OneDrive/SharePoint ou compartilhamento de rede, fora do servidor); arquivo atual com nome estável + `versoes/` com versão e instante, manifesto de versão (trabalho antigo não sobrescreve versão mais nova), retenção configurável sem apagar as últimas boas. Sem destino → só geração local em `.dados/planilha/` com estado "Não configurado" (nunca "Atualizada").
- **Agendador** no processo da API (intervalo, agrupamento, reconciliação periódica); só escopos não-demo vão para o destino.
- **Backup**: rotina `scripts/recuperacao/rotina-backup.mjs` (reaproveita `criar-backup.mjs`, confere hashes pelo manifesto, retenção, registra em `registro_protecao`); teste de restauração em bancos de ensaio novos com dados fictícios (seed demo), registrado; agendamento pelo Agendador de Tarefas do Windows documentado (não criado sem autorização do usuário).
- Tela "Planilha e proteção" (situação, atraso, tentar novamente, baixar arquivo) e aba "Proteção e ajuda" com estados `Atualizada`/`Atualização pendente`/`Falhou`/`Não configurado`/`Não testado`.
- Inventário: uma linha por vínculo NFD × palete (palete = código PR-…, permanente e nunca reutilizado); documentos MI/tipo pendente com NFD em branco e o documento na Situação; referências fora da praça como "Sem alocação"; Delivery como texto.

## Feito

- Migração `apps/api/prisma/migrations/20261010090000_planilha_unica_protecao` (aplicada no banco de **desenvolvimento**) + `schema.prisma` (AlteracaoPlanilha, ControlePlanilha, PublicacaoPlanilha, RegistroProtecao).
- Contratos: `packages/contracts/src/planilha.ts` (exportado no index) e permissão `planilha.publicar` (supervisor e administrador) em `acesso.ts`.
- API `apps/api/src/modules/planilha/`: `xlsx.ts` (gerador), `dados.ts` (snapshot), `situacao.ts` (estados), `montar.ts` (abas), `destino.ts` (pasta + versões + manifesto), `publicacao.ts` (concessão, validação pelo leitor de XLSX do projeto, falhas), `agendador.ts`, `rotas.ts` (GET `/planilha/situacao`, POST `/planilha/publicar`, GET `/planilha/arquivo`). Config em `config.ts` (`PLANILHA_*`, `BACKUP_*`, `RESTAURACAO_PRAZO_DIAS`), rotas em `app.ts`, agendador em `server.ts`, ações de auditoria novas.
- Scripts: `scripts/recuperacao/rotina-backup.mjs` (`npm run backup:rotina`) e `teste-restauracao.mjs` (`npm run backup:teste-restauracao`) — **ainda não executados**.
- Typecheck da API aprovado. Geração conferida: demo e escopo real geram e validam (≈0,7 s e 1,1 s); Excel abre (COM): 3 abas, tabelas com filtro, painéis fixos, NFD texto, datas tipadas, SUBTOTAL. Capturas por `.dados/capturar-excel.tmp.ps1` (STA) em `.dados/html-planilha/` (dados reais, fora do versionamento). Ajustes aplicados depois da 1ª captura (formato inteiro, números de NFD distintos, paletes sem nota, alturas) — **regenerar e recapturar**.

- Recaptura feita (v2 real): 745 vínculos, 657 números de NFD, 123 paletes, inteiros sem vírgula; aviso "número como texto" suprimido nas tabelas.
- Tela web `apps/web/src/features/planilha/TelaPlanilha.tsx` (rota `/planilha`, menu "Planilha e proteção", estilos `.lista-protecao`/`.selo-protecao--*` no fim de `base.css`). `npm run typecheck` completo aprovado.
- Testes `apps/api/test/banco/planilha.test.ts`: **9 aprovados** (fila/gatilhos, conteúdo, movimentações, concorrência, destino/leitura/arquivo defeituoso, reinício, ordem+retenção, demo e vazio, tela/permissões). `apoio.ts` (TABELAS) e `banco-e-seed.test.ts` (migração nova) ajustados.

## Próximos passos

1. (feito) regenerar/recapturar.
2. (feito) tela web — falta conferir no navegador (build + servidor em porta ≠ 3000, conta `supervisor.praca`).
3. (feito) testes da planilha.
- (feito) `npm run backup:rotina` → VERIFICADO (destino local); `npm run backup:teste-restauracao` → APROVADO (bancos de ensaio removidos); exemplo `npm run planilha:exemplo` → `examples/planilha/`; docs ESTADO/IMPLANTACAO/DECISOES (D177–D183)/README/.env.example atualizados; `.claude/launch.json` com `praca-reversa-3100`.
- Em andamento no momento desta nota: `npm run lint` e `npm run build` (logs em `.dados/lint.tmp.log` e `.dados/build.tmp.log`); depois: conferir a tela no navegador (preview `praca-reversa-3100`, conta `supervisor.praca`, menu da conta → Planilha e proteção) e `npm test` completo; preencher os resultados em ESTADO.

4. (antigo) Rodar `npm run backup:rotina` (destino local → "Não configurado" fora do servidor) e `npm run backup:teste-restauracao` (bancos de ensaio fictícios).
5. Exemplo fictício em `docs/exemplos/`, typecheck/lint/test/build, docs (ESTADO, IMPLANTACAO, DECISOES D177+, README, .env.example).
