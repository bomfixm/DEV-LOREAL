-- Complemento (5 out. 2026): desenho aprovado da praça (área desativada, nomes
-- operacionais e endereços reais), inventário conferido de referência, seleção
-- do cliente e conciliação. Estrutura gerada com `prisma migrate diff` (schema
-- anterior → atual) e acrescida à mão de CHECKs, índices parciais e gatilhos.

-- CreateEnum
CREATE TYPE "SituacaoEndereco" AS ENUM ('PROPOSTO', 'CONFIRMADO');

-- CreateEnum
CREATE TYPE "SentidoSequencia" AS ENUM ('P01_PRIMEIRO', 'P01_ULTIMO');

-- CreateEnum
CREATE TYPE "SituacaoInventario" AS ENUM ('ATIVO', 'SUBSTITUIDO');

-- CreateEnum
CREATE TYPE "AcaoLinhaInventario" AS ENUM ('VINCULAR', 'CRIAR_CADASTRO', 'ATUALIZAR', 'JA_IMPORTADO', 'REFERENCIA_HISTORICA', 'DUPLICADA_ARQUIVO', 'REQUER_RESOLUCAO');

-- CreateEnum
CREATE TYPE "ModalidadeSelecao" AS ENUM ('LISTA', 'MARCACAO');

-- CreateEnum
CREATE TYPE "SituacaoSelecao" AS ENUM ('REGISTRADA', 'SUBSTITUIDA');

-- CreateEnum
CREATE TYPE "AbrangenciaSelecao" AS ENUM ('PALETE', 'DOCUMENTO', 'LINHA_PRODUTO');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoImportacao" ADD VALUE 'INVENTARIO';
ALTER TYPE "TipoImportacao" ADD VALUE 'SELECAO_CLIENTE';

-- AlterEnum
ALTER TYPE "ClassificacaoLinha" ADD VALUE 'EXCLUIDA';

-- AlterTable
ALTER TABLE "elemento_layout" ADD COLUMN     "nome_operacional" TEXT,
ADD COLUMN     "prefixo_endereco" TEXT;

-- AlterTable
ALTER TABLE "fileira" ADD COLUMN     "lado" TEXT;

-- AlterTable
ALTER TABLE "posicao" ADD COLUMN     "desativada" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "lote_importacao" ADD COLUMN     "excluidas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "parametros" JSONB,
ADD COLUMN     "resumo_previa" JSONB;

-- AlterTable
ALTER TABLE "linha_importacao" ADD COLUMN     "acao" TEXT;

-- CreateTable
CREATE TABLE "sequencia_endereco_faixa" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "layout_id" UUID NOT NULL,
    "fileira_id" UUID NOT NULL,
    "segmentos" TEXT NOT NULL,
    "sentido" "SentidoSequencia" NOT NULL,
    "fonte" TEXT NOT NULL,
    "observacao" TEXT,
    "informado_por_id" UUID NOT NULL,
    "informado_em" TIMESTAMPTZ(3) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sequencia_endereco_faixa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "endereco_posicao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "layout_id" UUID NOT NULL,
    "posicao_id" UUID NOT NULL,
    "fileira_id" UUID NOT NULL,
    "prefixo" TEXT NOT NULL,
    "codigo_local" TEXT NOT NULL,
    "endereco" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "lado" TEXT NOT NULL,
    "ordem_visual" INTEGER NOT NULL,
    "situacao" "SituacaoEndereco" NOT NULL,
    "origem" TEXT NOT NULL,
    "proposto_por_id" UUID,
    "proposto_em" TIMESTAMPTZ(3) NOT NULL,
    "confirmado_por_id" UUID,
    "confirmado_em" TIMESTAMPTZ(3),
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "endereco_posicao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventario_referencia" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "lote_importacao_id" UUID,
    "referencia_conferencia" TEXT NOT NULL,
    "data_conferencia" DATE,
    "fonte_conferencia" TEXT,
    "nome_arquivo" TEXT,
    "hash_arquivo" TEXT,
    "aba" TEXT,
    "significado_numero_palete" TEXT NOT NULL,
    "convencoes" JSONB NOT NULL,
    "situacao" "SituacaoInventario" NOT NULL,
    "substitui_id" UUID,
    "total_linhas" INTEGER NOT NULL,
    "aplicadas" INTEGER NOT NULL,
    "pendentes" INTEGER NOT NULL,
    "historicas" INTEGER NOT NULL,
    "conferencia_externa_situacao" TEXT NOT NULL DEFAULT 'NAO_REGISTRADA',
    "conferencia_externa_referencia" TEXT,
    "conferencia_externa_data" DATE,
    "conferencia_externa_fonte" TEXT,
    "conferencia_externa_observacao" TEXT,
    "conferencia_externa_por_id" UUID,
    "conferencia_externa_em" TIMESTAMPTZ(3),
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "inventario_referencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linha_inventario" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "inventario_id" UUID NOT NULL,
    "lote_importacao_id" UUID NOT NULL,
    "linha_arquivo" INTEGER NOT NULL,
    "delivery" TEXT,
    "tipo_documento" TEXT,
    "numero_documento" TEXT,
    "chave_documento" TEXT,
    "volumes" DECIMAL(18,3),
    "volumes_lido" TEXT,
    "remetente" TEXT,
    "mes_agenda" TEXT,
    "janela_referencia" TEXT,
    "endereco_lido" TEXT,
    "endereco_canonico" TEXT,
    "endereco_livre" BOOLEAN NOT NULL DEFAULT false,
    "numero_palete" TEXT,
    "documentacao" TEXT,
    "pallet_full" TEXT,
    "categoria" TEXT,
    "extras" JSONB NOT NULL,
    "palete_id" UUID,
    "posicao_id" UUID,
    "acao" "AcaoLinhaInventario" NOT NULL,
    "aplicada" BOOLEAN NOT NULL,
    "motivos" JSONB NOT NULL,
    "resolvida_por_id" UUID,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "linha_inventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vinculo_documento_palete" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "inventario_id" UUID NOT NULL,
    "linha_inventario_id" UUID NOT NULL,
    "tipo_documento" TEXT,
    "numero_documento" TEXT NOT NULL,
    "chave_documento" TEXT NOT NULL,
    "delivery" TEXT,
    "volumes" DECIMAL(18,3),
    "unidade_volumes" TEXT NOT NULL,
    "documentacao" TEXT,
    "pallet_full" TEXT,
    "chave" TEXT NOT NULL,
    "situacao" TEXT NOT NULL,
    "conferido_externamente" BOOLEAN NOT NULL DEFAULT false,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,
    "encerrado_por_id" UUID,
    "encerrado_em" TIMESTAMPTZ(3),
    "motivo_encerramento" TEXT,

    CONSTRAINT "vinculo_documento_palete_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "selecao_cliente" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "referencia_pedido" TEXT NOT NULL,
    "versao_pedido" INTEGER NOT NULL,
    "rotulo_versao" TEXT,
    "modalidade" "ModalidadeSelecao" NOT NULL,
    "inventario_id" UUID,
    "lote_importacao_id" UUID NOT NULL,
    "parametros" JSONB NOT NULL,
    "situacao" "SituacaoSelecao" NOT NULL,
    "substitui_id" UUID,
    "diferencas" JSONB,
    "total_linhas" INTEGER NOT NULL,
    "linhas_excluidas" INTEGER NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "selecao_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linha_selecao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "selecao_id" UUID NOT NULL,
    "linha_arquivo" INTEGER NOT NULL,
    "referencia_linha" TEXT,
    "abrangencia" "AbrangenciaSelecao" NOT NULL,
    "regra_abrangencia" TEXT NOT NULL,
    "palete_referencia" TEXT,
    "tipo_documento" TEXT,
    "numero_documento" TEXT,
    "chave_documento" TEXT,
    "delivery" TEXT,
    "referencia_inventario" TEXT,
    "janela_referencia" TEXT,
    "sku" TEXT,
    "lote" TEXT,
    "quantidade" DECIMAL(18,3),
    "unidade" TEXT,
    "marcacao" TEXT,
    "observacao" TEXT,
    "lidos" JSONB NOT NULL,
    "chave" TEXT NOT NULL,
    "duplicada_de_id" UUID,
    "decisao_duplicidade" TEXT,

    CONSTRAINT "linha_selecao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolucao_linha_selecao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "linha_selecao_id" UUID NOT NULL,
    "palete_id" UUID,
    "chave_documento" TEXT,
    "motivo" TEXT NOT NULL,
    "autor_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,
    "anulada_em" TIMESTAMPTZ(3),
    "anulada_por_id" UUID,
    "motivo_anulacao" TEXT,

    CONSTRAINT "resolucao_linha_selecao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vinculo_selecao_reserva" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "selecao_id" UUID NOT NULL,
    "linha_selecao_id" UUID NOT NULL,
    "reserva_id" UUID NOT NULL,
    "linha_reserva_id" UUID NOT NULL,
    "quantidade" DECIMAL(18,3) NOT NULL,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vinculo_selecao_reserva_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sequencia_endereco_faixa_escopo_id_fileira_id_key" ON "sequencia_endereco_faixa"("escopo_id", "fileira_id");

-- CreateIndex
CREATE UNIQUE INDEX "sequencia_endereco_faixa_escopo_id_id_key" ON "sequencia_endereco_faixa"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "endereco_posicao_escopo_id_chave_idx" ON "endereco_posicao"("escopo_id", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "endereco_posicao_escopo_id_posicao_id_key" ON "endereco_posicao"("escopo_id", "posicao_id");

-- CreateIndex
CREATE UNIQUE INDEX "endereco_posicao_layout_id_chave_key" ON "endereco_posicao"("layout_id", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "endereco_posicao_escopo_id_id_key" ON "endereco_posicao"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "inventario_referencia_substitui_id_key" ON "inventario_referencia"("substitui_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventario_referencia_escopo_id_numero_key" ON "inventario_referencia"("escopo_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "inventario_referencia_escopo_id_lote_importacao_id_key" ON "inventario_referencia"("escopo_id", "lote_importacao_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventario_referencia_escopo_id_id_key" ON "inventario_referencia"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "linha_inventario_escopo_id_inventario_id_idx" ON "linha_inventario"("escopo_id", "inventario_id");

-- CreateIndex
CREATE INDEX "linha_inventario_escopo_id_chave_documento_idx" ON "linha_inventario"("escopo_id", "chave_documento");

-- CreateIndex
CREATE INDEX "linha_inventario_escopo_id_numero_palete_idx" ON "linha_inventario"("escopo_id", "numero_palete");

-- CreateIndex
CREATE UNIQUE INDEX "linha_inventario_lote_importacao_id_linha_arquivo_key" ON "linha_inventario"("lote_importacao_id", "linha_arquivo");

-- CreateIndex
CREATE UNIQUE INDEX "linha_inventario_escopo_id_id_key" ON "linha_inventario"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "vinculo_documento_palete_escopo_id_chave_documento_idx" ON "vinculo_documento_palete"("escopo_id", "chave_documento");

-- CreateIndex
CREATE INDEX "vinculo_documento_palete_escopo_id_palete_id_idx" ON "vinculo_documento_palete"("escopo_id", "palete_id");

-- CreateIndex
CREATE INDEX "vinculo_documento_palete_escopo_id_chave_idx" ON "vinculo_documento_palete"("escopo_id", "chave");

-- CreateIndex
CREATE UNIQUE INDEX "vinculo_documento_palete_escopo_id_id_key" ON "vinculo_documento_palete"("escopo_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "selecao_cliente_substitui_id_key" ON "selecao_cliente"("substitui_id");

-- CreateIndex
CREATE UNIQUE INDEX "selecao_cliente_escopo_id_numero_key" ON "selecao_cliente"("escopo_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "selecao_cliente_escopo_id_referencia_pedido_versao_pedido_key" ON "selecao_cliente"("escopo_id", "referencia_pedido", "versao_pedido");

-- CreateIndex
CREATE UNIQUE INDEX "selecao_cliente_escopo_id_lote_importacao_id_key" ON "selecao_cliente"("escopo_id", "lote_importacao_id");

-- CreateIndex
CREATE UNIQUE INDEX "selecao_cliente_escopo_id_id_key" ON "selecao_cliente"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "linha_selecao_escopo_id_chave_documento_idx" ON "linha_selecao"("escopo_id", "chave_documento");

-- CreateIndex
CREATE UNIQUE INDEX "linha_selecao_selecao_id_linha_arquivo_key" ON "linha_selecao"("selecao_id", "linha_arquivo");

-- CreateIndex
CREATE UNIQUE INDEX "linha_selecao_escopo_id_id_key" ON "linha_selecao"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "resolucao_linha_selecao_escopo_id_linha_selecao_id_idx" ON "resolucao_linha_selecao"("escopo_id", "linha_selecao_id");

-- CreateIndex
CREATE INDEX "vinculo_selecao_reserva_escopo_id_reserva_id_idx" ON "vinculo_selecao_reserva"("escopo_id", "reserva_id");

-- CreateIndex
CREATE UNIQUE INDEX "vinculo_selecao_reserva_linha_selecao_id_linha_reserva_id_key" ON "vinculo_selecao_reserva"("linha_selecao_id", "linha_reserva_id");

-- CreateIndex
CREATE UNIQUE INDEX "elemento_layout_layout_id_prefixo_endereco_key" ON "elemento_layout"("layout_id", "prefixo_endereco");

-- AddForeignKey
ALTER TABLE "sequencia_endereco_faixa" ADD CONSTRAINT "sequencia_endereco_faixa_escopo_id_layout_id_fkey" FOREIGN KEY ("escopo_id", "layout_id") REFERENCES "layout"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequencia_endereco_faixa" ADD CONSTRAINT "sequencia_endereco_faixa_escopo_id_fileira_id_fkey" FOREIGN KEY ("escopo_id", "fileira_id") REFERENCES "fileira"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sequencia_endereco_faixa" ADD CONSTRAINT "sequencia_endereco_faixa_informado_por_id_fkey" FOREIGN KEY ("informado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endereco_posicao" ADD CONSTRAINT "endereco_posicao_escopo_id_layout_id_fkey" FOREIGN KEY ("escopo_id", "layout_id") REFERENCES "layout"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endereco_posicao" ADD CONSTRAINT "endereco_posicao_escopo_id_posicao_id_fkey" FOREIGN KEY ("escopo_id", "posicao_id") REFERENCES "posicao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endereco_posicao" ADD CONSTRAINT "endereco_posicao_escopo_id_fileira_id_fkey" FOREIGN KEY ("escopo_id", "fileira_id") REFERENCES "fileira"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endereco_posicao" ADD CONSTRAINT "endereco_posicao_proposto_por_id_fkey" FOREIGN KEY ("proposto_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "endereco_posicao" ADD CONSTRAINT "endereco_posicao_confirmado_por_id_fkey" FOREIGN KEY ("confirmado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_referencia" ADD CONSTRAINT "inventario_referencia_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_referencia" ADD CONSTRAINT "inventario_referencia_escopo_id_lote_importacao_id_fkey" FOREIGN KEY ("escopo_id", "lote_importacao_id") REFERENCES "lote_importacao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_referencia" ADD CONSTRAINT "inventario_referencia_substitui_id_fkey" FOREIGN KEY ("substitui_id") REFERENCES "inventario_referencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_referencia" ADD CONSTRAINT "inventario_referencia_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventario_referencia" ADD CONSTRAINT "inventario_referencia_conferencia_externa_por_id_fkey" FOREIGN KEY ("conferencia_externa_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_inventario" ADD CONSTRAINT "linha_inventario_escopo_id_inventario_id_fkey" FOREIGN KEY ("escopo_id", "inventario_id") REFERENCES "inventario_referencia"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_inventario" ADD CONSTRAINT "linha_inventario_escopo_id_lote_importacao_id_fkey" FOREIGN KEY ("escopo_id", "lote_importacao_id") REFERENCES "lote_importacao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_inventario" ADD CONSTRAINT "linha_inventario_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_inventario" ADD CONSTRAINT "linha_inventario_escopo_id_posicao_id_fkey" FOREIGN KEY ("escopo_id", "posicao_id") REFERENCES "posicao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_inventario" ADD CONSTRAINT "linha_inventario_resolvida_por_id_fkey" FOREIGN KEY ("resolvida_por_id") REFERENCES "linha_inventario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_documento_palete" ADD CONSTRAINT "vinculo_documento_palete_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_documento_palete" ADD CONSTRAINT "vinculo_documento_palete_escopo_id_inventario_id_fkey" FOREIGN KEY ("escopo_id", "inventario_id") REFERENCES "inventario_referencia"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_documento_palete" ADD CONSTRAINT "vinculo_documento_palete_escopo_id_linha_inventario_id_fkey" FOREIGN KEY ("escopo_id", "linha_inventario_id") REFERENCES "linha_inventario"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_documento_palete" ADD CONSTRAINT "vinculo_documento_palete_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_documento_palete" ADD CONSTRAINT "vinculo_documento_palete_encerrado_por_id_fkey" FOREIGN KEY ("encerrado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selecao_cliente" ADD CONSTRAINT "selecao_cliente_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selecao_cliente" ADD CONSTRAINT "selecao_cliente_escopo_id_inventario_id_fkey" FOREIGN KEY ("escopo_id", "inventario_id") REFERENCES "inventario_referencia"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selecao_cliente" ADD CONSTRAINT "selecao_cliente_escopo_id_lote_importacao_id_fkey" FOREIGN KEY ("escopo_id", "lote_importacao_id") REFERENCES "lote_importacao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selecao_cliente" ADD CONSTRAINT "selecao_cliente_substitui_id_fkey" FOREIGN KEY ("substitui_id") REFERENCES "selecao_cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selecao_cliente" ADD CONSTRAINT "selecao_cliente_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_selecao" ADD CONSTRAINT "linha_selecao_escopo_id_selecao_id_fkey" FOREIGN KEY ("escopo_id", "selecao_id") REFERENCES "selecao_cliente"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linha_selecao" ADD CONSTRAINT "linha_selecao_duplicada_de_id_fkey" FOREIGN KEY ("duplicada_de_id") REFERENCES "linha_selecao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolucao_linha_selecao" ADD CONSTRAINT "resolucao_linha_selecao_escopo_id_linha_selecao_id_fkey" FOREIGN KEY ("escopo_id", "linha_selecao_id") REFERENCES "linha_selecao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolucao_linha_selecao" ADD CONSTRAINT "resolucao_linha_selecao_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolucao_linha_selecao" ADD CONSTRAINT "resolucao_linha_selecao_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolucao_linha_selecao" ADD CONSTRAINT "resolucao_linha_selecao_anulada_por_id_fkey" FOREIGN KEY ("anulada_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_selecao_reserva" ADD CONSTRAINT "vinculo_selecao_reserva_escopo_id_selecao_id_fkey" FOREIGN KEY ("escopo_id", "selecao_id") REFERENCES "selecao_cliente"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_selecao_reserva" ADD CONSTRAINT "vinculo_selecao_reserva_escopo_id_linha_selecao_id_fkey" FOREIGN KEY ("escopo_id", "linha_selecao_id") REFERENCES "linha_selecao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_selecao_reserva" ADD CONSTRAINT "vinculo_selecao_reserva_escopo_id_reserva_id_fkey" FOREIGN KEY ("escopo_id", "reserva_id") REFERENCES "reserva_janela"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_selecao_reserva" ADD CONSTRAINT "vinculo_selecao_reserva_escopo_id_linha_reserva_id_fkey" FOREIGN KEY ("escopo_id", "linha_reserva_id") REFERENCES "linha_reserva"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculo_selecao_reserva" ADD CONSTRAINT "vinculo_selecao_reserva_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Restrições, funções, gatilhos e índices adicionados manualmente.
-- Valores novos de enum (INVENTARIO, SELECAO_CLIENTE, EXCLUIDA) são comparados
-- como texto: o PostgreSQL não permite usá-los na mesma transação que os criou.

-- Lote: a confirmação do inventário conferido grava o conjunto válido e
-- mantém as linhas com pendência registradas como não aplicadas (inválidas e
-- conflitantes são permitidas só nesse tipo); a seleção do cliente pode ter
-- linhas excluídas pela regra de marcação. Nos demais tipos, nada muda.
ALTER TABLE "lote_importacao" DROP CONSTRAINT "lote_importacao_coerente";
ALTER TABLE "lote_importacao" ADD CONSTRAINT "lote_importacao_coerente"
  CHECK ("hash_arquivo" ~ '^[0-9a-f]{64}$'
         AND "tamanho_bytes" > 0
         AND char_length("nome_arquivo") BETWEEN 1 AND 200
         AND "nome_arquivo" !~ '[[:cntrl:]]'
         AND "versao" >= 1 AND "versao_previa" >= 0
         AND LEAST("total_linhas", "linhas_vazias", "validas_novas", "duplicadas", "invalidas", "conflitantes", "excluidas", "gravadas", "ignoradas") >= 0
         AND "validas_novas" + "duplicadas" + "invalidas" + "conflitantes" + "excluidas" = "total_linhas"
         AND ("excluidas" = 0 OR "tipo"::text = 'SELECAO_CLIENTE')
         AND ("situacao" <> 'AGUARDANDO_MAPEAMENTO' OR ("versao_previa" = 0 AND "assinatura_previa" IS NULL AND "total_linhas" = 0))
         AND ("situacao" NOT IN ('PREVIA', 'CONFIRMADO')
              OR ("versao_previa" >= 1 AND "assinatura_previa" ~ '^[0-9a-f]{64}$' AND "previa_gerada_em" IS NOT NULL
                  AND "opcoes" IS NOT NULL AND "colunas" IS NOT NULL AND "separador_decimal" IN ('VIRGULA', 'PONTO')))
         AND ("tipo"::text NOT IN ('INVENTARIO', 'SELECAO_CLIENTE') OR "situacao" NOT IN ('PREVIA', 'CONFIRMADO') OR jsonb_typeof("parametros") = 'object')
         AND (("situacao" = 'CONFIRMADO') = ("confirmado_em" IS NOT NULL AND "confirmado_por_id" IS NOT NULL))
         AND ("situacao" <> 'CONFIRMADO'
              OR ((("invalidas" = 0 AND "conflitantes" = 0) OR "tipo"::text = 'INVENTARIO')
                  AND "total_linhas" > 0
                  AND "gravadas" = "validas_novas" AND "ignoradas" = "duplicadas" AND "resultado" IS NOT NULL))
         AND ("situacao" = 'CONFIRMADO' OR ("gravadas" = 0 AND "ignoradas" = 0 AND "resultado" IS NULL))
         AND (("situacao" = 'DESCARTADO') = ("descartado_em" IS NOT NULL AND "descartado_por_id" IS NOT NULL)));

-- Linha da prévia: excluída também precisa de motivo; ação, quando houver, é conhecida.
ALTER TABLE "linha_importacao" DROP CONSTRAINT "linha_importacao_coerente";
ALTER TABLE "linha_importacao" ADD CONSTRAINT "linha_importacao_coerente"
  CHECK ("numero" >= 1
         AND jsonb_typeof("valores") = 'object' AND jsonb_typeof("lidos") = 'object'
         AND jsonb_typeof("motivos") = 'array' AND jsonb_typeof("avisos") = 'array'
         AND ("classificacao"::text NOT IN ('INVALIDA', 'CONFLITANTE', 'EXCLUIDA') OR jsonb_array_length("motivos") > 0)
         AND ("resultado" IS NULL
              OR ("resultado" = 'GRAVADA' AND "classificacao" = 'VALIDA_NOVA')
              OR ("resultado" = 'IGNORADA_DUPLICADA' AND "classificacao" = 'DUPLICADA'))
         AND ("registro_id" IS NULL OR "resultado" = 'GRAVADA')
         AND ("acao" IS NULL OR "acao" IN ('VINCULAR', 'CRIAR_CADASTRO', 'ATUALIZAR', 'JA_IMPORTADO', 'REFERENCIA_HISTORICA',
                                          'DUPLICADA_ARQUIVO', 'REQUER_RESOLUCAO', 'SOLICITACAO', 'EXCLUIDA_MARCACAO', 'DUPLICIDADE_AGRUPADA')));

-- Layout: área desativada fica indisponível (o gatilho palete_posicao_valida
-- já recusa palete em posição indisponível); lado da faixa conhecido; nome e
-- prefixo operacionais só em blocos.
ALTER TABLE "posicao" ADD CONSTRAINT "posicao_desativada_indisponivel" CHECK (NOT "desativada" OR NOT "disponivel");
ALTER TABLE "fileira" ADD CONSTRAINT "fileira_lado_valido" CHECK ("lado" IS NULL OR "lado" IN ('ESQUERDO', 'DIREITO', 'UNICO'));
ALTER TABLE "elemento_layout" ADD CONSTRAINT "elemento_layout_nome_operacional"
  CHECK (("nome_operacional" IS NULL OR (char_length("nome_operacional") BETWEEN 2 AND 60 AND "nome_operacional" = btrim("nome_operacional")
                                         AND "nome_operacional" !~ '[[:cntrl:]]'))
         AND ("prefixo_endereco" IS NULL OR "prefixo_endereco" ~ '^[A-Z0-9]{1,4}$')
         AND (("nome_operacional" IS NULL AND "prefixo_endereco" IS NULL) OR "tipo" = 'BLOCO'));

-- Sequência informada de uma faixa.
ALTER TABLE "sequencia_endereco_faixa" ADD CONSTRAINT "sequencia_endereco_faixa_coerente"
  CHECK (char_length("segmentos") BETWEEN 1 AND 300 AND "segmentos" !~ '[[:cntrl:]]'
         AND char_length("fonte") BETWEEN 3 AND 200 AND "versao" >= 1);

-- Correspondência posição × endereço: endereço e chave derivados do prefixo e
-- do código local; confirmação com autoria; ordem visual positiva.
ALTER TABLE "endereco_posicao" ADD CONSTRAINT "endereco_posicao_coerente"
  CHECK ("prefixo" ~ '^[A-Z0-9]{1,4}$' AND "codigo_local" ~ '^[A-Z0-9]{1,8}$'
         AND "endereco" = "prefixo" || ' - ' || "codigo_local"
         AND "chave" = "prefixo" || '|' || "codigo_local"
         AND "lado" IN ('ESQUERDO', 'DIREITO', 'UNICO')
         AND "ordem_visual" >= 1 AND "versao" >= 1
         AND "origem" IN ('SEQUENCIA', 'MANUAL', 'DEMONSTRACAO')
         AND (("situacao" = 'CONFIRMADO') = ("confirmado_em" IS NOT NULL)));

-- A posição e a faixa pertencem ao layout informado.
CREATE FUNCTION "verificar_endereco_posicao"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "posicao" p
   WHERE p."id" = NEW."posicao_id" AND p."escopo_id" = NEW."escopo_id"
     AND p."layout_id" = NEW."layout_id" AND p."fileira_id" = NEW."fileira_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ENDERECO_INVALIDO: posição, faixa e layout não correspondem' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "endereco_posicao_valido" BEFORE INSERT OR UPDATE ON "endereco_posicao"
FOR EACH ROW EXECUTE FUNCTION "verificar_endereco_posicao"();

-- Inventário de referência.
ALTER TABLE "inventario_referencia" ADD CONSTRAINT "inventario_referencia_coerente"
  CHECK ("numero" >= 1 AND "codigo" ~ '^INV-[0-9]{6,}$'
         AND char_length("descricao") BETWEEN 3 AND 200 AND "descricao" !~ '[[:cntrl:]]'
         AND char_length("referencia_conferencia") BETWEEN 1 AND 120 AND "referencia_conferencia" !~ '[[:cntrl:]]'
         AND "origem" IN ('IMPORTADO', 'APLICACAO')
         AND ("origem" <> 'IMPORTADO' OR ("lote_importacao_id" IS NOT NULL AND "hash_arquivo" ~ '^[0-9a-f]{64}$'))
         AND "significado_numero_palete" IN ('IDENTIFICADOR_PALETE', 'NUMERACAO_POSICAO')
         AND jsonb_typeof("convencoes") = 'object'
         AND LEAST("total_linhas", "aplicadas", "pendentes", "historicas") >= 0
         AND "versao" >= 1
         AND "conferencia_externa_situacao" IN ('NAO_REGISTRADA', 'RECONHECIDA')
         AND (("conferencia_externa_situacao" = 'RECONHECIDA')
              = ("conferencia_externa_referencia" IS NOT NULL AND "conferencia_externa_por_id" IS NOT NULL AND "conferencia_externa_em" IS NOT NULL)));

-- Linha do inventário: aplicada só nas ações que gravam vínculo/cadastro, com
-- palete; endereço livre nunca ocupa posição nem é aplicado como ocupação.
ALTER TABLE "linha_inventario" ADD CONSTRAINT "linha_inventario_coerente"
  CHECK ("linha_arquivo" >= 1
         AND jsonb_typeof("extras") = 'object' AND jsonb_typeof("motivos") = 'array'
         AND (NOT "aplicada" OR ("acao"::text IN ('VINCULAR', 'CRIAR_CADASTRO', 'ATUALIZAR') AND "palete_id" IS NOT NULL))
         AND (NOT "endereco_livre" OR (NOT "aplicada" AND "posicao_id" IS NULL))
         AND ("chave_documento" IS NULL OR "numero_documento" IS NOT NULL)
         AND ("volumes" IS NULL OR "volumes" >= 0)
         AND ("resolvida_por_id" IS NULL OR NOT "aplicada"));

-- Linha do inventário é fotografia: só a marca de "resolvida por" é acrescentada (uma vez).
CREATE FUNCTION "proteger_linha_inventario"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'INVENTARIO_IMUTAVEL: linhas do inventário não são apagadas' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."resolvida_por_id" IS NOT NULL
     OR (to_jsonb(NEW) - 'resolvida_por_id') <> (to_jsonb(OLD) - 'resolvida_por_id') THEN
    RAISE EXCEPTION 'INVENTARIO_IMUTAVEL: a fotografia do inventário não é alterada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "linha_inventario_protegida" BEFORE UPDATE OR DELETE ON "linha_inventario"
FOR EACH ROW EXECUTE FUNCTION "proteger_linha_inventario"();

-- Vínculo documental: encerrado com autoria e motivo; uma chave ativa por escopo
-- (reenvio não duplica). Volumes nunca negativos.
ALTER TABLE "vinculo_documento_palete" ADD CONSTRAINT "vinculo_documento_palete_coerente"
  CHECK ("situacao" IN ('ATIVO', 'ENCERRADO')
         AND (("situacao" = 'ENCERRADO') = ("encerrado_em" IS NOT NULL AND "encerrado_por_id" IS NOT NULL AND "motivo_encerramento" IS NOT NULL))
         AND char_length("numero_documento") BETWEEN 1 AND 64 AND "numero_documento" = btrim("numero_documento")
         AND char_length("chave_documento") BETWEEN 2 AND 140
         AND char_length("unidade_volumes") BETWEEN 1 AND 20
         AND ("volumes" IS NULL OR "volumes" >= 0));

CREATE UNIQUE INDEX "vinculo_documento_palete_chave_ativa_key" ON "vinculo_documento_palete"("escopo_id", "chave")
  WHERE "situacao" = 'ATIVO';

-- Vínculo documental: só encerramento e reconhecimento da conferência externa mudam; nunca apagado.
CREATE FUNCTION "proteger_vinculo_documento"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'INVENTARIO_IMUTAVEL: vínculos documentais não são apagados' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."situacao" = 'ENCERRADO'
     OR (to_jsonb(NEW) - ARRAY['situacao', 'encerrado_em', 'encerrado_por_id', 'motivo_encerramento', 'conferido_externamente'])
        <> (to_jsonb(OLD) - ARRAY['situacao', 'encerrado_em', 'encerrado_por_id', 'motivo_encerramento', 'conferido_externamente'])
     OR (OLD."conferido_externamente" AND NOT NEW."conferido_externamente") THEN
    RAISE EXCEPTION 'INVENTARIO_IMUTAVEL: vínculo documental só é encerrado ou reconhecido' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "vinculo_documento_palete_protegido" BEFORE UPDATE OR DELETE ON "vinculo_documento_palete"
FOR EACH ROW EXECUTE FUNCTION "proteger_vinculo_documento"();

-- Seleção do cliente.
ALTER TABLE "selecao_cliente" ADD CONSTRAINT "selecao_cliente_coerente"
  CHECK ("numero" >= 1 AND "codigo" ~ '^SEL-[0-9]{6,}$'
         AND char_length("referencia_pedido") BETWEEN 1 AND 80 AND "referencia_pedido" = btrim("referencia_pedido")
         AND "referencia_pedido" !~ '[[:cntrl:]]'
         AND "versao_pedido" >= 1 AND "versao" >= 1
         AND ("rotulo_versao" IS NULL OR (char_length("rotulo_versao") BETWEEN 1 AND 40 AND "rotulo_versao" !~ '[[:cntrl:]]'))
         AND jsonb_typeof("parametros") = 'object'
         AND ("diferencas" IS NULL OR jsonb_typeof("diferencas") = 'object')
         AND LEAST("total_linhas", "linhas_excluidas") >= 0
         AND (("versao_pedido" = 1) = ("substitui_id" IS NULL)));

-- Linha solicitada: abrangência coerente com a identificação; quantidade positiva quando informada.
ALTER TABLE "linha_selecao" ADD CONSTRAINT "linha_selecao_coerente"
  CHECK ("linha_arquivo" >= 1
         AND jsonb_typeof("lidos") = 'object'
         AND ("quantidade" IS NULL OR "quantidade" > 0)
         AND ("quantidade" IS NULL OR "unidade" IS NOT NULL)
         AND ("abrangencia" <> 'PALETE' OR "palete_referencia" IS NOT NULL)
         AND ("abrangencia" <> 'DOCUMENTO' OR "numero_documento" IS NOT NULL)
         AND ("abrangencia" <> 'LINHA_PRODUTO' OR "sku" IS NOT NULL)
         AND ("chave_documento" IS NULL OR "numero_documento" IS NOT NULL)
         AND (("duplicada_de_id" IS NULL) = ("decisao_duplicidade" IS NULL)));

CREATE TRIGGER "linha_selecao_imutavel" BEFORE UPDATE OR DELETE ON "linha_selecao"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();

-- Resolução explícita: no máximo uma ativa por linha; anulação com autoria e motivo.
ALTER TABLE "resolucao_linha_selecao" ADD CONSTRAINT "resolucao_linha_selecao_coerente"
  CHECK (("palete_id" IS NOT NULL OR "chave_documento" IS NOT NULL)
         AND char_length("motivo") BETWEEN 3 AND 500
         AND (("anulada_em" IS NULL) = ("anulada_por_id" IS NULL))
         AND (("anulada_em" IS NULL) = ("motivo_anulacao" IS NULL)));

CREATE UNIQUE INDEX "resolucao_linha_selecao_ativa_key" ON "resolucao_linha_selecao"("linha_selecao_id")
  WHERE "anulada_em" IS NULL;

-- Encaminhamento para a reserva: quantidade positiva; histórico imutável.
ALTER TABLE "vinculo_selecao_reserva" ADD CONSTRAINT "vinculo_selecao_reserva_coerente" CHECK ("quantidade" > 0);

CREATE TRIGGER "vinculo_selecao_reserva_imutavel" BEFORE UPDATE OR DELETE ON "vinculo_selecao_reserva"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();
