-- "Seleção cliente — teste" (pedido de 20/10/2026): o responsável interno
-- simula o cliente consultando o estoque e montando uma solicitação para uma
-- agenda de saída. Registros próprios do teste (carrinho, versões enviadas,
-- pedidos de alteração, respostas e histórico); o estoque real só é lido.
-- Nenhuma destas tabelas tem gatilho da planilha única nem participa de saldo,
-- reserva, movimentação, conferência ou agenda real. Só acrescenta: nada
-- existente muda de valor (a concessão nova começa desligada para todos).

-- Concessão explícita da funcionalidade, como a aprovação financeira de claims.
ALTER TABLE "vinculo" ADD COLUMN "selecao_cliente_teste" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "vinculo" ADD CONSTRAINT "vinculo_selecao_cliente_teste_perfil"
  CHECK (NOT "selecao_cliente_teste" OR "perfil" IN ('SUPERVISOR_ESTOQUE', 'ADMINISTRADOR'));

CREATE TYPE "SituacaoSolicitacaoTeste" AS ENUM ('RASCUNHO', 'ENVIADA', 'ALTERACAO_SOLICITADA', 'EM_REVISAO');
CREATE TYPE "SituacaoAlteracaoTeste" AS ENUM ('PENDENTE', 'APROVADA', 'RECUSADA');

CREATE TABLE "selecao_teste_solicitacao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "codigo" TEXT NOT NULL,
    "janela_id" UUID,
    "agenda_referencia" TEXT NOT NULL,
    "agenda_data" DATE,
    "agenda_chave" TEXT NOT NULL,
    "situacao" "SituacaoSolicitacaoTeste" NOT NULL DEFAULT 'RASCUNHO',
    "observacao" TEXT,
    "versao_enviada" INTEGER NOT NULL DEFAULT 0,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    "enviada_em" TIMESTAMPTZ(3),

    CONSTRAINT "selecao_teste_solicitacao_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "selecao_teste_solicitacao_escopo_id_numero_key" ON "selecao_teste_solicitacao"("escopo_id", "numero");
CREATE UNIQUE INDEX "selecao_teste_solicitacao_escopo_id_id_key" ON "selecao_teste_solicitacao"("escopo_id", "id");
CREATE INDEX "selecao_teste_solicitacao_escopo_id_agenda_chave_idx" ON "selecao_teste_solicitacao"("escopo_id", "agenda_chave");
CREATE INDEX "selecao_teste_solicitacao_escopo_id_criado_por_id_situacao_idx" ON "selecao_teste_solicitacao"("escopo_id", "criado_por_id", "situacao");
ALTER TABLE "selecao_teste_solicitacao" ADD CONSTRAINT "selecao_teste_solicitacao_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "selecao_teste_solicitacao" ADD CONSTRAINT "selecao_teste_solicitacao_escopo_id_janela_id_fkey" FOREIGN KEY ("escopo_id", "janela_id") REFERENCES "janela_devolucao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "selecao_teste_solicitacao" ADD CONSTRAINT "selecao_teste_solicitacao_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "selecao_teste_solicitacao" ADD CONSTRAINT "selecao_teste_solicitacao_coerente"
  CHECK ("numero" > 0
         AND char_length("agenda_referencia") BETWEEN 1 AND 120 AND "agenda_referencia" = btrim("agenda_referencia")
         AND ("observacao" IS NULL OR (char_length("observacao") BETWEEN 1 AND 1000 AND "observacao" = btrim("observacao")))
         AND "versao_enviada" >= 0 AND "versao" >= 1
         -- Só o rascunho nunca foi enviado; enviada_em marca o primeiro envio.
         AND (("situacao" = 'RASCUNHO') = ("versao_enviada" = 0))
         AND (("versao_enviada" = 0) = ("enviada_em" IS NULL)));

CREATE TABLE "selecao_teste_item" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "solicitacao_id" UUID NOT NULL,
    "abrangencia" TEXT NOT NULL,
    "palete_id" UUID NOT NULL,
    "palete_codigo" TEXT NOT NULL,
    "conteudo_alvo" TEXT,
    "conteudo_ref" UUID,
    "identificacao" JSONB,
    "apresentado" JSONB NOT NULL,
    "delivery_solicitada" TEXT,
    "quantidade_solicitada" INTEGER,
    "observacao" TEXT,
    "ordem" INTEGER NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "selecao_teste_item_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "selecao_teste_item_escopo_id_solicitacao_id_idx" ON "selecao_teste_item"("escopo_id", "solicitacao_id");
CREATE INDEX "selecao_teste_item_escopo_id_conteudo_ref_idx" ON "selecao_teste_item"("escopo_id", "conteudo_ref");
CREATE INDEX "selecao_teste_item_escopo_id_palete_id_idx" ON "selecao_teste_item"("escopo_id", "palete_id");
ALTER TABLE "selecao_teste_item" ADD CONSTRAINT "selecao_teste_item_escopo_id_solicitacao_id_fkey" FOREIGN KEY ("escopo_id", "solicitacao_id") REFERENCES "selecao_teste_solicitacao"("escopo_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "selecao_teste_item" ADD CONSTRAINT "selecao_teste_item_coerente"
  CHECK ("abrangencia" IN ('PALETE', 'CONTEUDO')
         AND (("abrangencia" = 'PALETE') = ("conteudo_ref" IS NULL))
         AND (("conteudo_ref" IS NULL) = ("conteudo_alvo" IS NULL))
         AND ("conteudo_alvo" IS NULL OR "conteudo_alvo" IN ('VINCULO', 'CONTEUDO'))
         -- Palete inteiro: sem Delivery própria (a Delivery é pedida por nota).
         AND ("abrangencia" = 'CONTEUDO' OR "delivery_solicitada" IS NULL)
         AND ("delivery_solicitada" IS NULL OR (char_length("delivery_solicitada") BETWEEN 1 AND 60 AND "delivery_solicitada" = btrim("delivery_solicitada")))
         AND ("quantidade_solicitada" IS NULL OR "quantidade_solicitada" > 0)
         AND ("observacao" IS NULL OR (char_length("observacao") BETWEEN 1 AND 500 AND "observacao" = btrim("observacao")))
         AND jsonb_typeof("apresentado") = 'object');

CREATE TABLE "selecao_teste_versao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "solicitacao_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "itens" JSONB NOT NULL,
    "observacao" TEXT,
    "total_volumes" INTEGER NOT NULL,
    "itens_em_analise" INTEGER NOT NULL,
    "alteracao_id" UUID,
    "enviada_por_id" UUID NOT NULL,
    "enviada_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "selecao_teste_versao_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "selecao_teste_versao_solicitacao_id_numero_key" ON "selecao_teste_versao"("solicitacao_id", "numero");
CREATE INDEX "selecao_teste_versao_escopo_id_solicitacao_id_idx" ON "selecao_teste_versao"("escopo_id", "solicitacao_id");
ALTER TABLE "selecao_teste_versao" ADD CONSTRAINT "selecao_teste_versao_escopo_id_solicitacao_id_fkey" FOREIGN KEY ("escopo_id", "solicitacao_id") REFERENCES "selecao_teste_solicitacao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "selecao_teste_versao" ADD CONSTRAINT "selecao_teste_versao_enviada_por_id_fkey" FOREIGN KEY ("enviada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "selecao_teste_versao" ADD CONSTRAINT "selecao_teste_versao_coerente"
  CHECK ("numero" >= 1 AND "total_volumes" >= 0 AND "itens_em_analise" >= 0
         AND jsonb_typeof("itens") = 'array' AND jsonb_array_length("itens") >= 1
         AND (("numero" = 1) = ("alteracao_id" IS NULL)));

CREATE TABLE "selecao_teste_alteracao" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "solicitacao_id" UUID NOT NULL,
    "versao_base" INTEGER NOT NULL,
    "justificativa" TEXT NOT NULL,
    "situacao" "SituacaoAlteracaoTeste" NOT NULL DEFAULT 'PENDENTE',
    "solicitada_por_id" UUID NOT NULL,
    "solicitada_em" TIMESTAMPTZ(3) NOT NULL,
    "respondida_por_id" UUID,
    "respondida_em" TIMESTAMPTZ(3),
    "resposta" TEXT,
    "versao_resultante" INTEGER,

    CONSTRAINT "selecao_teste_alteracao_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "selecao_teste_alteracao_escopo_id_solicitacao_id_idx" ON "selecao_teste_alteracao"("escopo_id", "solicitacao_id");
-- No máximo um pedido aguardando resposta por solicitação.
CREATE UNIQUE INDEX "selecao_teste_alteracao_uma_pendente" ON "selecao_teste_alteracao"("solicitacao_id") WHERE "situacao" = 'PENDENTE';
ALTER TABLE "selecao_teste_alteracao" ADD CONSTRAINT "selecao_teste_alteracao_escopo_id_solicitacao_id_fkey" FOREIGN KEY ("escopo_id", "solicitacao_id") REFERENCES "selecao_teste_solicitacao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "selecao_teste_alteracao" ADD CONSTRAINT "selecao_teste_alteracao_solicitada_por_id_fkey" FOREIGN KEY ("solicitada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "selecao_teste_alteracao" ADD CONSTRAINT "selecao_teste_alteracao_respondida_por_id_fkey" FOREIGN KEY ("respondida_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "selecao_teste_alteracao" ADD CONSTRAINT "selecao_teste_alteracao_coerente"
  CHECK ("versao_base" >= 1
         AND char_length("justificativa") BETWEEN 5 AND 1000 AND "justificativa" = btrim("justificativa")
         AND (("situacao" = 'PENDENTE') = ("respondida_em" IS NULL))
         AND (("respondida_em" IS NULL) = ("respondida_por_id" IS NULL))
         AND (("respondida_em" IS NULL) = ("resposta" IS NULL))
         AND ("resposta" IS NULL OR (char_length("resposta") BETWEEN 2 AND 1000 AND "resposta" = btrim("resposta")))
         -- Só uma alteração aprovada gera nova versão.
         AND ("versao_resultante" IS NULL OR ("situacao" = 'APROVADA' AND "versao_resultante" > "versao_base")));

CREATE TABLE "selecao_teste_evento" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "solicitacao_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "autor_id" UUID NOT NULL,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL,
    "detalhes" JSONB NOT NULL,

    CONSTRAINT "selecao_teste_evento_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "selecao_teste_evento_escopo_id_solicitacao_id_ocorrido_em_idx" ON "selecao_teste_evento"("escopo_id", "solicitacao_id", "ocorrido_em");
ALTER TABLE "selecao_teste_evento" ADD CONSTRAINT "selecao_teste_evento_escopo_id_solicitacao_id_fkey" FOREIGN KEY ("escopo_id", "solicitacao_id") REFERENCES "selecao_teste_solicitacao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "selecao_teste_evento" ADD CONSTRAINT "selecao_teste_evento_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "selecao_teste_evento" ADD CONSTRAINT "selecao_teste_evento_coerente"
  CHECK (char_length("tipo") BETWEEN 3 AND 40 AND jsonb_typeof("detalhes") = 'object');

-- Versões enviadas e histórico não são alterados nem apagados.
CREATE FUNCTION "proteger_registro_selecao_teste"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SELECAO_TESTE_IMUTAVEL: versões enviadas e histórico da seleção de teste não são alterados nem apagados' USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "selecao_teste_versao_protegida" BEFORE UPDATE OR DELETE ON "selecao_teste_versao"
FOR EACH ROW EXECUTE FUNCTION "proteger_registro_selecao_teste"();
CREATE TRIGGER "selecao_teste_evento_protegido" BEFORE UPDATE OR DELETE ON "selecao_teste_evento"
FOR EACH ROW EXECUTE FUNCTION "proteger_registro_selecao_teste"();
