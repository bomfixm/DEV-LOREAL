-- Etapa 05: movimentações com histórico.
-- Estrutura gerada com `prisma migrate diff` e ajustada à mão para:
-- - linhagem dos segmentos com lote/origem pendentes (registros pendentes
--   distintos não se unem só por terem campos nulos);
-- - transferência/correção entre dois paletes no mesmo evento de estoque;
-- - eventos de localização imutáveis;
-- - CHECKs e gatilhos que o Prisma não modela.

-- CreateEnum
CREATE TYPE "TipoEventoLocalizacao" AS ENUM ('MOVIMENTO', 'CORRECAO');

-- AlterEnum (PostgreSQL 12+: valores novos não são usados como enum nesta
-- transação; as restrições abaixo comparam o tipo como texto).
ALTER TYPE "TipoEventoEstoque" ADD VALUE 'TRANSFERENCIA';
ALTER TYPE "TipoEventoEstoque" ADD VALUE 'CORRECAO_TRANSFERENCIA';

-- AlterTable
ALTER TABLE "evento_estoque" ADD COLUMN     "evento_corrigido_id" UUID,
ADD COLUMN     "palete_destino_id" UUID,
ADD COLUMN     "versao_saldo_destino_anterior" INTEGER,
ADD COLUMN     "versao_saldo_destino_posterior" INTEGER;

-- AlterTable
ALTER TABLE "segmento_estoque" ADD COLUMN     "linhagem" TEXT;

-- CreateTable
CREATE TABLE "evento_localizacao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "tipo" "TipoEventoLocalizacao" NOT NULL,
    "posicao_origem_id" UUID,
    "posicao_origem_codigo" TEXT,
    "posicao_destino_id" UUID,
    "posicao_destino_codigo" TEXT,
    "motivo" TEXT NOT NULL,
    "autor_id" UUID,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL,
    "versao_palete_anterior" INTEGER NOT NULL,
    "versao_palete_posterior" INTEGER NOT NULL,
    "evento_corrigido_id" UUID,

    CONSTRAINT "evento_localizacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evento_localizacao_escopo_id_palete_id_ocorrido_em_idx" ON "evento_localizacao"("escopo_id", "palete_id", "ocorrido_em");

-- CreateIndex
CREATE UNIQUE INDEX "evento_localizacao_escopo_id_id_key" ON "evento_localizacao"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "evento_localizacao_evento_corrigido_id_key" ON "evento_localizacao"("evento_corrigido_id");

-- CreateIndex
CREATE INDEX "evento_estoque_escopo_id_palete_destino_id_ocorrido_em_idx" ON "evento_estoque"("escopo_id", "palete_destino_id", "ocorrido_em");

-- CreateIndex
CREATE INDEX "evento_estoque_escopo_id_evento_corrigido_id_idx" ON "evento_estoque"("escopo_id", "evento_corrigido_id");

-- AddForeignKey
ALTER TABLE "evento_estoque" ADD CONSTRAINT "evento_estoque_escopo_id_palete_destino_id_fkey" FOREIGN KEY ("escopo_id", "palete_destino_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_estoque" ADD CONSTRAINT "evento_estoque_escopo_id_evento_corrigido_id_fkey" FOREIGN KEY ("escopo_id", "evento_corrigido_id") REFERENCES "evento_estoque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_localizacao" ADD CONSTRAINT "evento_localizacao_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_localizacao" ADD CONSTRAINT "evento_localizacao_escopo_id_posicao_origem_id_fkey" FOREIGN KEY ("escopo_id", "posicao_origem_id") REFERENCES "posicao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_localizacao" ADD CONSTRAINT "evento_localizacao_escopo_id_posicao_destino_id_fkey" FOREIGN KEY ("escopo_id", "posicao_destino_id") REFERENCES "posicao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_localizacao" ADD CONSTRAINT "evento_localizacao_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_localizacao" ADD CONSTRAINT "evento_localizacao_escopo_id_evento_corrigido_id_fkey" FOREIGN KEY ("escopo_id", "evento_corrigido_id") REFERENCES "evento_localizacao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Restrições, funções e gatilhos adicionados manualmente.

-- Identidade dos segmentos com lote/origem pendentes: linhagem própria. Os
-- segmentos já existentes com pendência recebem a própria ID como linhagem
-- (nenhum saldo muda de segmento); os totalmente identificados ficam sem
-- linhagem e continuam compartilhados entre paletes.
UPDATE "segmento_estoque" SET "linhagem" = "id"::text
 WHERE "lote" IS NULL OR "origem_tipo" IS NULL OR "origem_referencia" IS NULL;

ALTER TABLE "segmento_estoque" DROP CONSTRAINT "segmento_chave_coerente";
DROP FUNCTION "chave_segmento"(uuid, text, text, text, text);

-- Chave de identidade do segmento: produto, lote, origem (tipo e referência),
-- condição e linhagem, separados por U+001F; pendente (nulo) é U+001E. Igual a
-- `chaveSegmento` em apps/api/src/modules/conferencia/regras.ts.
CREATE FUNCTION "chave_segmento"(produto uuid, lote text, origem_tipo text, origem_referencia text, condicao text, linhagem text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT concat_ws(chr(31), produto::text, coalesce(lote, chr(30)), coalesce(origem_tipo, chr(30)), coalesce(origem_referencia, chr(30)), condicao,
                   coalesce(linhagem, chr(30)))
$$;

UPDATE "segmento_estoque"
   SET "chave" = chave_segmento("produto_id", "lote", "origem_tipo"::text, "origem_referencia", "condicao"::text, "linhagem");

ALTER TABLE "segmento_estoque" ADD CONSTRAINT "segmento_chave_coerente"
  CHECK ("chave" = chave_segmento("produto_id", "lote", "origem_tipo"::text, "origem_referencia", "condicao"::text, "linhagem"));
ALTER TABLE "segmento_estoque" ADD CONSTRAINT "segmento_linhagem_coerente"
  CHECK (("linhagem" IS NULL) = ("lote" IS NOT NULL AND "origem_tipo" IS NOT NULL AND "origem_referencia" IS NOT NULL)
         AND coalesce("linhagem", '') !~ '[[:cntrl:]]' AND coalesce("linhagem", 'x') <> '');

-- Eventos de estoque: reconciliação (um palete) ou transferência/correção
-- (dois paletes distintos, cada um com a versão de conteúdo avançando uma vez).
ALTER TABLE "evento_estoque" DROP CONSTRAINT "evento_estoque_coerente";
ALTER TABLE "evento_estoque" ADD CONSTRAINT "evento_estoque_coerente"
  CHECK ("versao_saldo_posterior" = "versao_saldo_anterior" + 1
         AND char_length("motivo") >= 3
         AND ("tipo"::text <> 'AJUSTE_RECONCILIACAO' OR "sessao_id" IS NOT NULL)
         AND ("tipo"::text <> 'SALDO_INICIAL' OR "evento_anterior_id" IS NULL)
         AND ("tipo"::text IN ('SALDO_INICIAL', 'AJUSTE_RECONCILIACAO') OR "sessao_id" IS NULL)
         AND (("tipo"::text IN ('TRANSFERENCIA', 'CORRECAO_TRANSFERENCIA'))
              = ("palete_destino_id" IS NOT NULL AND "versao_saldo_destino_anterior" IS NOT NULL AND "versao_saldo_destino_posterior" IS NOT NULL))
         AND ("palete_destino_id" IS NOT NULL OR ("versao_saldo_destino_anterior" IS NULL AND "versao_saldo_destino_posterior" IS NULL))
         AND ("palete_destino_id" IS NULL OR ("palete_destino_id" <> "palete_id"
              AND "versao_saldo_destino_posterior" = "versao_saldo_destino_anterior" + 1))
         AND (("tipo"::text = 'CORRECAO_TRANSFERENCIA') = ("evento_corrigido_id" IS NOT NULL))
         AND "evento_corrigido_id" IS DISTINCT FROM "id");

-- Correção de transferência: compensa uma transferência do mesmo escopo, no
-- sentido inverso (sai do palete que recebeu e volta ao de origem).
CREATE FUNCTION "verificar_correcao_estoque"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."evento_corrigido_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "evento_estoque" o
     WHERE o."id" = NEW."evento_corrigido_id" AND o."escopo_id" = NEW."escopo_id"
       AND o."tipo"::text = 'TRANSFERENCIA'
       AND o."palete_id" = NEW."palete_destino_id" AND o."palete_destino_id" = NEW."palete_id"
  ) THEN
    RAISE EXCEPTION 'HISTORICO_IMUTAVEL: a correção precisa compensar uma transferência no sentido inverso' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "evento_estoque_correcao_valida" BEFORE INSERT ON "evento_estoque"
FOR EACH ROW EXECUTE FUNCTION "verificar_correcao_estoque"();

-- Eventos de localização: imutáveis; a versão do palete avança uma vez; o
-- movimento tem destino; a correção aponta para um movimento do mesmo palete.
ALTER TABLE "evento_localizacao" ADD CONSTRAINT "evento_localizacao_coerente"
  CHECK ("versao_palete_posterior" = "versao_palete_anterior" + 1
         AND "versao_palete_anterior" >= 1
         AND char_length("motivo") >= 3
         AND (("posicao_origem_id" IS NULL) = ("posicao_origem_codigo" IS NULL))
         AND (("posicao_destino_id" IS NULL) = ("posicao_destino_codigo" IS NULL))
         AND "posicao_origem_id" IS DISTINCT FROM "posicao_destino_id"
         AND ("tipo" <> 'MOVIMENTO' OR "posicao_destino_id" IS NOT NULL)
         AND (("tipo" = 'CORRECAO') = ("evento_corrigido_id" IS NOT NULL))
         AND "evento_corrigido_id" IS DISTINCT FROM "id");

CREATE FUNCTION "verificar_correcao_localizacao"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."evento_corrigido_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "evento_localizacao" o
     WHERE o."id" = NEW."evento_corrigido_id" AND o."escopo_id" = NEW."escopo_id" AND o."palete_id" = NEW."palete_id"
  ) THEN
    RAISE EXCEPTION 'HISTORICO_IMUTAVEL: a correção precisa apontar para um movimento do mesmo palete' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "evento_localizacao_correcao_valida" BEFORE INSERT ON "evento_localizacao"
FOR EACH ROW EXECUTE FUNCTION "verificar_correcao_localizacao"();

CREATE TRIGGER "evento_localizacao_imutavel" BEFORE UPDATE OR DELETE ON "evento_localizacao"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();
