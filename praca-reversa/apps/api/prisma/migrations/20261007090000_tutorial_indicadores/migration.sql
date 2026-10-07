-- Etapa 10: retirada de palete vazio (consolidação), preferência do tutorial
-- de primeiro uso e índices das consultas por período (indicadores e relatórios).

-- Palete vazio sai da posição sem nenhuma baixa de estoque (evento de localização próprio).
ALTER TYPE "TipoEventoLocalizacao" ADD VALUE 'RETIRADA_VAZIO';

CREATE TYPE "SituacaoTutorial" AS ENUM ('NAO_INICIADO', 'ADIADO', 'INTERROMPIDO', 'CONCLUIDO');

-- Preferência por usuário: somente a situação do tutorial e o passo em que parou.
CREATE TABLE "preferencia_usuario" (
    "usuario_id" UUID NOT NULL,
    "tutorial_situacao" "SituacaoTutorial" NOT NULL DEFAULT 'NAO_INICIADO',
    "tutorial_passo" INTEGER,
    "tutorial_versao" INTEGER NOT NULL DEFAULT 1,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "preferencia_usuario_pkey" PRIMARY KEY ("usuario_id")
);

ALTER TABLE "preferencia_usuario" ADD CONSTRAINT "preferencia_usuario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- O passo só existe quando o tutorial foi interrompido, e dentro do percurso.
ALTER TABLE "preferencia_usuario" ADD CONSTRAINT "preferencia_usuario_passo_coerente"
  CHECK ((("tutorial_situacao" = 'INTERROMPIDO') = ("tutorial_passo" IS NOT NULL))
         AND ("tutorial_passo" IS NULL OR "tutorial_passo" BETWEEN 1 AND 20)
         AND "tutorial_versao" >= 1);

-- Consultas por período no escopo.
CREATE INDEX "evento_estoque_escopo_ocorrido_idx" ON "evento_estoque"("escopo_id", "ocorrido_em");
CREATE INDEX "expedicao_escopo_confirmada_idx" ON "expedicao"("escopo_id", "confirmada_em");
