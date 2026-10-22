-- Bipagem real no palete (etapa 1, 19 out. 2026; docs/IMPORTACAO-BIPAGEM.md):
-- cada documento com volumes lidos vira um conteúdo do palete (cadastro de
-- conteúdo) com a contagem informada de origem BIPAGEM (conferência de
-- volumes). Só acrescenta: nada existente muda de valor.

-- Conteúdo: CNPJ do remetente (texto original e só dígitos, para comparar),
-- tipo como exportado (NF-e, Minuta), origem e linha do lote que o cadastrou.
ALTER TABLE "conteudo_palete"
  ADD COLUMN "cnpj_remetente" TEXT,
  ADD COLUMN "cnpj_remetente_digitos" TEXT,
  ADD COLUMN "tipo_documento_original" TEXT,
  ADD COLUMN "origem" TEXT NOT NULL DEFAULT 'REGISTRO',
  ADD COLUMN "lote_importacao_id" UUID,
  ADD COLUMN "linha_arquivo" INTEGER;

ALTER TABLE "conteudo_palete" ADD CONSTRAINT "conteudo_palete_escopo_id_lote_importacao_id_fkey" FOREIGN KEY ("escopo_id", "lote_importacao_id") REFERENCES "lote_importacao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "conteudo_palete" ADD CONSTRAINT "conteudo_palete_bipagem"
  CHECK ("origem" IN ('REGISTRO', 'BIPAGEM')
         AND ("cnpj_remetente" IS NULL OR length(btrim("cnpj_remetente")) > 0)
         AND ("cnpj_remetente_digitos" IS NULL OR "cnpj_remetente_digitos" ~ '^[0-9]{11,14}$')
         AND (("cnpj_remetente" IS NULL) = ("cnpj_remetente_digitos" IS NULL))
         AND ("tipo_documento_original" IS NULL OR length(btrim("tipo_documento_original")) > 0)
         AND ("origem" <> 'BIPAGEM'
              OR ("cnpj_remetente_digitos" IS NOT NULL AND "tipo_documento" IS NOT NULL AND "numero_documento" IS NOT NULL
                  AND "lote_importacao_id" IS NOT NULL AND "linha_arquivo" IS NOT NULL)));

-- Identidade do documento no palete: tipo + número + CNPJ (um conteúdo ativo
-- por identidade; o mesmo documento pode estar em outro palete).
CREATE UNIQUE INDEX "conteudo_palete_identidade_documento" ON "conteudo_palete"("escopo_id", "palete_id", "tipo_documento", "numero_documento", "cnpj_remetente_digitos")
  WHERE "situacao" = 'ATIVO' AND "cnpj_remetente_digitos" IS NOT NULL;

-- Contagem: origem BIPAGEM (contagem informada pelo arquivo), com o lote, a
-- linha e a identidade do documento (tipo|número|CNPJ) que a originaram.
ALTER TABLE "contagem_volumes"
  ADD COLUMN "lote_importacao_id" UUID,
  ADD COLUMN "linha_arquivo" INTEGER,
  ADD COLUMN "chave_bipagem" TEXT;

ALTER TABLE "contagem_volumes" ADD CONSTRAINT "contagem_volumes_escopo_id_lote_importacao_id_fkey" FOREIGN KEY ("escopo_id", "lote_importacao_id") REFERENCES "lote_importacao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contagem_volumes" DROP CONSTRAINT "contagem_volumes_alvo";
ALTER TABLE "contagem_volumes" ADD CONSTRAINT "contagem_volumes_alvo"
  CHECK (num_nonnulls("conteudo_id", "vinculo_id") = 1
         AND "volumes_contados" >= 0
         AND ("volumes_previstos" IS NULL OR "volumes_previstos" >= 0)
         AND "origem" IN ('CONTAGEM_FISICA', 'CONTAGEM_INFORMADA', 'BIPAGEM')
         AND (("origem" = 'BIPAGEM') = ("lote_importacao_id" IS NOT NULL AND "linha_arquivo" IS NOT NULL AND "chave_bipagem" IS NOT NULL)));

CREATE INDEX "contagem_volumes_escopo_id_palete_id_chave_bipagem_idx" ON "contagem_volumes"("escopo_id", "palete_id", "chave_bipagem") WHERE "chave_bipagem" IS NOT NULL;
CREATE INDEX "contagem_volumes_escopo_id_lote_importacao_id_idx" ON "contagem_volumes"("escopo_id", "lote_importacao_id") WHERE "lote_importacao_id" IS NOT NULL;

-- Ações das linhas da bipagem real no lote (mesma regra de coerência; acrescenta
-- NOVO, ATUALIZAR_CONTAGEM, SEM_MUDANCA, MANTER_ATUAL, USAR_ARQUIVO,
-- MESMO_DOCUMENTO, AGUARDA_DECISAO e SEM_LEITURA).
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
                                          'NOVA_PARCELA', 'EXCLUIDA_OPERADOR',
                                          'NOVO', 'ATUALIZAR_CONTAGEM', 'SEM_MUDANCA', 'MANTER_ATUAL', 'USAR_ARQUIVO', 'MESMO_DOCUMENTO',
                                          'AGUARDA_DECISAO', 'SEM_LEITURA')));
