# Mapa de dados do Praça Reversa

Levantado do código, do esquema do banco (`apps/api/prisma/schema.prisma`) e da configuração em 27/10/2026. Lista **categorias e campos**, não dados reais: nenhum registro da operação foi copiado para este documento. "Retenção praticada" é o que o sistema faz hoje, não um prazo aprovado; os prazos a aprovar estão em `DECISOES-HUMANAS.md`.

## Onde os dados ficam

| Local | O que guarda | Quem acessa | Retenção praticada hoje |
| --- | --- | --- | --- |
| PostgreSQL da instalação (servidor da filial; porta 5433 local) | Todas as tabelas abaixo | Aplicação (usuário do banco da instalação); administradores do servidor | Sem expurgo automático: nada é apagado por prazo |
| Pasta `.dados/planilha` do servidor | Espelho Excel por escopo (Inventário, Movimentações, Proteção e ajuda) | Perfis com `planilha.baixar`; administradores do servidor | Últimas 50, 1 por dia por 30 dias e as anteriores a substituições por 30 dias (`PLANILHA_*`, pedido de 23/10/2026) |
| Pasta `.dados/backups` do servidor | Backup completo do banco (dados + verificação) | Administradores do servidor (sem rota da API para baixar backup) | Trabalhador automático: 1 por dia por 30 dias. **Atenção:** o comando manual `npm run backup:rotina` **sem** `--sem-retencao` mantém só os 14 backups verificados mais novos (`BACKUP_MANTER`) e os de pré-substituição protegidos (30 dias); os demais são apagados. Em 27/10/2026, isso removeu 8 pastas anteriores a 13/10/2026. Use `--sem-retencao` nos backups manuais até haver política aprovada (decisão 3) |
| Destino independente (S3 ou pasta de rede de outra máquina) | Planilha e backup externo | Quem tiver a credencial do destino | **Não configurado nesta instalação**; retenção do destino depende do serviço aprovado |
| `.dados/servidor/servidor.log` | Registro técnico do servidor (pino): método, rota, status, duração, endereço IP de origem, identificador da requisição; erros | Administradores do servidor | Rotação por tamanho: 5 MB atual + 1 anterior |
| Navegador (cookie) | Cookie de sessão (httpOnly, SameSite=Strict, `Secure` em produção): identificador opaco | Somente o servidor (o JavaScript da página não lê) | Até sair, expirar por inatividade (120 min padrão) ou duração máxima (12 h padrão) |
| Navegador (`localStorage`) | Preferências: tema claro/escuro e menu compacto/expandido; preferências do tutorial | O próprio aparelho | Até o usuário limpar o navegador |
| Navegador (`sessionStorage`) | Operações com resposta incerta (chave de idempotência e o pedido), **somente fora de produção** | A própria aba | Fechar a aba ou sair da conta apaga |
| Service worker (Cache Storage) | Arquivos estáticos do aplicativo (JS, CSS, ícones); **nenhuma resposta da API** (`cache-control: no-store` e sem `runtimeCaching`) | O próprio aparelho | Substituído a cada versão |

Não há analytics, rastreamento, publicidade, mapa de calor, fontes ou scripts de terceiros carregados pelo aplicativo. Não há envio de e-mail, SMS ou notificação para fora.

## Categorias

| Categoria | Campos principais (tabelas) | Finalidade operacional | Origem | Pessoas naturais? | Acesso no sistema |
| --- | --- | --- | --- | --- | --- |
| Contas e autenticação | login, nome, hash Argon2id da senha, ativo, vínculos (escopo, perfil, concessões) — `usuario`, `vinculo` | Identificar quem usa e o que pode fazer | Administrador cria a conta | **Sim** (empregados e terceiros autorizados) | Administração de acesso; o próprio usuário vê nome e perfil |
| Sessões | hash do identificador, escopo ativo, criação, último uso, expiração, revogação e motivo — `sessao` | Manter a sessão e permitir revogar | Login | Sim (vinculadas à conta) | Somente o servidor |
| Preferências | tema, menu, tutorial — `preferencia_usuario` | Conforto de uso | Usuário | Sim | O próprio usuário |
| Auditoria de segurança e administração | ação, resultado, autor, escopo, alvo, detalhes simples, id da requisição — `evento_auditoria` (login, falha de login, acesso negado, contas, documentos) | Rastrear acessos e decisões administrativas | Servidor | Sim (autor) | `auditoria.consultar` (administrador) |
| Histórico operacional | autor e horário de cadastro, movimentação, conferência, recontagem (valor anterior e novo), correção, cancelamento, expedição — `evento_estoque`, `evento_localizacao`, `historico_conteudo`, `contagem_volumes`, `conferencia_volumes`, `evento_janela`, `evento_volumes_janela`, `historico_layout` | Rastrear o estoque físico e quem alterou | Operação | Sim (autor) e dados de empresas | Perfis internos conforme a matriz; cliente vê só o painel filtrado |
| Identificação documental | tipo e número da nota (NF/NFD/MI), Delivery, remetente (nome), CNPJ do remetente quando informado — `conteudo_palete`, `vinculo_documento_palete`, `informacao_documento`, `documento_devolucao` | Localizar devoluções e montar janelas | Bipagem, cadastro e inventário | **Em regra não** (empresas). Pode identificar pessoa natural quando o remetente é pessoa física ou empresário individual cujo nome empresarial contém o nome civil — avaliar caso a caso, sem presumir | Perfis internos; cliente só no painel do cliente |
| Produtos e estoque | SKU, descrição, lote, quantidades, saldos, posições, paletes — `produto`, `saldo_estoque`, `palete`, `posicao` | Inventário físico | Operação e importações | Não | Perfis internos |
| Claims e valores | caso, linhas, valores, candidatos, evidências e anexos (fotos/arquivos no banco) — `claim`, `anexo_claim`, `evidencia_claim` | Tratar reclamações e recuperações | Analistas | Possível em anexos (imagens/documentos podem conter nomes ou assinaturas) | `claim.*` |
| Anexos de conferência | imagem ou arquivo e tipo — `anexo_conferencia`, `anexo_janela` | Evidência da conferência e da janela | Operação | Possível (imagens) | Perfis internos |
| Arquivos importados | arquivo original guardado no banco (Excel/CSV) e linhas — `arquivo_importacao`, `linha_importacao`, `inventario_referencia`, `linha_inventario` | Reprocessar e auditar importações | Usuário com permissão de importar | Possível conforme o conteúdo do arquivo | `importacao.*`, `inventario.importar` |
| Seleção do cliente e solicitações de teste | linhas selecionadas, observações do cliente, situação — `selecao_cliente`, `solicitacao_selecao_teste` e relacionadas | Solicitação para a agenda/janela (não baixa estoque) | Cliente (teste interno) e supervisor | Sim (autor da solicitação) | `selecao.*`, `selecao_teste.*` (concessão explícita) |
| Validação urgente — sem endereço | ocorrências sem local físico confirmado, motivo, autor | Uso interno | Operação | Sim (autor) | `validacao.consultar` (nunca o cliente) |
| Planilha e proteção | revisões, gerações, envios externos, backups e restaurações — `controle_planilha`, `geracao_planilha`, `envio_externo`, `registro_protecao` | Continuidade | Servidor | Não (metadados) | Situação para quem consulta a praça; arquivos com `planilha.baixar` |
| Termos e privacidade | versões (texto, hash, situação, referência e responsável da aprovação, autores) e aceites (usuário, versão, hash, horário) — `documento_publico`, `aceite_documento` | Publicar textos aprovados e registrar o aceite exigido | Administrador / usuário | Sim (autores, aceitantes e o nome informado como responsável da aprovação) | `documentos.administrar`; cada usuário vê o próprio aceite |
| Idempotência | chave, hash do pedido, resposta — `registro_idempotencia` | Não repetir gravações | Servidor | Vinculada ao usuário | Somente o servidor |

## O que **não** é coletado

- Endereço IP, geolocalização, fingerprint ou user-agent **não** são gravados no banco. O IP é usado em memória para limitar tentativas de login e aparece no registro técnico do servidor (rotação de 5 MB).
- O aceite dos termos não grava IP nem dados do aparelho.
- Senhas nunca são gravadas em texto, nem em log, nem na auditoria; tokens e cookies são ocultados no log (`redact`).

## Destinos externos

Nenhum dado sai do servidor automaticamente hoje: o destino independente da planilha e dos backups está **sem configuração**. Quando for configurado (S3 compatível ou pasta de rede de outra máquina), registrar aqui o fornecedor, a região e quem tem acesso, depois da decisão humana correspondente (`DECISOES-HUMANAS.md`, item 4).
