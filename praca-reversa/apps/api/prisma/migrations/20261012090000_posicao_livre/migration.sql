-- "Palete livre" (ajustes de 08/10/2026): posição com desocupação confirmada,
-- para saber onde guardar os próximos paletes. Posição sem palete registrado
-- NÃO é livre por isso (pode haver palete sem endereço informado): só a ação
-- explícita (desocupação conferida no local) ou um movimento/saída/retirada
-- registrado marcam a posição de origem como livre. Qualquer palete que passe a
-- ocupar a posição limpa a marcação. Mantido por gatilhos, valendo para todos os
-- caminhos (API, importações, comandos); o histórico fica nos eventos de
-- localização e na auditoria.

-- AlterTable
ALTER TABLE "posicao" ADD COLUMN     "livre_confirmada_em" TIMESTAMPTZ(3),
ADD COLUMN     "livre_confirmada_por_id" UUID,
ADD COLUMN     "livre_origem" TEXT;

-- AddForeignKey
ALTER TABLE "posicao" ADD CONSTRAINT "posicao_livre_confirmada_por_id_fkey" FOREIGN KEY ("livre_confirmada_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- Acréscimos à mão ----------

ALTER TABLE "posicao" ADD CONSTRAINT "posicao_livre_coerente"
  CHECK (("livre_confirmada_em" IS NULL) = ("livre_origem" IS NULL)
         AND ("livre_origem" IS NULL OR "livre_origem" IN ('CONFIRMACAO', 'MOVIMENTO', 'EXPEDICAO', 'RETIRADA_VAZIO'))
         AND ("livre_confirmada_em" IS NULL OR (NOT "desativada" AND "retirada_em" IS NULL))
         AND ("livre_confirmada_por_id" IS NULL OR "livre_confirmada_em" IS NOT NULL));

-- Palete passou a ocupar a posição: deixa de ser livre.
CREATE FUNCTION "limpar_posicao_livre"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."posicao_id" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."posicao_id" IS DISTINCT FROM OLD."posicao_id") THEN
    UPDATE "posicao" SET "livre_confirmada_em" = NULL, "livre_confirmada_por_id" = NULL, "livre_origem" = NULL
     WHERE "id" = NEW."posicao_id" AND "livre_confirmada_em" IS NOT NULL;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "palete_ocupa_posicao_livre" AFTER INSERT OR UPDATE OF "posicao_id" ON "palete"
FOR EACH ROW EXECUTE FUNCTION "limpar_posicao_livre"();

-- Movimento, saída (expedição integral) ou retirada de palete vazio registrados:
-- a posição de origem fica livre — conferido no fim da transação (gatilho
-- adiado), quando o palete já saiu dela e nenhum outro a ocupou. Correção de
-- movimento não marca nada (a localização anterior estava errada).
CREATE FUNCTION "marcar_posicao_livre_por_saida"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."posicao_origem_id" IS NOT NULL AND NEW."tipo"::text IN ('MOVIMENTO', 'SAIDA_EXPEDICAO', 'RETIRADA_VAZIO')
     AND (NEW."posicao_destino_id" IS NULL OR NEW."posicao_destino_id" <> NEW."posicao_origem_id") THEN
    UPDATE "posicao" pos
       SET "livre_confirmada_em" = NEW."ocorrido_em",
           "livre_confirmada_por_id" = NEW."autor_id",
           "livre_origem" = CASE NEW."tipo"::text WHEN 'MOVIMENTO' THEN 'MOVIMENTO' WHEN 'SAIDA_EXPEDICAO' THEN 'EXPEDICAO' ELSE 'RETIRADA_VAZIO' END
     WHERE pos."id" = NEW."posicao_origem_id"
       AND NOT pos."desativada" AND pos."disponivel" AND pos."retirada_em" IS NULL
       AND NOT EXISTS (SELECT 1 FROM "palete" p WHERE p."posicao_id" = pos."id");
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "evento_localizacao_libera_origem" AFTER INSERT ON "evento_localizacao"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "marcar_posicao_livre_por_saida"();

-- Posição desativada ou retirada do desenho não é livre.
CREATE FUNCTION "limpar_livre_desativada"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."desativada" OR NEW."retirada_em" IS NOT NULL) AND NEW."livre_confirmada_em" IS NOT NULL THEN
    NEW."livre_confirmada_em" := NULL;
    NEW."livre_confirmada_por_id" := NULL;
    NEW."livre_origem" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "posicao_desativada_nao_livre" BEFORE UPDATE OF "desativada", "retirada_em" ON "posicao"
FOR EACH ROW EXECUTE FUNCTION "limpar_livre_desativada"();
