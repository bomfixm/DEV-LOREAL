-- Reconferência exigida por decisão (21/10/2026): notas de linhas em revisão do
-- inventário de 20/10 colocadas no palete do endereço por decisão do usuário
-- ficam com "Reconferência necessária" até a reconferência completa seguinte.
-- Só acrescenta colunas vazias: nenhum palete muda de situação.
ALTER TABLE "palete" ADD COLUMN "reconferencia_exigida_em" TIMESTAMPTZ(3);
ALTER TABLE "palete" ADD COLUMN "reconferencia_exigida_motivo" TEXT;
ALTER TABLE "palete" ADD CONSTRAINT "palete_reconferencia_exigida_motivo"
  CHECK ("reconferencia_exigida_em" IS NULL OR length(btrim(coalesce("reconferencia_exigida_motivo", ''))) > 0);
