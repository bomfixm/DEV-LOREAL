# Retomada — dashboards Operação DHL e visibilidade L’Oréal (CONCLUÍDA no desenvolvimento local, 13 out. 2026)

Arquivo de continuação para trocar de conta/sessão (a sessão anterior parou com 96% do limite de 5 h). **Sem dados reais nem credenciais.** Ler antes: `AGENTS.md`, `docs/ESTADO.md` (seções de 13/10), `docs/RETOMADA-MAPA-RECONFERENCIA.md`, `docs/INDICADORES.md` e a memória do projeto.

## Pedido

- Prompt: `C:\Users\Administrator\Downloads\PROMPT-DASHBOARDS-DHL-LOREAL.txt` (ler inteiro; 11 verificações obrigatórias no fim).
- Pedido do usuário: **ao chegar em 99% do limite, deixar/atualizar este arquivo de continuação**.

## Estado do ambiente (herdado)

- Versão de teste do Mateus: `http://127.0.0.1:3000` (`node apps/api/dist/server.js`, janela "Praca Reversa - versao de teste"), banco de desenvolvimento do `.env`, escopo real `PRACA-REVERSA/LOREAL`, contas em `.dados/teste-local/credenciais.md` (nunca no chat). Se a máquina reiniciar: `npm run db:iniciar` e subir o servidor de novo (ver memória `ambiente-local-praca-reversa`). Depois de build, reiniciar esse processo.
- Dados reais: INV-000002 (1.239 linhas, 1.153 vínculos, 184 paletes, 140 com posição); mapa com Ruas 12–16 confirmadas, Rua 11 e Grade pendentes (perguntas em `DESCOBERTA.md`); relógio de reconferência (20 dias) nos paletes (`palete.relogio_*`, `ultima_*`, `reconferencia_palete`, `paletes/relogio.ts`).
- Última verificação completa: `npm test` 561/561; E2E 115 + 1 seletor corrigido. Migrações aplicadas até `20261015090000_reconferencia_palete`.
- Cuidados: backup (`npm run backup:criar`) antes de migrar; nunca `node -e "..."` com crases no Bash (expande comandos — usar Write + script `.cjs`); `git apply` com autocrlf vira CRLF.

## Plano (em ordem)

1. **Inspecionar** (curto): `apps/api/src/modules/indicadores`, `apps/web/src/features/indicadores`, `docs/INDICADORES.md`, `modules/selecao` (seleção do cliente, conciliação, linhas da seleção com NF/volumes?), `modules/janelas` (restrições/métricas CAIXAS/PALETES/QUANTIDADE/VOLUME_M3, reserva, preparação, expedição — tudo por segmento/SKU?), `contracts/src/acesso.ts` (perfis e permissões), histórico (`movimentos/historico.ts`), relatórios/exportações (`http/csv-seguro.ts`).
2. **Modelo de volumes por janela** (provável migração incremental):
   - Meta T da janela em VOLUMES informada pelo cliente (campo próprio na janela ou na seleção, com versão da seleção).
   - Linhas selecionadas por NF (vínculo documental × palete) com volumes solicitados (parte < NF guarda o restante separado).
   - Registro explícito de **separação** (P): quantidade de volumes por linha/NF × palete × janela, autor, data, idempotência, sem exigir SKU; impedir a mesma parte em pedidos incompatíveis.
   - **Expedição** (E): só confirmação válida; ao expedir, sai de P e entra em E na mesma transação; retorno físico é evento próprio.
   - Reserva e seleção sozinhas não contam em P/E. Nova versão da seleção pede revisão das preparações, sem desfazer expedido.
   - Fórmulas: preparados = P+E; falta separar = max(T−P−E,0); falta expedir = max(T−E,0); % só com T conhecido > 0 ("Sem base para cálculo" com T = 0; excesso mostrado na visão interna).
3. **Perfil do cliente**: novo perfil (ex.: `CLIENTE_CONSULTA`) em `acesso.ts` com permissões só de consulta da projeção; nunca supervisor/admin; escritas negadas no servidor; login/logout/senha continuam. Conta de teste isolada (não criar conta real sem o usuário).
4. **API**: `GET /painel/operacao` (DHL: paletes ativos únicos, volumes informados × conferidos com a base, documentos distintos pela identidade, incompletos, posições ocupadas/livres confirmadas/desconhecidas sem áreas desativadas, NFs sem palete/endereço, reconferência vencida, próxima janela e progresso, tarefas; claims só para perfis autorizados, estimado × confirmado separados); `GET /painel/cliente` (projeção permitida: estoque por NF/Delivery/remetente/volumes/full-misto/palete/endereço, janelas com T/P/E, etapas, histórico filtrado pelo conteúdo consultável, exportação só dos campos permitidos). Sem claims/valores/pendências internas/logins/auditoria bruta no JSON. Mesma leitura coerente (transação de leitura) para totais e linhas; `consultedAt` America/Sao_Paulo.
5. **Web**: telas `Painel da operação` e `Painel do cliente` (menu por permissão), cards clicáveis que abrem a lista com os mesmos filtros (filtros na URL: janela, período, rua, palete, NF/NFD/MI, Delivery, remetente), gráfico por rua (paletes e volumes em séries distintas), comparação das janelas do mês, barras de preparação e expedição, tabela por NF/Delivery, linha do tempo; atualização a cada 60 s/foco (mesma estratégia do mapa) com "última atualização"/falha; responsivo; cores do tema (amarelo/vermelho/neutros) + texto/ícone.
6. **Testes** (os 11 do prompt): palete misto com uma NF selecionada; NF em vários paletes; exemplo 8.000/2.000/4.500 e expedir 1.000; seleção/reserva sem separação; reenvio/revisão/correção; T=0/desconhecido; projeção do cliente sem campos internos (JSON e exportação); outro escopo e escritas negadas; filtros/cards/totais × detalhes; painel usa a reconferência persistida.
7. **Docs**: `docs/INDICADORES.md` (definição/fonte/filtros de cada indicador), `GUIA-DO-OPERADOR.md` + ajuda (`features/ajuda/conteudo.ts` — precisam ficar iguais; `guia.test.ts`), `DECISOES.md` (D232+), `ESTADO.md`, memória.
8. **Entrega**: typecheck, lint, `npm test`, build, E2E pertinentes; migração no banco de dev com backup; reiniciar a porta 3000; demonstrar no navegador (DHL com `supervisor.praca`; cliente com conta de teste isolada) sem criar dados demonstrativos no escopo real; relatar rotas, fontes, eventos de preparação disponíveis, base do estoque e limitações.

## Fatos levantados (13 out., noite)

- `SelecaoCliente` (referenciaPedido, versaoPedido, substituiId, situacao) e `LinhaSelecao` (abrangencia, tipoDocumento, numeroDocumento, chaveDocumento, delivery, janelaReferencia, quantidade+unidade, chave, duplicadaDeId) já existem; a conciliação liga linhas a vínculos NF × palete (`selecao/conciliacao.ts`, `ResolucaoLinhaSelecao`, `VinculoSelecaoReserva`).
- `JanelaDevolucao` (codigo, mesReferencia, saidaInicio/Fim, prazoPreparacao, situacao). Capacidade: `MetricaCapacidade` = QUANTIDADE, CAIXAS, PALETES, PESO_KG, VOLUME_M3 (nenhuma é "volumes" operacionais). Reserva/preparação/expedição atuais são por segmento de SKU (saldo validado) — **não servem** à operação real (sem SKU/saldo).
- Indicadores: `modules/indicadores/{consultas,periodo,relatorios,rotas}.ts`, `GET /indicadores` (praca.consultar), relatórios/exportação; web `features/indicadores/{TelaIndicadores,TelaRelatorios,formato}`.
- Perfis (`contracts/src/acesso.ts`, enum `Perfil` também no banco): CONSULTA, OPERADOR, SUPERVISOR_ESTOQUE, ANALISTA_CLAIMS, ADMINISTRADOR. CONSULTA vê praça/paletes (dados internos) → **não serve ao cliente**.

## Desenho decidido (seguir)

- Migração incremental `20261016090000_paineis_volumes`:
  - `ALTER TYPE "Perfil" ADD VALUE 'CLIENTE_CONSULTA'` (perfil só com `painel.cliente`; nada de praca/palete/janela internos).
  - `meta_janela_volumes` (só acrescentada): janela, seleção (versão, opcional), volumes ≥ 0 (inteiro), referência, quem/quando. Vigente = a mais recente da janela.
  - `evento_volumes_janela` (só acrescentado, gatilho): janela, seleção/linha (opcionais), **vínculo NF × palete obrigatório**, palete, tipo SEPARACAO | ESTORNO_SEPARACAO | EXPEDICAO | ESTORNO_EXPEDICAO, volumes > 0, motivo, autor, data, evento corrigido.
  - P (separado aguardando) = SEP − EST_SEP − EXP + EST_EXP; E (expedido) = EXP − EST_EXP. Expedir só ≤ P do vínculo na janela (move P→E na mesma transação). Separar: soma separada+expedida ativa do vínculo em todas as janelas ≤ volumes do vínculo (quando conhecidos); idempotência e versão (bloqueio do vínculo/janela).
  - Permissões novas: `painel.operacao` (perfis DHL), `painel.cliente` (CLIENTE_CONSULTA), separação/expedição por volumes com permissões existentes (`expedicao.preparar` separa; confirmação de expedição com a permissão da expedição atual) e meta com `janela.gerenciar`.
- API: `GET /painel/operacao`, `GET /painel/cliente` (+ `/painel/cliente/estoque`, `/painel/cliente/historico`, exportação CSV com `csv-seguro`), `POST /janelas/:id/volumes/meta`, `POST /janelas/:id/volumes/separacoes|expedicoes|estornos`. Cliente: escopo da sessão, sem claims/valores/pendências/logins/auditoria; escritas negadas.
- Web: `/painel` (operação) e `/painel/cliente`; cliente sem `praca.consultar` cai direto no painel do cliente.

## Feito

- Levantamento acima.
- Migração `20261016090000_paineis_volumes` escrita (NÃO aplicada no banco de dev ainda): perfil CLIENTE_CONSULTA, `meta_janela_volumes`, `evento_volumes_janela` (vínculo OU conteúdo registrado; gatilhos de imutabilidade). Schema Prisma + client gerados.
- Contratos: `acesso.ts` (CLIENTE_CONSULTA, painel.operacao, painel.cliente; supervisor também tem painel.cliente para conferir a visão), `paineis.ts` (progressoVolumes, schemas, filtros) + `paineis.test.ts` (7 aprovados). Rótulo do perfil no web (`sessao/perfis.ts`).
- API `modules/paineis/`: base.ts (estoque atual por conteúdo), janelas.ts (meta vigente, seleção vigente, linhas/etapas, somas P/E), volumes.ts (meta/separação/expedição/estorno + leitura da janela + busca), estoque.ts, historico.ts, paineis.ts (operação/cliente), rotas.ts (registradas em app.ts); `auth.exigirAlguma`; auditoria (META_JANELA_REGISTRADA etc.); `claims`/`valores` exportados de indicadores/consultas.ts. **tsc da API limpo.**
- Teste de banco `apps/api/test/banco/paineis.test.ts`: **12/12 aprovados** (8.000/2.000/4.500, +1.000, palete misto, NF em 2 paletes, parte < NF, seleção/reserva não contam, idempotência/reenvio/revisão/estorno, incompletos/T=0, projeção do cliente JSON+CSV, outro escopo/escritas/logout, filtro por janela, reconferência persistida). Meta ganhou coluna `ordem` (SERIAL) para desempate.
- Web feito: features/paineis (comum.tsx, formato.ts, consulta-viva.ts, ConsultaEstoque.tsx, TelaPainelOperacao, TelaPainelEstoque, TelaVolumesJanela, TelaPainelCliente), rotas /painel /painel/estoque /painel/janelas/<id> /painel/cliente, menu (Painel; cliente cai no painel do cliente), estilos no fim de redesign.css, ajuda (tarefas painel e painel-cliente) + guia regenerado, rotas.test. tsc/eslint web limpos.
- Docs: INDICADORES.md (seção Painéis), DECISOES D232–D239.
- Concluído: npm test (578 + 3 testes antigos ajustados ao perfil novo/migração), E2E paineis.spec (5 + 1 pulado, capturas em docs/capturas/paineis), backup …20261013-234619Z… + db:migrar no dev, build, porta 3000 reiniciada, conta de teste cliente.teste.loreal (CLIENTE_CONSULTA), demonstração no navegador (supervisor.praca e cliente), ESTADO/DECISOES D232–D239/DESCOBERTA/INDICADORES/guia.
- Pendências reais: conta real do cliente, janelas/metas reais, seleção real, Rua 11/Grade, retorno físico por volumes (ver DESCOBERTA).
