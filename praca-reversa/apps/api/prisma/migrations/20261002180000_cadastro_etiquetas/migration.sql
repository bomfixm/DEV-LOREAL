-- Etapa 03: cadastro de produtos e paletes, configuração do layout e etiquetas.
-- Gerada com `prisma migrate diff` e ajustada à mão para preservar dados
-- existentes (preenchimento antes de NOT NULL) e acrescentar CHECKs e gatilhos
-- que o Prisma não modela.

-- CreateEnum
CREATE TYPE "TipoOrigemDocumento" AS ENUM ('DEVOLUCAO', 'NOTA_FISCAL', 'MANIFESTO', 'OUTRO');

-- CreateEnum
CREATE TYPE "OrigemCodigoPalete" AS ENUM ('EXISTENTE', 'GERADO', 'DEMONSTRACAO');

-- Linhas declaradas: origem documental por linha, produto e condição opcionais.
ALTER TABLE "item_declarado"
ADD COLUMN     "origem_referencia" TEXT,
ADD COLUMN     "origem_tipo" "TipoOrigemDocumento",
ADD COLUMN     "produto_id" UUID,
ADD COLUMN     "registrado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "registrado_por_id" UUID,
ALTER COLUMN "sku" DROP NOT NULL,
ALTER COLUMN "condicao" DROP NOT NULL;

-- A referência de devolução existente passa a ser origem do tipo DEVOLUCAO.
UPDATE "item_declarado"
SET "origem_tipo" = 'DEVOLUCAO', "origem_referencia" = "referencia_devolucao"
WHERE "referencia_devolucao" IS NOT NULL;

ALTER TABLE "item_declarado" DROP COLUMN "referencia_devolucao";

-- AlterTable
ALTER TABLE "layout" ADD COLUMN     "parametros" JSONB,
ADD COLUMN     "revisao" INTEGER NOT NULL DEFAULT 1;

-- Paletes: chave de código, origem do código, observações, autoria e arquivamento.
ALTER TABLE "palete" ADD COLUMN     "arquivado_em" TIMESTAMPTZ(3),
ADD COLUMN     "arquivado_por_id" UUID,
ADD COLUMN     "codigo_busca" TEXT,
ADD COLUMN     "criado_por_id" UUID,
ADD COLUMN     "motivo_arquivamento" TEXT,
ADD COLUMN     "observacoes" TEXT,
ADD COLUMN     "origem_codigo" "OrigemCodigoPalete";

-- Registros anteriores vêm todos da carga de demonstração.
UPDATE "palete"
SET "codigo" = upper(btrim("codigo")),
    "codigo_busca" = regexp_replace(upper("codigo"), '[^A-Z0-9]', '', 'g'),
    "origem_codigo" = 'DEMONSTRACAO';

ALTER TABLE "palete" ALTER COLUMN "codigo_busca" SET NOT NULL,
ALTER COLUMN "origem_codigo" SET NOT NULL;

-- DropIndex (substituído pelo índice único abaixo)
DROP INDEX "palete_escopo_id_posicao_id_idx";

-- AlterTable
ALTER TABLE "posicao" ADD COLUMN     "motivo_indisponibilidade" TEXT,
ADD COLUMN     "motivo_retirada" TEXT,
ADD COLUMN     "retirada_em" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "produto" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "unidade_canonica" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criado_por_id" UUID,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "produto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "codigo_barras" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "produto_id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "embalagem" TEXT NOT NULL,
    "fator_conversao" DECIMAL(18,3) NOT NULL,
    "registrado_por_id" UUID,
    "registrado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigo_barras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sequencia_palete" (
    "escopo_id" UUID NOT NULL,
    "prefixo" TEXT NOT NULL,
    "digitos" INTEGER NOT NULL,
    "proximo" INTEGER NOT NULL,

    CONSTRAINT "sequencia_palete_pkey" PRIMARY KEY ("escopo_id")
);

-- CreateTable
CREATE TABLE "historico_layout" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "layout_id" UUID NOT NULL,
    "revisao" INTEGER NOT NULL,
    "acao" TEXT NOT NULL,
    "alvo_tipo" TEXT NOT NULL,
    "alvo_id" TEXT,
    "resumo" TEXT NOT NULL,
    "antes" JSONB,
    "depois" JSONB,
    "autor_id" UUID,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historico_layout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "produto_escopo_id_sku_key" ON "produto"("escopo_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "produto_escopo_id_id_key" ON "produto"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "codigo_barras_escopo_id_codigo_key" ON "codigo_barras"("escopo_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "historico_layout_layout_id_revisao_key" ON "historico_layout"("layout_id", "revisao");

-- CreateIndex
CREATE INDEX "item_declarado_escopo_id_produto_id_idx" ON "item_declarado"("escopo_id", "produto_id");

-- CreateIndex
CREATE UNIQUE INDEX "palete_escopo_id_codigo_busca_key" ON "palete"("escopo_id", "codigo_busca");

-- Posição individual: no máximo um palete por posição (NULL não conflita).
CREATE UNIQUE INDEX "palete_escopo_id_posicao_id_key" ON "palete"("escopo_id", "posicao_id");

-- AddForeignKey
ALTER TABLE "palete" ADD CONSTRAINT "palete_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "palete" ADD CONSTRAINT "palete_arquivado_por_id_fkey" FOREIGN KEY ("arquivado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_declarado" ADD CONSTRAINT "item_declarado_escopo_id_produto_id_fkey" FOREIGN KEY ("escopo_id", "produto_id") REFERENCES "produto"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_declarado" ADD CONSTRAINT "item_declarado_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto" ADD CONSTRAINT "produto_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto" ADD CONSTRAINT "produto_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codigo_barras" ADD CONSTRAINT "codigo_barras_escopo_id_produto_id_fkey" FOREIGN KEY ("escopo_id", "produto_id") REFERENCES "produto"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codigo_barras" ADD CONSTRAINT "codigo_barras_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequencia_palete" ADD CONSTRAINT "sequencia_palete_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_layout" ADD CONSTRAINT "historico_layout_escopo_id_layout_id_fkey" FOREIGN KEY ("escopo_id", "layout_id") REFERENCES "layout"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historico_layout" ADD CONSTRAINT "historico_layout_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Restrições adicionadas manualmente (o Prisma não modela CHECK nem gatilhos).

-- Código do palete em maiúsculas, formato restrito; chave sem separadores coerente.
ALTER TABLE "palete" ADD CONSTRAINT "palete_codigo_formato" CHECK ("codigo" ~ '^[A-Z0-9][A-Z0-9._/-]{0,39}$');
ALTER TABLE "palete" ADD CONSTRAINT "palete_codigo_busca_coerente"
  CHECK ("codigo_busca" = regexp_replace("codigo", '[^A-Z0-9]', '', 'g') AND "codigo_busca" <> '');
-- Palete arquivado não ocupa posição e sai do fluxo de estoque.
ALTER TABLE "palete" ADD CONSTRAINT "palete_arquivado_sem_posicao"
  CHECK ("arquivado_em" IS NULL OR ("posicao_id" IS NULL AND "estado_fluxo" = 'VAZIO_ARQUIVADO' AND "motivo_arquivamento" IS NOT NULL));
ALTER TABLE "palete" ADD CONSTRAINT "palete_observacoes_tamanho" CHECK ("observacoes" IS NULL OR char_length("observacoes") BETWEEN 1 AND 500);

-- Código da posição em maiúsculas; posição indisponível tem motivo quando alterada pela configuração.
ALTER TABLE "posicao" ADD CONSTRAINT "posicao_codigo_formato" CHECK ("codigo" ~ '^[A-Z0-9][A-Z0-9._/-]{0,31}$');
ALTER TABLE "posicao" ADD CONSTRAINT "posicao_retirada_com_motivo" CHECK ("retirada_em" IS NULL OR "motivo_retirada" IS NOT NULL);
ALTER TABLE "layout" ADD CONSTRAINT "layout_revisao_positiva" CHECK ("revisao" >= 1);
ALTER TABLE "historico_layout" ADD CONSTRAINT "historico_layout_revisao" CHECK ("revisao" >= 2);

-- Produto: SKU textual sem espaços nas pontas; unidades em maiúsculas.
ALTER TABLE "produto" ADD CONSTRAINT "produto_sku_formato" CHECK ("sku" = btrim("sku") AND char_length("sku") BETWEEN 1 AND 64);
ALTER TABLE "produto" ADD CONSTRAINT "produto_unidade_formato" CHECK ("unidade_canonica" ~ '^[A-Z0-9]{1,10}$');
ALTER TABLE "codigo_barras" ADD CONSTRAINT "codigo_barras_formato" CHECK ("codigo" ~ '^[!-~]{1,64}$');
ALTER TABLE "codigo_barras" ADD CONSTRAINT "codigo_barras_embalagem_formato" CHECK ("embalagem" ~ '^[A-Z0-9]{1,10}$');
ALTER TABLE "codigo_barras" ADD CONSTRAINT "codigo_barras_fator_positivo" CHECK ("fator_conversao" > 0);

-- Linha declarada: produto vinculado guarda o SKU; referência exige tipo de documento.
ALTER TABLE "item_declarado" ADD CONSTRAINT "item_declarado_produto_com_sku" CHECK ("produto_id" IS NULL OR "sku" IS NOT NULL);
ALTER TABLE "item_declarado" ADD CONSTRAINT "item_declarado_origem_coerente" CHECK ("origem_referencia" IS NULL OR "origem_tipo" IS NOT NULL);

-- Sequência de códigos internos.
ALTER TABLE "sequencia_palete" ADD CONSTRAINT "sequencia_palete_valores" CHECK ("proximo" >= 1 AND "digitos" BETWEEN 1 AND 12 AND "prefixo" ~ '^[A-Z0-9][A-Z0-9._/-]{0,19}$');

-- Gatilho 1: um palete só é vinculado a posição disponível, não retirada, de
-- layout ativo e do mesmo escopo. FOR SHARE serializa com a alteração da posição.
CREATE FUNCTION "verificar_posicao_do_palete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."posicao_id" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."posicao_id" IS DISTINCT FROM OLD."posicao_id") THEN
    PERFORM 1
      FROM "posicao" p
      JOIN "layout" l ON l."id" = p."layout_id"
     WHERE p."id" = NEW."posicao_id"
       AND p."escopo_id" = NEW."escopo_id"
       AND p."disponivel"
       AND p."retirada_em" IS NULL
       AND l."ativo"
       FOR SHARE OF p;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'POSICAO_INVALIDA: posição indisponível, retirada ou fora do layout ativo do escopo'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "palete_posicao_valida"
BEFORE INSERT OR UPDATE OF "posicao_id" ON "palete"
FOR EACH ROW EXECUTE FUNCTION "verificar_posicao_do_palete"();

-- Gatilho 2: posição com palete não fica indisponível nem é retirada.
CREATE FUNCTION "impedir_posicao_ocupada_indisponivel"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NOT NEW."disponivel" OR NEW."retirada_em" IS NOT NULL)
     AND EXISTS (SELECT 1 FROM "palete" WHERE "posicao_id" = NEW."id") THEN
    RAISE EXCEPTION 'POSICAO_OCUPADA: posição com palete não pode ficar indisponível nem ser retirada'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "posicao_ocupada_disponivel"
BEFORE UPDATE OF "disponivel", "retirada_em" ON "posicao"
FOR EACH ROW EXECUTE FUNCTION "impedir_posicao_ocupada_indisponivel"();
