-- Bloqueio de login que sobrevive a reinícios (7 nov. 2026): falhas de entrada recentes,
-- guardadas por HMAC do login e do IP (o banco não guarda o IP nem o nome digitado).
-- Migração aditiva: uma tabela nova; nenhuma tabela existente muda e não há backfill.
-- Reversão: a tabela pode ficar sem uso (o servidor antigo ignora-a).

CREATE TABLE "tentativa_login" (
    "id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tentativa_login_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tentativa_login_tipo_chave_ocorrido_em_idx" ON "tentativa_login"("tipo", "chave", "ocorrido_em");

CREATE INDEX "tentativa_login_ocorrido_em_idx" ON "tentativa_login"("ocorrido_em");
