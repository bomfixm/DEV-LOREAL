MINUTA PARA REVISÃO - NÃO APROVADA PARA PUBLICAÇÃO OU ASSINATURA

# Suporte e continuidade — Praça Reversa

Documento interno. As metas ficam como `[A DEFINIR]` até haver medição e aprovação. As medições abaixo são observações, não garantia.

## Contatos e horários

| Item | Conteúdo |
| --- | --- |
| Suporte de uso | [A DEFINIR: canal, horário, responsável] |
| Suporte técnico (servidor, contas, cópias) | [A DEFINIR] |
| Incidentes de segurança | [A DEFINIR: canal corporativo] (ver `PROCEDIMENTO-DE-INCIDENTES.md`) |

## Prioridades

| Prioridade | Exemplo | Primeira resposta | Resolução |
| --- | --- | --- | --- |
| Crítica | Sistema fora do ar na operação; suspeita de vazamento | [A DEFINIR] | [A DEFINIR] |
| Alta | Função de registro indisponível com contorno manual | [A DEFINIR] | [A DEFINIR] |
| Normal | Erro de tela, dúvida, ajuste | [A DEFINIR] | [A DEFINIR] |

O prazo de resposta (alguém começa a tratar) é diferente do prazo de resolução (o problema termina).

## Manutenção

Versões novas entram pelo build no servidor. Uma versão nova encontrada na abertura do aplicativo entra sozinha quando nada está pendente; caso contrário, aparece o botão "Atualizar". Janela de manutenção: [A DEFINIR].

## Cópias e recuperação (situação em 27/10/2026)

- Backup completo do banco: automático a cada 24 h no servidor (`.dados/backups`), com verificação. É feito também antes de substituições e de migrações.
- Planilha do inventário: gerada depois de cada alteração confirmada, em versões, no servidor.
- Cópia fora do servidor: **não configurada** (decisão 4). Sem ela, a perda do servidor pode levar junto as cópias.
- Teste de restauração: aprovado em 26/10/2026 num banco isolado. O tempo observado está na tela "Planilha e proteção" e em `docs/ESTADO.md`. A restauração nunca é feita sobre o banco em uso para teste.
- Disponibilidade, RPO (perda máxima aceitável) e RTO (tempo máximo para voltar): [A DEFINIR depois da medição e da aprovação]. A frequência do backup não equivale a um RPO prometido.

## Devolução e exportação dos dados

No encerramento, ou a pedido autorizado, entregar a planilha (Excel) e o backup completo verificado a [A DEFINIR: destinatário autorizado], com registro da entrega.

## Comercialização

Se o software vier a ser comercializado ou licenciado a terceiros, revisar as obrigações da Lei 9.609/1998: validade técnica informada (art. 7) e serviços técnicos durante esse prazo (art. 8). Ver a minuta D.
