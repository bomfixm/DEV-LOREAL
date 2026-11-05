-- Palete full ou fracionado (5 nov. 2026). Migracao aditiva: uma coluna nula em palete;
-- nenhuma linha existente muda e nao ha backfill. Reversao: a coluna pode ficar sem uso.
ALTER TABLE "palete" ADD COLUMN "tipo_carga" TEXT;
