-- Número documental composto da origem (lista de notas separadas por vírgula,
-- expressões como "43102\43101") é conservado por inteiro, sem dividir nem
-- truncar: o limite do número no vínculo documental e na informação do
-- documento passa de 64 para 200 caracteres (a chave documental "TIPO|número",
-- de 140 para 260). Só relaxa as restrições; nenhum dado muda.

ALTER TABLE "vinculo_documento_palete" DROP CONSTRAINT "vinculo_documento_palete_coerente";
ALTER TABLE "vinculo_documento_palete" ADD CONSTRAINT "vinculo_documento_palete_coerente"
  CHECK ("situacao" IN ('ATIVO', 'ENCERRADO')
         AND (("situacao" = 'ENCERRADO') = ("encerrado_em" IS NOT NULL AND "encerrado_por_id" IS NOT NULL AND "motivo_encerramento" IS NOT NULL))
         AND char_length("numero_documento") BETWEEN 1 AND 200 AND "numero_documento" = btrim("numero_documento")
         AND char_length("chave_documento") BETWEEN 2 AND 260
         AND char_length("unidade_volumes") BETWEEN 1 AND 20
         AND ("volumes" IS NULL OR "volumes" >= 0));

ALTER TABLE "informacao_documento" DROP CONSTRAINT "informacao_documento_coerente";
ALTER TABLE "informacao_documento" ADD CONSTRAINT "informacao_documento_coerente"
  CHECK ("identidade_documento" ~ '^[0-9a-f]{64}$'
         AND char_length("numero_documento") BETWEEN 1 AND 200 AND "numero_documento" = btrim("numero_documento")
         AND char_length("cidade_destino") <= 120 AND "cidade_destino" = btrim("cidade_destino") AND "cidade_destino" !~ '[[:cntrl:]]'
         AND "versao" >= 1);
