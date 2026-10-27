# Retomada — planilha automática e proteção (26 out. 2026)

**Situação: implementada e verificada no desenvolvimento local** (ver `ESTADO.md`, seção "Planilha automática e proteção dos dados", e decisões D304–D310).

## Única pendência

Configurar o **destino independente** autorizado pela operação (decisão do usuário; credenciais só no `.env`, nunca no chat):

1. No `.env` do servidor: `PLANILHA_DESTINO=s3://<bucket>/<prefixo>` + `PROTECAO_S3_ENDPOINT`, `PROTECAO_S3_REGIAO`, `PROTECAO_S3_CHAVE_ACESSO`, `PROTECAO_S3_SEGREDO` (ou `pasta:\\outra-maquina\compartilhamento`) e `PLANILHA_DESTINO_DESCRICAO`.
2. `npm run protecao:verificar-destino` (grava, relê e apaga um teste).
3. Reiniciar a porta 3000 (a tarefa do Windows reinicia sozinha depois de `npm run build`; ou encerrar o processo do servidor).
4. Conferir na tela "Planilha e proteção" (Destino independente / Planilha no destino / Backup completo externo = Atualizada) e rodar `npm run protecao:teste-restauracao -- --origem=externo`.
5. Comprovar o acesso sem o aplicativo: abrir `planilha/Praca-Reversa-PRACA-REVERSA-LOREAL/` no próprio destino.
