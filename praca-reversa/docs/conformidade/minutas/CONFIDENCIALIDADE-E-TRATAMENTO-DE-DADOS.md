MINUTA PARA REVISÃO - NÃO APROVADA PARA PUBLICAÇÃO OU ASSINATURA

# Confidencialidade e tratamento de dados — Praça Reversa

Documento interno. **Antes de usar, conferir os contratos corporativos já existentes** entre as empresas: acordo de confidencialidade, cláusulas de proteção de dados e acordo operacional. Se eles já cobrem o Praça Reversa, este texto serve apenas como lista de verificação, e não como documento adicional. Esta minuta não define quem é controlador ou operador: isso depende da avaliação humana (decisão 2).

| Tema | Ponto a confirmar ou acordar |
| --- | --- |
| Informações abrangidas | Inventário de devoluções, documentos fiscais e de entrega, claims e valores, fotos e anexos, contas e históricos do sistema |
| Acesso autorizado | Somente contas individuais com perfil adequado (matriz em `MATRIZ-DE-PERMISSOES.md`). O acesso do cliente fica limitado ao painel do cliente e às solicitações autorizadas. [A DEFINIR: quem autoriza contas externas] |
| Instruções de tratamento | Usar os dados só para a operação de devoluções. Não exportar para fora dos canais autorizados. Não usar dados reais em testes ou demonstrações. [A DEFINIR: instruções de cada empresa] |
| Fornecedores | [A DEFINIR: hospedagem e armazenamento de cópias aprovados; região; exigências contratuais]. Hoje nenhum fornecedor externo recebe dados do sistema. |
| Segurança | Medidas técnicas existentes: senha com hash Argon2id, sessão revogável, permissões no servidor, proteção CSRF e de origem, auditoria, backup diário com teste de restauração. [A DEFINIR: requisitos corporativos adicionais] |
| Cooperação | Pedidos de titulares e incidentes: comunicação entre as empresas em até [A DEFINIR], pelo canal [A DEFINIR], seguindo `PROCEDIMENTO-DE-INCIDENTES.md` |
| Retenção | [A DEFINIR: prazos por categoria] (situação atual em `MAPA-DE-DADOS.md`) |
| Encerramento | Devolução por exportação (planilha e backup completo) e eliminação ou guarda conforme a obrigação legal: [A DEFINIR: prazo e comprovação] |
| Confidencialidade de pessoas | Empregados e prestadores com acesso seguem as políticas da empresa empregadora: [A DEFINIR: referência] |

Aprovação: [A DEFINIR]
