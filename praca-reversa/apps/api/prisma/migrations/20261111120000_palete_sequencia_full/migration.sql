-- Posicao do palete full na carga, ex. "2/7" (11 nov. 2026). Migracao aditiva: uma coluna nula em palete;
-- nenhuma linha existente muda e nao ha backfill. Reversao: a coluna pode ficar sem uso.
ALTER TABLE "palete" ADD COLUMN "sequencia_full" TEXT;
