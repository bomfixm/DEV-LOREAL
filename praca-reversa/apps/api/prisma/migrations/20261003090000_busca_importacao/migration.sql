-- Etapa 06: busca operacional e importação de produtos/documentos de devolução.
-- Estrutura gerada com `prisma migrate diff` (schema anterior → atual) e
-- acrescida à mão de CHECKs, gatilhos de imutabilidade, índice único parcial
-- do arquivo confirmado e índices de expressão da busca, que o Prisma não modela.

-- CreateEnum
CREATE TYPE "TipoImportacao" AS ENUM ('PRODUTOS', 'DEVOLUCOES');

-- CreateEnum
CREATE TYPE "FormatoArquivo" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "SituacaoImportacao" AS ENUM ('AGUARDANDO_MAPEAMENTO', 'PREVIA', 'CONFIRMADO', 'DESCARTADO');

-- CreateEnum
CREATE TYPE "ClassificacaoLinha" AS ENUM ('VALIDA_NOVA', 'DUPLICADA', 'INVALIDA', 'CONFLITANTE');

-- CreateEnum
CREATE TYPE "ResultadoLinha" AS ENUM ('GRAVADA', 'IGNORADA_DUPLICADA');

-- CreateTable
CREATE TABLE "lote_importacao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "tipo" "TipoImportacao" NOT NULL,
    "situacao" "SituacaoImportacao" NOT NULL,
    "formato" "FormatoArquivo" NOT NULL,
    "nome_arquivo" TEXT NOT NULL,
    "hash_arquivo" TEXT NOT NULL,
    "tamanho_bytes" INTEGER NOT NULL,
    "opcoes" JSONB,
    "separador_decimal" TEXT,
    "colunas" JSONB,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "versao_previa" INTEGER NOT NULL DEFAULT 0,
    "assinatura_previa" TEXT,
    "previa_gerada_em" TIMESTAMPTZ(3),
    "total_linhas" INTEGER NOT NULL DEFAULT 0,
    "linhas_vazias" INTEGER NOT NULL DEFAULT 0,
    "validas_novas" INTEGER NOT NULL DEFAULT 0,
    "duplicadas" INTEGER NOT NULL DEFAULT 0,
    "invalidas" INTEGER NOT NULL DEFAULT 0,
    "conflitantes" INTEGER NOT NULL DEFAULT 0,
    "gravadas" INTEGER NOT NULL DEFAULT 0,
    "ignoradas" INTEGER NOT NULL DEFAULT 0,
    "resultado" JSONB,
    "criado_por_id" UUID,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmado_por_id" UUID,
    "confirmado_em" TIMESTAMPTZ(3),
    "descartado_por_id" UUID,
    "descartado_em" TIMESTAMPTZ(3),
    "ultima_falha_em" TIMESTAMPTZ(3),
    "ultima_falha" TEXT,

    CONSTRAINT "lote_importacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arquivo_importacao" (
    "lote_id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "conteudo" BYTEA NOT NULL,

    CONSTRAINT "arquivo_importacao_pkey" PRIMARY KEY ("lote_id")
);

-- CreateTable
CREATE TABLE "linha_importacao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "lote_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "classificacao" "ClassificacaoLinha" NOT NULL,
    "chave" TEXT,
    "valores" JSONB NOT NULL,
    "lidos" JSONB NOT NULL,
    "motivos" JSONB NOT NULL,
    "avisos" JSONB NOT NULL,
    "resultado" "ResultadoLinha",
    "registro_id" UUID,

    CONSTRAINT "linha_importacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documento_devolucao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "tipo" "TipoOrigemDocumento" NOT NULL,
    "referencia" TEXT NOT NULL,
    "lote_importacao_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documento_devolucao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linha_documento_devolucao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "referencia_linha" TEXT NOT NULL,
    "chave_linha" TEXT NOT NULL,
    "produto_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "quantidade_declarada" DECIMAL(18,3) NOT NULL,
    "unidade_declarada" TEXT NOT NULL,
    "fator_conversao" DECIMAL(18,3) NOT NULL,
    "quantidade_canonica" DECIMAL(18,3) NOT NULL,
    "unidade_canonica" TEXT NOT NULL,
    "nota_fiscal" TEXT,
    "lote" TEXT,
    "data_documento" DATE,
    "lote_importacao_id" UUID NOT NULL,
    "linha_arquivo" INTEGER NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "linha_documento_devolucao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lote_importacao_escopo_id_criado_em_idx" ON "lote_importacao"("escopo_id", "criado_em");

-- CreateIndex
CREATE INDEX "lote_importacao_escopo_id_tipo_hash_arquivo_idx" ON "lote_importacao"("escopo_id", "tipo", "hash_arquivo");

-- CreateIndex
CREATE UNIQUE INDEX "lote_importacao_escopo_id_id_key" ON "lote_importacao"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "arquivo_importacao_escopo_id_lote_id_key" ON "arquivo_importacao"("escopo_id", "lote_id");

-- CreateIndex
CREATE INDEX "linha_importacao_lote_id_classificacao_numero_idx" ON "linha_importacao"("lote_id", "classificacao", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "linha_importacao_lote_id_numero_key" ON "linha_importacao"("lote_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "documento_devolucao_escopo_id_tipo_referencia_key" ON "documento_devolucao"("escopo_id", "tipo", "referencia");

-- CreateIndex
CREATE UNIQUE INDEX "documento_devolucao_escopo_id_id_key" ON "documento_devolucao"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "linha_documento_devolucao_escopo_id_produto_id_idx" ON "linha_documento_devolucao"("escopo_id", "produto_id");

-- CreateIndex
CREATE UNIQUE INDEX "linha_documento_devolucao_documento_id_chave_linha_key" ON "linha_documento_devolucao"("documento_id", "chave_linha");

-- AddForeignKey
ALTER TABLE "lote_importacao" ADD CONSTRAINT "lote_importacao_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote_importacao" ADD CONSTRAINT "lote_importacao_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote_importacao" ADD CONSTRAINT "lote_importacao_confirmado_por_id_fkey" FOREIGN KEY ("confirmado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lote_importacao" ADD CONSTRAINT "lote_importacao_descartado_por_id_fkey" FOREIGN KEY ("descartado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arquivo_importacao" ADD CONSTRAINT "arquivo_importacao_escopo_id_lote_id_fkey" FOREIGN KEY ("escopo_id", "lote_id") REFERENCES "lote_importacao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_importacao" ADD CONSTRAINT "linha_importacao_escopo_id_lote_id_fkey" FOREIGN KEY ("escopo_id", "lote_id") REFERENCES "lote_importacao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_devolucao" ADD CONSTRAINT "documento_devolucao_escopo_id_lote_importacao_id_fkey" FOREIGN KEY ("escopo_id", "lote_importacao_id") REFERENCES "lote_importacao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_documento_devolucao" ADD CONSTRAINT "linha_documento_devolucao_escopo_id_documento_id_fkey" FOREIGN KEY ("escopo_id", "documento_id") REFERENCES "documento_devolucao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_documento_devolucao" ADD CONSTRAINT "linha_documento_devolucao_escopo_id_produto_id_fkey" FOREIGN KEY ("escopo_id", "produto_id") REFERENCES "produto"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_documento_devolucao" ADD CONSTRAINT "linha_documento_devolucao_escopo_id_lote_importacao_id_fkey" FOREIGN KEY ("escopo_id", "lote_importacao_id") REFERENCES "lote_importacao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Restrições, funções, gatilhos e índices adicionados manualmente.

-- Lote: hash SHA-256, contadores coerentes, estados com autoria/horário. A
-- confirmação só existe sem linhas inválidas/conflitantes e grava exatamente
-- as válidas novas, ignorando as duplicadas.
ALTER TABLE "lote_importacao" ADD CONSTRAINT "lote_importacao_coerente"
  CHECK ("hash_arquivo" ~ '^[0-9a-f]{64}$'
         AND "tamanho_bytes" > 0
         AND char_length("nome_arquivo") BETWEEN 1 AND 200
         AND "nome_arquivo" !~ '[[:cntrl:]]'
         AND "versao" >= 1 AND "versao_previa" >= 0
         AND LEAST("total_linhas", "linhas_vazias", "validas_novas", "duplicadas", "invalidas", "conflitantes", "gravadas", "ignoradas") >= 0
         AND "validas_novas" + "duplicadas" + "invalidas" + "conflitantes" = "total_linhas"
         AND ("situacao" <> 'AGUARDANDO_MAPEAMENTO' OR ("versao_previa" = 0 AND "assinatura_previa" IS NULL AND "total_linhas" = 0))
         AND ("situacao" NOT IN ('PREVIA', 'CONFIRMADO')
              OR ("versao_previa" >= 1 AND "assinatura_previa" ~ '^[0-9a-f]{64}$' AND "previa_gerada_em" IS NOT NULL
                  AND "opcoes" IS NOT NULL AND "colunas" IS NOT NULL AND "separador_decimal" IN ('VIRGULA', 'PONTO')))
         AND (("situacao" = 'CONFIRMADO') = ("confirmado_em" IS NOT NULL AND "confirmado_por_id" IS NOT NULL))
         AND ("situacao" <> 'CONFIRMADO'
              OR ("invalidas" = 0 AND "conflitantes" = 0 AND "total_linhas" > 0
                  AND "gravadas" = "validas_novas" AND "ignoradas" = "duplicadas" AND "resultado" IS NOT NULL))
         AND ("situacao" = 'CONFIRMADO' OR ("gravadas" = 0 AND "ignoradas" = 0 AND "resultado" IS NULL))
         AND (("situacao" = 'DESCARTADO') = ("descartado_em" IS NOT NULL AND "descartado_por_id" IS NOT NULL)));

-- O mesmo arquivo (hash) do mesmo tipo é confirmado uma única vez por escopo,
-- inclusive com dois lotes confirmados ao mesmo tempo.
CREATE UNIQUE INDEX "lote_importacao_arquivo_confirmado_key" ON "lote_importacao"("escopo_id", "tipo", "hash_arquivo")
  WHERE "situacao" = 'CONFIRMADO';

-- Lote nunca é apagado; arquivo, tipo e autoria não mudam; CONFIRMADO e
-- DESCARTADO são finais; a versão da prévia só avança.
CREATE FUNCTION "proteger_lote_importacao"() RETURNS trigger
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
     OR NEW."criado_por_id" IS DISTINCT FROM OLD."criado_por_id" THEN
    RAISE EXCEPTION 'IMPORTACAO_IMUTAVEL: arquivo, tipo e autoria do lote não mudam' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."versao_previa" < OLD."versao_previa" OR NEW."versao" < OLD."versao"
     OR (NEW."situacao"::text = 'AGUARDANDO_MAPEAMENTO' AND OLD."situacao"::text <> 'AGUARDANDO_MAPEAMENTO') THEN
    RAISE EXCEPTION 'IMPORTACAO_IMUTAVEL: a prévia e a versão do lote só avançam' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "lote_importacao_protegido" BEFORE UPDATE OR DELETE ON "lote_importacao"
FOR EACH ROW EXECUTE FUNCTION "proteger_lote_importacao"();

-- Conteúdo do arquivo: gravado uma vez, nunca alterado nem apagado pela aplicação.
CREATE FUNCTION "proteger_arquivo_importacao"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMPORTACAO_IMUTAVEL: o arquivo enviado não é alterado nem apagado' USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "arquivo_importacao_imutavel" BEFORE UPDATE OR DELETE ON "arquivo_importacao"
FOR EACH ROW EXECUTE FUNCTION "proteger_arquivo_importacao"();

-- Linhas da prévia: substituídas só enquanto o lote não foi confirmado nem
-- descartado; nunca editadas. Resultado coerente com a classificação.
ALTER TABLE "linha_importacao" ADD CONSTRAINT "linha_importacao_coerente"
  CHECK ("numero" >= 1
         AND jsonb_typeof("valores") = 'object' AND jsonb_typeof("lidos") = 'object'
         AND jsonb_typeof("motivos") = 'array' AND jsonb_typeof("avisos") = 'array'
         AND ("classificacao" NOT IN ('INVALIDA', 'CONFLITANTE') OR jsonb_array_length("motivos") > 0)
         AND ("resultado" IS NULL
              OR ("resultado" = 'GRAVADA' AND "classificacao" = 'VALIDA_NOVA')
              OR ("resultado" = 'IGNORADA_DUPLICADA' AND "classificacao" = 'DUPLICADA'))
         AND ("registro_id" IS NULL OR "resultado" = 'GRAVADA'));

CREATE FUNCTION "proteger_linha_importacao"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_lote uuid;
  v_situacao text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'IMPORTACAO_IMUTAVEL: o resultado de uma linha não é editado' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN v_lote := NEW."lote_id"; ELSE v_lote := OLD."lote_id"; END IF;
  SELECT "situacao"::text INTO v_situacao FROM "lote_importacao" WHERE "id" = v_lote;
  IF v_situacao IS NULL OR v_situacao NOT IN ('AGUARDANDO_MAPEAMENTO', 'PREVIA') THEN
    RAISE EXCEPTION 'IMPORTACAO_IMUTAVEL: o resultado de um lote confirmado ou descartado não muda' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "linha_importacao_protegida" BEFORE INSERT OR UPDATE OR DELETE ON "linha_importacao"
FOR EACH ROW EXECUTE FUNCTION "proteger_linha_importacao"();

-- Chave de comparação da linha do documento: o texto exato; quando só tem
-- dígitos, sem zeros à esquerda ("001" e "1" são a mesma linha). Igual a
-- `chaveLinhaDocumento` em apps/api/src/modules/importacao/interpretar.ts.
CREATE FUNCTION "chave_linha_documento"(referencia text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN referencia ~ '^[0-9]+$' THEN coalesce(nullif(ltrim(referencia, '0'), ''), '0') ELSE referencia END
$$;

-- Texto de identificação: sem espaços nas pontas, sem caracteres de controle, até 64.
CREATE FUNCTION "texto_identificador_valido"(valor text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT valor IS NULL OR (char_length(valor) BETWEEN 1 AND 64 AND valor = btrim(valor) AND valor !~ '[[:cntrl:]]')
$$;

ALTER TABLE "documento_devolucao" ADD CONSTRAINT "documento_devolucao_coerente"
  CHECK ("tipo"::text = 'DEVOLUCAO' AND "referencia" IS NOT NULL AND texto_identificador_valido("referencia"));

CREATE TRIGGER "documento_devolucao_imutavel" BEFORE UPDATE OR DELETE ON "documento_devolucao"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();

-- Linha de documento: quantidade e unidade declaradas originais, fator e
-- conversão exata para a unidade canônica; peças inteiras; textos válidos.
ALTER TABLE "linha_documento_devolucao" ADD CONSTRAINT "linha_documento_devolucao_coerente"
  CHECK ("quantidade_declarada" > 0 AND "fator_conversao" > 0
         AND "quantidade_canonica" = "quantidade_declarada" * "fator_conversao"
         AND ("unidade_declarada" <> "unidade_canonica" OR "fator_conversao" = 1)
         AND ("unidade_declarada" <> 'UN' OR "quantidade_declarada" = trunc("quantidade_declarada"))
         AND ("unidade_canonica" <> 'UN' OR "quantidade_canonica" = trunc("quantidade_canonica"))
         AND "unidade_declarada" ~ '^[A-Z0-9]{1,10}$' AND "unidade_canonica" ~ '^[A-Z0-9]{1,10}$'
         AND texto_identificador_valido("referencia_linha") AND "referencia_linha" IS NOT NULL
         AND "chave_linha" = chave_linha_documento("referencia_linha")
         AND texto_identificador_valido("sku") AND texto_identificador_valido("lote") AND texto_identificador_valido("nota_fiscal")
         AND "linha_arquivo" >= 1);

-- O produto, o SKU e a unidade canônica gravados são os do cadastro no momento.
CREATE FUNCTION "verificar_linha_documento"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "produto" p
     WHERE p."id" = NEW."produto_id" AND p."escopo_id" = NEW."escopo_id"
       AND p."sku" = NEW."sku" AND p."unidade_canonica" = NEW."unidade_canonica"
  ) THEN
    RAISE EXCEPTION 'IMPORTACAO_IMUTAVEL: SKU ou unidade canônica diferentes do cadastro do produto' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "linha_documento_devolucao_produto" BEFORE INSERT ON "linha_documento_devolucao"
FOR EACH ROW EXECUTE FUNCTION "verificar_linha_documento"();

CREATE TRIGGER "linha_documento_devolucao_imutavel" BEFORE UPDATE OR DELETE ON "linha_documento_devolucao"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();

-- Índices da busca: identificadores comparados sem diferenciar maiúsculas, por
-- igualdade ou início (text_pattern_ops vale para qualquer collation).
CREATE INDEX "produto_busca_sku_idx" ON "produto"("escopo_id", upper("sku") text_pattern_ops);
CREATE INDEX "codigo_barras_busca_codigo_idx" ON "codigo_barras"("escopo_id", upper("codigo") text_pattern_ops);
CREATE INDEX "palete_busca_codigo_idx" ON "palete"("escopo_id", upper("codigo_busca") text_pattern_ops);
CREATE INDEX "segmento_estoque_produto_idx" ON "segmento_estoque"("escopo_id", "produto_id");
CREATE INDEX "segmento_estoque_busca_lote_idx" ON "segmento_estoque"("escopo_id", upper("lote") text_pattern_ops);
CREATE INDEX "segmento_estoque_busca_origem_idx" ON "segmento_estoque"("escopo_id", upper("origem_referencia") text_pattern_ops);
CREATE INDEX "saldo_estoque_segmento_idx" ON "saldo_estoque"("escopo_id", "segmento_id");
CREATE INDEX "item_declarado_busca_lote_idx" ON "item_declarado"("escopo_id", upper("lote") text_pattern_ops);
CREATE INDEX "item_declarado_busca_origem_idx" ON "item_declarado"("escopo_id", upper("origem_referencia") text_pattern_ops);
CREATE INDEX "observacao_conferencia_busca_lote_idx" ON "observacao_conferencia"("escopo_id", upper("lote") text_pattern_ops);
CREATE INDEX "observacao_conferencia_busca_origem_idx" ON "observacao_conferencia"("escopo_id", upper("origem_referencia") text_pattern_ops);
CREATE INDEX "documento_devolucao_busca_referencia_idx" ON "documento_devolucao"("escopo_id", upper("referencia") text_pattern_ops);
CREATE INDEX "linha_documento_devolucao_busca_lote_idx" ON "linha_documento_devolucao"("escopo_id", upper("lote") text_pattern_ops);
CREATE INDEX "linha_documento_devolucao_busca_nf_idx" ON "linha_documento_devolucao"("escopo_id", upper("nota_fiscal") text_pattern_ops);
CREATE INDEX "linha_documento_devolucao_documento_idx" ON "linha_documento_devolucao"("escopo_id", "documento_id");
