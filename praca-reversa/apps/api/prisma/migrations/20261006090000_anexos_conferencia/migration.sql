-- CreateTable
CREATE TABLE "anexo_conferencia" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "conferencia_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo_conteudo" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "conteudo" BYTEA NOT NULL,
    "enviado_por_id" UUID NOT NULL,
    "enviado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "anexo_conferencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "anexo_conferencia_escopo_id_id_key" ON "anexo_conferencia"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "anexo_conferencia_conferencia_id_sha256_key" ON "anexo_conferencia"("conferencia_id", "sha256");

-- AddForeignKey
ALTER TABLE "anexo_conferencia" ADD CONSTRAINT "anexo_conferencia_escopo_id_conferencia_id_fkey" FOREIGN KEY ("escopo_id", "conferencia_id") REFERENCES "sessao_conferencia"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo_conferencia" ADD CONSTRAINT "anexo_conferencia_enviado_por_id_fkey" FOREIGN KEY ("enviado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Regras (etapa 09) ----------

-- Conteúdo, tamanho e hash coerentes: o SHA-256 gravado é o do próprio conteúdo
-- (integridade em repouso, conferida também no backup/restauração).
ALTER TABLE "anexo_conferencia" ADD CONSTRAINT "anexo_conferencia_coerente"
  CHECK ("tamanho" > 0 AND "tamanho" = octet_length("conteudo")
         AND "sha256" ~ '^[0-9a-f]{64}$' AND "sha256" = encode(sha256("conteudo"), 'hex')
         AND "tipo_conteudo" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
         AND texto_curto_valido("nome", 200) AND "nome" !~ '[[:cntrl:]/\\]');

-- Evidência imutável: não é alterada nem apagada.
CREATE TRIGGER "anexo_conferencia_imutavel" BEFORE UPDATE OR DELETE ON "anexo_conferencia"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();
