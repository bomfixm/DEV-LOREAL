# Etapa 03 Cadastro de paletes e etiquetas

Continue o aplicativo Praça Reversa na pasta existente. Leia `AGENTS.md`, `README.md`, `docs/ESTADO.md` e `docs/DADOS-E-REGRAS.md`, `docs/INTERFACES.md`. Confira as etapas anteriores e o código existente antes de editar.

## Escopo desta etapa

Implementar cadastro de produtos, zonas, posições e paletes; configurar o layout real sem presumir medidas da praça. Ler `docs/MAPA-ZOOM.md` e persistir geometria/versão do layout separadamente da ocupação. Preservar zoom, arraste da visão, pinça e centralização já verificados na etapa 01 ao integrar mapa e lista à API compartilhada. Separar ID permanente de localização. Mostrar paletes sem localização e conteúdo desconhecido. Preparar vínculos documentais e múltiplas origens por conteúdo. Emitir etiqueta interna legível com QR que abre cadastro autenticado. Alterações de layout ocupado precisam preservar referências e histórico.

Implemente somente esta etapa. Complete as correções reversíveis necessárias ao seu aceite, preservando funções já verificadas. Regras operacionais desconhecidas devem ser registradas em `DESCOBERTA.md`; não preenchê-las com suposições como se fossem regras do cliente.

## Critérios de aceite

- ID duplicado e reutilização de ID arquivado são rejeitados.
- Ocupação incompatível e posição indisponível são bloqueadas.
- Cadastro é persistido e aparece para outro usuário autorizado.
- QR e busca por ID abrem o mesmo palete autenticado.
- Mapa/lista/detalhe mantêm os mesmos dados em desktop e celular.
- Geometria e ocupação persistem; navegar pelo mapa não grava alterações de localização ou saldo. Conversão dos eixos e cantos da planta é verificada.

## Verificação e entrega

Execute typecheck, lint, build e os testes pertinentes que existirem no projeto. Acrescente testes necessários para as regras reais desta etapa. Use PostgreSQL para saldo/transações/concorrência. Verifique a interface em computador e celular quando ela for alterada. Não anuncie sucesso para comandos ou fluxos que não executou.

Atualize `docs/ESTADO.md` com o que foi implementado, verificações e resultados, limitações e próximo passo. Registre decisões novas em `docs/DECISOES.md`. Atualize o README se mudar a execução. Entregue um relato curto, comandos reais de iniciar e evidências proporcionais. As etapas posteriores permanecem planejadas. Publicação e uso de dados reais seguem o ambiente efetivamente definido para o piloto.
