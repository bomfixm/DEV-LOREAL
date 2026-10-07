# Instruções para trabalhar no Praça Reversa

## Objetivo

Construir um aplicativo operacional para tornar rastreável o estoque de devoluções DHL / L’Oréal, apoiar a busca dos produtos de claims e preparar as janelas de devolução ao cliente. O mapa é a entrada principal; a confiabilidade vem dos registros, conferências, movimentos e evidências.

## Início de cada sessão

1. Leia este arquivo, `README.md` e `docs/ESTADO.md`.
2. Identifique a etapa pedida pelo usuário e leia seu prompt.
3. Leia somente os documentos e módulos relevantes. `docs/ESCOPO.md` define funcionalidades; `docs/DADOS-E-REGRAS.md` prevalece nas regras de estoque.
4. Inspecione o código existente antes de editar. Preserve alterações do usuário.
5. Verifique as dependências e o ambiente disponíveis; não anuncie uma verificação que não executou.

## Execução por etapas

- Implemente uma etapa por solicitação. As demais continuam registradas como planejadas.
- Complete o código e as verificações necessários à etapa. Um botão visual sem operação correspondente não conta como função implementada.
- Resolva escolhas técnicas rotineiras e correções reversíveis dentro do escopo. Documente suposições operacionais em `DESCOBERTA.md`; não invente regras do cliente.
- Alterações posteriores indicadas pelo usuário substituem decisões anteriores. Registre o motivo e os módulos afetados em `DECISOES.md`.
- Faça mudanças pequenas e coesas; não reescreva áreas já validadas sem necessidade.
- Não introduza uma segunda stack ou um segundo banco para resolver uma função isolada.
- Não crie microserviços, Kubernetes, IA, RFID ou integrações externas para a primeira versão.
- Não envie mensagens, não abra contas e não publique dados da operação como parte do desenvolvimento local.

## Regras técnicas

- TypeScript com modo estrito na interface e na API. A tipagem não substitui validação dos dados recebidos.
- Valide solicitações na API e todas as permissões no servidor.
- Use PostgreSQL para os testes que envolvem transações, saldo e concorrência.
- Dinheiro e medidas decimais usam representação exata. Identificadores, códigos, lotes, códigos de barras e chaves fiscais são strings.
- Configure uma unidade canônica por produto. Conversões de caixas e unidades precisam de fator conhecido e aprovado.
- Registre timestamps em UTC; apresente datas em português do Brasil, no fuso da operação, inicialmente America/Sao_Paulo.
- Nenhum saldo negativo, nenhuma transferência pela metade, nenhuma expedição duplicada e nenhuma identificação reutilizada para outro palete.
- Movimentos, reconciliações, expedições e resoluções devem preservar histórico. Correções geram eventos vinculados ao original.
- Use proteção contra versão desatualizada e chave de idempotência nas operações críticas.
- APIs, schemas e componentes devem permanecer separados por domínio; regras de estoque ficam em serviços da API.
- Fixe versões compatíveis em lockfile. Consulte as APIs da versão escolhida, especialmente as de Prisma, antes de implementar.
- O modo demonstração deve ser visível e utilizar dados fictícios, isolados dos dados da operação.

## Interface

- Linguagem operacional em português; interface simples, com leitura clara no celular e no computador.
- A identidade inicial pode usar amarelo e vermelho como referência da operação DHL, sem representar homologação oficial.
- Priorize informação, toque, teclado e contraste. Evite animações decorativas que dificultem a conferência.
- Cor de status sempre acompanha texto ou outro marcador identificável.
- Celular reorganiza a interface; não basta diminuir os elementos do desktop.
- Estados de carregamento, vazio, erro, sem conexão e conflito devem existir.
- Mapa e lista mostram a mesma fonte de dados. Conteúdo desconhecido não recebe uma quantidade física presumida.
- Não coloque segredos, dados reais da operação ou tokens de sessão em arquivos de exemplo, commits ou armazenamento acessível a scripts no navegador.

## Verificação proporcional

Execute verificações pertinentes à mudança. Tipos, lint e build são obrigatórios quando existir código correspondente. Testes de saldo, concorrência, importação, permissões, claims e expedição são obrigatórios nas etapas que os implementam. Use testes que exercitem regras reais, não testes que apenas copiem a implementação.

Após verificações aprovadas, avance para fechar a entrega. Repita ou amplie verificações quando uma mudança, falha ou dúvida nova justificar.

## Fechar cada etapa

Atualize `docs/ESTADO.md` com: etapa, funcionalidades realmente implementadas, comandos executados e resultados, falhas/limites, alterações relevantes e próximo passo. Mantenha o registro curto e útil para retomar sem reler toda a conversa.

Relate ao usuário: comportamento entregue, como iniciar, validação executada e limitações materiais. Diferencie demonstração, verificação local e verificação no ambiente do piloto. Não declare que o app está pronto para produção apenas por compilar.
