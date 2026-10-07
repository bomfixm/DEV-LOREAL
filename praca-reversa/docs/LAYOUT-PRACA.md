# Layout da praça

Atualizado em 5 de outubro de 2026 (complemento "seleção do cliente": desenho aprovado, nomenclatura real e endereços). Histórico das etapas 02 e 03 no fim.

## Desenho aprovado (referência)

Fonte: `docs/Mapa_Praca_Reversa_Referencia.pdf` (vista superior aprovada) e a correspondência de nomes informada pelo operador em 5 out. 2026. A geometria do PDF é a **referência visual**; não é praça fisicamente validada (medidas, endereços reais por posição e ocupação continuam a confirmar).

| Bloco (código permanente) | Nome operacional | Prefixo do endereço | Faixas no desenho | Posições desenhadas |
| --- | --- | --- | --- | --- |
| FB01 | Fileira 11 | `11` | F01, única | 17 |
| FB02 | Fileira 12 | `12` | F02/F03, dupla | 34 |
| FB03 | Fileira 13 | `13` | F04/F05, dupla | 34 |
| FB04 | Fileira 14 | `14` | F06/F07, dupla | 34 |
| FB05 | Fileira 15 | `15` | F08/F09, dupla | 30 |
| FB06 | Fileira 16 | `16` | F10/F11, dupla | 30 |
| FB07 | GR — Grade | `GR` | F12, única | 15 |

- **194 posições ativas** (FB01–FB07). Isso descreve o desenho, não declara 194 paletes nem posições conferidas.
- **300 posições desativadas** (DB01–DB07, faixas D01–D12 de 25): fora da capacidade ativa e da ocupação, **prontas para ativar** (ativar é tornar a posição disponível na lista de posições, com registro no histórico). No banco, `posicao.desativada` implica indisponível (CHECK), então nenhum palete entra numa posição desativada.
- Faixas verticais; `P01` é a primeira posição visual (topo do desenho) de cada faixa. Nas faixas duplas, a faixa da esquerda é o lado **ESQUERDO** e a da direita o **DIREITO** (`fileira.lado`); faixas únicas são **UNICO**. `P01` não equivale a A101 nem ao número do palete.
- Configuração em `examples/layout-desenho-aprovado.json`; gerador `apps/api/src/modules/layout/desenho-aprovado.ts`.

### Aplicação nos layouts existentes

- **Criar do desenho aprovado** (Layout da praça, escopo sem layout ativo) cria o layout completo.
- **Aplicar nomes operacionais (Fileiras 11–16/GR)** grava o nome e o prefixo nos blocos FB01–FB07 de um layout que já tem o desenho, sem mudar códigos, IDs, geometria, QR, movimentos ou áreas desativadas (idempotente).
- O seed de demonstração sincroniza o layout `PRACA-INFORMADA` pelo **código** (elemento, faixa, posição): IDs e vínculos preservados; posição fora do desenho só é retirada se estiver livre (no banco de desenvolvimento, 2 posições livres do bloco fictício antigo foram retiradas).

## Endereços reais

O endereço é composto: **fileira (11–16) ou GR + código local** — `15 - A120`. `15 - A120` e `13 - A120` são posições diferentes; nada é buscado, atualizado ou vinculado só por `A120`.

Normalização registrada (texto original sempre preservado): N1 espaços nas pontas e repetidos; N2 maiúsculas; N3 travessão vale hífen; N4 espaços em volta do hífen e entre letra e número (`15- A120`, `15 - A 120` → `15 - A120`). Nunca: completar prefixo ausente (`A120`), acrescentar letra que o texto não tem (`14 - 130` continua `14 - 130`) ou mudar dígitos.

### Tabela de correspondência (posição ↔ endereço)

Por faixa, em **Layout da praça → Endereços reais**:

1. **Informar a sequência**: códigos locais na ordem (`A101-A133/2`, vários segmentos separados por vírgula: `A79-A89/2, A103-A123/2`), o **sentido** (P01 recebe o primeiro ou o último endereço) e a **fonte** (quem informou, quando). A quantidade precisa bater com as posições da faixa; código repetido é erro.
2. A sequência gera uma **proposta** (endereço por posição) para revisão; nada muda no mapa.
3. **Confirmar** os endereços propostos (com a contagem revisada). Só a correspondência **confirmada** coloca um endereço informado no mapa; trocar endereços confirmados exige motivo.

Não há fórmula fixa: cada faixa tem a sua sequência (numerações próprias ou intervalos irregulares são aceitos). Enquanto uma faixa estiver pendente, um endereço informado sem posição aparece nas listas como **posição visual pendente**, nunca num retângulo por aproximação.

Estado atual: **nenhuma sequência real confirmada**. Na demonstração há endereços **fictícios** confirmados em F01 (`11 - A1`…`11 - A17`), F08 (`15 - A101`…`15 - A129`, ímpares) e F09 (`15 - A102`…`15 - A130`, pares), só para exercitar o fluxo. O que falta (início/fim/sentido de cada faixa, Fileira 11, GR, referência visual dos lados) está em `docs/DESCOBERTA.md`.

## Ocupação

Uma posição desenhada não comprova ocupação. O mapa distingue:

- **Palete registrado** — há um palete vinculado à posição.
- **Ocupação desconhecida** — a posição ainda não foi levantada; não há informação sobre o físico.
- **Sem palete registrado** — posição coberta por cadastro, sem palete vinculado. Ausência de cadastro não comprova que a posição esteja fisicamente vazia.
- **Indisponível** — motivo registrado (pilar, passagem…).
- **Desativada · pronta para ativar** — área desativada do desenho aprovado (tracejado cinza claro, sem "X").

O rótulo mostra o endereço real confirmado junto do código da posição (`15 - A101 · F08-P01`); proposta aparece como "(proposto …)"; sem correspondência, só o código.

## Cenário de navegação (fixture separada)

O layout maior da etapa 01 (zonas Norte e Sul, 384 posições, docas e corredores) continua disponível como escopo separado, "Cenário de navegação · fictício", para testar navegação e desempenho com mais elementos. Não representa a praça nem sua capacidade.

## Configuração pelo aplicativo (etapa 03)

O supervisor de estoque configura o layout em **Layout da praça** (menu da conta). O layout ativo do escopo guarda a geometria; a ocupação vem do vínculo palete → posição e nunca é alterada pela configuração.

- **Criar layout**: só em escopo sem layout ativo; começa vazio — ou **Criar do desenho aprovado**.
- **Acrescentar bloco ao final**: fileira única ou par de fileiras próximas, posições por fileira e título. O bloco entra depois do último desenhado; fileiras e posições recebem os próximos códigos pela ordem (no desenho aprovado, `F25`, `F25-P01`…), provisórios e com ocupação desconhecida. Cadastre só o que foi confirmado no levantamento.
- **Bloco ou zona**: renomear e deslocar (com fileiras e posições); zona também pode ser criada e redimensionada. O título da zona fica na faixa superior e só aparece se não cobrir posições.
- **Posição**: trocar o código, tornar indisponível com motivo, **ativar** posição desativada, retirar do desenho. Posição com palete não fica indisponível nem é retirada; o código de posição retirada não é reutilizado; renomear posição ocupada mantém o palete vinculado pelo ID.
- **Revisões**: cada alteração (inclusive sequência, confirmação de endereços e nomes operacionais) aumenta a revisão do layout e entra no histórico (antes/depois, autor, data). Revisão desatualizada recebe conflito. Alterações que sobrepõem posições, colocam título sobre posição ou levam o desenho para coordenadas negativas são recusadas.

## Histórico

- **Etapa 02 (2 out. 2026)**: esquema informado "15 primeiro, depois 17" (`examples/layout-praca-informado.json`, exemplo de 96 posições em faixas horizontais B01–B04). Substituído na demonstração pelo desenho aprovado em 5 out. 2026 (D159); o arquivo continua como referência das etapas 02/03.
- **Pendências de levantamento**: `docs/DESCOBERTA.md` (sequências por faixa, medidas, corredores e acessos, docas, posições indisponíveis, capacidade por posição).
