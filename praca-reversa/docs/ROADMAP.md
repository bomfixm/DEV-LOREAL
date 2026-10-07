# Desenvolvimento em dez etapas

Executar uma etapa por vez, usando o prompt correspondente. O roadmap completo é o plano; `ESTADO.md` é o registro da implementação. Corrigir falhas da etapa atual antes de classificá-la como concluída. Este roteiro não presume que o aplicativo completo possa ser colocado em operação em uma semana.

| Etapa | Entrega | Aceite principal |
| --- | --- | --- |
| 01 | Base TypeScript, React, API de saúde, mapa demonstrativo com zoom e arraste da visão e base instalável PWA. | App local abre; navegação, seleção e lista funcionam; estados desconhecidos são claros; tipos/lint/build passam. |
| 02 | Banco compartilhado, migrações, entidades, autenticação, permissões, auditoria e idempotência base. | Dados persistem, acesso indevido é negado no servidor, migração limpa e sessões são verificadas. |
| 03 | Layout real configurável, cadastro de paletes, detalhe, localização e etiquetas QR. | IDs únicos; mapa/lista concordam; ocupação inválida é bloqueada; QR abre palete autenticado. |
| 04 | Conferência parcial/completa, rascunhos, observações, recontagem e reconciliação. | Documental e físico separados; divergência preservada; versão antiga é rejeitada; unidade validada. |
| 05 | Movimentos de palete e itens, reservas protegidas e eventos compensatórios. | Transferência atômica; saldo não negativo; repetição e concorrência verificadas com PostgreSQL. |
| 06 | Busca operacional e importações de produtos/devoluções CSV/XLSX. | Prévia/erros/duplicidade funcionam; zeros preservados; importação documental não cria saldo físico. |
| 07 | Claims, importação de casos, candidatos, evidências, prioridades e resultados validados. | Mesmo SKU não encerra caso; quantidades não são duplicadas; estimativa e valor confirmado separados. |
| 08 | Janelas, critérios, capacidade, preparação, reservas e expedição. | Nenhuma reserva acima da capacidade/saldo; baixa única; cancelamento anterior à saída libera reserva. |
| 09 | Instalação PWA, câmera quando compatível, conexão/atualização, anexos e restauração. | Dispositivos-alvo testados; sem conexão não confirma estoque; backup restaurado e fluxo retomado. |
| 10 | Indicadores, relatórios, piloto físico, ajustes e preparação da implantação. | Indicadores batem com registros; fluxo real acompanhado; limitações, responsáveis e operação documentados. |

## Dependências

01 precede 02. Cadastro depende de banco e acesso. Conferência precede movimentos confiáveis. Busca usa cadastro, contagens e documentos importados. Claims dependem desses dados e evidências. Janelas usam saldo validado e regras de liberação. O uso real deve incluir a validação operacional, instalação e recuperação pertinentes ao ambiente.

## Primeira demonstração e primeiro piloto

A demonstração da etapa 01 serve para escolher desenho e fluxo do mapa. Não é uma comprovação do controle de estoque. O primeiro piloto precisa das etapas que sustentam o fluxo que será exercitado: identificação, persistência, acesso individual, conferência, movimentos e restauração. Se o piloto incluir claims ou expedição, seus respectivos módulos e testes também precisam estar concluídos.

Enquanto o código avança, a operação pode coletar IDs, endereços e documentos e definir um grupo de paletes. Essas tarefas evitam preencher o aplicativo com suposições.

## Fechamento de etapa

Cada entrega informa: funcionalidades realmente disponíveis; comandos executados e resultado; capturas desktop/celular nas etapas de interface; testes de regra quando aplicáveis; falhas e limites; atualização de `ESTADO.md`; próxima etapa. A demonstração local e o piloto com dados reais têm registros de validação distintos.
