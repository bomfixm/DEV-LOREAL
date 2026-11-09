-- "Liberar posição" (9/11/2026): o palete não está fisicamente no endereço
-- registrado. Tira só o vínculo de posição (o palete fica em localização
-- pendente; nada é arquivado, conteúdo e conferência não mudam) e deixa a
-- posição livre. Evento próprio: o movimento exige destino, e o indicador de
-- "paletes vazios retirados" não deve contar isto.

ALTER TYPE "TipoEventoLocalizacao" ADD VALUE 'LIBERACAO_POSICAO';

ALTER TABLE "posicao" DROP CONSTRAINT "posicao_livre_coerente";
ALTER TABLE "posicao" ADD CONSTRAINT "posicao_livre_coerente"
  CHECK (("livre_confirmada_em" IS NULL) = ("livre_origem" IS NULL)
         AND ("livre_origem" IS NULL OR "livre_origem" IN ('CONFIRMACAO', 'MOVIMENTO', 'EXPEDICAO', 'RETIRADA_VAZIO', 'LIBERACAO'))
         AND ("livre_confirmada_em" IS NULL OR (NOT "desativada" AND "retirada_em" IS NULL))
         AND ("livre_confirmada_por_id" IS NULL OR "livre_confirmada_em" IS NOT NULL));

CREATE OR REPLACE FUNCTION "marcar_posicao_livre_por_saida"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."posicao_origem_id" IS NOT NULL AND NEW."tipo"::text IN ('MOVIMENTO', 'SAIDA_EXPEDICAO', 'RETIRADA_VAZIO', 'LIBERACAO_POSICAO')
     AND (NEW."posicao_destino_id" IS NULL OR NEW."posicao_destino_id" <> NEW."posicao_origem_id") THEN
    UPDATE "posicao" pos
       SET "livre_confirmada_em" = NEW."ocorrido_em",
           "livre_confirmada_por_id" = NEW."autor_id",
           "livre_origem" = CASE NEW."tipo"::text WHEN 'MOVIMENTO' THEN 'MOVIMENTO' WHEN 'SAIDA_EXPEDICAO' THEN 'EXPEDICAO' WHEN 'LIBERACAO_POSICAO' THEN 'LIBERACAO' ELSE 'RETIRADA_VAZIO' END
     WHERE pos."id" = NEW."posicao_origem_id"
       AND NOT pos."desativada" AND pos."disponivel" AND pos."retirada_em" IS NULL
       AND NOT EXISTS (SELECT 1 FROM "palete" p WHERE p."posicao_id" = pos."id");
  END IF;
  RETURN NULL;
END;
$$;
