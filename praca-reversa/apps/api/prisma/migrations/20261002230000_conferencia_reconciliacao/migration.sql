-- Etapa 04: conferência (sessões, observações, rascunho), estoque validado
-- (segmentos, saldos, eventos) e reconciliação.
-- Estrutura gerada com `prisma migrate diff` e ajustada à mão para: converter
-- as linhas legadas `item_observado`/`item_saldo` (somente da carga de
-- demonstração) no novo modelo, com IDs determinísticos iguais aos do seed;
-- acrescentar CHECKs e gatilhos que o Prisma não modela.

-- CreateEnum
CREATE TYPE "EscopoConferencia" AS ENUM ('PARCIAL', 'COMPLETA');

-- CreateEnum
CREATE TYPE "SituacaoConferencia" AS ENUM ('EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA', 'RECONCILIADA', 'SUBSTITUIDA');

-- CreateEnum
CREATE TYPE "MotivoConferencia" AS ENUM ('CONFERENCIA', 'RECONTAGEM');

-- CreateEnum
CREATE TYPE "ModoEntrada" AS ENUM ('MANUAL', 'LEITURA_UNIDADE', 'LEITURA_EMBALAGEM');

-- CreateEnum
CREATE TYPE "PendenciaObservacao" AS ENUM ('PRODUTO_NAO_IDENTIFICADO', 'FATOR_DESCONHECIDO');

-- CreateEnum
CREATE TYPE "TipoEventoEstoque" AS ENUM ('SALDO_INICIAL', 'AJUSTE_RECONCILIACAO');

-- Embalagem com fator desconhecido (não aprovado): código reconhecido, conversão bloqueada.
ALTER TABLE "codigo_barras" ALTER COLUMN "fator_conversao" DROP NOT NULL;

-- Versão do conteúdo validado do palete (eventos de estoque).
ALTER TABLE "palete" ADD COLUMN     "versao_saldo" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "sessao_conferencia" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "escopo_contagem" "EscopoConferencia" NOT NULL,
    "descricao_escopo" TEXT,
    "motivo" "MotivoConferencia" NOT NULL,
    "sessao_origem_id" UUID,
    "justificativa" TEXT,
    "situacao" "SituacaoConferencia" NOT NULL,
    "ativa" BOOLEAN,
    "revisao" INTEGER NOT NULL DEFAULT 1,
    "versao_palete_inicial" INTEGER NOT NULL,
    "versao_saldo_inicial" INTEGER NOT NULL,
    "observacoes" TEXT,
    "responsavel_id" UUID,
    "iniciada_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluida_em" TIMESTAMPTZ(3),
    "concluida_por_id" UUID,
    "escopo_completo_confirmado" BOOLEAN NOT NULL DEFAULT false,
    "cancelada_em" TIMESTAMPTZ(3),
    "cancelada_por_id" UUID,
    "motivo_cancelamento" TEXT,
    "reconciliada_em" TIMESTAMPTZ(3),
    "reconciliada_por_id" UUID,
    "justificativa_reconciliacao" TEXT,
    "pendencia_reconciliacao" TEXT,
    "pendencia_registrada_em" TIMESTAMPTZ(3),

    CONSTRAINT "sessao_conferencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observacao_conferencia" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "sessao_id" UUID NOT NULL,
    "ordem" INTEGER NOT NULL,
    "produto_id" UUID,
    "sku" TEXT,
    "descricao" TEXT NOT NULL,
    "codigo_lido" TEXT,
    "modo_entrada" "ModoEntrada" NOT NULL,
    "quantidade_informada" DECIMAL(18,3) NOT NULL,
    "unidade_informada" TEXT NOT NULL,
    "fator_conversao" DECIMAL(18,3),
    "quantidade_canonica" DECIMAL(18,3),
    "unidade_canonica" TEXT,
    "lote" TEXT,
    "origem_tipo" "TipoOrigemDocumento",
    "origem_referencia" TEXT,
    "condicao" "CondicaoMaterial" NOT NULL,
    "pendencia" "PendenciaObservacao",
    "nota" TEXT,
    "evidencia" TEXT,
    "revisao" INTEGER NOT NULL DEFAULT 1,
    "registrado_por_id" UUID,
    "registrado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removida_em" TIMESTAMPTZ(3),
    "removida_por_id" UUID,
    "motivo_remocao" TEXT,

    CONSTRAINT "observacao_conferencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revisao_observacao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "observacao_id" UUID NOT NULL,
    "revisao" INTEGER NOT NULL,
    "acao" TEXT NOT NULL,
    "anterior" JSONB NOT NULL,
    "motivo" TEXT,
    "autor_id" UUID,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revisao_observacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segmento_estoque" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "lote" TEXT,
    "origem_tipo" "TipoOrigemDocumento",
    "origem_referencia" TEXT,
    "condicao" "CondicaoMaterial" NOT NULL,
    "unidade" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "segmento_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saldo_estoque" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "segmento_id" UUID NOT NULL,
    "quantidade" DECIMAL(18,3) NOT NULL,
    "quantidade_reservada" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saldo_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_estoque" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "tipo" "TipoEventoEstoque" NOT NULL,
    "palete_id" UUID NOT NULL,
    "sessao_id" UUID,
    "motivo" TEXT NOT NULL,
    "autor_id" UUID,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evento_anterior_id" UUID,
    "versao_saldo_anterior" INTEGER NOT NULL,
    "versao_saldo_posterior" INTEGER NOT NULL,

    CONSTRAINT "evento_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linha_evento_estoque" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "segmento_id" UUID NOT NULL,
    "quantidade_anterior" DECIMAL(18,3) NOT NULL,
    "delta" DECIMAL(18,3) NOT NULL,
    "quantidade_posterior" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "linha_evento_estoque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessao_conferencia_escopo_id_situacao_idx" ON "sessao_conferencia"("escopo_id", "situacao");

-- CreateIndex
CREATE UNIQUE INDEX "sessao_conferencia_palete_id_numero_key" ON "sessao_conferencia"("palete_id", "numero");

-- Uma única sessão ativa por palete: "ativa" é TRUE só em EM_ANDAMENTO e nula nos demais (nulos não conflitam).
CREATE UNIQUE INDEX "sessao_conferencia_palete_id_ativa_key" ON "sessao_conferencia"("palete_id", "ativa");

-- CreateIndex
CREATE UNIQUE INDEX "sessao_conferencia_escopo_id_id_key" ON "sessao_conferencia"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "observacao_conferencia_escopo_id_produto_id_idx" ON "observacao_conferencia"("escopo_id", "produto_id");

-- CreateIndex
CREATE UNIQUE INDEX "observacao_conferencia_sessao_id_ordem_key" ON "observacao_conferencia"("sessao_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "observacao_conferencia_escopo_id_id_key" ON "observacao_conferencia"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "revisao_observacao_observacao_id_revisao_key" ON "revisao_observacao"("observacao_id", "revisao");

-- CreateIndex
CREATE UNIQUE INDEX "segmento_estoque_escopo_id_chave_key" ON "segmento_estoque"("escopo_id", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "segmento_estoque_escopo_id_id_key" ON "segmento_estoque"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "saldo_estoque_palete_id_segmento_id_key" ON "saldo_estoque"("palete_id", "segmento_id");

-- CreateIndex
CREATE INDEX "evento_estoque_escopo_id_palete_id_ocorrido_em_idx" ON "evento_estoque"("escopo_id", "palete_id", "ocorrido_em");

-- No máximo um evento de estoque por conferência (nulos não conflitam).
CREATE UNIQUE INDEX "evento_estoque_escopo_id_sessao_id_key" ON "evento_estoque"("escopo_id", "sessao_id");

-- CreateIndex
CREATE UNIQUE INDEX "evento_estoque_escopo_id_id_key" ON "evento_estoque"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "linha_evento_estoque_evento_id_palete_id_segmento_id_key" ON "linha_evento_estoque"("evento_id", "palete_id", "segmento_id");

-- AddForeignKey
ALTER TABLE "sessao_conferencia" ADD CONSTRAINT "sessao_conferencia_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao_conferencia" ADD CONSTRAINT "sessao_conferencia_escopo_id_sessao_origem_id_fkey" FOREIGN KEY ("escopo_id", "sessao_origem_id") REFERENCES "sessao_conferencia"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao_conferencia" ADD CONSTRAINT "sessao_conferencia_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao_conferencia" ADD CONSTRAINT "sessao_conferencia_concluida_por_id_fkey" FOREIGN KEY ("concluida_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao_conferencia" ADD CONSTRAINT "sessao_conferencia_cancelada_por_id_fkey" FOREIGN KEY ("cancelada_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao_conferencia" ADD CONSTRAINT "sessao_conferencia_reconciliada_por_id_fkey" FOREIGN KEY ("reconciliada_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observacao_conferencia" ADD CONSTRAINT "observacao_conferencia_escopo_id_sessao_id_fkey" FOREIGN KEY ("escopo_id", "sessao_id") REFERENCES "sessao_conferencia"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observacao_conferencia" ADD CONSTRAINT "observacao_conferencia_escopo_id_produto_id_fkey" FOREIGN KEY ("escopo_id", "produto_id") REFERENCES "produto"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observacao_conferencia" ADD CONSTRAINT "observacao_conferencia_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observacao_conferencia" ADD CONSTRAINT "observacao_conferencia_removida_por_id_fkey" FOREIGN KEY ("removida_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisao_observacao" ADD CONSTRAINT "revisao_observacao_escopo_id_observacao_id_fkey" FOREIGN KEY ("escopo_id", "observacao_id") REFERENCES "observacao_conferencia"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revisao_observacao" ADD CONSTRAINT "revisao_observacao_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segmento_estoque" ADD CONSTRAINT "segmento_estoque_escopo_id_produto_id_fkey" FOREIGN KEY ("escopo_id", "produto_id") REFERENCES "produto"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldo_estoque" ADD CONSTRAINT "saldo_estoque_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldo_estoque" ADD CONSTRAINT "saldo_estoque_escopo_id_segmento_id_fkey" FOREIGN KEY ("escopo_id", "segmento_id") REFERENCES "segmento_estoque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_estoque" ADD CONSTRAINT "evento_estoque_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_estoque" ADD CONSTRAINT "evento_estoque_escopo_id_sessao_id_fkey" FOREIGN KEY ("escopo_id", "sessao_id") REFERENCES "sessao_conferencia"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_estoque" ADD CONSTRAINT "evento_estoque_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_estoque" ADD CONSTRAINT "evento_estoque_escopo_id_evento_anterior_id_fkey" FOREIGN KEY ("escopo_id", "evento_anterior_id") REFERENCES "evento_estoque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_evento_estoque" ADD CONSTRAINT "linha_evento_estoque_escopo_id_evento_id_fkey" FOREIGN KEY ("escopo_id", "evento_id") REFERENCES "evento_estoque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_evento_estoque" ADD CONSTRAINT "linha_evento_estoque_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_evento_estoque" ADD CONSTRAINT "linha_evento_estoque_escopo_id_segmento_id_fkey" FOREIGN KEY ("escopo_id", "segmento_id") REFERENCES "segmento_estoque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Funções auxiliares (permanentes; replicadas em TypeScript e conferidas em teste).

-- UUID determinístico (MD5 do nome, bits de versão 3 e variante RFC 9562).
-- Usado só para converter a carga legada de demonstração com os mesmos IDs
-- que o seed gera (apps/api/src/demo/ids.ts, idDemoMd5).
CREATE FUNCTION "uuid_deterministico"(nome text) RETURNS uuid
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT (
    substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-3' || substr(h, 14, 3) || '-' ||
    to_hex(((('x' || substr(h, 17, 1))::bit(4))::int & 3) | 8) || substr(h, 18, 3) || '-' || substr(h, 21, 12)
  )::uuid
  FROM (SELECT md5(nome) AS h) AS s
$$;

-- Chave de identidade do segmento: produto, lote, origem (tipo e referência) e
-- condição, separados por U+001F; pendente (nulo) é U+001E. Os textos não
-- admitem caracteres de controle, então a chave não é ambígua.
CREATE FUNCTION "chave_segmento"(produto uuid, lote text, origem_tipo text, origem_referencia text, condicao text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT concat_ws(chr(31), produto::text, coalesce(lote, chr(30)), coalesce(origem_tipo, chr(30)), coalesce(origem_referencia, chr(30)), condicao)
$$;

-- ---------------------------------------------------------------------------
-- Conversão da carga legada (etapas 01–03): `item_observado` e `item_saldo`
-- existem só nos escopos de demonstração. Nada é inventado para dados
-- operacionais: se houver linhas legadas fora da demonstração, a migração para.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM (SELECT "escopo_id" FROM "item_observado" UNION ALL SELECT "escopo_id" FROM "item_saldo") AS l
      JOIN "escopo" e ON e."id" = l."escopo_id"
     WHERE NOT e."demonstracao"
  ) THEN
    RAISE EXCEPTION 'Linhas observadas/saldo legadas fora dos escopos de demonstração: converta-as manualmente antes desta migração.';
  END IF;
END $$;

-- Produtos fictícios da demonstração referenciados pelas linhas legadas.
INSERT INTO "produto" ("id", "escopo_id", "sku", "descricao", "unidade_canonica", "ativo", "versao", "criado_em", "atualizado_em")
SELECT uuid_deterministico('produto:' || l."escopo_id"::text || ':' || l."sku"), l."escopo_id", l."sku", min(l."descricao"), min(l."unidade_medida"),
       true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (
        SELECT "escopo_id", "sku", "descricao", "unidade_medida" FROM "item_saldo"
        UNION ALL SELECT "escopo_id", "sku", "descricao", "unidade_medida" FROM "item_observado"
        UNION ALL SELECT d."escopo_id", d."sku", d."descricao", d."unidade_medida"
                    FROM "item_declarado" d JOIN "escopo" e ON e."id" = d."escopo_id" AND e."demonstracao"
                   WHERE d."sku" IS NOT NULL AND d."produto_id" IS NULL
       ) AS l
 WHERE NOT EXISTS (SELECT 1 FROM "produto" p WHERE p."escopo_id" = l."escopo_id" AND p."sku" = l."sku")
 GROUP BY l."escopo_id", l."sku";

-- Linhas declaradas da demonstração passam a apontar para o produto do mesmo SKU.
UPDATE "item_declarado" d
   SET "produto_id" = p."id"
  FROM "produto" p
  JOIN "escopo" e ON e."id" = p."escopo_id" AND e."demonstracao"
 WHERE d."produto_id" IS NULL AND d."sku" IS NOT NULL AND p."escopo_id" = d."escopo_id" AND p."sku" = d."sku";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM (SELECT "escopo_id", "sku", "unidade_medida" FROM "item_saldo" UNION ALL SELECT "escopo_id", "sku", "unidade_medida" FROM "item_observado") AS l
      JOIN "produto" p ON p."escopo_id" = l."escopo_id" AND p."sku" = l."sku"
     WHERE l."unidade_medida" <> p."unidade_canonica"
  ) THEN
    RAISE EXCEPTION 'Linha legada em unidade diferente da canônica: conversão sem fator aprovado não é feita.';
  END IF;
END $$;

-- Saldos legados: segmentos, saldo validado e um evento de saldo inicial por palete.
CREATE TEMP TABLE "legado_saldo" AS
SELECT i."escopo_id", i."palete_id", p."id" AS "produto_id", i."lote",
       CASE WHEN i."referencia_devolucao" IS NULL THEN NULL ELSE 'DEVOLUCAO'::"TipoOrigemDocumento" END AS "origem_tipo",
       i."referencia_devolucao" AS "origem_referencia", i."condicao", p."unidade_canonica" AS "unidade",
       chave_segmento(p."id", i."lote", CASE WHEN i."referencia_devolucao" IS NULL THEN NULL ELSE 'DEVOLUCAO' END,
                      i."referencia_devolucao", i."condicao"::text) AS "chave",
       sum(i."quantidade") AS "quantidade"
  FROM "item_saldo" i
  JOIN "produto" p ON p."escopo_id" = i."escopo_id" AND p."sku" = i."sku"
 GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9
HAVING sum(i."quantidade") > 0;

INSERT INTO "segmento_estoque" ("id", "escopo_id", "produto_id", "lote", "origem_tipo", "origem_referencia", "condicao", "unidade", "chave", "criado_em")
SELECT DISTINCT ON (l."escopo_id", l."chave")
       uuid_deterministico('segmento:' || l."escopo_id"::text || ':' || l."chave"), l."escopo_id", l."produto_id", l."lote", l."origem_tipo",
       l."origem_referencia", l."condicao", l."unidade", l."chave", CURRENT_TIMESTAMP
  FROM "legado_saldo" l
 WHERE NOT EXISTS (SELECT 1 FROM "segmento_estoque" s WHERE s."escopo_id" = l."escopo_id" AND s."chave" = l."chave");

INSERT INTO "evento_estoque" ("id", "escopo_id", "tipo", "palete_id", "sessao_id", "motivo", "autor_id", "ocorrido_em", "evento_anterior_id", "versao_saldo_anterior", "versao_saldo_posterior")
SELECT uuid_deterministico('evento-saldo-inicial:' || p."id"::text), p."escopo_id", 'SALDO_INICIAL', p."id", NULL,
       'Saldo da carga de demonstração anterior (fictício), registrado sem sessão de conferência.', NULL, p."criado_em", NULL, 1, 2
  FROM "palete" p
 WHERE p."id" IN (SELECT "palete_id" FROM "legado_saldo");

INSERT INTO "saldo_estoque" ("id", "escopo_id", "palete_id", "segmento_id", "quantidade", "quantidade_reservada", "versao", "atualizado_em")
SELECT uuid_deterministico('saldo:' || l."palete_id"::text || ':' || s."id"::text), l."escopo_id", l."palete_id", s."id", l."quantidade", 0, 1, CURRENT_TIMESTAMP
  FROM "legado_saldo" l
  JOIN "segmento_estoque" s ON s."escopo_id" = l."escopo_id" AND s."chave" = l."chave";

INSERT INTO "linha_evento_estoque" ("id", "escopo_id", "evento_id", "palete_id", "segmento_id", "quantidade_anterior", "delta", "quantidade_posterior")
SELECT uuid_deterministico('linha:' || l."palete_id"::text || ':' || s."id"::text), l."escopo_id",
       uuid_deterministico('evento-saldo-inicial:' || l."palete_id"::text), l."palete_id", s."id", 0, l."quantidade", l."quantidade"
  FROM "legado_saldo" l
  JOIN "segmento_estoque" s ON s."escopo_id" = l."escopo_id" AND s."chave" = l."chave";

UPDATE "palete" SET "versao_saldo" = 2 WHERE "id" IN (SELECT "palete_id" FROM "legado_saldo");

-- Observações legadas: uma sessão concluída (sem responsável, carga anterior) por palete.
INSERT INTO "sessao_conferencia" ("id", "escopo_id", "palete_id", "numero", "escopo_contagem", "descricao_escopo", "motivo", "situacao", "ativa",
                                  "revisao", "versao_palete_inicial", "versao_saldo_inicial", "observacoes", "iniciada_em", "atualizada_em",
                                  "concluida_em", "escopo_completo_confirmado", "reconciliada_em", "justificativa_reconciliacao")
SELECT uuid_deterministico('sessao:' || p."id"::text || ':1'), p."escopo_id", p."id", 1,
       CASE WHEN p."estado_conferencia" = 'PARCIAL' THEN 'PARCIAL' ELSE 'COMPLETA' END::"EscopoConferencia",
       CASE WHEN p."estado_conferencia" = 'PARCIAL' THEN 'Parte física não registrada na carga anterior' END,
       'CONFERENCIA',
       CASE WHEN p."estado_conferencia" = 'RECONCILIADO' THEN 'RECONCILIADA' ELSE 'CONCLUIDA' END::"SituacaoConferencia",
       NULL, 1, p."versao", p."versao_saldo",
       'Contagem da carga de demonstração anterior (fictícia), registrada sem sessão de origem.',
       p."criado_em", p."criado_em", p."criado_em", p."estado_conferencia" <> 'PARCIAL',
       CASE WHEN p."estado_conferencia" = 'RECONCILIADO' THEN p."criado_em" END,
       CASE WHEN p."estado_conferencia" = 'RECONCILIADO' THEN 'Carga de demonstração anterior.' END
  FROM "palete" p
 WHERE EXISTS (SELECT 1 FROM "item_observado" i WHERE i."palete_id" = p."id");

INSERT INTO "observacao_conferencia" ("id", "escopo_id", "sessao_id", "ordem", "produto_id", "sku", "descricao", "codigo_lido", "modo_entrada",
                                      "quantidade_informada", "unidade_informada", "fator_conversao", "quantidade_canonica", "unidade_canonica",
                                      "lote", "origem_tipo", "origem_referencia", "condicao", "pendencia", "revisao", "registrado_em")
SELECT uuid_deterministico('observacao:' || i."palete_id"::text || ':' || (i."ordem" + 1)::text), i."escopo_id",
       uuid_deterministico('sessao:' || i."palete_id"::text || ':1'), i."ordem" + 1, p."id", p."sku", i."descricao", i."codigo_barras", 'MANUAL',
       i."quantidade", i."unidade_medida", 1, i."quantidade", p."unidade_canonica", i."lote",
       CASE WHEN i."referencia_devolucao" IS NULL THEN NULL ELSE 'DEVOLUCAO'::"TipoOrigemDocumento" END, i."referencia_devolucao",
       i."condicao", NULL, 1, pal."criado_em"
  FROM "item_observado" i
  JOIN "palete" pal ON pal."id" = i."palete_id"
  JOIN "produto" p ON p."escopo_id" = i."escopo_id" AND p."sku" = i."sku";

DO $$
BEGIN
  IF (SELECT count(*) FROM "item_observado") <> (SELECT count(*) FROM "observacao_conferencia") THEN
    RAISE EXCEPTION 'Conversão incompleta das observações legadas.';
  END IF;
  IF (SELECT coalesce(sum("quantidade"), 0) FROM "item_saldo") <> (SELECT coalesce(sum("quantidade"), 0) FROM "saldo_estoque") THEN
    RAISE EXCEPTION 'Conversão incompleta dos saldos legados.';
  END IF;
END $$;

DROP TABLE "legado_saldo";

-- DropForeignKey
ALTER TABLE "item_observado" DROP CONSTRAINT "item_observado_escopo_id_palete_id_fkey";

-- DropForeignKey
ALTER TABLE "item_saldo" DROP CONSTRAINT "item_saldo_escopo_id_palete_id_fkey";

-- DropTable
DROP TABLE "item_observado";

-- DropTable
DROP TABLE "item_saldo";

-- ---------------------------------------------------------------------------
-- Restrições adicionadas manualmente (o Prisma não modela CHECK nem gatilhos).

ALTER TABLE "palete" ADD CONSTRAINT "palete_versao_saldo_positiva" CHECK ("versao_saldo" >= 1);

-- Sessão: estados coerentes. "ativa" é TRUE exatamente em EM_ANDAMENTO.
ALTER TABLE "sessao_conferencia" ADD CONSTRAINT "sessao_conferencia_numeros"
  CHECK ("numero" >= 1 AND "revisao" >= 1 AND "versao_palete_inicial" >= 1 AND "versao_saldo_inicial" >= 1);
ALTER TABLE "sessao_conferencia" ADD CONSTRAINT "sessao_conferencia_ativa"
  CHECK (("situacao" = 'EM_ANDAMENTO' AND "ativa" IS TRUE) OR ("situacao" <> 'EM_ANDAMENTO' AND "ativa" IS NULL));
ALTER TABLE "sessao_conferencia" ADD CONSTRAINT "sessao_conferencia_parcial_descrita"
  CHECK ("escopo_contagem" <> 'PARCIAL' OR "descricao_escopo" IS NOT NULL);
ALTER TABLE "sessao_conferencia" ADD CONSTRAINT "sessao_conferencia_recontagem"
  CHECK ((("motivo" = 'RECONTAGEM') = ("sessao_origem_id" IS NOT NULL))
         AND ("motivo" <> 'RECONTAGEM' OR "justificativa" IS NOT NULL)
         AND ("sessao_origem_id" IS DISTINCT FROM "id"));
ALTER TABLE "sessao_conferencia" ADD CONSTRAINT "sessao_conferencia_concluida"
  CHECK ("situacao" IN ('EM_ANDAMENTO', 'CANCELADA') OR "concluida_em" IS NOT NULL);
ALTER TABLE "sessao_conferencia" ADD CONSTRAINT "sessao_conferencia_completa_confirmada"
  CHECK ("escopo_contagem" <> 'COMPLETA' OR "concluida_em" IS NULL OR "escopo_completo_confirmado");
ALTER TABLE "sessao_conferencia" ADD CONSTRAINT "sessao_conferencia_cancelada"
  CHECK ((("situacao" = 'CANCELADA') = ("cancelada_em" IS NOT NULL)) AND ("situacao" <> 'CANCELADA' OR "motivo_cancelamento" IS NOT NULL));
ALTER TABLE "sessao_conferencia" ADD CONSTRAINT "sessao_conferencia_reconciliada"
  CHECK ((("situacao" = 'RECONCILIADA') = ("reconciliada_em" IS NOT NULL))
         AND ("situacao" <> 'RECONCILIADA' OR ("escopo_contagem" = 'COMPLETA' AND "justificativa_reconciliacao" IS NOT NULL)));
ALTER TABLE "sessao_conferencia" ADD CONSTRAINT "sessao_conferencia_pendencia"
  CHECK (("pendencia_reconciliacao" IS NULL) = ("pendencia_registrada_em" IS NULL));

-- Observação: quantidade positiva; conversão exata (sem arredondamento) ou pendência explícita.
ALTER TABLE "observacao_conferencia" ADD CONSTRAINT "observacao_quantidade_positiva"
  CHECK ("quantidade_informada" > 0 AND "ordem" >= 1 AND "revisao" >= 1);
ALTER TABLE "observacao_conferencia" ADD CONSTRAINT "observacao_conversao_exata"
  CHECK ("quantidade_canonica" IS NULL
         OR ("fator_conversao" IS NOT NULL AND "fator_conversao" > 0 AND "quantidade_canonica" = "quantidade_informada" * "fator_conversao"));
ALTER TABLE "observacao_conferencia" ADD CONSTRAINT "observacao_pendencia_coerente"
  CHECK (CASE "pendencia"
           WHEN 'PRODUTO_NAO_IDENTIFICADO' THEN "produto_id" IS NULL AND "quantidade_canonica" IS NULL AND "fator_conversao" IS NULL
           WHEN 'FATOR_DESCONHECIDO' THEN "produto_id" IS NOT NULL AND "quantidade_canonica" IS NULL AND "fator_conversao" IS NULL
           ELSE "produto_id" IS NOT NULL AND "quantidade_canonica" IS NOT NULL
         END);
ALTER TABLE "observacao_conferencia" ADD CONSTRAINT "observacao_produto_com_sku"
  CHECK ("produto_id" IS NULL OR ("sku" IS NOT NULL AND "unidade_canonica" IS NOT NULL));
ALTER TABLE "observacao_conferencia" ADD CONSTRAINT "observacao_pecas_inteiras"
  CHECK (("unidade_informada" <> 'UN' OR "quantidade_informada" = trunc("quantidade_informada"))
         AND ("unidade_canonica" IS DISTINCT FROM 'UN' OR "quantidade_canonica" IS NULL OR "quantidade_canonica" = trunc("quantidade_canonica")));
ALTER TABLE "observacao_conferencia" ADD CONSTRAINT "observacao_origem_coerente"
  CHECK ("origem_referencia" IS NULL OR "origem_tipo" IS NOT NULL);
ALTER TABLE "observacao_conferencia" ADD CONSTRAINT "observacao_textos"
  CHECK (coalesce("lote", '') !~ '[[:cntrl:]]' AND coalesce("origem_referencia", '') !~ '[[:cntrl:]]' AND coalesce("sku", '') !~ '[[:cntrl:]]');
ALTER TABLE "observacao_conferencia" ADD CONSTRAINT "observacao_remocao_coerente"
  CHECK (("removida_em" IS NULL) = ("removida_por_id" IS NULL) AND ("removida_em" IS NOT NULL OR "motivo_remocao" IS NULL));

ALTER TABLE "revisao_observacao" ADD CONSTRAINT "revisao_observacao_acao" CHECK ("acao" IN ('CORRIGIDA', 'REMOVIDA') AND "revisao" >= 1);

-- Segmento: chave coerente com os atributos (identidade preservada também quando lote/origem são pendentes).
ALTER TABLE "segmento_estoque" ADD CONSTRAINT "segmento_chave_coerente"
  CHECK ("chave" = chave_segmento("produto_id", "lote", "origem_tipo"::text, "origem_referencia", "condicao"::text));
ALTER TABLE "segmento_estoque" ADD CONSTRAINT "segmento_textos"
  CHECK (coalesce("lote", '') !~ '[[:cntrl:]]' AND coalesce("origem_referencia", '') !~ '[[:cntrl:]]'
         AND ("origem_referencia" IS NULL OR "origem_tipo" IS NOT NULL));

-- Saldo: nunca negativo; reserva dentro do saldo.
ALTER TABLE "saldo_estoque" ADD CONSTRAINT "saldo_nao_negativo"
  CHECK ("quantidade" >= 0 AND "quantidade_reservada" >= 0 AND "quantidade_reservada" <= "quantidade" AND "versao" >= 1);

-- Evento: versão de conteúdo avança uma vez; ajuste pertence a uma conferência.
ALTER TABLE "evento_estoque" ADD CONSTRAINT "evento_estoque_coerente"
  CHECK ("versao_saldo_posterior" = "versao_saldo_anterior" + 1
         AND char_length("motivo") >= 3
         AND ("tipo" <> 'AJUSTE_RECONCILIACAO' OR "sessao_id" IS NOT NULL)
         AND ("tipo" <> 'SALDO_INICIAL' OR "evento_anterior_id" IS NULL));
ALTER TABLE "linha_evento_estoque" ADD CONSTRAINT "linha_evento_exata"
  CHECK ("delta" <> 0 AND "quantidade_anterior" >= 0 AND "quantidade_posterior" >= 0
         AND "quantidade_posterior" = "quantidade_anterior" + "delta");

-- ---------------------------------------------------------------------------
-- Gatilhos de proteção.

-- Sessão: transições permitidas; sessão encerrada não muda; nenhuma é apagada.
CREATE FUNCTION "verificar_transicao_conferencia"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CONFERENCIA_IMUTAVEL: sessões de conferência não são apagadas' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."situacao" IN ('CANCELADA', 'RECONCILIADA', 'SUBSTITUIDA') THEN
    RAISE EXCEPTION 'CONFERENCIA_ENCERRADA: sessão % encerrada não é alterada', OLD."situacao" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."situacao" <> OLD."situacao" AND NOT (
       (OLD."situacao" = 'EM_ANDAMENTO' AND NEW."situacao" IN ('CONCLUIDA', 'CANCELADA'))
    OR (OLD."situacao" = 'CONCLUIDA' AND NEW."situacao" IN ('RECONCILIADA', 'CANCELADA', 'SUBSTITUIDA'))
  ) THEN
    RAISE EXCEPTION 'CONFERENCIA_TRANSICAO_INVALIDA: % para %', OLD."situacao", NEW."situacao" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."palete_id" <> OLD."palete_id" OR NEW."escopo_id" <> OLD."escopo_id" OR NEW."numero" <> OLD."numero"
     OR NEW."escopo_contagem" <> OLD."escopo_contagem" OR NEW."versao_saldo_inicial" <> OLD."versao_saldo_inicial"
     OR NEW."iniciada_em" <> OLD."iniciada_em" OR NEW."responsavel_id" IS DISTINCT FROM OLD."responsavel_id"
     OR NEW."sessao_origem_id" IS DISTINCT FROM OLD."sessao_origem_id" THEN
    RAISE EXCEPTION 'CONFERENCIA_IMUTAVEL: identidade, escopo e autoria da sessão não mudam' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "sessao_conferencia_transicao"
BEFORE UPDATE OR DELETE ON "sessao_conferencia"
FOR EACH ROW EXECUTE FUNCTION "verificar_transicao_conferencia"();

-- Observação: só muda enquanto a sessão está em andamento; autoria e ordem
-- preservadas; nada é apagado (remoção é registrada na própria linha).
CREATE FUNCTION "proteger_observacao"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'OBSERVACAO_IMUTAVEL: observações não são apagadas; a remoção fica registrada' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "sessao_conferencia" s WHERE s."id" = OLD."sessao_id" AND s."situacao" = 'EM_ANDAMENTO') THEN
    RAISE EXCEPTION 'CONFERENCIA_ENCERRADA: observações de sessão concluída são preservadas' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."removida_em" IS NOT NULL THEN
    RAISE EXCEPTION 'OBSERVACAO_IMUTAVEL: linha removida não é alterada' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."sessao_id" <> OLD."sessao_id" OR NEW."escopo_id" <> OLD."escopo_id" OR NEW."ordem" <> OLD."ordem"
     OR NEW."registrado_em" <> OLD."registrado_em" OR NEW."registrado_por_id" IS DISTINCT FROM OLD."registrado_por_id"
     OR NEW."modo_entrada" <> OLD."modo_entrada" OR NEW."revisao" <> OLD."revisao" + 1 THEN
    RAISE EXCEPTION 'OBSERVACAO_IMUTAVEL: autoria, ordem e modo preservados; cada correção ou remoção avança uma revisão'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "observacao_conferencia_protegida"
BEFORE UPDATE OR DELETE ON "observacao_conferencia"
FOR EACH ROW EXECUTE FUNCTION "proteger_observacao"();

-- Histórico e eventos de estoque são imutáveis.
CREATE FUNCTION "impedir_alteracao_historico"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'HISTORICO_IMUTAVEL: % não é alterado nem apagado; correções geram novo registro vinculado', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "revisao_observacao_imutavel" BEFORE UPDATE OR DELETE ON "revisao_observacao"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();
CREATE TRIGGER "evento_estoque_imutavel" BEFORE UPDATE OR DELETE ON "evento_estoque"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();
CREATE TRIGGER "linha_evento_estoque_imutavel" BEFORE UPDATE OR DELETE ON "linha_evento_estoque"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();

-- Proteção preparada para a etapa 05: enquanto houver conferência em andamento
-- no palete, o saldo validado e a localização dele não mudam (operações
-- incompatíveis bloqueadas só naquele palete, não na praça inteira).
CREATE FUNCTION "impedir_saldo_em_conferencia"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  paletes uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    paletes := ARRAY[NEW."palete_id"];
  ELSIF TG_OP = 'DELETE' THEN
    paletes := ARRAY[OLD."palete_id"];
  ELSE
    paletes := ARRAY[OLD."palete_id", NEW."palete_id"];
  END IF;
  IF EXISTS (SELECT 1 FROM "sessao_conferencia" s WHERE s."palete_id" = ANY (paletes) AND s."ativa") THEN
    RAISE EXCEPTION 'PALETE_EM_CONFERENCIA: o saldo deste palete não muda durante uma conferência em andamento'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "saldo_estoque_sem_conferencia_ativa"
BEFORE INSERT OR UPDATE OR DELETE ON "saldo_estoque"
FOR EACH ROW EXECUTE FUNCTION "impedir_saldo_em_conferencia"();

CREATE FUNCTION "impedir_local_em_conferencia"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."posicao_id" IS DISTINCT FROM OLD."posicao_id" OR NEW."arquivado_em" IS DISTINCT FROM OLD."arquivado_em")
     AND EXISTS (SELECT 1 FROM "sessao_conferencia" s WHERE s."palete_id" = NEW."id" AND s."ativa") THEN
    RAISE EXCEPTION 'PALETE_EM_CONFERENCIA: localização e arquivamento ficam bloqueados durante uma conferência em andamento'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "palete_local_sem_conferencia_ativa"
BEFORE UPDATE OF "posicao_id", "arquivado_em" ON "palete"
FOR EACH ROW EXECUTE FUNCTION "impedir_local_em_conferencia"();
