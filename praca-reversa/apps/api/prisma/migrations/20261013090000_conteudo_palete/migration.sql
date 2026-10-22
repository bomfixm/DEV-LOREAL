-- Cadastro de conteúdo e conferência de volumes (out. 2026). O conteúdo
-- recebido no palete é identificado pelo remetente e, quando disponíveis, pela
-- nota (NF, NFD ou MI) e pelo Delivery — ambos podem ficar vazios. Sem SKU,
-- unidade, código de barras ou produto artificial. Volumes ficam na contagem,
-- separada do cadastro (sem contagem = aguardando conferência, nunca zero).
-- Migração aditiva: nenhum dado existente é alterado.

-- CreateTable
CREATE TABLE "conteudo_palete" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "remetente" TEXT NOT NULL,
    "tipo_documento" TEXT,
    "numero_documento" TEXT,
    "delivery" TEXT,
    "descricao" TEXT,
    "situacao" TEXT NOT NULL DEFAULT 'ATIVO',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,
    "atualizado_por_id" UUID,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conteudo_palete_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contagem_volumes" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "conteudo_id" UUID,
    "vinculo_id" UUID,
    "volumes_contados" INTEGER NOT NULL,
    "volumes_previstos" INTEGER,
    "origem" TEXT NOT NULL,
    "referencia" TEXT,
    "registrada_por_id" UUID NOT NULL,
    "registrada_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contagem_volumes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conteudo_palete_escopo_id_palete_id_idx" ON "conteudo_palete"("escopo_id", "palete_id");

-- CreateIndex
CREATE INDEX "conteudo_palete_escopo_id_numero_documento_idx" ON "conteudo_palete"("escopo_id", "numero_documento");

-- CreateIndex
CREATE INDEX "conteudo_palete_escopo_id_delivery_idx" ON "conteudo_palete"("escopo_id", "delivery");

-- CreateIndex
CREATE UNIQUE INDEX "conteudo_palete_escopo_id_id_key" ON "conteudo_palete"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "contagem_volumes_escopo_id_palete_id_idx" ON "contagem_volumes"("escopo_id", "palete_id");

-- CreateIndex
CREATE INDEX "contagem_volumes_escopo_id_conteudo_id_registrada_em_idx" ON "contagem_volumes"("escopo_id", "conteudo_id", "registrada_em");

-- CreateIndex
CREATE INDEX "contagem_volumes_escopo_id_vinculo_id_registrada_em_idx" ON "contagem_volumes"("escopo_id", "vinculo_id", "registrada_em");

-- AddForeignKey
ALTER TABLE "conteudo_palete" ADD CONSTRAINT "conteudo_palete_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conteudo_palete" ADD CONSTRAINT "conteudo_palete_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conteudo_palete" ADD CONSTRAINT "conteudo_palete_atualizado_por_id_fkey" FOREIGN KEY ("atualizado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contagem_volumes" ADD CONSTRAINT "contagem_volumes_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contagem_volumes" ADD CONSTRAINT "contagem_volumes_escopo_id_conteudo_id_fkey" FOREIGN KEY ("escopo_id", "conteudo_id") REFERENCES "conteudo_palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contagem_volumes" ADD CONSTRAINT "contagem_volumes_escopo_id_vinculo_id_fkey" FOREIGN KEY ("escopo_id", "vinculo_id") REFERENCES "vinculo_documento_palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contagem_volumes" ADD CONSTRAINT "contagem_volumes_registrada_por_id_fkey" FOREIGN KEY ("registrada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Acréscimos à mão ----------

-- Remetente obrigatório; demais referências opcionais, mas nunca texto vazio
-- (vazio = NULL = não informado). Tipo só NF, NFD ou MI.
ALTER TABLE "conteudo_palete" ADD CONSTRAINT "conteudo_palete_campos"
  CHECK (length(btrim("remetente")) > 0
         AND ("tipo_documento" IS NULL OR "tipo_documento" IN ('NF', 'NFD', 'MI'))
         AND ("numero_documento" IS NULL OR length(btrim("numero_documento")) > 0)
         AND ("delivery" IS NULL OR length(btrim("delivery")) > 0)
         AND ("descricao" IS NULL OR length(btrim("descricao")) > 0)
         AND "situacao" IN ('ATIVO', 'ENCERRADO')
         AND "versao" > 0);

-- Uma contagem é de exatamente um alvo (conteúdo registrado ou vínculo importado).
ALTER TABLE "contagem_volumes" ADD CONSTRAINT "contagem_volumes_alvo"
  CHECK (num_nonnulls("conteudo_id", "vinculo_id") = 1
         AND "volumes_contados" >= 0
         AND ("volumes_previstos" IS NULL OR "volumes_previstos" >= 0)
         AND "origem" IN ('CONTAGEM_FISICA', 'CONTAGEM_INFORMADA'));

-- Contagem só se acrescenta: correção = nova contagem (a anterior fica no histórico).
CREATE FUNCTION "contagem_volumes_imutavel"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Contagem de volumes não é alterada nem apagada: registre uma nova contagem.';
END;
$$;

CREATE TRIGGER "contagem_volumes_sem_alteracao" BEFORE UPDATE OR DELETE ON "contagem_volumes"
FOR EACH ROW EXECUTE FUNCTION "contagem_volumes_imutavel"();
