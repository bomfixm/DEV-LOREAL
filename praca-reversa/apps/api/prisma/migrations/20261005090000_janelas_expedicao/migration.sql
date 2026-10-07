-- Etapa 08: janelas de devolução, liberação do material (palete × segmento),
-- reservas de estoque e capacidade, preparação, expedição com baixa única e
-- retorno físico rastreado. O saldo ganha a parte liberada e o bloqueio por
-- material; o palete ganha o bloqueio inteiro; os estados anteriores de
-- liberação do palete são convertidos (nenhum saldo muda).

-- CreateEnum
CREATE TYPE "SituacaoJanela" AS ENUM ('RASCUNHO', 'CONFIRMADA', 'PREPARACAO', 'ENCERRADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "MetricaCapacidade" AS ENUM ('QUANTIDADE', 'CAIXAS', 'PALETES', 'PESO_KG', 'VOLUME_M3');

-- CreateEnum
CREATE TYPE "BasePeso" AS ENUM ('BRUTO', 'LIQUIDO');

-- CreateEnum
CREATE TYPE "SituacaoReserva" AS ENUM ('ATIVA', 'LIBERADA', 'CONSUMIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "SituacaoPreparacao" AS ENUM ('PENDENTE', 'PREPARADA', 'DIVERGENTE');

-- CreateEnum
CREATE TYPE "TipoRetorno" AS ENUM ('AVISO_DOCUMENTAL', 'RECEBIMENTO_FISICO');

-- AlterEnum
ALTER TYPE "TipoEventoEstoque" ADD VALUE 'EXPEDICAO';

-- AlterEnum
ALTER TYPE "TipoEventoLocalizacao" ADD VALUE 'SAIDA_EXPEDICAO';

-- AlterTable
ALTER TABLE "evento_estoque" ADD COLUMN     "expedicao_id" UUID;

-- AlterTable
ALTER TABLE "item_declarado" ADD COLUMN     "linha_retorno_id" UUID;

-- AlterTable
ALTER TABLE "palete" ADD COLUMN     "bloqueado_em" TIMESTAMPTZ(3),
ADD COLUMN     "bloqueado_por_id" UUID,
ADD COLUMN     "bloqueio_motivo" TEXT;

-- AlterTable
ALTER TABLE "saldo_estoque" ADD COLUMN     "bloqueado_em" TIMESTAMPTZ(3),
ADD COLUMN     "bloqueado_por_id" UUID,
ADD COLUMN     "bloqueio_motivo" TEXT,
ADD COLUMN     "quantidade_liberada" DECIMAL(18,3) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "evento_liberacao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "segmento_id" UUID,
    "tipo" TEXT NOT NULL,
    "quantidade" DECIMAL(18,3),
    "liberada_anterior" DECIMAL(18,3),
    "liberada_posterior" DECIMAL(18,3),
    "criterio" TEXT,
    "fonte" TEXT,
    "referencia" TEXT,
    "motivo" TEXT NOT NULL,
    "autor_id" UUID,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL,
    "evento_estoque_id" UUID,

    CONSTRAINT "evento_liberacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "janela_devolucao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "referencia_cliente" TEXT,
    "mes_referencia" DATE NOT NULL,
    "saida_inicio" TIMESTAMPTZ(3),
    "saida_fim" TIMESTAMPTZ(3),
    "prazo_preparacao" TIMESTAMPTZ(3),
    "criterios_definidos" BOOLEAN NOT NULL DEFAULT false,
    "condicoes_aceitas" "CondicaoMaterial"[],
    "origem_qualquer" BOOLEAN NOT NULL DEFAULT true,
    "origens_aceitas" "TipoOrigemDocumento"[],
    "exige_lote" BOOLEAN NOT NULL DEFAULT false,
    "exige_origem" BOOLEAN NOT NULL DEFAULT false,
    "documentos_exigidos" TEXT[],
    "criterios_observacao" TEXT,
    "autorizacao_fonte" TEXT,
    "autorizacao_referencia" TEXT,
    "autorizacao_data" DATE,
    "autorizacao_responsavel" TEXT,
    "observacoes" TEXT,
    "situacao" "SituacaoJanela" NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "versao_regras" INTEGER NOT NULL DEFAULT 1,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    "confirmada_por_id" UUID,
    "confirmada_em" TIMESTAMPTZ(3),
    "encerrada_por_id" UUID,
    "encerrada_em" TIMESTAMPTZ(3),
    "motivo_encerramento" TEXT,

    CONSTRAINT "janela_devolucao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restricao_janela" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "janela_id" UUID NOT NULL,
    "metrica" "MetricaCapacidade" NOT NULL,
    "unidade" TEXT NOT NULL,
    "base_peso" "BasePeso",
    "limite" DECIMAL(18,3),
    "reservado" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "expedido" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "restricao_janela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "versao_regras_janela" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "janela_id" UUID NOT NULL,
    "versao" INTEGER NOT NULL,
    "fotografia" JSONB NOT NULL,
    "justificativa" TEXT,
    "fonte" TEXT,
    "autor_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "versao_regras_janela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserva_janela" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "janela_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "situacao" "SituacaoReserva" NOT NULL,
    "consumo_parcial" BOOLEAN NOT NULL DEFAULT false,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "versao_regras" INTEGER NOT NULL,
    "fotografia_criterios" JSONB NOT NULL,
    "observacoes" TEXT,
    "preparacao" "SituacaoPreparacao" NOT NULL DEFAULT 'PENDENTE',
    "preparada_em" TIMESTAMPTZ(3),
    "preparacao_responsavel_id" UUID,
    "preparacao_registrada_por_id" UUID,
    "preparacao_registrada_em" TIMESTAMPTZ(3),
    "preparacao_observacoes" TEXT,
    "preparacao_diferencas" JSONB,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,
    "encerrada_por_id" UUID,
    "encerrada_em" TIMESTAMPTZ(3),
    "motivo_encerramento" TEXT,

    CONSTRAINT "reserva_janela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linha_reserva" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "reserva_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "segmento_id" UUID NOT NULL,
    "quantidade" DECIMAL(18,3) NOT NULL,
    "unidade" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "lote" TEXT,
    "origem_tipo" "TipoOrigemDocumento",
    "origem_referencia" TEXT,
    "condicao" "CondicaoMaterial" NOT NULL,
    "palete_codigo" TEXT NOT NULL,
    "posicao_codigo" TEXT,
    "quantidade_preparada" DECIMAL(18,3),
    "quantidade_enviada" DECIMAL(18,3),
    "quantidade_liberada" DECIMAL(18,3),

    CONSTRAINT "linha_reserva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidade_carga_reserva" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "reserva_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "caixas" INTEGER,
    "peso_kg" DECIMAL(18,3),
    "base_peso" "BasePeso",
    "volume_m3" DECIMAL(18,3),
    "fonte_medida" TEXT,
    "informado_por_id" UUID NOT NULL,
    "informado_em" TIMESTAMPTZ(3) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "unidade_carga_reserva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrica_reserva" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "reserva_id" UUID NOT NULL,
    "restricao_id" UUID NOT NULL,
    "metrica" "MetricaCapacidade" NOT NULL,
    "unidade" TEXT NOT NULL,
    "valor" DECIMAL(18,3) NOT NULL,
    "valor_inicial" DECIMAL(18,3) NOT NULL,
    "base" TEXT NOT NULL,

    CONSTRAINT "metrica_reserva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expedicao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "janela_id" UUID NOT NULL,
    "reserva_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "saida_em" TIMESTAMPTZ(3) NOT NULL,
    "responsavel_id" UUID NOT NULL,
    "confirmada_por_id" UUID NOT NULL,
    "confirmada_em" TIMESTAMPTZ(3) NOT NULL,
    "parcial" BOOLEAN NOT NULL,
    "observacoes" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "expedicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linha_expedicao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "expedicao_id" UUID NOT NULL,
    "linha_reserva_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "segmento_id" UUID NOT NULL,
    "unidade" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "lote" TEXT,
    "origem_tipo" "TipoOrigemDocumento",
    "origem_referencia" TEXT,
    "condicao" "CondicaoMaterial" NOT NULL,
    "palete_codigo" TEXT NOT NULL,
    "posicao_codigo" TEXT,
    "quantidade_reservada" DECIMAL(18,3) NOT NULL,
    "quantidade_enviada" DECIMAL(18,3) NOT NULL,
    "quantidade_liberada" DECIMAL(18,3) NOT NULL,
    "quantidade_retornada" DECIMAL(18,3) NOT NULL DEFAULT 0,

    CONSTRAINT "linha_expedicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidade_carga_expedicao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "expedicao_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "palete_codigo" TEXT NOT NULL,
    "caixas" INTEGER,
    "peso_kg" DECIMAL(18,3),
    "base_peso" "BasePeso",
    "volume_m3" DECIMAL(18,3),
    "fonte_medida" TEXT,
    "palete_saiu" BOOLEAN NOT NULL,

    CONSTRAINT "unidade_carga_expedicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrica_expedicao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "expedicao_id" UUID NOT NULL,
    "restricao_id" UUID NOT NULL,
    "metrica" "MetricaCapacidade" NOT NULL,
    "unidade" TEXT NOT NULL,
    "valor_reservado" DECIMAL(18,3) NOT NULL,
    "valor_expedido" DECIMAL(18,3) NOT NULL,
    "valor_liberado" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "metrica_expedicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documento_expedicao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "expedicao_id" UUID NOT NULL,
    "versao" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "referencia" TEXT,
    "anexo_id" UUID,

    CONSTRAINT "documento_expedicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correcao_expedicao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "expedicao_id" UUID NOT NULL,
    "versao" INTEGER NOT NULL,
    "motivo" TEXT NOT NULL,
    "antes" JSONB NOT NULL,
    "depois" JSONB NOT NULL,
    "autor_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "correcao_expedicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retorno_expedicao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "expedicao_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" "TipoRetorno" NOT NULL,
    "recebido_em" TIMESTAMPTZ(3) NOT NULL,
    "motivo" TEXT NOT NULL,
    "condicao" "CondicaoMaterial" NOT NULL,
    "palete_destino_id" UUID,
    "anexo_ids" UUID[],
    "observacoes" TEXT,
    "registrado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "retorno_expedicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linha_retorno" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "retorno_id" UUID NOT NULL,
    "linha_expedicao_id" UUID NOT NULL,
    "quantidade" DECIMAL(18,3) NOT NULL,

    CONSTRAINT "linha_retorno_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anexo_janela" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "janela_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo_conteudo" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "conteudo" BYTEA NOT NULL,
    "enviado_por_id" UUID NOT NULL,
    "enviado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "anexo_janela_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_janela" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "janela_id" UUID NOT NULL,
    "reserva_id" UUID,
    "expedicao_id" UUID,
    "retorno_id" UUID,
    "tipo" TEXT NOT NULL,
    "autor_id" UUID NOT NULL,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL,
    "resumo" TEXT NOT NULL,
    "detalhes" JSONB NOT NULL,

    CONSTRAINT "evento_janela_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "evento_liberacao_escopo_id_palete_id_ocorrido_em_idx" ON "evento_liberacao"("escopo_id", "palete_id", "ocorrido_em");

-- CreateIndex
CREATE INDEX "janela_devolucao_escopo_id_mes_referencia_idx" ON "janela_devolucao"("escopo_id", "mes_referencia");

-- CreateIndex
CREATE UNIQUE INDEX "janela_devolucao_escopo_id_numero_key" ON "janela_devolucao"("escopo_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "janela_devolucao_escopo_id_id_key" ON "janela_devolucao"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "restricao_janela_janela_id_metrica_key" ON "restricao_janela"("janela_id", "metrica");

-- CreateIndex
CREATE UNIQUE INDEX "restricao_janela_escopo_id_id_key" ON "restricao_janela"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "versao_regras_janela_janela_id_versao_key" ON "versao_regras_janela"("janela_id", "versao");

-- CreateIndex
CREATE INDEX "reserva_janela_escopo_id_janela_id_situacao_idx" ON "reserva_janela"("escopo_id", "janela_id", "situacao");

-- CreateIndex
CREATE UNIQUE INDEX "reserva_janela_escopo_id_numero_key" ON "reserva_janela"("escopo_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "reserva_janela_escopo_id_id_key" ON "reserva_janela"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "linha_reserva_escopo_id_palete_id_segmento_id_idx" ON "linha_reserva"("escopo_id", "palete_id", "segmento_id");

-- CreateIndex
CREATE UNIQUE INDEX "linha_reserva_reserva_id_palete_id_segmento_id_key" ON "linha_reserva"("reserva_id", "palete_id", "segmento_id");

-- CreateIndex
CREATE UNIQUE INDEX "linha_reserva_escopo_id_id_key" ON "linha_reserva"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "unidade_carga_reserva_reserva_id_palete_id_key" ON "unidade_carga_reserva"("reserva_id", "palete_id");

-- CreateIndex
CREATE INDEX "metrica_reserva_restricao_id_idx" ON "metrica_reserva"("restricao_id");

-- CreateIndex
CREATE UNIQUE INDEX "metrica_reserva_reserva_id_restricao_id_key" ON "metrica_reserva"("reserva_id", "restricao_id");

-- CreateIndex
CREATE UNIQUE INDEX "expedicao_escopo_id_reserva_id_key" ON "expedicao"("escopo_id", "reserva_id");

-- CreateIndex
CREATE UNIQUE INDEX "expedicao_escopo_id_numero_key" ON "expedicao"("escopo_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "expedicao_escopo_id_id_key" ON "expedicao"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "linha_expedicao_expedicao_id_idx" ON "linha_expedicao"("expedicao_id");

-- CreateIndex
CREATE UNIQUE INDEX "linha_expedicao_escopo_id_linha_reserva_id_key" ON "linha_expedicao"("escopo_id", "linha_reserva_id");

-- CreateIndex
CREATE UNIQUE INDEX "linha_expedicao_escopo_id_id_key" ON "linha_expedicao"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "unidade_carga_expedicao_expedicao_id_palete_id_key" ON "unidade_carga_expedicao"("expedicao_id", "palete_id");

-- CreateIndex
CREATE INDEX "metrica_expedicao_restricao_id_idx" ON "metrica_expedicao"("restricao_id");

-- CreateIndex
CREATE UNIQUE INDEX "metrica_expedicao_expedicao_id_restricao_id_key" ON "metrica_expedicao"("expedicao_id", "restricao_id");

-- CreateIndex
CREATE UNIQUE INDEX "documento_expedicao_expedicao_id_versao_ordem_key" ON "documento_expedicao"("expedicao_id", "versao", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "correcao_expedicao_expedicao_id_versao_key" ON "correcao_expedicao"("expedicao_id", "versao");

-- CreateIndex
CREATE UNIQUE INDEX "retorno_expedicao_escopo_id_numero_key" ON "retorno_expedicao"("escopo_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "retorno_expedicao_escopo_id_id_key" ON "retorno_expedicao"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "linha_retorno_linha_expedicao_id_idx" ON "linha_retorno"("linha_expedicao_id");

-- CreateIndex
CREATE UNIQUE INDEX "linha_retorno_retorno_id_linha_expedicao_id_key" ON "linha_retorno"("retorno_id", "linha_expedicao_id");

-- CreateIndex
CREATE UNIQUE INDEX "linha_retorno_escopo_id_id_key" ON "linha_retorno"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "anexo_janela_escopo_id_id_key" ON "anexo_janela"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "anexo_janela_janela_id_sha256_key" ON "anexo_janela"("janela_id", "sha256");

-- CreateIndex
CREATE INDEX "evento_janela_escopo_id_janela_id_ocorrido_em_idx" ON "evento_janela"("escopo_id", "janela_id", "ocorrido_em");

-- CreateIndex
CREATE UNIQUE INDEX "evento_estoque_expedicao_id_palete_id_key" ON "evento_estoque"("expedicao_id", "palete_id");

-- AddForeignKey
ALTER TABLE "palete" ADD CONSTRAINT "palete_bloqueado_por_id_fkey" FOREIGN KEY ("bloqueado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_declarado" ADD CONSTRAINT "item_declarado_escopo_id_linha_retorno_id_fkey" FOREIGN KEY ("escopo_id", "linha_retorno_id") REFERENCES "linha_retorno"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saldo_estoque" ADD CONSTRAINT "saldo_estoque_bloqueado_por_id_fkey" FOREIGN KEY ("bloqueado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_estoque" ADD CONSTRAINT "evento_estoque_escopo_id_expedicao_id_fkey" FOREIGN KEY ("escopo_id", "expedicao_id") REFERENCES "expedicao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_liberacao" ADD CONSTRAINT "evento_liberacao_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_liberacao" ADD CONSTRAINT "evento_liberacao_escopo_id_segmento_id_fkey" FOREIGN KEY ("escopo_id", "segmento_id") REFERENCES "segmento_estoque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_liberacao" ADD CONSTRAINT "evento_liberacao_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_liberacao" ADD CONSTRAINT "evento_liberacao_escopo_id_evento_estoque_id_fkey" FOREIGN KEY ("escopo_id", "evento_estoque_id") REFERENCES "evento_estoque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "janela_devolucao" ADD CONSTRAINT "janela_devolucao_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "janela_devolucao" ADD CONSTRAINT "janela_devolucao_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "janela_devolucao" ADD CONSTRAINT "janela_devolucao_confirmada_por_id_fkey" FOREIGN KEY ("confirmada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "janela_devolucao" ADD CONSTRAINT "janela_devolucao_encerrada_por_id_fkey" FOREIGN KEY ("encerrada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restricao_janela" ADD CONSTRAINT "restricao_janela_escopo_id_janela_id_fkey" FOREIGN KEY ("escopo_id", "janela_id") REFERENCES "janela_devolucao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versao_regras_janela" ADD CONSTRAINT "versao_regras_janela_escopo_id_janela_id_fkey" FOREIGN KEY ("escopo_id", "janela_id") REFERENCES "janela_devolucao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versao_regras_janela" ADD CONSTRAINT "versao_regras_janela_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva_janela" ADD CONSTRAINT "reserva_janela_escopo_id_janela_id_fkey" FOREIGN KEY ("escopo_id", "janela_id") REFERENCES "janela_devolucao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva_janela" ADD CONSTRAINT "reserva_janela_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva_janela" ADD CONSTRAINT "reserva_janela_encerrada_por_id_fkey" FOREIGN KEY ("encerrada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva_janela" ADD CONSTRAINT "reserva_janela_preparacao_responsavel_id_fkey" FOREIGN KEY ("preparacao_responsavel_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserva_janela" ADD CONSTRAINT "reserva_janela_preparacao_registrada_por_id_fkey" FOREIGN KEY ("preparacao_registrada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_reserva" ADD CONSTRAINT "linha_reserva_escopo_id_reserva_id_fkey" FOREIGN KEY ("escopo_id", "reserva_id") REFERENCES "reserva_janela"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_reserva" ADD CONSTRAINT "linha_reserva_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_reserva" ADD CONSTRAINT "linha_reserva_escopo_id_segmento_id_fkey" FOREIGN KEY ("escopo_id", "segmento_id") REFERENCES "segmento_estoque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidade_carga_reserva" ADD CONSTRAINT "unidade_carga_reserva_escopo_id_reserva_id_fkey" FOREIGN KEY ("escopo_id", "reserva_id") REFERENCES "reserva_janela"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidade_carga_reserva" ADD CONSTRAINT "unidade_carga_reserva_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidade_carga_reserva" ADD CONSTRAINT "unidade_carga_reserva_informado_por_id_fkey" FOREIGN KEY ("informado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrica_reserva" ADD CONSTRAINT "metrica_reserva_escopo_id_reserva_id_fkey" FOREIGN KEY ("escopo_id", "reserva_id") REFERENCES "reserva_janela"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrica_reserva" ADD CONSTRAINT "metrica_reserva_escopo_id_restricao_id_fkey" FOREIGN KEY ("escopo_id", "restricao_id") REFERENCES "restricao_janela"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedicao" ADD CONSTRAINT "expedicao_escopo_id_janela_id_fkey" FOREIGN KEY ("escopo_id", "janela_id") REFERENCES "janela_devolucao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedicao" ADD CONSTRAINT "expedicao_escopo_id_reserva_id_fkey" FOREIGN KEY ("escopo_id", "reserva_id") REFERENCES "reserva_janela"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedicao" ADD CONSTRAINT "expedicao_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expedicao" ADD CONSTRAINT "expedicao_confirmada_por_id_fkey" FOREIGN KEY ("confirmada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_expedicao" ADD CONSTRAINT "linha_expedicao_escopo_id_expedicao_id_fkey" FOREIGN KEY ("escopo_id", "expedicao_id") REFERENCES "expedicao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_expedicao" ADD CONSTRAINT "linha_expedicao_escopo_id_linha_reserva_id_fkey" FOREIGN KEY ("escopo_id", "linha_reserva_id") REFERENCES "linha_reserva"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_expedicao" ADD CONSTRAINT "linha_expedicao_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_expedicao" ADD CONSTRAINT "linha_expedicao_escopo_id_segmento_id_fkey" FOREIGN KEY ("escopo_id", "segmento_id") REFERENCES "segmento_estoque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidade_carga_expedicao" ADD CONSTRAINT "unidade_carga_expedicao_escopo_id_expedicao_id_fkey" FOREIGN KEY ("escopo_id", "expedicao_id") REFERENCES "expedicao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidade_carga_expedicao" ADD CONSTRAINT "unidade_carga_expedicao_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrica_expedicao" ADD CONSTRAINT "metrica_expedicao_escopo_id_expedicao_id_fkey" FOREIGN KEY ("escopo_id", "expedicao_id") REFERENCES "expedicao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrica_expedicao" ADD CONSTRAINT "metrica_expedicao_escopo_id_restricao_id_fkey" FOREIGN KEY ("escopo_id", "restricao_id") REFERENCES "restricao_janela"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_expedicao" ADD CONSTRAINT "documento_expedicao_escopo_id_expedicao_id_fkey" FOREIGN KEY ("escopo_id", "expedicao_id") REFERENCES "expedicao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento_expedicao" ADD CONSTRAINT "documento_expedicao_escopo_id_anexo_id_fkey" FOREIGN KEY ("escopo_id", "anexo_id") REFERENCES "anexo_janela"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correcao_expedicao" ADD CONSTRAINT "correcao_expedicao_escopo_id_expedicao_id_fkey" FOREIGN KEY ("escopo_id", "expedicao_id") REFERENCES "expedicao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correcao_expedicao" ADD CONSTRAINT "correcao_expedicao_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retorno_expedicao" ADD CONSTRAINT "retorno_expedicao_escopo_id_expedicao_id_fkey" FOREIGN KEY ("escopo_id", "expedicao_id") REFERENCES "expedicao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retorno_expedicao" ADD CONSTRAINT "retorno_expedicao_escopo_id_palete_destino_id_fkey" FOREIGN KEY ("escopo_id", "palete_destino_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retorno_expedicao" ADD CONSTRAINT "retorno_expedicao_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_retorno" ADD CONSTRAINT "linha_retorno_escopo_id_retorno_id_fkey" FOREIGN KEY ("escopo_id", "retorno_id") REFERENCES "retorno_expedicao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_retorno" ADD CONSTRAINT "linha_retorno_escopo_id_linha_expedicao_id_fkey" FOREIGN KEY ("escopo_id", "linha_expedicao_id") REFERENCES "linha_expedicao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo_janela" ADD CONSTRAINT "anexo_janela_escopo_id_janela_id_fkey" FOREIGN KEY ("escopo_id", "janela_id") REFERENCES "janela_devolucao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexo_janela" ADD CONSTRAINT "anexo_janela_enviado_por_id_fkey" FOREIGN KEY ("enviado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_janela" ADD CONSTRAINT "evento_janela_escopo_id_janela_id_fkey" FOREIGN KEY ("escopo_id", "janela_id") REFERENCES "janela_devolucao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_janela" ADD CONSTRAINT "evento_janela_escopo_id_reserva_id_fkey" FOREIGN KEY ("escopo_id", "reserva_id") REFERENCES "reserva_janela"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_janela" ADD CONSTRAINT "evento_janela_escopo_id_expedicao_id_fkey" FOREIGN KEY ("escopo_id", "expedicao_id") REFERENCES "expedicao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_janela" ADD CONSTRAINT "evento_janela_escopo_id_retorno_id_fkey" FOREIGN KEY ("escopo_id", "retorno_id") REFERENCES "retorno_expedicao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evento_janela" ADD CONSTRAINT "evento_janela_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Regras do banco da etapa 08 (além do que o Prisma modela).
-- =====================================================================

-- Conferência em andamento bloqueia mudança de conteúdo (quantidade, entrada
-- ou saída de linha de saldo), não a reserva, a liberação ou o cancelamento
-- de reserva (que não mudam o físico).
CREATE OR REPLACE FUNCTION "impedir_saldo_em_conferencia"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  paletes uuid[];
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."quantidade" = OLD."quantidade" AND NEW."palete_id" = OLD."palete_id" AND NEW."segmento_id" = OLD."segmento_id" THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    paletes := ARRAY[NEW."palete_id"];
  ELSIF TG_OP = 'DELETE' THEN
    paletes := ARRAY[OLD."palete_id"];
  ELSE
    paletes := ARRAY[OLD."palete_id", NEW."palete_id"];
  END IF;
  IF EXISTS (SELECT 1 FROM "sessao_conferencia" s WHERE s."palete_id" = ANY (paletes) AND s."ativa") THEN
    RAISE EXCEPTION 'PALETE_EM_CONFERENCIA: o saldo deste palete não muda durante uma conferência em andamento'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ---------- Liberação: conversão dos estados anteriores ----------

-- Palete liberado (estado do palete, anterior à etapa 08): todo o saldo validado
-- fica liberado; palete bloqueado: bloqueio do palete inteiro com o motivo que
-- havia. O histórico registra a conversão (autor nulo = migração).
INSERT INTO "evento_liberacao" ("id", "escopo_id", "palete_id", "segmento_id", "tipo", "quantidade", "liberada_anterior", "liberada_posterior", "motivo", "ocorrido_em")
SELECT uuid_deterministico('liberacao-migracao:' || s."id"::text), s."escopo_id", s."palete_id", s."segmento_id", 'MIGRACAO', s."quantidade", 0, s."quantidade",
       'Palete liberado antes da etapa 08: saldo validado liberado na conversão', now()
  FROM "saldo_estoque" s JOIN "palete" p ON p."id" = s."palete_id"
 WHERE p."estado_liberacao" = 'LIBERADO' AND s."quantidade" > 0;
UPDATE "saldo_estoque" s SET "quantidade_liberada" = s."quantidade"
  FROM "palete" p WHERE p."id" = s."palete_id" AND p."estado_liberacao" = 'LIBERADO';
-- Reserva existente (nenhuma no modelo anterior) nunca fica acima do liberado.
UPDATE "saldo_estoque" SET "quantidade_liberada" = "quantidade_reservada" WHERE "quantidade_reservada" > "quantidade_liberada";

INSERT INTO "evento_liberacao" ("id", "escopo_id", "palete_id", "tipo", "motivo", "ocorrido_em")
SELECT uuid_deterministico('bloqueio-migracao:' || p."id"::text), p."escopo_id", p."id", 'MIGRACAO',
       'Palete bloqueado antes da etapa 08: ' || coalesce(p."motivo_pendencia", 'sem motivo registrado'), now()
  FROM "palete" p WHERE p."estado_liberacao" = 'BLOQUEADO';
UPDATE "palete" SET "bloqueio_motivo" = left(coalesce("motivo_pendencia", 'Bloqueio registrado antes da etapa 08'), 500), "bloqueado_em" = "atualizado_em"
 WHERE "estado_liberacao" = 'BLOQUEADO';

-- ---------- Liberação: coerência ----------

ALTER TABLE "saldo_estoque" ADD CONSTRAINT "saldo_liberacao_coerente"
  CHECK ("quantidade_liberada" >= 0 AND "quantidade_liberada" <= "quantidade" AND "quantidade_reservada" <= "quantidade_liberada"
         AND ("bloqueio_motivo" IS NULL) = ("bloqueado_em" IS NULL)
         AND ("bloqueio_motivo" IS NULL OR char_length("bloqueio_motivo") BETWEEN 3 AND 500));
ALTER TABLE "palete" ADD CONSTRAINT "palete_bloqueio_coerente"
  CHECK (("bloqueio_motivo" IS NULL) = ("bloqueado_em" IS NULL)
         AND ("bloqueio_motivo" IS NULL OR char_length("bloqueio_motivo") BETWEEN 3 AND 500));

ALTER TABLE "evento_liberacao" ADD CONSTRAINT "evento_liberacao_coerente"
  CHECK ("tipo" IN ('LIBERAR', 'REVOGAR', 'BLOQUEAR', 'DESBLOQUEAR', 'BLOQUEAR_PALETE', 'DESBLOQUEAR_PALETE', 'AJUSTE_SALDO', 'HERANCA_BLOQUEIO', 'MIGRACAO')
         AND char_length("motivo") BETWEEN 3 AND 600
         AND ("tipo" NOT IN ('LIBERAR', 'REVOGAR') OR ("segmento_id" IS NOT NULL AND "quantidade" > 0 AND "liberada_anterior" IS NOT NULL AND "liberada_posterior" IS NOT NULL))
         AND ("tipo" <> 'LIBERAR' OR ("criterio" IS NOT NULL AND "fonte" IS NOT NULL AND "autor_id" IS NOT NULL))
         AND ("tipo" NOT IN ('BLOQUEAR', 'DESBLOQUEAR', 'HERANCA_BLOQUEIO') OR "segmento_id" IS NOT NULL)
         AND ("tipo" NOT IN ('BLOQUEAR_PALETE', 'DESBLOQUEAR_PALETE') OR "segmento_id" IS NULL)
         AND ("tipo" = 'MIGRACAO' OR "tipo" IN ('AJUSTE_SALDO', 'HERANCA_BLOQUEIO') OR "autor_id" IS NOT NULL));
CREATE TRIGGER "evento_liberacao_imutavel" BEFORE UPDATE OR DELETE ON "evento_liberacao"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();

-- Resumo de liberação e de fluxo do palete (mesma regra do serviço, que o
-- recalcula na transação de cada mudança): bloqueado se o palete ou alguma
-- linha estiver bloqueada; liberado se reconciliado, com saldo e tudo
-- liberado; senão pendente. Fluxo: expedido e arquivado são finais; com
-- reserva ativa, reservado; senão em estoque.
CREATE FUNCTION "resumo_liberacao_palete"(p_palete uuid) RETURNS "EstadoLiberacao"
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p."bloqueio_motivo" IS NOT NULL OR EXISTS (SELECT 1 FROM "saldo_estoque" s WHERE s."palete_id" = p."id" AND s."bloqueio_motivo" IS NOT NULL)
      THEN 'BLOQUEADO'::"EstadoLiberacao"
    WHEN p."estado_conferencia" = 'RECONCILIADO'
         AND EXISTS (SELECT 1 FROM "saldo_estoque" s WHERE s."palete_id" = p."id")
         AND NOT EXISTS (SELECT 1 FROM "saldo_estoque" s WHERE s."palete_id" = p."id" AND s."quantidade_liberada" < s."quantidade")
      THEN 'LIBERADO'::"EstadoLiberacao"
    ELSE 'PENDENTE'::"EstadoLiberacao"
  END
  FROM "palete" p WHERE p."id" = p_palete
$$;

CREATE FUNCTION "resumo_fluxo_palete"(p_palete uuid) RETURNS "EstadoFluxo"
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN p."estado_fluxo" IN ('EXPEDIDO', 'VAZIO_ARQUIVADO') THEN p."estado_fluxo"
    WHEN EXISTS (SELECT 1 FROM "saldo_estoque" s WHERE s."palete_id" = p."id" AND s."quantidade_reservada" > 0) THEN 'RESERVADO'::"EstadoFluxo"
    ELSE 'EM_ESTOQUE'::"EstadoFluxo"
  END
  FROM "palete" p WHERE p."id" = p_palete
$$;

UPDATE "palete" SET "estado_liberacao" = resumo_liberacao_palete("id"), "estado_fluxo" = resumo_fluxo_palete("id");

-- Palete expedido saiu da praça: sem posição.
ALTER TABLE "palete" ADD CONSTRAINT "palete_expedido_sem_posicao" CHECK ("estado_fluxo" <> 'EXPEDIDO' OR "posicao_id" IS NULL);

-- ---------- Eventos de estoque: baixa por expedição ----------

ALTER TABLE "evento_estoque" DROP CONSTRAINT "evento_estoque_coerente";
ALTER TABLE "evento_estoque" ADD CONSTRAINT "evento_estoque_coerente"
  CHECK ("versao_saldo_posterior" = "versao_saldo_anterior" + 1
         AND char_length("motivo") >= 3
         AND ("tipo"::text <> 'AJUSTE_RECONCILIACAO' OR "sessao_id" IS NOT NULL)
         AND ("tipo"::text <> 'SALDO_INICIAL' OR "evento_anterior_id" IS NULL)
         AND ("tipo"::text IN ('SALDO_INICIAL', 'AJUSTE_RECONCILIACAO') OR "sessao_id" IS NULL)
         AND (("tipo"::text IN ('TRANSFERENCIA', 'CORRECAO_TRANSFERENCIA'))
              = ("palete_destino_id" IS NOT NULL AND "versao_saldo_destino_anterior" IS NOT NULL AND "versao_saldo_destino_posterior" IS NOT NULL))
         AND ("palete_destino_id" IS NOT NULL OR ("versao_saldo_destino_anterior" IS NULL AND "versao_saldo_destino_posterior" IS NULL))
         AND ("palete_destino_id" IS NULL OR ("palete_destino_id" <> "palete_id"
              AND "versao_saldo_destino_posterior" = "versao_saldo_destino_anterior" + 1))
         AND (("tipo"::text = 'CORRECAO_TRANSFERENCIA') = ("evento_corrigido_id" IS NOT NULL))
         AND (("tipo"::text = 'EXPEDICAO') = ("expedicao_id" IS NOT NULL))
         AND "evento_corrigido_id" IS DISTINCT FROM "id");

-- Baixa por expedição: somente saídas (delta negativo) do palete do evento.
CREATE FUNCTION "verificar_linha_expedicao_estoque"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "evento_estoque" e WHERE e."id" = NEW."evento_id" AND e."tipo"::text = 'EXPEDICAO'
                AND (NEW."delta" >= 0 OR NEW."palete_id" <> e."palete_id")) THEN
    RAISE EXCEPTION 'HISTORICO_IMUTAVEL: a expedição só baixa saldo do palete do evento' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "linha_evento_expedicao_valida" BEFORE INSERT ON "linha_evento_estoque"
FOR EACH ROW EXECUTE FUNCTION "verificar_linha_expedicao_estoque"();

-- ---------- Janela ----------

ALTER TABLE "janela_devolucao" ADD CONSTRAINT "janela_coerente"
  CHECK ("numero" >= 1 AND "codigo" = 'JAN-' || lpad("numero"::text, 6, '0') AND "versao" >= 1 AND "versao_regras" >= 1
         AND texto_curto_valido("nome", 120) AND "nome" IS NOT NULL
         AND texto_curto_valido("referencia_cliente", 80)
         AND "mes_referencia" = date_trunc('month', "mes_referencia")::date
         AND (("saida_inicio" IS NULL) = ("saida_fim" IS NULL))
         AND ("saida_fim" IS NULL OR "saida_fim" >= "saida_inicio")
         AND (NOT "criterios_definidos" OR cardinality("condicoes_aceitas") >= 1)
         AND ("origem_qualquer" OR cardinality("origens_aceitas") >= 1)
         AND cardinality("documentos_exigidos") <= 20
         AND texto_curto_valido("autorizacao_fonte", 120) AND texto_curto_valido("autorizacao_referencia", 120)
         AND texto_curto_valido("autorizacao_responsavel", 120)
         -- Confirmada: autorização registrada e intervalo de saída conhecido.
         AND ("situacao" = 'RASCUNHO' OR "situacao" = 'CANCELADA'
              OR ("confirmada_em" IS NOT NULL AND "confirmada_por_id" IS NOT NULL AND "saida_inicio" IS NOT NULL
                  AND "autorizacao_fonte" IS NOT NULL AND "autorizacao_referencia" IS NOT NULL AND "autorizacao_data" IS NOT NULL
                  AND "autorizacao_responsavel" IS NOT NULL))
         AND (("situacao" IN ('ENCERRADA', 'CANCELADA'))
              = ("encerrada_em" IS NOT NULL AND "encerrada_por_id" IS NOT NULL AND "motivo_encerramento" IS NOT NULL)));

CREATE FUNCTION "proteger_janela"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'JANELA_IMUTAVEL: janelas não são apagadas; cancele ou encerre com motivo' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."situacao" IN ('ENCERRADA', 'CANCELADA') THEN
    RAISE EXCEPTION 'JANELA_IMUTAVEL: janela encerrada ou cancelada não muda' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."escopo_id", NEW."numero", NEW."codigo", NEW."criado_por_id", NEW."criado_em")
     IS DISTINCT FROM (OLD."id", OLD."escopo_id", OLD."numero", OLD."codigo", OLD."criado_por_id", OLD."criado_em")
     OR NEW."versao" < OLD."versao" OR NEW."versao_regras" < OLD."versao_regras"
     OR (OLD."situacao" <> 'RASCUNHO' AND NEW."situacao" = 'RASCUNHO') THEN
    RAISE EXCEPTION 'JANELA_IMUTAVEL: identidade, versão ou situação da janela não retrocedem' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "janela_protegida" BEFORE UPDATE OR DELETE ON "janela_devolucao"
FOR EACH ROW EXECUTE FUNCTION "proteger_janela"();

-- Restrição: limite nulo = pendente (sem reserva nem expedição); reservado +
-- expedido nunca passam do limite; caixas e paletes são inteiros.
ALTER TABLE "restricao_janela" ADD CONSTRAINT "restricao_janela_coerente"
  CHECK ("reservado" >= 0 AND "expedido" >= 0 AND ("limite" IS NULL OR "limite" >= 0)
         AND (("metrica" = 'PESO_KG') = ("base_peso" IS NOT NULL))
         AND ("metrica" NOT IN ('CAIXAS', 'PALETES')
              OR (coalesce("limite", 0) % 1 = 0 AND "reservado" % 1 = 0 AND "expedido" % 1 = 0))
         AND texto_curto_valido("unidade", 20) AND "unidade" IS NOT NULL);
ALTER TABLE "restricao_janela" ADD CONSTRAINT "restricao_dentro_do_limite"
  CHECK (("limite" IS NULL AND "reservado" = 0 AND "expedido" = 0) OR ("limite" IS NOT NULL AND "reservado" + "expedido" <= "limite"));

CREATE FUNCTION "proteger_restricao_janela"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."reservado" <> 0 OR OLD."expedido" <> 0 THEN
      RAISE EXCEPTION 'JANELA_IMUTAVEL: restrição com reserva ou expedição não é removida' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW."id", NEW."escopo_id", NEW."janela_id", NEW."metrica") IS DISTINCT FROM (OLD."id", OLD."escopo_id", OLD."janela_id", OLD."metrica")
     OR ((NEW."unidade", NEW."base_peso") IS DISTINCT FROM (OLD."unidade", OLD."base_peso") AND (OLD."reservado" <> 0 OR OLD."expedido" <> 0)) THEN
    RAISE EXCEPTION 'JANELA_IMUTAVEL: métrica, unidade ou base de uma restrição em uso não mudam' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "restricao_janela_protegida" BEFORE UPDATE OR DELETE ON "restricao_janela"
FOR EACH ROW EXECUTE FUNCTION "proteger_restricao_janela"();

CREATE TRIGGER "versao_regras_janela_imutavel" BEFORE UPDATE OR DELETE ON "versao_regras_janela"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();

ALTER TABLE "evento_janela" ADD CONSTRAINT "evento_janela_coerente"
  CHECK ("tipo" IN ('JANELA_CRIADA', 'JANELA_ALTERADA', 'REGRAS_ALTERADAS', 'JANELA_CONFIRMADA', 'PREPARACAO_INICIADA', 'JANELA_ENCERRADA',
                    'JANELA_CANCELADA', 'ANEXO_ENVIADO', 'RESERVA_CRIADA', 'RESERVA_CANCELADA', 'RESERVA_LIBERADA', 'PREPARACAO_REGISTRADA',
                    'MEDIDAS_ALTERADAS', 'EXPEDICAO_CONFIRMADA', 'EXPEDICAO_CORRIGIDA', 'RETORNO_REGISTRADO')
         AND char_length("resumo") BETWEEN 1 AND 500);
CREATE TRIGGER "evento_janela_imutavel" BEFORE UPDATE OR DELETE ON "evento_janela"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();

ALTER TABLE "anexo_janela" ADD CONSTRAINT "anexo_janela_coerente"
  CHECK ("tamanho" > 0 AND "tamanho" = octet_length("conteudo") AND "sha256" ~ '^[0-9a-f]{64}$'
         AND "tipo_conteudo" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') AND texto_curto_valido("nome", 200) AND "nome" IS NOT NULL);
CREATE TRIGGER "anexo_janela_imutavel" BEFORE UPDATE OR DELETE ON "anexo_janela"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();

-- ---------- Reserva ----------

ALTER TABLE "reserva_janela" ADD CONSTRAINT "reserva_coerente"
  CHECK ("numero" >= 1 AND "codigo" = 'RES-' || lpad("numero"::text, 6, '0') AND "versao" >= 1 AND "versao_regras" >= 1
         AND (("situacao" = 'ATIVA') = ("encerrada_em" IS NULL))
         AND ("situacao" = 'ATIVA' OR "encerrada_por_id" IS NOT NULL)
         AND ("situacao" NOT IN ('LIBERADA', 'CANCELADA') OR "motivo_encerramento" IS NOT NULL)
         AND (NOT "consumo_parcial" OR "situacao" = 'CONSUMIDA')
         AND (("preparacao" = 'PENDENTE') = ("preparada_em" IS NULL))
         AND ("preparacao" = 'PENDENTE' OR ("preparacao_responsavel_id" IS NOT NULL AND "preparacao_registrada_por_id" IS NOT NULL AND "preparacao_registrada_em" IS NOT NULL)));

-- Reserva encerrada (liberada, consumida, cancelada) não volta nem muda.
CREATE FUNCTION "proteger_reserva"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'JANELA_IMUTAVEL: reservas não são apagadas; ficam no histórico' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."situacao" <> 'ATIVA' THEN
    RAISE EXCEPTION 'JANELA_IMUTAVEL: reserva % não muda depois de encerrada', OLD."situacao" USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."escopo_id", NEW."janela_id", NEW."numero", NEW."codigo", NEW."versao_regras", NEW."fotografia_criterios", NEW."criado_por_id", NEW."criado_em")
     IS DISTINCT FROM (OLD."id", OLD."escopo_id", OLD."janela_id", OLD."numero", OLD."codigo", OLD."versao_regras", OLD."fotografia_criterios", OLD."criado_por_id", OLD."criado_em")
     OR NEW."versao" <> OLD."versao" + 1 THEN
    RAISE EXCEPTION 'JANELA_IMUTAVEL: a fotografia e a janela de uma reserva não mudam' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "reserva_protegida" BEFORE UPDATE OR DELETE ON "reserva_janela"
FOR EACH ROW EXECUTE FUNCTION "proteger_reserva"();

ALTER TABLE "linha_reserva" ADD CONSTRAINT "linha_reserva_coerente"
  CHECK ("quantidade" > 0
         AND ("quantidade_preparada" IS NULL OR "quantidade_preparada" >= 0)
         AND (("quantidade_enviada" IS NULL) = ("quantidade_liberada" IS NULL))
         AND ("quantidade_enviada" IS NULL OR ("quantidade_enviada" >= 0 AND "quantidade_liberada" >= 0
              AND "quantidade_enviada" + "quantidade_liberada" = "quantidade")));

CREATE FUNCTION "proteger_linha_reserva"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'JANELA_IMUTAVEL: linhas de reserva não são apagadas' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."escopo_id", NEW."reserva_id", NEW."palete_id", NEW."segmento_id", NEW."quantidade", NEW."unidade", NEW."sku", NEW."lote",
      NEW."origem_tipo", NEW."origem_referencia", NEW."condicao", NEW."palete_codigo", NEW."posicao_codigo")
     IS DISTINCT FROM (OLD."id", OLD."escopo_id", OLD."reserva_id", OLD."palete_id", OLD."segmento_id", OLD."quantidade", OLD."unidade", OLD."sku", OLD."lote",
      OLD."origem_tipo", OLD."origem_referencia", OLD."condicao", OLD."palete_codigo", OLD."posicao_codigo")
     OR (OLD."quantidade_enviada" IS NOT NULL) THEN
    RAISE EXCEPTION 'JANELA_IMUTAVEL: a fotografia da linha reservada não muda' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "linha_reserva_protegida" BEFORE UPDATE OR DELETE ON "linha_reserva"
FOR EACH ROW EXECUTE FUNCTION "proteger_linha_reserva"();

ALTER TABLE "unidade_carga_reserva" ADD CONSTRAINT "unidade_carga_reserva_coerente"
  CHECK (coalesce("caixas", 0) >= 0 AND coalesce("peso_kg", 0) >= 0 AND coalesce("volume_m3", 0) >= 0
         AND ("peso_kg" IS NULL OR "base_peso" IS NOT NULL) AND "versao" >= 1
         AND (("caixas" IS NULL AND "peso_kg" IS NULL AND "volume_m3" IS NULL) OR "fonte_medida" IS NOT NULL)
         AND texto_curto_valido("fonte_medida", 120));
ALTER TABLE "metrica_reserva" ADD CONSTRAINT "metrica_reserva_coerente"
  CHECK ("valor" >= 0 AND "valor_inicial" >= 0 AND char_length("base") BETWEEN 1 AND 300);

-- ---------- Expedição ----------

ALTER TABLE "expedicao" ADD CONSTRAINT "expedicao_coerente"
  CHECK ("numero" >= 1 AND "codigo" = 'EXP-' || lpad("numero"::text, 6, '0') AND "versao" >= 1);

-- Expedição concluída não é desfeita: só a versão e as observações mudam
-- (correção de informação registrada em correcao_expedicao).
CREATE FUNCTION "proteger_expedicao"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'JANELA_IMUTAVEL: expedição confirmada não é apagada nem cancelada' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."escopo_id", NEW."janela_id", NEW."reserva_id", NEW."numero", NEW."codigo", NEW."saida_em", NEW."responsavel_id",
      NEW."confirmada_por_id", NEW."confirmada_em", NEW."parcial")
     IS DISTINCT FROM (OLD."id", OLD."escopo_id", OLD."janela_id", OLD."reserva_id", OLD."numero", OLD."codigo", OLD."saida_em", OLD."responsavel_id",
      OLD."confirmada_por_id", OLD."confirmada_em", OLD."parcial")
     OR NEW."versao" <> OLD."versao" + 1 THEN
    RAISE EXCEPTION 'JANELA_IMUTAVEL: a expedição confirmada só recebe correção de informação versionada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "expedicao_protegida" BEFORE UPDATE OR DELETE ON "expedicao"
FOR EACH ROW EXECUTE FUNCTION "proteger_expedicao"();

ALTER TABLE "linha_expedicao" ADD CONSTRAINT "linha_expedicao_coerente"
  CHECK ("quantidade_enviada" >= 0 AND "quantidade_liberada" >= 0 AND "quantidade_enviada" + "quantidade_liberada" = "quantidade_reservada");
ALTER TABLE "linha_expedicao" ADD CONSTRAINT "linha_expedicao_retorno_limite"
  CHECK ("quantidade_retornada" >= 0 AND "quantidade_retornada" <= "quantidade_enviada");

CREATE FUNCTION "proteger_linha_expedicao"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'JANELA_IMUTAVEL: linhas expedidas não são apagadas' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."id", NEW."escopo_id", NEW."expedicao_id", NEW."linha_reserva_id", NEW."palete_id", NEW."segmento_id", NEW."quantidade_reservada",
      NEW."quantidade_enviada", NEW."quantidade_liberada", NEW."sku", NEW."lote", NEW."origem_tipo", NEW."origem_referencia", NEW."condicao")
     IS DISTINCT FROM (OLD."id", OLD."escopo_id", OLD."expedicao_id", OLD."linha_reserva_id", OLD."palete_id", OLD."segmento_id", OLD."quantidade_reservada",
      OLD."quantidade_enviada", OLD."quantidade_liberada", OLD."sku", OLD."lote", OLD."origem_tipo", OLD."origem_referencia", OLD."condicao")
     OR NEW."quantidade_retornada" < OLD."quantidade_retornada" THEN
    RAISE EXCEPTION 'JANELA_IMUTAVEL: a linha expedida só acumula retornos físicos registrados' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "linha_expedicao_protegida" BEFORE UPDATE OR DELETE ON "linha_expedicao"
FOR EACH ROW EXECUTE FUNCTION "proteger_linha_expedicao"();

ALTER TABLE "unidade_carga_expedicao" ADD CONSTRAINT "unidade_carga_expedicao_coerente"
  CHECK (coalesce("caixas", 0) >= 0 AND coalesce("peso_kg", 0) >= 0 AND coalesce("volume_m3", 0) >= 0 AND ("peso_kg" IS NULL OR "base_peso" IS NOT NULL));
ALTER TABLE "metrica_expedicao" ADD CONSTRAINT "metrica_expedicao_coerente"
  CHECK ("valor_expedido" >= 0 AND "valor_liberado" >= 0 AND "valor_expedido" + "valor_liberado" = "valor_reservado");
ALTER TABLE "documento_expedicao" ADD CONSTRAINT "documento_expedicao_coerente"
  CHECK ("versao" >= 1 AND "ordem" >= 0 AND texto_curto_valido("nome", 80) AND texto_curto_valido("referencia", 120)
         AND ("referencia" IS NOT NULL OR "anexo_id" IS NOT NULL));
ALTER TABLE "correcao_expedicao" ADD CONSTRAINT "correcao_expedicao_coerente" CHECK ("versao" >= 2 AND char_length("motivo") BETWEEN 3 AND 500);
CREATE TRIGGER "unidade_carga_expedicao_imutavel" BEFORE UPDATE OR DELETE ON "unidade_carga_expedicao"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();
CREATE TRIGGER "metrica_expedicao_imutavel" BEFORE UPDATE OR DELETE ON "metrica_expedicao"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();
CREATE TRIGGER "documento_expedicao_imutavel" BEFORE UPDATE OR DELETE ON "documento_expedicao"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();
CREATE TRIGGER "correcao_expedicao_imutavel" BEFORE UPDATE OR DELETE ON "correcao_expedicao"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();

-- ---------- Retorno ----------

ALTER TABLE "retorno_expedicao" ADD CONSTRAINT "retorno_coerente"
  CHECK ("numero" >= 1 AND "codigo" = 'RET-' || lpad("numero"::text, 6, '0') AND char_length("motivo") BETWEEN 3 AND 500
         AND cardinality("anexo_ids") <= 10
         AND ("tipo" <> 'RECEBIMENTO_FISICO' OR ("palete_destino_id" IS NOT NULL AND cardinality("anexo_ids") >= 1)));
ALTER TABLE "linha_retorno" ADD CONSTRAINT "linha_retorno_coerente" CHECK ("quantidade" > 0);
CREATE TRIGGER "retorno_expedicao_imutavel" BEFORE UPDATE OR DELETE ON "retorno_expedicao"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();
CREATE TRIGGER "linha_retorno_imutavel" BEFORE UPDATE OR DELETE ON "linha_retorno"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();

-- ---------- Totais conferidos no COMMIT (gatilhos adiados) ----------

-- Reservado do saldo = soma das linhas de reservas ativas do palete × segmento:
-- não há segundo saldo disponível paralelo; reserva só pela tabela de reservas.
CREATE FUNCTION "conferir_reserva_saldo"(p_palete uuid, p_segmento uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_saldo numeric;
  v_soma numeric;
BEGIN
  SELECT coalesce(max("quantidade_reservada"), 0) INTO v_saldo FROM "saldo_estoque" WHERE "palete_id" = p_palete AND "segmento_id" = p_segmento;
  SELECT coalesce(sum(l."quantidade"), 0) INTO v_soma
    FROM "linha_reserva" l JOIN "reserva_janela" r ON r."id" = l."reserva_id"
   WHERE l."palete_id" = p_palete AND l."segmento_id" = p_segmento AND r."situacao" = 'ATIVA';
  IF v_saldo <> v_soma THEN
    RAISE EXCEPTION 'RESERVA_INCOERENTE: reservado no saldo (%) diferente das reservas ativas (%)', v_saldo, v_soma USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION "conferir_saldo_reservado"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM conferir_reserva_saldo(OLD."palete_id", OLD."segmento_id");
  ELSIF TG_OP = 'INSERT' OR NEW."quantidade_reservada" IS DISTINCT FROM OLD."quantidade_reservada" THEN
    PERFORM conferir_reserva_saldo(NEW."palete_id", NEW."segmento_id");
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "saldo_estoque_reserva_coerente"
AFTER INSERT OR UPDATE OR DELETE ON "saldo_estoque"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "conferir_saldo_reservado"();

CREATE FUNCTION "conferir_linha_reservada"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM conferir_reserva_saldo(NEW."palete_id", NEW."segmento_id");
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "linha_reserva_saldo_coerente"
AFTER INSERT OR UPDATE ON "linha_reserva"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "conferir_linha_reservada"();

-- Capacidade: reservado e expedido de cada restrição = métricas das reservas
-- ativas e das expedições confirmadas.
CREATE FUNCTION "conferir_restricao"(p_restricao uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_r record;
  v_reservado numeric;
  v_expedido numeric;
BEGIN
  SELECT "reservado", "expedido" INTO v_r FROM "restricao_janela" WHERE "id" = p_restricao;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT coalesce(sum(m."valor"), 0) INTO v_reservado
    FROM "metrica_reserva" m JOIN "reserva_janela" r ON r."id" = m."reserva_id"
   WHERE m."restricao_id" = p_restricao AND r."situacao" = 'ATIVA';
  SELECT coalesce(sum("valor_expedido"), 0) INTO v_expedido FROM "metrica_expedicao" WHERE "restricao_id" = p_restricao;
  IF v_r."reservado" <> v_reservado OR v_r."expedido" <> v_expedido THEN
    RAISE EXCEPTION 'JANELA_INCOERENTE: capacidade da restrição (reservado %, expedido %) diferente dos registros (%, %)',
      v_r."reservado", v_r."expedido", v_reservado, v_expedido USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION "conferir_restricao_alterada"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM conferir_restricao(NEW."id");
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "restricao_janela_totais_coerentes"
AFTER INSERT OR UPDATE ON "restricao_janela"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "conferir_restricao_alterada"();

CREATE FUNCTION "conferir_metrica_restricao"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM conferir_restricao(NEW."restricao_id");
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "metrica_reserva_totais_coerentes"
AFTER INSERT OR UPDATE ON "metrica_reserva"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "conferir_metrica_restricao"();
CREATE CONSTRAINT TRIGGER "metrica_expedicao_totais_coerentes"
AFTER INSERT ON "metrica_expedicao"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "conferir_metrica_restricao"();

-- Mudança de situação da reserva: confere saldo das linhas e capacidade.
CREATE FUNCTION "conferir_reserva_encerrada"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_l record;
BEGIN
  IF NEW."situacao" IS DISTINCT FROM OLD."situacao" THEN
    FOR v_l IN SELECT DISTINCT "palete_id", "segmento_id" FROM "linha_reserva" WHERE "reserva_id" = NEW."id" LOOP
      PERFORM conferir_reserva_saldo(v_l."palete_id", v_l."segmento_id");
    END LOOP;
    FOR v_l IN SELECT "restricao_id" FROM "metrica_reserva" WHERE "reserva_id" = NEW."id" LOOP
      PERFORM conferir_restricao(v_l."restricao_id");
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "reserva_janela_totais_coerentes"
AFTER UPDATE ON "reserva_janela"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "conferir_reserva_encerrada"();

-- Retornado da linha expedida = soma dos recebimentos físicos registrados.
CREATE FUNCTION "conferir_retorno_linha"(p_linha uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_registrado numeric;
  v_soma numeric;
BEGIN
  SELECT "quantidade_retornada" INTO v_registrado FROM "linha_expedicao" WHERE "id" = p_linha;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT coalesce(sum(lr."quantidade"), 0) INTO v_soma
    FROM "linha_retorno" lr JOIN "retorno_expedicao" r ON r."id" = lr."retorno_id"
   WHERE lr."linha_expedicao_id" = p_linha AND r."tipo" = 'RECEBIMENTO_FISICO';
  IF v_registrado <> v_soma THEN
    RAISE EXCEPTION 'JANELA_INCOERENTE: retornado da linha (%) diferente dos recebimentos físicos (%)', v_registrado, v_soma USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION "conferir_retorno_registrado"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'linha_retorno' THEN
    PERFORM conferir_retorno_linha(NEW."linha_expedicao_id");
  ELSE
    PERFORM conferir_retorno_linha(NEW."id");
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "linha_retorno_total_coerente"
AFTER INSERT ON "linha_retorno"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "conferir_retorno_registrado"();
CREATE CONSTRAINT TRIGGER "linha_expedicao_retorno_coerente"
AFTER UPDATE ON "linha_expedicao"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "conferir_retorno_registrado"();

-- Registros de reserva/expedição/retorno pertencem à mesma janela e reserva.
CREATE FUNCTION "verificar_expedicao_da_reserva"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "reserva_janela" r WHERE r."id" = NEW."reserva_id" AND r."janela_id" = NEW."janela_id") THEN
    RAISE EXCEPTION 'JANELA_INCOERENTE: expedição de reserva de outra janela' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "expedicao_da_reserva" BEFORE INSERT ON "expedicao"
FOR EACH ROW EXECUTE FUNCTION "verificar_expedicao_da_reserva"();

CREATE FUNCTION "verificar_linha_expedida"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "linha_reserva" l JOIN "expedicao" e ON e."reserva_id" = l."reserva_id"
     WHERE l."id" = NEW."linha_reserva_id" AND e."id" = NEW."expedicao_id"
       AND l."palete_id" = NEW."palete_id" AND l."segmento_id" = NEW."segmento_id" AND l."quantidade" = NEW."quantidade_reservada"
  ) THEN
    RAISE EXCEPTION 'JANELA_INCOERENTE: linha expedida diferente da linha reservada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "linha_expedicao_da_reserva" BEFORE INSERT ON "linha_expedicao"
FOR EACH ROW EXECUTE FUNCTION "verificar_linha_expedida"();

CREATE FUNCTION "verificar_metrica_da_janela"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_janela uuid;
BEGIN
  IF TG_TABLE_NAME = 'metrica_reserva' THEN
    SELECT "janela_id" INTO v_janela FROM "reserva_janela" WHERE "id" = NEW."reserva_id";
  ELSE
    SELECT "janela_id" INTO v_janela FROM "expedicao" WHERE "id" = NEW."expedicao_id";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "restricao_janela" WHERE "id" = NEW."restricao_id" AND "janela_id" = v_janela) THEN
    RAISE EXCEPTION 'JANELA_INCOERENTE: métrica de restrição de outra janela' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "metrica_reserva_da_janela" BEFORE INSERT ON "metrica_reserva"
FOR EACH ROW EXECUTE FUNCTION "verificar_metrica_da_janela"();
CREATE TRIGGER "metrica_expedicao_da_janela" BEFORE INSERT ON "metrica_expedicao"
FOR EACH ROW EXECUTE FUNCTION "verificar_metrica_da_janela"();

CREATE FUNCTION "verificar_linha_retornada"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "linha_expedicao" l JOIN "retorno_expedicao" r ON r."expedicao_id" = l."expedicao_id"
     WHERE l."id" = NEW."linha_expedicao_id" AND r."id" = NEW."retorno_id"
  ) THEN
    RAISE EXCEPTION 'JANELA_INCOERENTE: linha de retorno de outra expedição' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "linha_retorno_da_expedicao" BEFORE INSERT ON "linha_retorno"
FOR EACH ROW EXECUTE FUNCTION "verificar_linha_retornada"();

