-- Verificação em duas etapas (7 nov. 2026): uma tabela nova, 1:1 com usuario.
-- Migração aditiva; nenhuma tabela existente muda e não há backfill (ninguém tem 2º fator até ativar).
-- Reversão: a tabela pode ficar sem uso (o servidor antigo ignora-a).

CREATE TABLE "segundo_fator" (
    "usuario_id" UUID NOT NULL,
    "segredo_cifrado" TEXT NOT NULL,
    "ativado_em" TIMESTAMPTZ(3),
    "ultimo_passo" INTEGER,
    "codigos_recuperacao" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "segundo_fator_pkey" PRIMARY KEY ("usuario_id")
);

ALTER TABLE "segundo_fator" ADD CONSTRAINT "segundo_fator_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
