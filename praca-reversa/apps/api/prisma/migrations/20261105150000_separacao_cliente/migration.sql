-- Separação do cliente (5 nov. 2026): planilha enviada pelo cliente e suas notas.
-- Migração aditiva: duas tabelas novas; nenhuma tabela existente muda e não há
-- backfill. Reversão: as tabelas podem ficar sem uso (o código anterior não as lê).

CREATE TABLE "separacao_cliente" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "nome_arquivo" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "janela" TEXT,
    "cabecalhos" JSONB NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'ATIVA',
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,
    "encerrado_por_id" UUID,
    "encerrado_em" TIMESTAMPTZ(3),

    CONSTRAINT "separacao_cliente_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "separacao_cliente_nota" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "separacao_id" UUID NOT NULL,
    "linha_arquivo" INTEGER NOT NULL,
    "numero_documento" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "tipo_documento" TEXT,
    "delivery" TEXT,
    "volumes" TEXT,
    "remetente" TEXT,
    "palete_informado" TEXT,
    "endereco_informado" TEXT,
    "valores" JSONB NOT NULL,

    CONSTRAINT "separacao_cliente_nota_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "separacao_cliente_escopo_id_situacao_idx" ON "separacao_cliente"("escopo_id", "situacao");
CREATE UNIQUE INDEX "separacao_cliente_nota_separacao_id_linha_arquivo_key" ON "separacao_cliente_nota"("separacao_id", "linha_arquivo");
CREATE INDEX "separacao_cliente_nota_escopo_id_chave_idx" ON "separacao_cliente_nota"("escopo_id", "chave");

ALTER TABLE "separacao_cliente" ADD CONSTRAINT "separacao_cliente_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "separacao_cliente" ADD CONSTRAINT "separacao_cliente_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "separacao_cliente" ADD CONSTRAINT "separacao_cliente_encerrado_por_id_fkey" FOREIGN KEY ("encerrado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "separacao_cliente_nota" ADD CONSTRAINT "separacao_cliente_nota_separacao_id_fkey" FOREIGN KEY ("separacao_id") REFERENCES "separacao_cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
