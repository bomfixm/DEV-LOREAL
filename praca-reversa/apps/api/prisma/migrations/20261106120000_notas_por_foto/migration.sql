-- Notas por foto (6 nov. 2026): rascunhos de nota e suas fotos, separados do estoque
-- até a inclusão confirmada. Migração aditiva: duas tabelas novas; nenhuma tabela
-- existente muda e não há backfill. Reversão: as tabelas podem ficar sem uso.

CREATE TABLE "nota_foto" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'RASCUNHO',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "tipo_documento" TEXT,
    "numero_documento" TEXT,
    "remetente" TEXT,
    "tipo_etiqueta" TEXT,
    "referencia_etiqueta" TEXT,
    "delivery" TEXT,
    "volumes" INTEGER,
    "decisao" TEXT,
    "campos_editados" JSONB NOT NULL DEFAULT '[]',
    "leitura_situacao" TEXT NOT NULL DEFAULT 'PENDENTE',
    "leitura_texto" TEXT,
    "leitura_numero_bruto" TEXT,
    "leitura_candidatos" JSONB NOT NULL DEFAULT '[]',
    "conteudo_id" UUID,
    "vinculo_id" UUID,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,
    "atualizado_por_id" UUID,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "nota_foto_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "nota_foto_volumes_check" CHECK ("volumes" IS NULL OR "volumes" >= 0)
);

CREATE TABLE "foto_nota" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "nota_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo_conteudo" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "conteudo" BYTEA NOT NULL,
    "enviado_por_id" UUID NOT NULL,
    "enviado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "foto_nota_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "nota_foto_escopo_id_palete_id_situacao_idx" ON "nota_foto"("escopo_id", "palete_id", "situacao");
CREATE INDEX "foto_nota_nota_id_idx" ON "foto_nota"("nota_id");
CREATE INDEX "foto_nota_escopo_id_palete_id_sha256_idx" ON "foto_nota"("escopo_id", "palete_id", "sha256");

ALTER TABLE "nota_foto" ADD CONSTRAINT "nota_foto_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nota_foto" ADD CONSTRAINT "nota_foto_palete_id_fkey" FOREIGN KEY ("palete_id") REFERENCES "palete"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nota_foto" ADD CONSTRAINT "nota_foto_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nota_foto" ADD CONSTRAINT "nota_foto_atualizado_por_id_fkey" FOREIGN KEY ("atualizado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "foto_nota" ADD CONSTRAINT "foto_nota_nota_id_fkey" FOREIGN KEY ("nota_id") REFERENCES "nota_foto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "foto_nota" ADD CONSTRAINT "foto_nota_enviado_por_id_fkey" FOREIGN KEY ("enviado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
