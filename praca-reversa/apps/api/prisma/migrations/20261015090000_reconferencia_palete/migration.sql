-- Reconferência após 20 dias sem movimentação (prazo por palete). Campos
-- próprios no palete, preenchidos pelos eventos reais na mesma transação
-- (nunca por "atualizado_em"), e a reconferência completa registrada na
-- conferência de volumes. Só acrescenta: nada existente muda de valor.

ALTER TABLE "palete"
  ADD COLUMN "relogio_inicio_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "relogio_inicio_origem" TEXT NOT NULL DEFAULT 'CADASTRO',
  ADD COLUMN "ultima_movimentacao_em" TIMESTAMPTZ(3),
  ADD COLUMN "ultima_movimentacao_tipo" TEXT,
  ADD COLUMN "ultima_reconferencia_em" TIMESTAMPTZ(3),
  ADD COLUMN "ultima_reconferencia_por_id" UUID,
  ADD COLUMN "ultima_reconferencia_origem" TEXT;

-- Início conhecido: a entrada do palete no sistema (cadastro).
UPDATE "palete" SET "relogio_inicio_em" = "criado_em", "relogio_inicio_origem" = 'CADASTRO';

-- Última movimentação relevante a partir do histórico persistido. A posição
-- registrada pela carga do inventário (tabela de endereços confirmada) é dado
-- de origem, não movimento físico: fica de fora.
UPDATE "palete" p SET "ultima_movimentacao_em" = m."em", "ultima_movimentacao_tipo" = m."tipo"
  FROM (
    SELECT DISTINCT ON ("palete_id") "palete_id", "em", "tipo" FROM (
      SELECT "palete_id", "ocorrido_em" AS "em",
             CASE "tipo"::text WHEN 'MOVIMENTO' THEN 'MOVIMENTO' WHEN 'CORRECAO' THEN 'CORRECAO_LOCALIZACAO' ELSE 'RETIRADA_VAZIO' END AS "tipo"
        FROM "evento_localizacao"
       WHERE "tipo"::text IN ('MOVIMENTO', 'CORRECAO', 'RETIRADA_VAZIO') AND "motivo" NOT LIKE 'Localização informada no %'
      UNION ALL
      SELECT "palete_id", "ocorrido_em", CASE "tipo"::text WHEN 'EXPEDICAO' THEN 'SAIDA_PARCIAL' WHEN 'TRANSFERENCIA' THEN 'TRANSFERENCIA_ENVIADA' ELSE 'CORRECAO_TRANSFERENCIA' END
        FROM "evento_estoque" WHERE "tipo"::text IN ('TRANSFERENCIA', 'CORRECAO_TRANSFERENCIA', 'EXPEDICAO')
      UNION ALL
      SELECT "palete_destino_id", "ocorrido_em", CASE "tipo"::text WHEN 'TRANSFERENCIA' THEN 'TRANSFERENCIA_RECEBIDA' ELSE 'CORRECAO_TRANSFERENCIA' END
        FROM "evento_estoque" WHERE "tipo"::text IN ('TRANSFERENCIA', 'CORRECAO_TRANSFERENCIA') AND "palete_destino_id" IS NOT NULL
      UNION ALL
      SELECT "palete_id", "criado_em", 'ENTRADA_CONTEUDO' FROM "conteudo_palete"
    ) e
    ORDER BY "palete_id", "em" DESC
  ) m
 WHERE m."palete_id" = p."id";

-- Última conferência COMPLETA válida (concluída ou reconciliada; recontagem pedida não vale).
UPDATE "palete" p SET "ultima_reconferencia_em" = s."concluida_em", "ultima_reconferencia_por_id" = s."concluida_por_id", "ultima_reconferencia_origem" = 'CONFERENCIA_COMPLETA'
  FROM (
    SELECT DISTINCT ON ("palete_id") "palete_id", "concluida_em", "concluida_por_id"
      FROM "sessao_conferencia"
     WHERE "escopo_contagem"::text = 'COMPLETA' AND "situacao"::text IN ('CONCLUIDA', 'RECONCILIADA') AND "concluida_em" IS NOT NULL
     ORDER BY "palete_id", "concluida_em" DESC
  ) s
 WHERE s."palete_id" = p."id";

ALTER TABLE "palete" ADD CONSTRAINT "palete_relogio_coerente"
  CHECK ("relogio_inicio_origem" IN ('CADASTRO', 'IMPLANTACAO')
         AND ("ultima_movimentacao_em" IS NULL) = ("ultima_movimentacao_tipo" IS NULL)
         AND ("ultima_reconferencia_em" IS NULL) = ("ultima_reconferencia_origem" IS NULL)
         AND ("ultima_reconferencia_origem" IS NULL OR "ultima_reconferencia_origem" IN ('CONFERENCIA_COMPLETA', 'RECONFERENCIA_VOLUMES')));

ALTER TABLE "palete" ADD CONSTRAINT "palete_ultima_reconferencia_por_id_fkey" FOREIGN KEY ("ultima_reconferencia_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reconferência completa registrada na conferência de volumes (responsável e data).
CREATE TABLE "reconferencia_palete" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "resultado" TEXT NOT NULL,
    "observacao" TEXT,
    "conteudos" INTEGER NOT NULL,
    "registrada_por_id" UUID NOT NULL,
    "registrada_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reconferencia_palete_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reconferencia_palete_escopo_id_palete_id_registrada_em_idx" ON "reconferencia_palete"("escopo_id", "palete_id", "registrada_em");

ALTER TABLE "reconferencia_palete" ADD CONSTRAINT "reconferencia_palete_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reconferencia_palete" ADD CONSTRAINT "reconferencia_palete_registrada_por_id_fkey" FOREIGN KEY ("registrada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reconferencia_palete" ADD CONSTRAINT "reconferencia_palete_coerente"
  CHECK ("resultado" IN ('SEM_DIFERENCA', 'COM_DIFERENCA')
         AND "conteudos" >= 0
         AND ("observacao" IS NULL OR (char_length("observacao") BETWEEN 1 AND 500 AND "observacao" = btrim("observacao"))));

-- Registro da reconferência: só acrescentado (nunca alterado nem apagado).
CREATE FUNCTION "proteger_reconferencia_palete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RECONFERENCIA_IMUTAVEL: o registro da reconferência não é alterado nem apagado' USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "reconferencia_palete_protegida" BEFORE UPDATE OR DELETE ON "reconferencia_palete"
FOR EACH ROW EXECUTE FUNCTION "proteger_reconferencia_palete"();
