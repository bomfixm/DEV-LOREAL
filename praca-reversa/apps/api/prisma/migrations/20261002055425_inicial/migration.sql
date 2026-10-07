-- CreateEnum
CREATE TYPE "Perfil" AS ENUM ('CONSULTA', 'OPERADOR', 'SUPERVISOR_ESTOQUE', 'ANALISTA_CLAIMS', 'ADMINISTRADOR');

-- CreateEnum
CREATE TYPE "EstadoConferencia" AS ENUM ('NAO_CONFERIDO', 'PARCIAL', 'AGUARDANDO_VALIDACAO', 'RECONCILIADO');

-- CreateEnum
CREATE TYPE "EstadoLiberacao" AS ENUM ('PENDENTE', 'BLOQUEADO', 'LIBERADO');

-- CreateEnum
CREATE TYPE "EstadoFluxo" AS ENUM ('EM_ESTOQUE', 'RESERVADO', 'EXPEDIDO', 'VAZIO_ARQUIVADO');

-- CreateEnum
CREATE TYPE "CondicaoMaterial" AS ENUM ('SAUDAVEL', 'AVARIADO', 'EM_AVALIACAO');

-- CreateEnum
CREATE TYPE "TipoElemento" AS ENUM ('ZONA', 'BLOCO', 'CORREDOR', 'DOCA');

-- CreateEnum
CREATE TYPE "ResultadoAuditoria" AS ENUM ('SUCESSO', 'NEGADO', 'FALHA');

-- CreateTable
CREATE TABLE "unidade" (
    "id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "fuso" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "demonstracao" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cliente" (
    "id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "demonstracao" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escopo" (
    "id" UUID NOT NULL,
    "unidade_id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "demonstracao" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escopo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuario" (
    "id" UUID NOT NULL,
    "login" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    "desativado_em" TIMESTAMPTZ(3),

    CONSTRAINT "usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vinculo" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "perfil" "Perfil" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vinculo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessao" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "usuario_id" UUID NOT NULL,
    "escopo_ativo_id" UUID,
    "criada_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_uso_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_em" TIMESTAMPTZ(3) NOT NULL,
    "revogada_em" TIMESTAMPTZ(3),
    "motivo_revogacao" TEXT,

    CONSTRAINT "sessao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_auditoria" (
    "id" UUID NOT NULL,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acao" TEXT NOT NULL,
    "resultado" "ResultadoAuditoria" NOT NULL,
    "ator_usuario_id" UUID,
    "escopo_id" UUID,
    "alvo_tipo" TEXT,
    "alvo_id" TEXT,
    "detalhes" JSONB,
    "request_id" TEXT,

    CONSTRAINT "evento_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_idempotencia" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "operacao" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "status_http" INTEGER NOT NULL,
    "resposta" JSONB NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_idempotencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "layout" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "versao" TEXT NOT NULL,
    "largura" INTEGER NOT NULL,
    "altura" INTEGER NOT NULL,
    "capacidade_total" INTEGER,
    "esquematico" BOOLEAN NOT NULL DEFAULT true,
    "ficticio" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "observacao" TEXT,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "layout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "elemento_layout" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "layout_id" UUID NOT NULL,
    "tipo" "TipoElemento" NOT NULL,
    "codigo" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "ficticio" BOOLEAN NOT NULL DEFAULT false,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "largura" INTEGER NOT NULL,
    "altura" INTEGER NOT NULL,
    "rotulo_x" INTEGER,
    "rotulo_y" INTEGER,
    "rotulo_largura" INTEGER,
    "rotulo_altura" INTEGER,

    CONSTRAINT "elemento_layout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fileira" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "layout_id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "bloco_codigo" TEXT,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "largura" INTEGER NOT NULL,
    "altura" INTEGER NOT NULL,
    "rotulo_x" INTEGER NOT NULL,
    "rotulo_y" INTEGER NOT NULL,
    "rotulo_largura" INTEGER NOT NULL,
    "rotulo_altura" INTEGER NOT NULL,

    CONSTRAINT "fileira_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posicao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "layout_id" UUID NOT NULL,
    "fileira_id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "codigo_provisorio" BOOLEAN NOT NULL DEFAULT true,
    "numero" INTEGER NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "largura" INTEGER NOT NULL,
    "altura" INTEGER NOT NULL,
    "disponivel" BOOLEAN NOT NULL DEFAULT true,
    "ocupacao_levantada" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "posicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "palete" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "posicao_id" UUID,
    "estado_conferencia" "EstadoConferencia" NOT NULL,
    "estado_liberacao" "EstadoLiberacao" NOT NULL,
    "estado_fluxo" "EstadoFluxo" NOT NULL,
    "motivo_pendencia" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "palete_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_declarado" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "ordem" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "lote" TEXT,
    "codigo_barras" TEXT,
    "referencia_devolucao" TEXT,
    "quantidade" DECIMAL(18,3) NOT NULL,
    "unidade_medida" TEXT NOT NULL,
    "condicao" "CondicaoMaterial" NOT NULL,

    CONSTRAINT "item_declarado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_observado" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "ordem" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "lote" TEXT,
    "codigo_barras" TEXT,
    "referencia_devolucao" TEXT,
    "quantidade" DECIMAL(18,3) NOT NULL,
    "unidade_medida" TEXT NOT NULL,
    "condicao" "CondicaoMaterial" NOT NULL,

    CONSTRAINT "item_observado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_saldo" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "ordem" INTEGER NOT NULL,
    "sku" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "lote" TEXT,
    "codigo_barras" TEXT,
    "referencia_devolucao" TEXT,
    "quantidade" DECIMAL(18,3) NOT NULL,
    "unidade_medida" TEXT NOT NULL,
    "condicao" "CondicaoMaterial" NOT NULL,

    CONSTRAINT "item_saldo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unidade_codigo_key" ON "unidade"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "cliente_codigo_key" ON "cliente"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "escopo_unidade_id_cliente_id_key" ON "escopo"("unidade_id", "cliente_id");

-- CreateIndex
CREATE UNIQUE INDEX "usuario_login_key" ON "usuario"("login");

-- CreateIndex
CREATE INDEX "vinculo_escopo_id_idx" ON "vinculo"("escopo_id");

-- CreateIndex
CREATE UNIQUE INDEX "vinculo_usuario_id_escopo_id_key" ON "vinculo"("usuario_id", "escopo_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessao_token_hash_key" ON "sessao"("token_hash");

-- CreateIndex
CREATE INDEX "sessao_usuario_id_idx" ON "sessao"("usuario_id");

-- CreateIndex
CREATE INDEX "evento_auditoria_escopo_id_ocorrido_em_idx" ON "evento_auditoria"("escopo_id", "ocorrido_em");

-- CreateIndex
CREATE INDEX "evento_auditoria_ator_usuario_id_ocorrido_em_idx" ON "evento_auditoria"("ator_usuario_id", "ocorrido_em");

-- CreateIndex
CREATE UNIQUE INDEX "registro_idempotencia_escopo_id_usuario_id_operacao_chave_key" ON "registro_idempotencia"("escopo_id", "usuario_id", "operacao", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "layout_escopo_id_codigo_key" ON "layout"("escopo_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "layout_escopo_id_id_key" ON "layout"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "elemento_layout_layout_id_codigo_key" ON "elemento_layout"("layout_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "fileira_layout_id_codigo_key" ON "fileira"("layout_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "fileira_escopo_id_id_key" ON "fileira"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "posicao_layout_id_codigo_key" ON "posicao"("layout_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "posicao_escopo_id_id_key" ON "posicao"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "palete_escopo_id_posicao_id_idx" ON "palete"("escopo_id", "posicao_id");

-- CreateIndex
CREATE UNIQUE INDEX "palete_escopo_id_codigo_key" ON "palete"("escopo_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "palete_escopo_id_id_key" ON "palete"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "item_declarado_palete_id_ordem_key" ON "item_declarado"("palete_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "item_observado_palete_id_ordem_key" ON "item_observado"("palete_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "item_saldo_palete_id_ordem_key" ON "item_saldo"("palete_id", "ordem");

-- AddForeignKey
ALTER TABLE "escopo" ADD CONSTRAINT "escopo_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escopo" ADD CONSTRAINT "escopo_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo" ADD CONSTRAINT "vinculo_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo" ADD CONSTRAINT "vinculo_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_escopo_ativo_id_fkey" FOREIGN KEY ("escopo_ativo_id") REFERENCES "escopo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_auditoria" ADD CONSTRAINT "evento_auditoria_ator_usuario_id_fkey" FOREIGN KEY ("ator_usuario_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_auditoria" ADD CONSTRAINT "evento_auditoria_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_idempotencia" ADD CONSTRAINT "registro_idempotencia_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_idempotencia" ADD CONSTRAINT "registro_idempotencia_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layout" ADD CONSTRAINT "layout_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "elemento_layout" ADD CONSTRAINT "elemento_layout_escopo_id_layout_id_fkey" FOREIGN KEY ("escopo_id", "layout_id") REFERENCES "layout"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fileira" ADD CONSTRAINT "fileira_escopo_id_layout_id_fkey" FOREIGN KEY ("escopo_id", "layout_id") REFERENCES "layout"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posicao" ADD CONSTRAINT "posicao_escopo_id_layout_id_fkey" FOREIGN KEY ("escopo_id", "layout_id") REFERENCES "layout"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posicao" ADD CONSTRAINT "posicao_escopo_id_fileira_id_fkey" FOREIGN KEY ("escopo_id", "fileira_id") REFERENCES "fileira"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "palete" ADD CONSTRAINT "palete_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "palete" ADD CONSTRAINT "palete_escopo_id_posicao_id_fkey" FOREIGN KEY ("escopo_id", "posicao_id") REFERENCES "posicao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_declarado" ADD CONSTRAINT "item_declarado_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_observado" ADD CONSTRAINT "item_observado_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_saldo" ADD CONSTRAINT "item_saldo_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restrições adicionadas manualmente (o Prisma não modela CHECK).
-- Quantidades nunca negativas.
ALTER TABLE "item_declarado" ADD CONSTRAINT "item_declarado_quantidade_nao_negativa" CHECK ("quantidade" >= 0);
ALTER TABLE "item_observado" ADD CONSTRAINT "item_observado_quantidade_nao_negativa" CHECK ("quantidade" >= 0);
ALTER TABLE "item_saldo" ADD CONSTRAINT "item_saldo_quantidade_nao_negativa" CHECK ("quantidade" >= 0);

-- Geometria em unidades de desenho: coordenadas não negativas e medidas positivas.
ALTER TABLE "layout" ADD CONSTRAINT "layout_medidas_positivas" CHECK ("largura" > 0 AND "altura" > 0);
ALTER TABLE "layout" ADD CONSTRAINT "layout_capacidade_nao_negativa" CHECK ("capacidade_total" IS NULL OR "capacidade_total" >= 0);
ALTER TABLE "elemento_layout" ADD CONSTRAINT "elemento_layout_geometria" CHECK ("x" >= 0 AND "y" >= 0 AND "largura" > 0 AND "altura" > 0);
ALTER TABLE "fileira" ADD CONSTRAINT "fileira_geometria" CHECK ("x" >= 0 AND "y" >= 0 AND "largura" > 0 AND "altura" > 0);
ALTER TABLE "posicao" ADD CONSTRAINT "posicao_geometria" CHECK ("x" >= 0 AND "y" >= 0 AND "largura" > 0 AND "altura" > 0 AND "numero" > 0);

-- Login normalizado e sessão com expiração posterior à criação.
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_login_normalizado" CHECK ("login" = lower("login") AND char_length("login") BETWEEN 3 AND 64);
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_expiracao_valida" CHECK ("expira_em" > "criada_em");
ALTER TABLE "registro_idempotencia" ADD CONSTRAINT "registro_idempotencia_chave_tamanho" CHECK (char_length("chave") BETWEEN 8 AND 200);
