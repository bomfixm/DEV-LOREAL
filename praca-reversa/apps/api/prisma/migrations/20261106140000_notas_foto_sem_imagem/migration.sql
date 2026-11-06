-- Notas por foto: a foto serve só para a leitura no aparelho e não é guardada
-- (decisão do usuário, 6 nov. 2026). Sai a tabela de imagens, criada horas antes;
-- fica só a chave que evita duplicar a mesma foto. Nenhuma outra tabela muda.

DROP TABLE "foto_nota";

ALTER TABLE "nota_foto" ADD COLUMN "chave_foto" TEXT;

CREATE INDEX "nota_foto_escopo_id_palete_id_chave_foto_idx" ON "nota_foto"("escopo_id", "palete_id", "chave_foto");
