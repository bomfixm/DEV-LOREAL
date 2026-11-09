-- "Separado para agenda" (9/11/2026): marca manual, por palete, de que o palete
-- roxo (nota da separação do cliente) já foi separado. Vale só para a separação
-- ativa; não reserva, não libera e não altera estoque.
CREATE TABLE "separacao_cliente_palete" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "separacao_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "marcado_por_id" UUID NOT NULL,
    "marcado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "separacao_cliente_palete_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "separacao_cliente_palete_separacao_id_palete_id_key" ON "separacao_cliente_palete"("separacao_id", "palete_id");
CREATE INDEX "separacao_cliente_palete_escopo_id_palete_id_idx" ON "separacao_cliente_palete"("escopo_id", "palete_id");

ALTER TABLE "separacao_cliente_palete" ADD CONSTRAINT "separacao_cliente_palete_separacao_id_fkey" FOREIGN KEY ("separacao_id") REFERENCES "separacao_cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
