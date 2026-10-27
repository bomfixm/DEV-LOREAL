# Procedimento curto de incidentes — Praça Reversa

Para suspeita de acesso indevido, perda, alteração ou divulgação de dados, ou indisponibilidade grave. Nem todo erro do sistema é incidente de segurança, e nem todo incidente precisa ser comunicado à ANPD: essa análise é **humana**, feita pelo responsável corporativo.

1. **Identificar:** o que aconteceu, quando, quem percebeu, quais telas, contas ou arquivos. Anotar fatos, sem suposição.
2. **Conter, sem apagar evidências:**
   - conta suspeita: o administrador desativa a conta em "Administração de acesso", o que revoga as sessões;
   - servidor comprometido: desligar o acesso de rede, sem formatar nem apagar arquivos;
   - segredo exposto (senha do banco, `APP_SEGREDO`, chave de destino): marcar para rotação pelo responsável. Não copiar o valor para mensagens ou chamados.
3. **Preservar evidências:**
   - eventos de auditoria (Administração → auditoria; tabela `evento_auditoria`);
   - registro técnico `.dados/servidor/servidor.log` e `servidor.log.1` (copiar antes da rotação de 5 MB);
   - backup do momento (`npm run backup:rotina -- --motivo=MANUAL --sem-retencao`).
4. **Registrar:** data e hora, descrição, dados e pessoas possivelmente afetados, medidas tomadas e quem decidiu. Usar [A DEFINIR: registro corporativo de incidentes].
5. **Acionar o responsável corporativo:** [A DEFINIR: canal de segurança/privacidade]. Cabe a ele avaliar:
   - a comunicação à ANPD e aos titulares (LGPD art. 48: comunicação pelo controlador em prazo razoável definido pela autoridade);
   - os critérios e prazos da regulamentação vigente da ANPD sobre comunicação de incidente, conferidos na data;
   - o conteúdo mínimo do art. 48 §1;
   - eventuais obrigações contratuais com o cliente.
6. **Recuperar:** restaurar a partir de backup verificado, conforme `docs/IMPLANTACAO.md` (recuperação). Antes, testar em banco isolado. Nunca restaurar sobre o banco em uso sem decisão registrada.
7. **Revisar:** causa, correção e lição aprendida em `docs/DECISOES.md`.

## O que o sistema faz sozinho

- Registra falhas de login, bloqueios por excesso de tentativas e acessos negados, com autor e horário, na auditoria.
- Mostra na tela "Planilha e proteção" falhas de geração, envio e backup, com horário.
- **Não envia** alertas externos: não há canal corporativo configurado (decisão 8).
- **Não envia** comunicações legais automáticas.
