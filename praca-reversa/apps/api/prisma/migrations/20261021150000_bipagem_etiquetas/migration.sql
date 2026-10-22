-- Importação fixa da bipagem "Etiquetas" (21/10/2026): um arquivo = um palete,
-- destino escolhido no mapa depois do envio, palete novo numerado pela série
-- do piso e a regra combinada para notas repetidas ("Revalidar" ou "Importar
-- separadamente"). Nada existente muda de valor.

-- 1. Conteúdo da bipagem: CNPJ do remetente passa a opcional (o arquivo pode
--    não trazer); "Última Leitura" guardada como foi lida (horário local da
--    bipagem, sem fuso inventado); decisão registrada quando a entrada foi
--    importada separada de outra com a mesma identidade.
ALTER TABLE "conteudo_palete"
  ADD COLUMN "ultima_leitura" TEXT,
  ADD COLUMN "decisao_bipagem" TEXT;

ALTER TABLE "conteudo_palete" DROP CONSTRAINT "conteudo_palete_bipagem";
ALTER TABLE "conteudo_palete" ADD CONSTRAINT "conteudo_palete_bipagem"
  CHECK ("origem" IN ('REGISTRO', 'BIPAGEM')
         AND ("cnpj_remetente" IS NULL OR length(btrim("cnpj_remetente")) > 0)
         AND ("cnpj_remetente_digitos" IS NULL OR "cnpj_remetente_digitos" ~ '^[0-9]{11,14}$')
         AND ("cnpj_remetente" IS NOT NULL OR "cnpj_remetente_digitos" IS NULL)
         AND ("tipo_documento_original" IS NULL OR length(btrim("tipo_documento_original")) > 0)
         AND ("ultima_leitura" IS NULL OR "ultima_leitura" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2})?)?$')
         AND ("decisao_bipagem" IS NULL OR ("origem" = 'BIPAGEM' AND "decisao_bipagem" = 'IMPORTAR_SEPARADO'))
         AND ("origem" <> 'BIPAGEM'
              OR ("tipo_documento" IS NOT NULL AND "numero_documento" IS NOT NULL
                  AND "lote_importacao_id" IS NOT NULL AND "linha_arquivo" IS NOT NULL)));

-- 2. A identidade (tipo + número + CNPJ + remetente) deixa de ser única no
--    palete: o usuário autorizou ocorrências distintas da mesma identidade
--    ("Importar separadamente"). Fica um índice comum para a comparação.
DROP INDEX "conteudo_palete_identidade_documento";
CREATE INDEX "conteudo_palete_identidade_documento_idx" ON "conteudo_palete"("escopo_id", "palete_id", "tipo_documento", "numero_documento")
  WHERE "situacao" = 'ATIVO';

-- 3. Lote da bipagem: o destino é escolhido no mapa depois do envio. O palete
--    do lote fica vazio até a confirmação e é gravado nela (de vazio para o
--    palete, uma vez); as demais regras de imutabilidade continuam.
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
     OR (NEW."palete_id" IS DISTINCT FROM OLD."palete_id"
         AND NOT (OLD."palete_id" IS NULL AND NEW."tipo"::text = 'BIPAGEM' AND NEW."situacao"::text = 'CONFIRMADO')) THEN
    RAISE EXCEPTION 'IMPORTACAO_IMUTAVEL: arquivo, tipo, palete de destino e autoria do lote não mudam' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."versao_previa" < OLD."versao_previa" OR NEW."versao" < OLD."versao"
     OR (NEW."situacao"::text = 'AGUARDANDO_MAPEAMENTO' AND OLD."situacao"::text <> 'AGUARDANDO_MAPEAMENTO') THEN
    RAISE EXCEPTION 'IMPORTACAO_IMUTAVEL: a prévia e a versão do lote só avançam' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 4. O mesmo arquivo da bipagem pode ser importado de novo quando a pessoa
--    confirma que é uma nova operação (aviso com a importação anterior na
--    prévia). Os demais tipos continuam uma confirmação por arquivo.
DROP INDEX "lote_importacao_arquivo_confirmado_key";
CREATE UNIQUE INDEX "lote_importacao_arquivo_confirmado_key"
  ON "lote_importacao"("escopo_id", "tipo", "hash_arquivo", COALESCE("palete_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "situacao" = 'CONFIRMADO' AND "tipo" <> 'BIPAGEM';

-- 5. Ações das linhas da bipagem: REVALIDAR (linha ignorada, rastreável) e
--    IMPORTAR_SEPARADO (nova entrada da mesma identidade).
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
                                          'AGUARDA_DECISAO', 'SEM_LEITURA', 'REVALIDAR', 'IMPORTAR_SEPARADO')));

-- 6. Número operacional do palete novo (série física do piso, sem prefixo):
--    próximo número e faixas reservadas por escopo. A linha fica bloqueada na
--    geração (cadastros simultâneos recebem números diferentes); números já
--    usados por palete ou pela planilha são pulados e nunca reutilizados.
CREATE TABLE "numeracao_palete" (
  "escopo_id" UUID NOT NULL,
  "proximo" INTEGER NOT NULL,
  "reservados" JSONB NOT NULL DEFAULT '[]',
  "origem" TEXT NOT NULL,
  "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
  "atualizado_por_id" UUID,
  CONSTRAINT "numeracao_palete_pkey" PRIMARY KEY ("escopo_id"),
  CONSTRAINT "numeracao_palete_coerente" CHECK ("proximo" >= 1 AND jsonb_typeof("reservados") = 'array' AND length(btrim("origem")) > 0)
);
ALTER TABLE "numeracao_palete" ADD CONSTRAINT "numeracao_palete_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "numeracao_palete" ADD CONSTRAINT "numeracao_palete_atualizado_por_id_fkey" FOREIGN KEY ("atualizado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. Coerência do lote: na bipagem o palete pode ficar vazio até a confirmação
--    (destino escolhido no mapa); confirmada, o palete é obrigatório. Os demais
--    tipos continuam sem palete.
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
         AND ("palete_id" IS NULL OR "tipo"::text = 'BIPAGEM')
         AND ("tipo"::text <> 'BIPAGEM' OR "situacao" <> 'CONFIRMADO' OR "palete_id" IS NOT NULL)
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
