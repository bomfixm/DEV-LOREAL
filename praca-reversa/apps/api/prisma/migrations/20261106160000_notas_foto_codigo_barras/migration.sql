-- Notas por foto: marca quando o identificador veio do código de barras (exato).
-- Migração aditiva: uma coluna com valor padrão; nenhuma linha existente muda de sentido.
ALTER TABLE "nota_foto" ADD COLUMN "leitura_codigo_barras" BOOLEAN NOT NULL DEFAULT false;
