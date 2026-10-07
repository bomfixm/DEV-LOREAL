# Etapa 10 Indicadores e piloto operacional

Continue o aplicativo Praça Reversa na pasta existente. Leia `AGENTS.md`, `README.md`, `docs/ESTADO.md` e `docs/ESCOPO.md`, `docs/DESCOBERTA.md`, `docs/IMPLANTACAO.md`, `docs/VALIDACAO.md`. Confira as etapas anteriores e o código existente antes de editar.

## Escopo desta etapa

Concluir indicadores e exportações com período/unidade/base explícitos. Separar paletes/ocupação, unidades/estoque, entradas/saídas, claims/localização/regularização e valores estimados/confirmados. Preparar roteiro de piloto delimitado, responsáveis, material de uso e ambiente de implantação. Conferir o fluxo com o responsável operacional quando houver acesso aos dados reais. Sem acesso, entregar o procedimento pronto e registrar o piloto físico como pendente; não fabricar evidência de execução.

Implemente somente esta etapa. Complete as correções reversíveis necessárias ao seu aceite, preservando funções já verificadas. Regras operacionais desconhecidas devem ser registradas em `DESCOBERTA.md`; não preenchê-las com suposições como se fossem regras do cliente.

## Critérios de aceite

- Teste T29 e fluxos pertinentes aprovados; métricas batem com eventos.
- Número de paletes reduzido por consolidação não vira saída de unidades.
- Relatório financeiro mostra estimativa e resultado confirmado separadamente.
- Roteiro, responsáveis, backup, manutenção e limites estão documentados.
- Piloto real, teste local e preparação de implantação são registrados separadamente.

## Verificação e entrega

Execute typecheck, lint, build e os testes pertinentes que existirem no projeto. Acrescente testes necessários para as regras reais desta etapa. Use PostgreSQL para saldo/transações/concorrência. Verifique a interface em computador e celular quando ela for alterada. Não anuncie sucesso para comandos ou fluxos que não executou.

Atualize `docs/ESTADO.md` com o que foi implementado, verificações e resultados, limitações e próximo passo. Registre decisões novas em `docs/DECISOES.md`. Atualize o README se mudar a execução. Entregue um relato curto, comandos reais de iniciar e evidências proporcionais. As etapas posteriores permanecem planejadas. Publicação e uso de dados reais seguem o ambiente efetivamente definido para o piloto.
