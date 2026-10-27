# Implantação, publicação dos textos, reversão e recuperação — termos e privacidade

## Configuração

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `DOCUMENTOS_EXIGIR_ACEITE` | `desativada` | `ativada`: com termos de uso **publicados**, cada usuário precisa aceitar a versão atual antes de usar o aplicativo. Até aceitar, só funcionam a sessão, a leitura dos documentos e o aceite; a API responde `428 ACEITE_PENDENTE` às demais rotas. Sem termos publicados, ninguém é bloqueado. |

Nenhuma outra variável é necessária. Nenhum valor secreto está envolvido.

## Implantação (instalação local da porta 3000)

1. Backup antes da migração: `npm run backup:rotina -- --motivo=MANUAL`. Conferir `BACKUP_ID=` na saída.
2. Migração aditiva: `npm run db:migrar`. Ela cria `documento_publico` e `aceite_documento` e a proteção da auditoria.
3. Build: `npm run build`. A tarefa "Praca Reversa - servidor 3000" reinicia sozinha com o build novo.
4. Conferir:
   - `/termos` e `/privacidade` dizem "ainda não há versão aprovada publicada";
   - a tela "Termos e privacidade" (administrador) abre sem o aviso "não instalado".

Sem o passo 2, o código novo fica inerte: as páginas públicas dizem "não publicado" e a tela do administrador avisa "não instalado". Nada do restante muda.

## Publicar um texto aprovado

1. Obter fora do sistema a aprovação do texto final (jurídico/privacidade da empresa), com uma referência verificável: parecer, ata, e-mail corporativo ou protocolo.
2. Em **Termos e privacidade**, criar a minuta com o texto exato aprovado, sem a linha "MINUTA PARA REVISÃO" e sem `[A DEFINIR]`.
3. Conferir a prévia interna e o código de conferência (início do hash SHA-256).
4. Registrar a referência da aprovação e quem aprovou (nome e função).
5. Publicar. A versão anterior, se houver, fica como "substituída", e o texto dela continua guardado.
6. Se a empresa decidir exigir aceite: definir `DOCUMENTOS_EXIGIR_ACEITE=ativada` no `.env` e reiniciar o servidor.

Uma correção de texto gera **versão nova**: o banco recusa alterar o texto, a aprovação ou a publicação de uma versão já registrada.

## Reversão

- **Código:** voltar ao build anterior (commit anterior + `npm run build`). As tabelas novas ficam sem uso; o código anterior não as lê.
- **Exigência de aceite:** `DOCUMENTOS_EXIGIR_ACEITE=desativada` e reiniciar. Ninguém fica bloqueado, e os aceites registrados continuam guardados.
- **Não apagar** versões publicadas nem aceites para "voltar": o banco recusa, e esses registros são a evidência do que foi mostrado e aceito.
- **Proteção da auditoria:** se for indispensável remover, faça por migração nova e registrada (`DROP TRIGGER "evento_auditoria_imutavel"`), nunca editando eventos.

## Recuperação

Sem alteração: backup e restauração continuam como em `docs/IMPLANTACAO.md`. O backup completo inclui as tabelas novas. Teste de restauração sempre em banco isolado (`npm run protecao:teste-restauracao`).
