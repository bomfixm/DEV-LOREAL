-- Etapa 07: claims e rastreabilidade (casos, linhas, candidatos, evidências,
-- anexos privados, recuperações validadas com vínculo ao material, resultados
-- da regularização e histórico). Nenhuma tabela de estoque perde dados: o
-- saldo ganha a quantidade vinculada a recuperações (não é reserva).

-- CreateEnum
CREATE TYPE "MotivoClaim" AS ENUM ('EXTRAVIO_FALTA', 'AVARIA', 'DIVERGENCIA_DOCUMENTAL');

-- CreateEnum
CREATE TYPE "SituacaoClaim" AS ENUM ('EM_ANALISE', 'BUSCA_EM_ANDAMENTO', 'CANDIDATO_LOCALIZADO', 'VALIDACAO_PENDENTE', 'REGULARIZADO', 'PERDA_CONFIRMADA', 'ENCERRADO');

-- CreateEnum
CREATE TYPE "PrioridadeClaim" AS ENUM ('URGENTE', 'ALTA', 'NORMAL', 'BAIXA');

-- CreateEnum
CREATE TYPE "BaseValor" AS ENUM ('TOTAL_LINHA', 'UNITARIO');

-- CreateEnum
CREATE TYPE "OrigemCadastroClaim" AS ENUM ('MANUAL', 'IMPORTACAO');

-- CreateEnum
CREATE TYPE "BaseCandidato" AS ENUM ('SALDO_VALIDADO', 'OBSERVADO', 'DECLARADO_PALETE', 'DOCUMENTO', 'HISTORICO');

-- CreateEnum
CREATE TYPE "SituacaoCandidato" AS ENUM ('EM_INVESTIGACAO', 'DESCARTADO');

-- CreateEnum
CREATE TYPE "TipoEvidencia" AS ENUM ('MATERIAL_CONFERIDO', 'DOCUMENTO', 'DESCRICAO');

-- CreateEnum
CREATE TYPE "SituacaoEvidencia" AS ENUM ('REGISTRADA', 'VALIDACAO_SOLICITADA', 'VALIDADA', 'REJEITADA');

-- CreateEnum
CREATE TYPE "SituacaoRecuperacao" AS ENUM ('ATIVA', 'ESTORNADA');

-- CreateEnum
CREATE TYPE "TipoResultado" AS ENUM ('REGULARIZACAO', 'PERDA_CONFIRMADA');

-- CreateEnum
CREATE TYPE "SituacaoResultado" AS ENUM ('VIGENTE', 'CORRIGIDO', 'ANULADO');

-- AlterEnum
ALTER TYPE "TipoImportacao" ADD VALUE 'CLAIMS';

-- AlterTable
ALTER TABLE "vinculo" ADD COLUMN     "aprova_financeiro" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "saldo_estoque" ADD COLUMN     "quantidade_vinculada" DECIMAL(18,3) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "claim" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "referencia_externa" TEXT,
    "motivo" "MotivoClaim" NOT NULL,
    "situacao" "SituacaoClaim" NOT NULL,
    "prioridade" "PrioridadeClaim",
    "prazo" DATE,
    "data_abertura" DATE,
    "data_ocorrencia" DATE,
    "responsavel_id" UUID,
    "moeda" TEXT,
    "fonte_valor" TEXT,
    "situacao_externa" TEXT,
    "referencia_cobranca" TEXT,
    "cobranca_finalizada" BOOLEAN NOT NULL DEFAULT false,
    "observacoes" TEXT,
    "origem_cadastro" "OrigemCadastroClaim" NOT NULL,
    "lote_importacao_id" UUID,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "encerrado_em" TIMESTAMPTZ(3),
    "encerrado_por_id" UUID,
    "decisao_encerramento" TEXT,

    CONSTRAINT "claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linha_claim" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "identificador" TEXT NOT NULL,
    "chave_linha" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "produto_id" UUID,
    "sku" TEXT NOT NULL,
    "descricao" TEXT,
    "quantidade_analise" DECIMAL(18,3) NOT NULL,
    "unidade" TEXT NOT NULL,
    "lote" TEXT,
    "lote_exigido" BOOLEAN NOT NULL DEFAULT false,
    "origem_tipo" "TipoOrigemDocumento",
    "origem_referencia" TEXT,
    "origem_linha" TEXT,
    "valor_estimado" DECIMAL(18,2),
    "base_valor" "BaseValor",
    "quantidade_recuperada" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "quantidade_coberta" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "lote_importacao_id" UUID,
    "linha_arquivo" INTEGER,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "linha_claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidato_claim" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "linha_id" UUID NOT NULL,
    "base" "BaseCandidato" NOT NULL,
    "situacao" "SituacaoCandidato" NOT NULL,
    "palete_id" UUID,
    "segmento_id" UUID,
    "sessao_id" UUID,
    "linha_documento_id" UUID,
    "retrato" JSONB NOT NULL,
    "observacao" TEXT,
    "registrado_por_id" UUID NOT NULL,
    "registrado_em" TIMESTAMPTZ(3) NOT NULL,
    "conferencia_solicitada_por_id" UUID,
    "conferencia_solicitada_em" TIMESTAMPTZ(3),
    "nota_conferencia" TEXT,
    "sessao_vinculada_id" UUID,
    "descartado_por_id" UUID,
    "descartado_em" TIMESTAMPTZ(3),
    "motivo_descarte" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "candidato_claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anexo_claim" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo_conteudo" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "conteudo" BYTEA NOT NULL,
    "enviado_por_id" UUID NOT NULL,
    "enviado_em" TIMESTAMPTZ(3) NOT NULL,
    "evidencia_id" UUID,
    "resultado_id" UUID,

    CONSTRAINT "anexo_claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidencia_claim" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "linha_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "tipo" "TipoEvidencia" NOT NULL,
    "situacao" "SituacaoEvidencia" NOT NULL,
    "candidato_id" UUID,
    "palete_id" UUID,
    "posicao_na_epoca" TEXT,
    "segmento_id" UUID,
    "sessao_id" UUID,
    "linha_documento_id" UUID,
    "quantidade" DECIMAL(18,3),
    "unidade" TEXT,
    "condicao" "CondicaoMaterial",
    "descricao" TEXT NOT NULL,
    "referencia_verificavel" TEXT,
    "retrato" JSONB NOT NULL,
    "autor_id" UUID NOT NULL,
    "registrada_em" TIMESTAMPTZ(3) NOT NULL,
    "quantidade_solicitada" DECIMAL(18,3),
    "nota_solicitacao" TEXT,
    "solicitada_por_id" UUID,
    "solicitada_em" TIMESTAMPTZ(3),
    "decidida_por_id" UUID,
    "decidida_em" TIMESTAMPTZ(3),
    "justificativa_decisao" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "evidencia_claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recuperacao_claim" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "linha_id" UUID NOT NULL,
    "evidencia_id" UUID NOT NULL,
    "segmento_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "posicao_na_epoca" TEXT,
    "quantidade" DECIMAL(18,3) NOT NULL,
    "unidade" TEXT NOT NULL,
    "situacao" "SituacaoRecuperacao" NOT NULL,
    "validada_por_id" UUID NOT NULL,
    "validada_em" TIMESTAMPTZ(3) NOT NULL,
    "justificativa" TEXT NOT NULL,
    "tratativa_lote" TEXT,
    "retrato" JSONB NOT NULL,
    "estornada_por_id" UUID,
    "estornada_em" TIMESTAMPTZ(3),
    "motivo_estorno" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "recuperacao_claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vinculo_material_claim" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "recuperacao_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "segmento_id" UUID NOT NULL,
    "quantidade" DECIMAL(18,3) NOT NULL,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vinculo_material_claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resultado_claim" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "tipo" "TipoResultado" NOT NULL,
    "situacao" "SituacaoResultado" NOT NULL,
    "data_decisao" DATE NOT NULL,
    "valor" DECIMAL(18,2),
    "moeda" TEXT,
    "fonte" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "referencia_resultado_externo" TEXT,
    "justificativa_valor" TEXT,
    "estimativa" JSONB NOT NULL,
    "evidencias" JSONB NOT NULL,
    "autor_id" UUID NOT NULL,
    "registrado_em" TIMESTAMPTZ(3) NOT NULL,
    "corrige_id" UUID,
    "motivo_correcao" TEXT,
    "encerrado_por_id" UUID,
    "encerrado_em" TIMESTAMPTZ(3),
    "motivo_encerramento" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "resultado_claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resultado_linha_claim" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "resultado_id" UUID NOT NULL,
    "linha_id" UUID NOT NULL,
    "quantidade" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "resultado_linha_claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_claim" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "linha_id" UUID,
    "tipo" TEXT NOT NULL,
    "autor_id" UUID,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL,
    "resumo" TEXT NOT NULL,
    "relacionado_id" UUID,
    "detalhes" JSONB NOT NULL,

    CONSTRAINT "evento_claim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "claim_escopo_id_situacao_idx" ON "claim"("escopo_id", "situacao");

-- CreateIndex
CREATE INDEX "claim_escopo_id_prazo_idx" ON "claim"("escopo_id", "prazo");

-- CreateIndex
CREATE UNIQUE INDEX "claim_escopo_id_numero_key" ON "claim"("escopo_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "claim_escopo_id_referencia_externa_key" ON "claim"("escopo_id", "referencia_externa");

-- CreateIndex
CREATE UNIQUE INDEX "claim_escopo_id_id_key" ON "claim"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "linha_claim_escopo_id_produto_id_idx" ON "linha_claim"("escopo_id", "produto_id");

-- CreateIndex
CREATE INDEX "linha_claim_escopo_id_sku_idx" ON "linha_claim"("escopo_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "linha_claim_claim_id_chave_linha_key" ON "linha_claim"("claim_id", "chave_linha");

-- CreateIndex
CREATE UNIQUE INDEX "linha_claim_claim_id_ordem_key" ON "linha_claim"("claim_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "linha_claim_escopo_id_id_key" ON "linha_claim"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "candidato_claim_escopo_id_claim_id_idx" ON "candidato_claim"("escopo_id", "claim_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidato_claim_escopo_id_id_key" ON "candidato_claim"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "anexo_claim_escopo_id_claim_id_idx" ON "anexo_claim"("escopo_id", "claim_id");

-- CreateIndex
CREATE UNIQUE INDEX "anexo_claim_escopo_id_id_key" ON "anexo_claim"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "evidencia_claim_escopo_id_linha_id_idx" ON "evidencia_claim"("escopo_id", "linha_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidencia_claim_claim_id_numero_key" ON "evidencia_claim"("claim_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "evidencia_claim_escopo_id_id_key" ON "evidencia_claim"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "recuperacao_claim_escopo_id_segmento_id_idx" ON "recuperacao_claim"("escopo_id", "segmento_id");

-- CreateIndex
CREATE INDEX "recuperacao_claim_escopo_id_linha_id_idx" ON "recuperacao_claim"("escopo_id", "linha_id");

-- CreateIndex
CREATE INDEX "recuperacao_claim_claim_id_idx" ON "recuperacao_claim"("claim_id");

-- CreateIndex
CREATE UNIQUE INDEX "recuperacao_claim_escopo_id_id_key" ON "recuperacao_claim"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "recuperacao_claim_escopo_id_evidencia_id_key" ON "recuperacao_claim"("escopo_id", "evidencia_id");

-- CreateIndex
CREATE INDEX "vinculo_material_claim_palete_id_segmento_id_idx" ON "vinculo_material_claim"("palete_id", "segmento_id");

-- CreateIndex
CREATE UNIQUE INDEX "vinculo_material_claim_recuperacao_id_palete_id_key" ON "vinculo_material_claim"("recuperacao_id", "palete_id");

-- CreateIndex
CREATE UNIQUE INDEX "resultado_claim_claim_id_numero_key" ON "resultado_claim"("claim_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "resultado_claim_escopo_id_id_key" ON "resultado_claim"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "resultado_claim_corrige_id_key" ON "resultado_claim"("corrige_id");

-- CreateIndex
CREATE INDEX "resultado_linha_claim_escopo_id_linha_id_idx" ON "resultado_linha_claim"("escopo_id", "linha_id");

-- CreateIndex
CREATE UNIQUE INDEX "resultado_linha_claim_resultado_id_linha_id_key" ON "resultado_linha_claim"("resultado_id", "linha_id");

-- CreateIndex
CREATE INDEX "evento_claim_escopo_id_claim_id_ocorrido_em_idx" ON "evento_claim"("escopo_id", "claim_id", "ocorrido_em");

-- CreateIndex
CREATE UNIQUE INDEX "linha_documento_devolucao_escopo_id_id_key" ON "linha_documento_devolucao"("escopo_id", "id");

-- AddForeignKey
ALTER TABLE "claim" ADD CONSTRAINT "claim_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim" ADD CONSTRAINT "claim_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim" ADD CONSTRAINT "claim_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim" ADD CONSTRAINT "claim_encerrado_por_id_fkey" FOREIGN KEY ("encerrado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim" ADD CONSTRAINT "claim_escopo_id_lote_importacao_id_fkey" FOREIGN KEY ("escopo_id", "lote_importacao_id") REFERENCES "lote_importacao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_claim" ADD CONSTRAINT "linha_claim_escopo_id_claim_id_fkey" FOREIGN KEY ("escopo_id", "claim_id") REFERENCES "claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_claim" ADD CONSTRAINT "linha_claim_escopo_id_produto_id_fkey" FOREIGN KEY ("escopo_id", "produto_id") REFERENCES "produto"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_claim" ADD CONSTRAINT "linha_claim_escopo_id_lote_importacao_id_fkey" FOREIGN KEY ("escopo_id", "lote_importacao_id") REFERENCES "lote_importacao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidato_claim" ADD CONSTRAINT "candidato_claim_escopo_id_claim_id_fkey" FOREIGN KEY ("escopo_id", "claim_id") REFERENCES "claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidato_claim" ADD CONSTRAINT "candidato_claim_escopo_id_linha_id_fkey" FOREIGN KEY ("escopo_id", "linha_id") REFERENCES "linha_claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidato_claim" ADD CONSTRAINT "candidato_claim_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidato_claim" ADD CONSTRAINT "candidato_claim_escopo_id_segmento_id_fkey" FOREIGN KEY ("escopo_id", "segmento_id") REFERENCES "segmento_estoque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidato_claim" ADD CONSTRAINT "candidato_claim_escopo_id_sessao_id_fkey" FOREIGN KEY ("escopo_id", "sessao_id") REFERENCES "sessao_conferencia"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidato_claim" ADD CONSTRAINT "candidato_claim_escopo_id_sessao_vinculada_id_fkey" FOREIGN KEY ("escopo_id", "sessao_vinculada_id") REFERENCES "sessao_conferencia"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidato_claim" ADD CONSTRAINT "candidato_claim_escopo_id_linha_documento_id_fkey" FOREIGN KEY ("escopo_id", "linha_documento_id") REFERENCES "linha_documento_devolucao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidato_claim" ADD CONSTRAINT "candidato_claim_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidato_claim" ADD CONSTRAINT "candidato_claim_conferencia_solicitada_por_id_fkey" FOREIGN KEY ("conferencia_solicitada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidato_claim" ADD CONSTRAINT "candidato_claim_descartado_por_id_fkey" FOREIGN KEY ("descartado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo_claim" ADD CONSTRAINT "anexo_claim_escopo_id_claim_id_fkey" FOREIGN KEY ("escopo_id", "claim_id") REFERENCES "claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo_claim" ADD CONSTRAINT "anexo_claim_enviado_por_id_fkey" FOREIGN KEY ("enviado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo_claim" ADD CONSTRAINT "anexo_claim_escopo_id_evidencia_id_fkey" FOREIGN KEY ("escopo_id", "evidencia_id") REFERENCES "evidencia_claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo_claim" ADD CONSTRAINT "anexo_claim_escopo_id_resultado_id_fkey" FOREIGN KEY ("escopo_id", "resultado_id") REFERENCES "resultado_claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencia_claim" ADD CONSTRAINT "evidencia_claim_escopo_id_claim_id_fkey" FOREIGN KEY ("escopo_id", "claim_id") REFERENCES "claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencia_claim" ADD CONSTRAINT "evidencia_claim_escopo_id_linha_id_fkey" FOREIGN KEY ("escopo_id", "linha_id") REFERENCES "linha_claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencia_claim" ADD CONSTRAINT "evidencia_claim_escopo_id_candidato_id_fkey" FOREIGN KEY ("escopo_id", "candidato_id") REFERENCES "candidato_claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencia_claim" ADD CONSTRAINT "evidencia_claim_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencia_claim" ADD CONSTRAINT "evidencia_claim_escopo_id_segmento_id_fkey" FOREIGN KEY ("escopo_id", "segmento_id") REFERENCES "segmento_estoque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencia_claim" ADD CONSTRAINT "evidencia_claim_escopo_id_sessao_id_fkey" FOREIGN KEY ("escopo_id", "sessao_id") REFERENCES "sessao_conferencia"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencia_claim" ADD CONSTRAINT "evidencia_claim_escopo_id_linha_documento_id_fkey" FOREIGN KEY ("escopo_id", "linha_documento_id") REFERENCES "linha_documento_devolucao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencia_claim" ADD CONSTRAINT "evidencia_claim_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencia_claim" ADD CONSTRAINT "evidencia_claim_solicitada_por_id_fkey" FOREIGN KEY ("solicitada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencia_claim" ADD CONSTRAINT "evidencia_claim_decidida_por_id_fkey" FOREIGN KEY ("decidida_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recuperacao_claim" ADD CONSTRAINT "recuperacao_claim_escopo_id_claim_id_fkey" FOREIGN KEY ("escopo_id", "claim_id") REFERENCES "claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recuperacao_claim" ADD CONSTRAINT "recuperacao_claim_escopo_id_linha_id_fkey" FOREIGN KEY ("escopo_id", "linha_id") REFERENCES "linha_claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recuperacao_claim" ADD CONSTRAINT "recuperacao_claim_escopo_id_evidencia_id_fkey" FOREIGN KEY ("escopo_id", "evidencia_id") REFERENCES "evidencia_claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recuperacao_claim" ADD CONSTRAINT "recuperacao_claim_escopo_id_segmento_id_fkey" FOREIGN KEY ("escopo_id", "segmento_id") REFERENCES "segmento_estoque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recuperacao_claim" ADD CONSTRAINT "recuperacao_claim_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recuperacao_claim" ADD CONSTRAINT "recuperacao_claim_validada_por_id_fkey" FOREIGN KEY ("validada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recuperacao_claim" ADD CONSTRAINT "recuperacao_claim_estornada_por_id_fkey" FOREIGN KEY ("estornada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_material_claim" ADD CONSTRAINT "vinculo_material_claim_escopo_id_recuperacao_id_fkey" FOREIGN KEY ("escopo_id", "recuperacao_id") REFERENCES "recuperacao_claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_material_claim" ADD CONSTRAINT "vinculo_material_claim_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_material_claim" ADD CONSTRAINT "vinculo_material_claim_escopo_id_segmento_id_fkey" FOREIGN KEY ("escopo_id", "segmento_id") REFERENCES "segmento_estoque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultado_claim" ADD CONSTRAINT "resultado_claim_escopo_id_claim_id_fkey" FOREIGN KEY ("escopo_id", "claim_id") REFERENCES "claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultado_claim" ADD CONSTRAINT "resultado_claim_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultado_claim" ADD CONSTRAINT "resultado_claim_encerrado_por_id_fkey" FOREIGN KEY ("encerrado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultado_claim" ADD CONSTRAINT "resultado_claim_escopo_id_corrige_id_fkey" FOREIGN KEY ("escopo_id", "corrige_id") REFERENCES "resultado_claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultado_linha_claim" ADD CONSTRAINT "resultado_linha_claim_escopo_id_resultado_id_fkey" FOREIGN KEY ("escopo_id", "resultado_id") REFERENCES "resultado_claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultado_linha_claim" ADD CONSTRAINT "resultado_linha_claim_escopo_id_linha_id_fkey" FOREIGN KEY ("escopo_id", "linha_id") REFERENCES "linha_claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_claim" ADD CONSTRAINT "evento_claim_escopo_id_claim_id_fkey" FOREIGN KEY ("escopo_id", "claim_id") REFERENCES "claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_claim" ADD CONSTRAINT "evento_claim_escopo_id_linha_id_fkey" FOREIGN KEY ("escopo_id", "linha_id") REFERENCES "linha_claim"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_claim" ADD CONSTRAINT "evento_claim_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Regras e proteções da etapa 07 (claims e rastreabilidade).

-- Texto curto de identificação: sem espaços nas pontas, sem controle, até `maximo`.
CREATE FUNCTION "texto_curto_valido"(valor text, maximo integer) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT valor IS NULL OR (char_length(valor) BETWEEN 1 AND maximo AND valor = btrim(valor) AND valor !~ '[[:cntrl:]]')
$$;

-- Aprovação financeira de claims: concessão explícita, só a analista de claims.
ALTER TABLE "vinculo" ADD CONSTRAINT "vinculo_aprovacao_financeira"
  CHECK (NOT "aprova_financeiro" OR "perfil" = 'ANALISTA_CLAIMS');

-- Saldo: a parte vinculada a recuperações de claim e a reservada cabem no
-- saldo, sem sobreposição. Uma mesma quantidade física não sustenta duas
-- recuperações (nem reserva e recuperação ao mesmo tempo).
ALTER TABLE "saldo_estoque" ADD CONSTRAINT "saldo_vinculo_dentro_do_saldo"
  CHECK ("quantidade_vinculada" >= 0 AND "quantidade_reservada" + "quantidade_vinculada" <= "quantidade");

ALTER TABLE "claim" ADD CONSTRAINT "claim_coerente"
  CHECK ("numero" >= 1 AND "codigo" = 'CLM-' || lpad("numero"::text, 6, '0') AND "versao" >= 1
         AND texto_curto_valido("referencia_externa", 80) AND texto_curto_valido("referencia_cobranca", 80)
         AND ("moeda" IS NULL OR "moeda" ~ '^[A-Z]{3}$')
         AND (("situacao" IN ('REGULARIZADO', 'PERDA_CONFIRMADA', 'ENCERRADO')) = ("encerrado_em" IS NOT NULL))
         AND (("encerrado_em" IS NULL) = ("encerrado_por_id" IS NULL))
         AND (("encerrado_em" IS NULL) = ("decisao_encerramento" IS NULL))
         AND ("decisao_encerramento" IS NULL OR char_length("decisao_encerramento") >= 10)
         AND (("origem_cadastro" = 'IMPORTACAO') = ("lote_importacao_id" IS NOT NULL)));

ALTER TABLE "linha_claim" ADD CONSTRAINT "linha_claim_coerente"
  CHECK ("ordem" >= 1 AND "versao" >= 1 AND "quantidade_analise" > 0
         AND "identificador" IS NOT NULL AND texto_curto_valido("identificador", 40)
         AND "chave_linha" = chave_linha_documento("identificador")
         AND "sku" IS NOT NULL AND texto_curto_valido("sku", 60)
         AND "unidade" ~ '^[A-Z0-9]{1,10}$'
         AND ("unidade" <> 'UN' OR "quantidade_analise" = trunc("quantidade_analise"))
         AND texto_curto_valido("lote", 60) AND texto_curto_valido("origem_referencia", 80) AND texto_curto_valido("origem_linha", 40)
         AND ("origem_referencia" IS NULL OR "origem_tipo" IS NOT NULL)
         AND (("valor_estimado" IS NULL) = ("base_valor" IS NULL)) AND ("valor_estimado" IS NULL OR "valor_estimado" >= 0)
         AND (("lote_importacao_id" IS NULL) = ("linha_arquivo" IS NULL)));

-- Recuperação validada e cobertura por resultados nunca passam da quantidade em análise.
ALTER TABLE "linha_claim" ADD CONSTRAINT "linha_claim_quantidades"
  CHECK ("quantidade_recuperada" >= 0 AND "quantidade_recuperada" <= "quantidade_analise"
         AND "quantidade_coberta" >= 0 AND "quantidade_coberta" <= "quantidade_analise");

ALTER TABLE "candidato_claim" ADD CONSTRAINT "candidato_claim_coerente"
  CHECK ("versao" >= 1 AND jsonb_typeof("retrato") = 'object'
         AND (("situacao" = 'DESCARTADO') = ("descartado_em" IS NOT NULL))
         AND (("descartado_em" IS NULL) = ("descartado_por_id" IS NULL))
         AND (("descartado_em" IS NULL) = ("motivo_descarte" IS NULL))
         AND (("conferencia_solicitada_em" IS NULL) = ("conferencia_solicitada_por_id" IS NULL))
         AND (("conferencia_solicitada_em" IS NULL) = ("nota_conferencia" IS NULL))
         AND ("sessao_vinculada_id" IS NULL OR "conferencia_solicitada_em" IS NOT NULL)
         AND ("base" = 'DOCUMENTO' OR "palete_id" IS NOT NULL)
         AND ("base" <> 'DOCUMENTO' OR ("linha_documento_id" IS NOT NULL AND "palete_id" IS NULL)));

ALTER TABLE "anexo_claim" ADD CONSTRAINT "anexo_claim_coerente"
  CHECK ("tamanho" > 0 AND "tamanho" = octet_length("conteudo") AND "sha256" ~ '^[0-9a-f]{64}$'
         AND "tipo_conteudo" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
         AND char_length("nome") BETWEEN 1 AND 200 AND "nome" !~ '[[:cntrl:]/\\]'
         AND NOT ("evidencia_id" IS NOT NULL AND "resultado_id" IS NOT NULL));

-- Só material conferido (palete × segmento com saldo) vai à validação de recuperação.
ALTER TABLE "evidencia_claim" ADD CONSTRAINT "evidencia_claim_coerente"
  CHECK ("numero" >= 1 AND "versao" >= 1 AND char_length("descricao") >= 10 AND jsonb_typeof("retrato") = 'object'
         AND ("tipo" <> 'MATERIAL_CONFERIDO'
              OR ("palete_id" IS NOT NULL AND "segmento_id" IS NOT NULL AND "quantidade" > 0 AND "unidade" IS NOT NULL AND "condicao" IS NOT NULL))
         AND ("tipo" <> 'DOCUMENTO' OR "linha_documento_id" IS NOT NULL)
         AND ("situacao" = 'REGISTRADA' OR "tipo" = 'MATERIAL_CONFERIDO')
         AND ("situacao" = 'REGISTRADA'
              OR ("quantidade_solicitada" > 0 AND "solicitada_em" IS NOT NULL AND "solicitada_por_id" IS NOT NULL))
         AND (("situacao" IN ('VALIDADA', 'REJEITADA'))
              = ("decidida_em" IS NOT NULL AND "decidida_por_id" IS NOT NULL AND char_length(coalesce("justificativa_decisao", '')) >= 10)));

ALTER TABLE "recuperacao_claim" ADD CONSTRAINT "recuperacao_claim_coerente"
  CHECK ("quantidade" > 0 AND "versao" >= 1 AND char_length("justificativa") >= 10 AND jsonb_typeof("retrato") = 'object'
         AND (("situacao" = 'ESTORNADA') = ("estornada_em" IS NOT NULL))
         AND (("estornada_em" IS NULL) = ("estornada_por_id" IS NULL))
         AND (("estornada_em" IS NULL) = ("motivo_estorno" IS NULL)));

ALTER TABLE "vinculo_material_claim" ADD CONSTRAINT "vinculo_material_claim_positivo" CHECK ("quantidade" > 0);

ALTER TABLE "resultado_claim" ADD CONSTRAINT "resultado_claim_coerente"
  CHECK ("numero" >= 1 AND "versao" >= 1
         AND (("valor" IS NULL) = ("moeda" IS NULL)) AND ("valor" IS NULL OR "valor" >= 0) AND ("moeda" IS NULL OR "moeda" ~ '^[A-Z]{3}$')
         AND char_length("fonte") >= 3 AND char_length("referencia") >= 3
         AND (("corrige_id" IS NULL) = ("motivo_correcao" IS NULL))
         AND (("situacao" = 'VIGENTE') = ("encerrado_em" IS NULL))
         AND (("encerrado_em" IS NULL) = ("encerrado_por_id" IS NULL))
         AND (("encerrado_em" IS NULL) = ("motivo_encerramento" IS NULL))
         AND jsonb_typeof("estimativa") = 'object' AND jsonb_typeof("evidencias") = 'array');

ALTER TABLE "resultado_linha_claim" ADD CONSTRAINT "resultado_linha_claim_positiva" CHECK ("quantidade" > 0);

ALTER TABLE "evento_claim" ADD CONSTRAINT "evento_claim_coerente"
  CHECK (char_length("tipo") >= 3 AND char_length("resumo") >= 3 AND jsonb_typeof("detalhes") = 'object');

-- ---------------------------------------------------------------------------
-- Imutabilidade: casos, linhas, candidatos, evidências, recuperações,
-- resultados e anexos nunca são apagados; o histórico não muda.

CREATE TRIGGER "evento_claim_imutavel" BEFORE UPDATE OR DELETE ON "evento_claim"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();
CREATE TRIGGER "resultado_linha_claim_imutavel" BEFORE UPDATE OR DELETE ON "resultado_linha_claim"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();

CREATE FUNCTION "proteger_claim"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CLAIM_IMUTAVEL: casos não são apagados; encerramento e reabertura ficam no histórico' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."escopo_id", NEW."numero", NEW."codigo", NEW."origem_cadastro", NEW."lote_importacao_id", NEW."criado_por_id", NEW."criado_em")
     IS DISTINCT FROM (OLD."id", OLD."escopo_id", OLD."numero", OLD."codigo", OLD."origem_cadastro", OLD."lote_importacao_id", OLD."criado_por_id", OLD."criado_em")
     OR NEW."versao" <> OLD."versao" + 1 THEN
    RAISE EXCEPTION 'CLAIM_IMUTAVEL: identidade e autoria do caso preservadas; cada alteração avança uma versão' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "claim_protegido" BEFORE UPDATE OR DELETE ON "claim"
FOR EACH ROW EXECUTE FUNCTION "proteger_claim"();

CREATE FUNCTION "proteger_linha_claim"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CLAIM_IMUTAVEL: linhas de claim não são apagadas' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."escopo_id", NEW."claim_id", NEW."ordem", NEW."lote_importacao_id", NEW."linha_arquivo", NEW."criado_em")
     IS DISTINCT FROM (OLD."id", OLD."escopo_id", OLD."claim_id", OLD."ordem", OLD."lote_importacao_id", OLD."linha_arquivo", OLD."criado_em")
     OR NEW."versao" < OLD."versao" THEN
    RAISE EXCEPTION 'CLAIM_IMUTAVEL: identidade e ordem da linha preservadas' USING ERRCODE = 'check_violation';
  END IF;
  -- Dados que sustentam recuperações ou resultados não mudam sob eles.
  IF (NEW."produto_id", NEW."sku", NEW."unidade", NEW."lote", NEW."lote_exigido", NEW."origem_tipo", NEW."origem_referencia", NEW."origem_linha")
       IS DISTINCT FROM (OLD."produto_id", OLD."sku", OLD."unidade", OLD."lote", OLD."lote_exigido", OLD."origem_tipo", OLD."origem_referencia", OLD."origem_linha")
     AND (NEW."quantidade_recuperada" > 0 OR NEW."quantidade_coberta" > 0) THEN
    RAISE EXCEPTION 'CLAIM_IMUTAVEL: produto, unidade, lote e origem de linha com recuperação ou resultado não mudam' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "linha_claim_protegida" BEFORE UPDATE OR DELETE ON "linha_claim"
FOR EACH ROW EXECUTE FUNCTION "proteger_linha_claim"();

CREATE FUNCTION "proteger_candidato_claim"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CLAIM_IMUTAVEL: candidatos registrados não são apagados; o descarte fica registrado' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."situacao" = 'DESCARTADO'
     OR (NEW."id", NEW."escopo_id", NEW."claim_id", NEW."linha_id", NEW."base", NEW."palete_id", NEW."segmento_id", NEW."sessao_id",
         NEW."linha_documento_id", NEW."retrato", NEW."observacao", NEW."registrado_por_id", NEW."registrado_em")
        IS DISTINCT FROM (OLD."id", OLD."escopo_id", OLD."claim_id", OLD."linha_id", OLD."base", OLD."palete_id", OLD."segmento_id", OLD."sessao_id",
         OLD."linha_documento_id", OLD."retrato", OLD."observacao", OLD."registrado_por_id", OLD."registrado_em")
     OR NEW."versao" <> OLD."versao" + 1 THEN
    RAISE EXCEPTION 'CLAIM_IMUTAVEL: o registro do candidato é preservado; descartado não muda' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "candidato_claim_protegido" BEFORE UPDATE OR DELETE ON "candidato_claim"
FOR EACH ROW EXECUTE FUNCTION "proteger_candidato_claim"();

CREATE FUNCTION "proteger_anexo_claim"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CLAIM_IMUTAVEL: anexos não são apagados' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."escopo_id", NEW."claim_id", NEW."nome", NEW."tipo_conteudo", NEW."tamanho", NEW."sha256", NEW."conteudo", NEW."enviado_por_id", NEW."enviado_em")
     IS DISTINCT FROM (OLD."id", OLD."escopo_id", OLD."claim_id", OLD."nome", OLD."tipo_conteudo", OLD."tamanho", OLD."sha256", OLD."conteudo", OLD."enviado_por_id", OLD."enviado_em")
     OR (OLD."evidencia_id" IS NOT NULL AND NEW."evidencia_id" IS DISTINCT FROM OLD."evidencia_id")
     OR (OLD."resultado_id" IS NOT NULL AND NEW."resultado_id" IS DISTINCT FROM OLD."resultado_id") THEN
    RAISE EXCEPTION 'CLAIM_IMUTAVEL: conteúdo e vínculo do anexo não mudam' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "anexo_claim_protegido" BEFORE UPDATE OR DELETE ON "anexo_claim"
FOR EACH ROW EXECUTE FUNCTION "proteger_anexo_claim"();

CREATE FUNCTION "proteger_evidencia_claim"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CLAIM_IMUTAVEL: evidências não são apagadas' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."escopo_id", NEW."claim_id", NEW."linha_id", NEW."numero", NEW."tipo", NEW."candidato_id", NEW."palete_id", NEW."posicao_na_epoca",
      NEW."segmento_id", NEW."sessao_id", NEW."linha_documento_id", NEW."quantidade", NEW."unidade", NEW."condicao", NEW."descricao",
      NEW."referencia_verificavel", NEW."retrato", NEW."autor_id", NEW."registrada_em")
     IS DISTINCT FROM (OLD."id", OLD."escopo_id", OLD."claim_id", OLD."linha_id", OLD."numero", OLD."tipo", OLD."candidato_id", OLD."palete_id", OLD."posicao_na_epoca",
      OLD."segmento_id", OLD."sessao_id", OLD."linha_documento_id", OLD."quantidade", OLD."unidade", OLD."condicao", OLD."descricao",
      OLD."referencia_verificavel", OLD."retrato", OLD."autor_id", OLD."registrada_em")
     OR NEW."versao" <> OLD."versao" + 1
     OR NOT ((OLD."situacao" = 'REGISTRADA' AND NEW."situacao" = 'VALIDACAO_SOLICITADA')
             OR (OLD."situacao" = 'VALIDACAO_SOLICITADA' AND NEW."situacao" IN ('VALIDADA', 'REJEITADA')))
     OR (OLD."situacao" = 'VALIDACAO_SOLICITADA'
         AND (NEW."quantidade_solicitada", NEW."nota_solicitacao", NEW."solicitada_por_id", NEW."solicitada_em")
             IS DISTINCT FROM (OLD."quantidade_solicitada", OLD."nota_solicitacao", OLD."solicitada_por_id", OLD."solicitada_em")) THEN
    RAISE EXCEPTION 'CLAIM_IMUTAVEL: conteúdo da evidência preservado; só a situação avança (registrada, solicitada, decidida)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "evidencia_claim_protegida" BEFORE UPDATE OR DELETE ON "evidencia_claim"
FOR EACH ROW EXECUTE FUNCTION "proteger_evidencia_claim"();

CREATE FUNCTION "proteger_recuperacao_claim"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CLAIM_IMUTAVEL: recuperações validadas não são apagadas; o estorno fica registrado' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."situacao" <> 'ATIVA' OR NEW."situacao" <> 'ESTORNADA' OR NEW."versao" <> OLD."versao" + 1
     OR (NEW."id", NEW."escopo_id", NEW."claim_id", NEW."linha_id", NEW."evidencia_id", NEW."segmento_id", NEW."palete_id", NEW."posicao_na_epoca",
         NEW."quantidade", NEW."unidade", NEW."validada_por_id", NEW."validada_em", NEW."justificativa", NEW."tratativa_lote", NEW."retrato")
        IS DISTINCT FROM (OLD."id", OLD."escopo_id", OLD."claim_id", OLD."linha_id", OLD."evidencia_id", OLD."segmento_id", OLD."palete_id", OLD."posicao_na_epoca",
         OLD."quantidade", OLD."unidade", OLD."validada_por_id", OLD."validada_em", OLD."justificativa", OLD."tratativa_lote", OLD."retrato") THEN
    RAISE EXCEPTION 'CLAIM_IMUTAVEL: a recuperação validada só muda por estorno explícito' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "recuperacao_claim_protegida" BEFORE UPDATE OR DELETE ON "recuperacao_claim"
FOR EACH ROW EXECUTE FUNCTION "proteger_recuperacao_claim"();

CREATE FUNCTION "proteger_resultado_claim"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CLAIM_IMUTAVEL: resultados não são apagados; correção e anulação ficam registradas' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."situacao" <> 'VIGENTE' OR NEW."situacao" NOT IN ('CORRIGIDO', 'ANULADO') OR NEW."versao" <> OLD."versao" + 1
     OR (NEW."id", NEW."escopo_id", NEW."claim_id", NEW."numero", NEW."tipo", NEW."data_decisao", NEW."valor", NEW."moeda", NEW."fonte", NEW."referencia",
         NEW."referencia_resultado_externo", NEW."justificativa_valor", NEW."estimativa", NEW."evidencias", NEW."autor_id", NEW."registrado_em",
         NEW."corrige_id", NEW."motivo_correcao")
        IS DISTINCT FROM (OLD."id", OLD."escopo_id", OLD."claim_id", OLD."numero", OLD."tipo", OLD."data_decisao", OLD."valor", OLD."moeda", OLD."fonte", OLD."referencia",
         OLD."referencia_resultado_externo", OLD."justificativa_valor", OLD."estimativa", OLD."evidencias", OLD."autor_id", OLD."registrado_em",
         OLD."corrige_id", OLD."motivo_correcao") THEN
    RAISE EXCEPTION 'CLAIM_IMUTAVEL: o resultado registrado só é encerrado por correção ou anulação explícita' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "resultado_claim_protegido" BEFORE UPDATE OR DELETE ON "resultado_claim"
FOR EACH ROW EXECUTE FUNCTION "proteger_resultado_claim"();

-- Registros de uma linha pertencem ao mesmo caso da linha.
CREATE FUNCTION "verificar_linha_do_claim"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."linha_id" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "linha_claim" l WHERE l."id" = NEW."linha_id" AND l."claim_id" = NEW."claim_id") THEN
    RAISE EXCEPTION 'CLAIM_INCOERENTE: a linha informada não pertence a este caso' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "candidato_claim_linha" BEFORE INSERT ON "candidato_claim" FOR EACH ROW EXECUTE FUNCTION "verificar_linha_do_claim"();
CREATE TRIGGER "evidencia_claim_linha" BEFORE INSERT ON "evidencia_claim" FOR EACH ROW EXECUTE FUNCTION "verificar_linha_do_claim"();
CREATE TRIGGER "evento_claim_linha" BEFORE INSERT ON "evento_claim" FOR EACH ROW EXECUTE FUNCTION "verificar_linha_do_claim"();

CREATE FUNCTION "verificar_resultado_linha_claim"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "resultado_claim" r JOIN "linha_claim" l ON l."claim_id" = r."claim_id"
                  WHERE r."id" = NEW."resultado_id" AND l."id" = NEW."linha_id") THEN
    RAISE EXCEPTION 'CLAIM_INCOERENTE: a linha coberta não pertence ao caso do resultado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "resultado_linha_claim_linha" BEFORE INSERT ON "resultado_linha_claim" FOR EACH ROW EXECUTE FUNCTION "verificar_resultado_linha_claim"();

-- A recuperação nasce de evidência de material conferido validada, da mesma
-- linha, palete e segmento; produto e unidade iguais aos da linha.
CREATE FUNCTION "verificar_recuperacao_claim"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "evidencia_claim" e
      JOIN "linha_claim" l ON l."id" = e."linha_id"
      JOIN "segmento_estoque" s ON s."id" = e."segmento_id"
     WHERE e."id" = NEW."evidencia_id" AND e."claim_id" = NEW."claim_id" AND e."linha_id" = NEW."linha_id"
       AND e."tipo" = 'MATERIAL_CONFERIDO' AND e."situacao" = 'VALIDADA'
       AND e."palete_id" = NEW."palete_id" AND e."segmento_id" = NEW."segmento_id"
       AND l."produto_id" = s."produto_id" AND l."unidade" = s."unidade" AND NEW."unidade" = s."unidade"
       AND NEW."quantidade" <= e."quantidade_solicitada"
  ) THEN
    RAISE EXCEPTION 'CLAIM_INCOERENTE: recuperação sem evidência validada do mesmo material, linha, produto e unidade' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "recuperacao_claim_origem" BEFORE INSERT ON "recuperacao_claim" FOR EACH ROW EXECUTE FUNCTION "verificar_recuperacao_claim"();

-- ---------------------------------------------------------------------------
-- Conferências adiadas (no COMMIT): os totais mantidos pelo serviço batem com
-- os registros. Qualquer divergência desfaz a transação inteira.

-- Soma dos vínculos de um palete × segmento = quantidade vinculada do saldo.
CREATE FUNCTION "conferir_vinculo_saldo"(p_palete uuid, p_segmento uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_soma numeric;
  v_saldo numeric;
BEGIN
  SELECT coalesce(sum("quantidade"), 0) INTO v_soma FROM "vinculo_material_claim" WHERE "palete_id" = p_palete AND "segmento_id" = p_segmento;
  SELECT coalesce(max("quantidade_vinculada"), 0) INTO v_saldo FROM "saldo_estoque" WHERE "palete_id" = p_palete AND "segmento_id" = p_segmento;
  IF v_soma <> v_saldo THEN
    RAISE EXCEPTION 'CLAIM_INCOERENTE: vínculos de claim (%) diferentes da quantidade vinculada do saldo (%)', v_soma, v_saldo USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- Vínculos de uma recuperação: mesmo segmento; soma = quantidade (ativa) ou zero (estornada).
CREATE FUNCTION "conferir_recuperacao_claim"(p_recuperacao uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_rec record;
  v_soma numeric;
  v_esperado numeric;
BEGIN
  SELECT "situacao"::text AS situacao, "quantidade", "segmento_id" INTO v_rec FROM "recuperacao_claim" WHERE "id" = p_recuperacao;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM "vinculo_material_claim" WHERE "recuperacao_id" = p_recuperacao AND "segmento_id" <> v_rec."segmento_id") THEN
    RAISE EXCEPTION 'CLAIM_INCOERENTE: vínculo de recuperação em outro material' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum("quantidade"), 0) INTO v_soma FROM "vinculo_material_claim" WHERE "recuperacao_id" = p_recuperacao;
  v_esperado := CASE WHEN v_rec.situacao = 'ATIVA' THEN v_rec."quantidade" ELSE 0 END;
  IF v_soma <> v_esperado THEN
    RAISE EXCEPTION 'CLAIM_INCOERENTE: vínculos (%) diferentes da recuperação %', v_soma, v_rec.situacao USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- Totais da linha: recuperações ativas e resultados vigentes.
CREATE FUNCTION "conferir_linha_claim"(p_linha uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_linha record;
  v_recuperada numeric;
  v_coberta numeric;
BEGIN
  SELECT "quantidade_recuperada", "quantidade_coberta" INTO v_linha FROM "linha_claim" WHERE "id" = p_linha;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT coalesce(sum("quantidade"), 0) INTO v_recuperada FROM "recuperacao_claim" WHERE "linha_id" = p_linha AND "situacao" = 'ATIVA';
  SELECT coalesce(sum(rl."quantidade"), 0) INTO v_coberta
    FROM "resultado_linha_claim" rl JOIN "resultado_claim" r ON r."id" = rl."resultado_id"
   WHERE rl."linha_id" = p_linha AND r."situacao" = 'VIGENTE';
  IF v_linha."quantidade_recuperada" <> v_recuperada OR v_linha."quantidade_coberta" <> v_coberta THEN
    RAISE EXCEPTION 'CLAIM_INCOERENTE: totais da linha (recuperada %, coberta %) diferentes dos registros (%, %)',
      v_linha."quantidade_recuperada", v_linha."quantidade_coberta", v_recuperada, v_coberta USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION "conferir_vinculo_material_claim"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM conferir_vinculo_saldo(OLD."palete_id", OLD."segmento_id");
    PERFORM conferir_recuperacao_claim(OLD."recuperacao_id");
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM conferir_vinculo_saldo(NEW."palete_id", NEW."segmento_id");
    PERFORM conferir_recuperacao_claim(NEW."recuperacao_id");
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "vinculo_material_claim_coerente"
AFTER INSERT OR UPDATE OR DELETE ON "vinculo_material_claim"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "conferir_vinculo_material_claim"();

CREATE FUNCTION "conferir_saldo_vinculado"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM conferir_vinculo_saldo(OLD."palete_id", OLD."segmento_id");
  ELSIF TG_OP = 'INSERT' OR NEW."quantidade_vinculada" IS DISTINCT FROM OLD."quantidade_vinculada" THEN
    PERFORM conferir_vinculo_saldo(NEW."palete_id", NEW."segmento_id");
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "saldo_estoque_vinculo_coerente"
AFTER INSERT OR UPDATE OR DELETE ON "saldo_estoque"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "conferir_saldo_vinculado"();

CREATE FUNCTION "conferir_recuperacao_e_linha"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM conferir_recuperacao_claim(NEW."id");
  PERFORM conferir_linha_claim(NEW."linha_id");
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "recuperacao_claim_coerente_totais"
AFTER INSERT OR UPDATE ON "recuperacao_claim"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "conferir_recuperacao_e_linha"();

CREATE FUNCTION "conferir_linha_claim_gatilho"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM conferir_linha_claim(NEW."id");
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "linha_claim_coerente_totais"
AFTER INSERT OR UPDATE ON "linha_claim"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "conferir_linha_claim_gatilho"();

CREATE FUNCTION "conferir_linhas_do_resultado"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_linha uuid;
BEGIN
  IF TG_TABLE_NAME = 'resultado_linha_claim' THEN
    PERFORM conferir_linha_claim(NEW."linha_id");
  ELSE
    FOR v_linha IN SELECT "linha_id" FROM "resultado_linha_claim" WHERE "resultado_id" = NEW."id" LOOP
      PERFORM conferir_linha_claim(v_linha);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "resultado_linha_claim_coerente_totais"
AFTER INSERT ON "resultado_linha_claim"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "conferir_linhas_do_resultado"();
CREATE CONSTRAINT TRIGGER "resultado_claim_coerente_totais"
AFTER UPDATE ON "resultado_claim"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "conferir_linhas_do_resultado"();

-- Índices de filtro da lista de claims (texto sem diferenciar maiúsculas).
CREATE INDEX "claim_busca_referencia_idx" ON "claim"("escopo_id", upper("referencia_externa") text_pattern_ops);
CREATE INDEX "linha_claim_busca_sku_idx" ON "linha_claim"("escopo_id", upper("sku") text_pattern_ops);
CREATE INDEX "linha_claim_busca_origem_idx" ON "linha_claim"("escopo_id", upper("origem_referencia") text_pattern_ops);
