# Matriz de permissões (gerada do código)

Fonte: `packages/contracts/src/acesso.ts` (`PERMISSOES_POR_PERFIL`), conferida no servidor por `exigirPermissao` em cada rota. Gerada em 27/10/2026; regenerar depois de mudar perfis. "✔" = o perfil tem a permissão no escopo ativo do vínculo. Concessões explícitas por vínculo (fora do perfil): `claim.aprovar_financeiro` (analista de claims) e `selecao_teste.*` (supervisor ou administrador, funcionalidade de teste interno).

| Permissão | CONSULTA | OPERADOR | SUPERVISOR_ESTOQUE | ANALISTA_CLAIMS | ADMINISTRADOR | CLIENTE_CONSULTA |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| `praca.consultar` | ✔ | ✔ | ✔ | ✔ | ✔ |  |
| `palete.consultar` | ✔ | ✔ | ✔ | ✔ | ✔ |  |
| `produto.consultar` | ✔ | ✔ | ✔ | ✔ | ✔ |  |
| `acesso.administrar` |  |  |  |  | ✔ |  |
| `auditoria.consultar` |  |  |  |  | ✔ |  |
| `palete.cadastrar` |  | ✔ | ✔ |  |  |  |
| `palete.arquivar` |  |  | ✔ |  |  |  |
| `produto.cadastrar` |  |  | ✔ |  |  |  |
| `layout.configurar` |  |  | ✔ |  |  |  |
| `etiqueta.imprimir` |  | ✔ | ✔ |  |  |  |
| `conferencia.registrar` |  | ✔ | ✔ |  |  |  |
| `conferencia.reconciliar` |  |  | ✔ |  |  |  |
| `movimento.registrar` |  | ✔ | ✔ |  |  |  |
| `movimento.corrigir` |  |  | ✔ |  |  |  |
| `importacao.executar` |  |  | ✔ |  |  |  |
| `importacao.consultar` |  |  | ✔ |  |  |  |
| `busca.exportar` |  |  | ✔ | ✔ |  |  |
| `claim.consultar` |  |  | ✔ | ✔ |  |  |
| `claim.tratar` |  |  |  | ✔ |  |  |
| `claim.validar` |  |  |  | ✔ |  |  |
| `claim.aprovar_financeiro` |  |  |  |  |  |  |
| `janela.consultar` | ✔ | ✔ | ✔ | ✔ |  |  |
| `janela.gerenciar` |  |  | ✔ |  |  |  |
| `material.liberar` |  |  | ✔ |  |  |  |
| `janela.reservar` |  |  | ✔ |  |  |  |
| `expedicao.preparar` |  | ✔ | ✔ |  |  |  |
| `expedicao.confirmar` |  |  | ✔ |  |  |  |
| `expedicao.retorno` |  |  | ✔ |  |  |  |
| `janela.exportar` |  |  | ✔ |  |  |  |
| `relatorio.exportar` |  |  | ✔ | ✔ |  |  |
| `inventario.importar` |  |  | ✔ |  |  |  |
| `selecao.consultar` |  | ✔ | ✔ | ✔ |  |  |
| `selecao.importar` |  |  | ✔ |  |  |  |
| `selecao.exportar` |  | ✔ | ✔ | ✔ |  |  |
| `planilha.publicar` |  |  | ✔ |  | ✔ |  |
| `planilha.baixar` |  |  | ✔ | ✔ | ✔ |  |
| `painel.operacao` | ✔ | ✔ | ✔ | ✔ | ✔ |  |
| `painel.cliente` |  |  | ✔ |  |  | ✔ |
| `selecao_teste.solicitar` |  |  |  |  |  |  |
| `selecao_teste.responder` |  |  |  |  |  |  |
| `conteudo.corrigir` |  |  | ✔ |  | ✔ |  |
| `validacao.consultar` |  | ✔ | ✔ |  | ✔ |  |
| `documentos.administrar` |  |  |  |  | ✔ |  |

## Leitura

- `CLIENTE_CONSULTA` tem somente `painel.cliente`: não consulta a praça interna, a validação urgente, os históricos internos, a planilha, os backups nem a administração (testes `paineis.test.ts`, `correcao-conteudos.test.ts` e `documentos.test.ts`).
- `ADMINISTRADOR` é o perfil administrativo técnico: contas, auditoria, planilha, correção de conteúdos e, desde 27/10/2026, `documentos.administrar` (minuta, referência da aprovação e publicação dos termos/aviso). Não altera estoque pelo perfil.
- Toda rota da API exige sessão válida (cookie httpOnly, SameSite=Strict) e, nas mutações, o token anti-CSRF; o escopo vem da sessão no servidor, nunca do navegador.
