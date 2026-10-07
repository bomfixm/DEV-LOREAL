-- Carga do inventário em lote (6 out. 2026): pacote preparado (JSON) carregado
-- por comando local com os serviços existentes. Identidade documental e chave
-- externa nos vínculos (reenvio não duplica), fotografia das indicações do
-- pacote, N° Pallet como referência externa sem significado confirmado e as
-- informações editáveis da nota (cidade destino; produto na caixa por vínculo,
-- com descrições por caixa/grupo). Estrutura gerada com `prisma migrate diff`
-- (schema anterior → atual) e acrescida à mão de CHECKs, índices parciais e
-- gatilhos.

-- AlterEnum
ALTER TYPE "FormatoArquivo" ADD VALUE 'JSON';

-- AlterTable
ALTER TABLE "linha_inventario" ADD COLUMN     "identidade_documento" TEXT;

-- AlterTable
ALTER TABLE "vinculo_documento_palete" ADD COLUMN     "chave_externa" TEXT,
ADD COLUMN     "fotografia" JSONB,
ADD COLUMN     "identidade_documento" TEXT;

-- CreateTable
CREATE TABLE "informacao_documento" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "identidade_documento" TEXT NOT NULL,
    "tipo_documento" TEXT,
    "numero_documento" TEXT NOT NULL,
    "cidade_destino" TEXT NOT NULL DEFAULT '',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "atualizado_por_id" UUID,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "informacao_documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conteudo_documento_palete" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "identidade_documento" TEXT NOT NULL,
    "produto_na_caixa" TEXT NOT NULL DEFAULT '',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "atualizado_por_id" UUID,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conteudo_documento_palete_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "descricao_caixa_documento" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "conteudo_id" UUID NOT NULL,
    "grupo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,
    "removida_em" TIMESTAMPTZ(3),
    "removida_por_id" UUID,
    "motivo_remocao" TEXT,

    CONSTRAINT "descricao_caixa_documento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "informacao_documento_escopo_id_identidade_documento_key" ON "informacao_documento"("escopo_id", "identidade_documento");

-- CreateIndex
CREATE UNIQUE INDEX "informacao_documento_escopo_id_id_key" ON "informacao_documento"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "conteudo_documento_palete_escopo_id_palete_id_identidade_do_key" ON "conteudo_documento_palete"("escopo_id", "palete_id", "identidade_documento");

-- CreateIndex
CREATE UNIQUE INDEX "conteudo_documento_palete_escopo_id_id_key" ON "conteudo_documento_palete"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "descricao_caixa_documento_escopo_id_conteudo_id_idx" ON "descricao_caixa_documento"("escopo_id", "conteudo_id");

-- CreateIndex
CREATE INDEX "linha_inventario_escopo_id_identidade_documento_idx" ON "linha_inventario"("escopo_id", "identidade_documento");

-- CreateIndex
CREATE INDEX "linha_inventario_escopo_id_palete_id_idx" ON "linha_inventario"("escopo_id", "palete_id");

-- CreateIndex
CREATE INDEX "vinculo_documento_palete_escopo_id_identidade_documento_idx" ON "vinculo_documento_palete"("escopo_id", "identidade_documento");

-- AddForeignKey
ALTER TABLE "informacao_documento" ADD CONSTRAINT "informacao_documento_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "informacao_documento" ADD CONSTRAINT "informacao_documento_atualizado_por_id_fkey" FOREIGN KEY ("atualizado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conteudo_documento_palete" ADD CONSTRAINT "conteudo_documento_palete_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conteudo_documento_palete" ADD CONSTRAINT "conteudo_documento_palete_atualizado_por_id_fkey" FOREIGN KEY ("atualizado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "descricao_caixa_documento" ADD CONSTRAINT "descricao_caixa_documento_escopo_id_conteudo_id_fkey" FOREIGN KEY ("escopo_id", "conteudo_id") REFERENCES "conteudo_documento_palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "descricao_caixa_documento" ADD CONSTRAINT "descricao_caixa_documento_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "descricao_caixa_documento" ADD CONSTRAINT "descricao_caixa_documento_removida_por_id_fkey" FOREIGN KEY ("removida_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- Acréscimos à mão ----------

-- N° Pallet: além de identificador e numeração de posição, "referência
-- externa" (significado não confirmado; nunca vira ID do palete).
ALTER TABLE "inventario_referencia" DROP CONSTRAINT "inventario_referencia_coerente";
ALTER TABLE "inventario_referencia" ADD CONSTRAINT "inventario_referencia_coerente"
  CHECK ("numero" >= 1 AND "codigo" ~ '^INV-[0-9]{6,}$'
         AND char_length("descricao") BETWEEN 3 AND 200 AND "descricao" !~ '[[:cntrl:]]'
         AND char_length("referencia_conferencia") BETWEEN 1 AND 120 AND "referencia_conferencia" !~ '[[:cntrl:]]'
         AND "origem" IN ('IMPORTADO', 'APLICACAO')
         AND ("origem" <> 'IMPORTADO' OR ("lote_importacao_id" IS NOT NULL AND "hash_arquivo" ~ '^[0-9a-f]{64}$'))
         AND "significado_numero_palete" IN ('IDENTIFICADOR_PALETE', 'NUMERACAO_POSICAO', 'REFERENCIA_EXTERNA')
         AND jsonb_typeof("convencoes") = 'object'
         AND LEAST("total_linhas", "aplicadas", "pendentes", "historicas") >= 0
         AND "versao" >= 1
         AND "conferencia_externa_situacao" IN ('NAO_REGISTRADA', 'RECONHECIDA')
         AND (("conferencia_externa_situacao" = 'RECONHECIDA')
              = ("conferencia_externa_referencia" IS NOT NULL AND "conferencia_externa_por_id" IS NOT NULL AND "conferencia_externa_em" IS NOT NULL)));

-- Identidade documental: SHA-256 em hexadecimal, só com número de documento.
ALTER TABLE "linha_inventario" ADD CONSTRAINT "linha_inventario_identidade"
  CHECK ("identidade_documento" IS NULL OR ("identidade_documento" ~ '^[0-9a-f]{64}$' AND "numero_documento" IS NOT NULL));

-- Vínculo: identidade e chave externa no formato; fotografia é objeto. A chave
-- externa ativa é única no escopo (o mesmo pacote reenviado não duplica).
ALTER TABLE "vinculo_documento_palete" ADD CONSTRAINT "vinculo_documento_palete_carga"
  CHECK (("identidade_documento" IS NULL OR "identidade_documento" ~ '^[0-9a-f]{64}$')
         AND ("chave_externa" IS NULL OR "chave_externa" ~ '^[0-9A-Za-z._:-]{8,128}$')
         AND ("fotografia" IS NULL OR jsonb_typeof("fotografia") = 'object'));

CREATE UNIQUE INDEX "vinculo_documento_palete_chave_externa_ativa_key" ON "vinculo_documento_palete"("escopo_id", "chave_externa")
  WHERE "situacao" = 'ATIVO' AND "chave_externa" IS NOT NULL;

-- Cidade destino: texto de uma linha, vazio = não informada.
ALTER TABLE "informacao_documento" ADD CONSTRAINT "informacao_documento_coerente"
  CHECK ("identidade_documento" ~ '^[0-9a-f]{64}$'
         AND char_length("numero_documento") BETWEEN 1 AND 64 AND "numero_documento" = btrim("numero_documento")
         AND char_length("cidade_destino") <= 120 AND "cidade_destino" = btrim("cidade_destino") AND "cidade_destino" !~ '[[:cntrl:]]'
         AND "versao" >= 1);

-- Produto na caixa: descrição livre de uma linha, vazio = não informado.
ALTER TABLE "conteudo_documento_palete" ADD CONSTRAINT "conteudo_documento_palete_coerente"
  CHECK ("identidade_documento" ~ '^[0-9a-f]{64}$'
         AND char_length("produto_na_caixa") <= 500 AND "produto_na_caixa" = btrim("produto_na_caixa") AND "produto_na_caixa" !~ '[[:cntrl:]]'
         AND "versao" >= 1);

-- Descrição por caixa/grupo: retirada com autoria e motivo (registro preservado).
ALTER TABLE "descricao_caixa_documento" ADD CONSTRAINT "descricao_caixa_documento_coerente"
  CHECK (char_length("grupo") BETWEEN 1 AND 60 AND "grupo" = btrim("grupo") AND "grupo" !~ '[[:cntrl:]]'
         AND char_length("descricao") BETWEEN 1 AND 300 AND "descricao" = btrim("descricao") AND "descricao" !~ '[[:cntrl:]]'
         AND (("removida_em" IS NULL) = ("removida_por_id" IS NULL))
         AND (("removida_em" IS NULL) = ("motivo_remocao" IS NULL))
         AND ("motivo_remocao" IS NULL OR char_length("motivo_remocao") BETWEEN 3 AND 300));

-- Só a retirada (uma vez) muda a descrição; nunca é apagada.
CREATE FUNCTION "proteger_descricao_caixa"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HISTORICO_IMUTAVEL: descrições de caixa não são apagadas' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."removida_em" IS NOT NULL
     OR (to_jsonb(NEW) - ARRAY['removida_em', 'removida_por_id', 'motivo_remocao'])
        <> (to_jsonb(OLD) - ARRAY['removida_em', 'removida_por_id', 'motivo_remocao']) THEN
    RAISE EXCEPTION 'HISTORICO_IMUTAVEL: a descrição de caixa só é retirada (uma vez)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "descricao_caixa_documento_protegida" BEFORE UPDATE OR DELETE ON "descricao_caixa_documento"
FOR EACH ROW EXECUTE FUNCTION "proteger_descricao_caixa"();
