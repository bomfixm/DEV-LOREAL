-- Importação do Excel da bipagem (8 out. 2026): lote ligado ao palete de
-- destino (ID permanente, imutável), inventário de referência de origem
-- BIPAGEM com código BIP-… (numeração própria; INV-… continua a sua) e linhas
-- excluídas pelo operador. Estrutura gerada com `prisma migrate diff` (schema
-- anterior → atual) e acrescida à mão de CHECKs, índice parcial e gatilho.
-- Valores novos de enum são comparados como texto (não podem ser usados na
-- mesma transação que os criou).

-- AlterEnum
ALTER TYPE "TipoImportacao" ADD VALUE 'BIPAGEM';

-- DropIndex
DROP INDEX "inventario_referencia_escopo_id_numero_key";

-- AlterTable
ALTER TABLE "lote_importacao" ADD COLUMN     "palete_id" UUID;

-- CreateIndex
CREATE INDEX "lote_importacao_escopo_id_palete_id_idx" ON "lote_importacao"("escopo_id", "palete_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventario_referencia_escopo_id_codigo_key" ON "inventario_referencia"("escopo_id", "codigo");

-- AddForeignKey
ALTER TABLE "lote_importacao" ADD CONSTRAINT "lote_importacao_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Acréscimos à mão ----------

-- Lote: palete de destino só (e sempre) na bipagem; linhas excluídas também na
-- bipagem (deixadas de fora explicitamente por quem importa); parâmetros
-- obrigatórios na prévia. A confirmação da bipagem exige zero inválidas e
-- conflitantes, como nos demais tipos.
ALTER TABLE "lote_importacao" DROP CONSTRAINT "lote_importacao_coerente";
ALTER TABLE "lote_importacao" ADD CONSTRAINT "lote_importacao_coerente"
  CHECK ("hash_arquivo" ~ '^[0-9a-f]{64}$'
         AND "tamanho_bytes" > 0
         AND char_length("nome_arquivo") BETWEEN 1 AND 200
         AND "nome_arquivo" !~ '[[:cntrl:]]'
         AND "versao" >= 1 AND "versao_previa" >= 0
         AND LEAST("total_linhas", "linhas_vazias", "validas_novas", "duplicadas", "invalidas", "conflitantes", "excluidas", "gravadas", "ignoradas") >= 0
         AND "validas_novas" + "duplicadas" + "invalidas" + "conflitantes" + "excluidas" = "total_linhas"
         AND ("excluidas" = 0 OR "tipo"::text IN ('SELECAO_CLIENTE', 'BIPAGEM'))
         AND (("tipo"::text = 'BIPAGEM') = ("palete_id" IS NOT NULL))
         AND ("situacao" <> 'AGUARDANDO_MAPEAMENTO' OR ("versao_previa" = 0 AND "assinatura_previa" IS NULL AND "total_linhas" = 0))
         AND ("situacao" NOT IN ('PREVIA', 'CONFIRMADO')
              OR ("versao_previa" >= 1 AND "assinatura_previa" ~ '^[0-9a-f]{64}$' AND "previa_gerada_em" IS NOT NULL
                  AND "opcoes" IS NOT NULL AND "colunas" IS NOT NULL AND "separador_decimal" IN ('VIRGULA', 'PONTO')))
         AND ("tipo"::text NOT IN ('INVENTARIO', 'SELECAO_CLIENTE', 'BIPAGEM') OR "situacao" NOT IN ('PREVIA', 'CONFIRMADO') OR jsonb_typeof("parametros") = 'object')
         AND (("situacao" = 'CONFIRMADO') = ("confirmado_em" IS NOT NULL AND "confirmado_por_id" IS NOT NULL))
         AND ("situacao" <> 'CONFIRMADO'
              OR ((("invalidas" = 0 AND "conflitantes" = 0) OR "tipo"::text = 'INVENTARIO')
                  AND "total_linhas" > 0
                  AND "gravadas" = "validas_novas" AND "ignoradas" = "duplicadas" AND "resultado" IS NOT NULL))
         AND ("situacao" = 'CONFIRMADO' OR ("gravadas" = 0 AND "ignoradas" = 0 AND "resultado" IS NULL))
         AND (("situacao" = 'DESCARTADO') = ("descartado_em" IS NOT NULL AND "descartado_por_id" IS NOT NULL)));

-- O mesmo arquivo do mesmo tipo é confirmado uma vez por escopo; na bipagem,
-- uma vez por palete (o mesmo arquivo pode trazer notas de outro palete,
-- importadas pelo outro palete). Vale também para confirmações simultâneas.
DROP INDEX "lote_importacao_arquivo_confirmado_key";
CREATE UNIQUE INDEX "lote_importacao_arquivo_confirmado_key"
  ON "lote_importacao"("escopo_id", "tipo", "hash_arquivo", COALESCE("palete_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "situacao" = 'CONFIRMADO';

-- O palete de destino do lote não muda (além das regras anteriores).
CREATE OR REPLACE FUNCTION "proteger_lote_importacao"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMPORTACAO_IMUTAVEL: lotes de importação não são apagados' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."situacao"::text IN ('CONFIRMADO', 'DESCARTADO') THEN
    RAISE EXCEPTION 'IMPORTACAO_IMUTAVEL: o lote já está %', OLD."situacao" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."escopo_id" <> OLD."escopo_id" OR NEW."tipo" <> OLD."tipo" OR NEW."formato" <> OLD."formato"
     OR NEW."hash_arquivo" <> OLD."hash_arquivo" OR NEW."tamanho_bytes" <> OLD."tamanho_bytes"
     OR NEW."nome_arquivo" <> OLD."nome_arquivo" OR NEW."criado_em" <> OLD."criado_em"
     OR NEW."criado_por_id" IS DISTINCT FROM OLD."criado_por_id"
     OR NEW."palete_id" IS DISTINCT FROM OLD."palete_id" THEN
    RAISE EXCEPTION 'IMPORTACAO_IMUTAVEL: arquivo, tipo, palete de destino e autoria do lote não mudam' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."versao_previa" < OLD."versao_previa" OR NEW."versao" < OLD."versao"
     OR (NEW."situacao"::text = 'AGUARDANDO_MAPEAMENTO' AND OLD."situacao"::text <> 'AGUARDANDO_MAPEAMENTO') THEN
    RAISE EXCEPTION 'IMPORTACAO_IMUTAVEL: a prévia e a versão do lote só avançam' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Linha da prévia: ações novas da bipagem (nova parcela, deixada de fora).
ALTER TABLE "linha_importacao" DROP CONSTRAINT "linha_importacao_coerente";
ALTER TABLE "linha_importacao" ADD CONSTRAINT "linha_importacao_coerente"
  CHECK ("numero" >= 1
         AND jsonb_typeof("valores") = 'object' AND jsonb_typeof("lidos") = 'object'
         AND jsonb_typeof("motivos") = 'array' AND jsonb_typeof("avisos") = 'array'
         AND ("classificacao"::text NOT IN ('INVALIDA', 'CONFLITANTE', 'EXCLUIDA') OR jsonb_array_length("motivos") > 0)
         AND ("resultado" IS NULL
              OR ("resultado" = 'GRAVADA' AND "classificacao" = 'VALIDA_NOVA')
              OR ("resultado" = 'IGNORADA_DUPLICADA' AND "classificacao" = 'DUPLICADA'))
         AND ("registro_id" IS NULL OR "resultado" = 'GRAVADA')
         AND ("acao" IS NULL OR "acao" IN ('VINCULAR', 'CRIAR_CADASTRO', 'ATUALIZAR', 'JA_IMPORTADO', 'REFERENCIA_HISTORICA',
                                          'DUPLICADA_ARQUIVO', 'REQUER_RESOLUCAO', 'SOLICITACAO', 'EXCLUIDA_MARCACAO', 'DUPLICIDADE_AGRUPADA',
                                          'NOVA_PARCELA', 'EXCLUIDA_OPERADOR')));

-- Inventário de referência: origem BIPAGEM (código BIP-…) exige lote e hash,
-- como o importado; o prefixo do código acompanha a origem.
ALTER TABLE "inventario_referencia" DROP CONSTRAINT "inventario_referencia_coerente";
ALTER TABLE "inventario_referencia" ADD CONSTRAINT "inventario_referencia_coerente"
  CHECK ("numero" >= 1 AND "codigo" ~ '^(INV|BIP)-[0-9]{6,}$'
         AND (("origem" = 'BIPAGEM') = ("codigo" LIKE 'BIP-%'))
         AND char_length("descricao") BETWEEN 3 AND 200 AND "descricao" !~ '[[:cntrl:]]'
         AND char_length("referencia_conferencia") BETWEEN 1 AND 120 AND "referencia_conferencia" !~ '[[:cntrl:]]'
         AND "origem" IN ('IMPORTADO', 'APLICACAO', 'BIPAGEM')
         AND ("origem" NOT IN ('IMPORTADO', 'BIPAGEM') OR ("lote_importacao_id" IS NOT NULL AND "hash_arquivo" ~ '^[0-9a-f]{64}$'))
         AND "significado_numero_palete" IN ('IDENTIFICADOR_PALETE', 'NUMERACAO_POSICAO', 'REFERENCIA_EXTERNA')
         AND jsonb_typeof("convencoes") = 'object'
         AND LEAST("total_linhas", "aplicadas", "pendentes", "historicas") >= 0
         AND "versao" >= 1
         AND "conferencia_externa_situacao" IN ('NAO_REGISTRADA', 'RECONHECIDA')
         AND (("conferencia_externa_situacao" = 'RECONHECIDA')
              = ("conferencia_externa_referencia" IS NOT NULL AND "conferencia_externa_por_id" IS NOT NULL AND "conferencia_externa_em" IS NOT NULL)));

-- Numeração por prefixo: o mesmo número não se repete dentro de cada prefixo.
CREATE UNIQUE INDEX "inventario_referencia_escopo_prefixo_numero_key"
  ON "inventario_referencia"("escopo_id", (left("codigo", 3)), "numero");
