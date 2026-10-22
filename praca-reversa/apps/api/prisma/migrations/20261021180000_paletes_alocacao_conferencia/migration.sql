-- Palete, alocação de conteúdos e conferência em tabela (21 out. 2026).
-- Pedido: CORRECAO-PALETES-CONFERENCIA-E-REFERENCIAS5.zip. Migração aditiva:
-- nenhuma linha é apagada; UUIDs, contagens e vínculos existentes ficam.
--
-- 1. Número operacional do palete ("Palete 256") × identificador legado
--    (PR-000001): o código passa a ser o número operacional; o legado fica
--    guardado, pesquisável e nunca reutilizado. Cada troca fica no histórico.
-- 2. Ocorrências (conteúdo registrado e vínculo importado): VALIDACAO (sem
--    endereço, fora do estoque físico do palete; o palete fica como último
--    conhecido) e CANCELADO (registro incorreto retirado do estoque ativo).
--    O vínculo importado pode mudar de palete (mover) preservando o ID.
-- 3. Histórico das correções de ocorrências (só acrescentado).
-- 4. Conferência de volumes em tabela: a operação (completa ou parcial) e os
--    itens abrangidos; a contagem gravada aponta a operação.

-- ---------- 1. Número operacional e código legado ----------

ALTER TABLE "palete" ADD COLUMN "codigo_legado" TEXT;
ALTER TABLE "palete" ADD CONSTRAINT "palete_codigo_legado_valido"
  CHECK ("codigo_legado" IS NULL OR (length(btrim("codigo_legado")) > 0 AND "codigo_legado" <> "codigo"));
CREATE UNIQUE INDEX "palete_codigo_legado_key" ON "palete"("escopo_id", "codigo_legado") WHERE "codigo_legado" IS NOT NULL;

CREATE TABLE "historico_codigo_palete" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "codigo_anterior" TEXT NOT NULL,
    "codigo_novo" TEXT NOT NULL,
    "origem_anterior" TEXT NOT NULL,
    "origem_nova" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "fonte" TEXT,
    "operacao_id" UUID NOT NULL,
    "autor_id" UUID,
    "registrado_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "historico_codigo_palete_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "historico_codigo_palete_coerente" CHECK ("codigo_anterior" <> "codigo_novo" AND length(btrim("motivo")) > 0)
);
CREATE INDEX "historico_codigo_palete_escopo_id_palete_id_idx" ON "historico_codigo_palete"("escopo_id", "palete_id");
ALTER TABLE "historico_codigo_palete" ADD CONSTRAINT "historico_codigo_palete_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "historico_codigo_palete" ADD CONSTRAINT "historico_codigo_palete_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- 2. Situações e alocação das ocorrências ----------

-- Data em que a ocorrência entrou no palete atual (NULL = desde o registro).
ALTER TABLE "conteudo_palete" ADD COLUMN "alocado_em" TIMESTAMPTZ(3);
ALTER TABLE "vinculo_documento_palete" ADD COLUMN "alocado_em" TIMESTAMPTZ(3);

ALTER TABLE "conteudo_palete" DROP CONSTRAINT "conteudo_palete_campos";
ALTER TABLE "conteudo_palete" ADD CONSTRAINT "conteudo_palete_campos"
  CHECK (length(btrim("remetente")) > 0
         AND ("tipo_documento" IS NULL OR "tipo_documento" IN ('NF', 'NFD', 'MI'))
         AND ("numero_documento" IS NULL OR length(btrim("numero_documento")) > 0)
         AND ("delivery" IS NULL OR length(btrim("delivery")) > 0)
         AND ("descricao" IS NULL OR length(btrim("descricao")) > 0)
         AND "situacao" IN ('ATIVO', 'ENCERRADO', 'VALIDACAO', 'CANCELADO')
         AND "versao" > 0);

-- Encerrado (versão nova do inventário) e cancelado (registro incorreto) têm autoria e motivo.
ALTER TABLE "vinculo_documento_palete" DROP CONSTRAINT "vinculo_documento_palete_coerente";
ALTER TABLE "vinculo_documento_palete" ADD CONSTRAINT "vinculo_documento_palete_coerente"
  CHECK ("situacao" IN ('ATIVO', 'ENCERRADO', 'VALIDACAO', 'CANCELADO')
         AND (("situacao" IN ('ENCERRADO', 'CANCELADO')) = ("encerrado_em" IS NOT NULL AND "encerrado_por_id" IS NOT NULL AND "motivo_encerramento" IS NOT NULL))
         AND char_length("numero_documento") BETWEEN 1 AND 200 AND "numero_documento" = btrim("numero_documento")
         AND char_length("chave_documento") BETWEEN 2 AND 260
         AND char_length("unidade_volumes") BETWEEN 1 AND 20
         AND ("volumes" IS NULL OR "volumes" >= 0));

-- Vínculo documental: a fotografia (documento, volumes, linha) continua imutável.
-- Mudam só a situação (ATIVO ↔ VALIDACAO; ATIVO/VALIDACAO → ENCERRADO/CANCELADO),
-- o palete atual e a data da alocação (mover), e o reconhecimento externo.
CREATE OR REPLACE FUNCTION "proteger_vinculo_documento"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  livres CONSTANT text[] := ARRAY['situacao', 'encerrado_em', 'encerrado_por_id', 'motivo_encerramento', 'conferido_externamente', 'palete_id', 'alocado_em'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'INVENTARIO_IMUTAVEL: vínculos documentais não são apagados' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."situacao" IN ('ENCERRADO', 'CANCELADO')
     OR (to_jsonb(NEW) - livres) <> (to_jsonb(OLD) - livres)
     OR (OLD."conferido_externamente" AND NOT NEW."conferido_externamente")
     OR (NEW."palete_id" <> OLD."palete_id" AND NOT (OLD."situacao" IN ('ATIVO', 'VALIDACAO') AND NEW."situacao" IN ('ATIVO', 'VALIDACAO'))) THEN
    RAISE EXCEPTION 'INVENTARIO_IMUTAVEL: vínculo documental só é movido, encaminhado à validação, encerrado ou reconhecido' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE INDEX "vinculo_documento_palete_validacao_idx" ON "vinculo_documento_palete"("escopo_id") WHERE "situacao" = 'VALIDACAO';
CREATE INDEX "conteudo_palete_validacao_idx" ON "conteudo_palete"("escopo_id") WHERE "situacao" = 'VALIDACAO';

-- ---------- 3. Histórico das correções de ocorrências ----------

CREATE TABLE "historico_conteudo" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "operacao_id" UUID NOT NULL,
    "conteudo_id" UUID,
    "vinculo_id" UUID,
    "acao" TEXT NOT NULL,
    "palete_origem_id" UUID,
    "codigo_origem" TEXT,
    "endereco_origem" TEXT,
    "palete_destino_id" UUID,
    "codigo_destino" TEXT,
    "endereco_destino" TEXT,
    "situacao_anterior" TEXT NOT NULL,
    "situacao_nova" TEXT NOT NULL,
    "volumes" INTEGER,
    "motivo" TEXT,
    "autor_id" UUID,
    "registrado_em" TIMESTAMPTZ(3) NOT NULL,
    "detalhes" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "historico_conteudo_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "historico_conteudo_coerente" CHECK (
      num_nonnulls("conteudo_id", "vinculo_id") = 1
      AND "acao" IN ('MOVIMENTO', 'VALIDACAO', 'RESOLUCAO', 'CANCELAMENTO', 'ENCERRAMENTO')
      AND ("volumes" IS NULL OR "volumes" >= 0)
      AND ("motivo" IS NULL OR length(btrim("motivo")) > 0))
);
CREATE INDEX "historico_conteudo_escopo_id_conteudo_id_idx" ON "historico_conteudo"("escopo_id", "conteudo_id", "registrado_em") WHERE "conteudo_id" IS NOT NULL;
CREATE INDEX "historico_conteudo_escopo_id_vinculo_id_idx" ON "historico_conteudo"("escopo_id", "vinculo_id", "registrado_em") WHERE "vinculo_id" IS NOT NULL;
CREATE INDEX "historico_conteudo_escopo_id_operacao_id_idx" ON "historico_conteudo"("escopo_id", "operacao_id");
ALTER TABLE "historico_conteudo" ADD CONSTRAINT "historico_conteudo_escopo_id_conteudo_id_fkey" FOREIGN KEY ("escopo_id", "conteudo_id") REFERENCES "conteudo_palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "historico_conteudo" ADD CONSTRAINT "historico_conteudo_escopo_id_vinculo_id_fkey" FOREIGN KEY ("escopo_id", "vinculo_id") REFERENCES "vinculo_documento_palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "historico_conteudo" ADD CONSTRAINT "historico_conteudo_escopo_id_palete_origem_id_fkey" FOREIGN KEY ("escopo_id", "palete_origem_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "historico_conteudo" ADD CONSTRAINT "historico_conteudo_escopo_id_palete_destino_id_fkey" FOREIGN KEY ("escopo_id", "palete_destino_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "historico_conteudo" ADD CONSTRAINT "historico_conteudo_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- 4. Conferência de volumes em tabela ----------

CREATE TABLE "conferencia_volumes" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_id" UUID NOT NULL,
    "abrangencia" TEXT NOT NULL,
    "resultado" TEXT NOT NULL,
    "declaracao_fisica" BOOLEAN NOT NULL,
    "assinatura_conjunto" TEXT NOT NULL,
    "itens" INTEGER NOT NULL,
    "alterados" INTEGER NOT NULL,
    "diferencas" INTEGER NOT NULL,
    "volumes_antes" INTEGER,
    "volumes_depois" INTEGER,
    "observacao" TEXT,
    "reconferencia_id" UUID,
    "registrada_por_id" UUID NOT NULL,
    "registrada_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conferencia_volumes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conferencia_volumes_coerente" CHECK (
      "abrangencia" IN ('COMPLETA', 'PARCIAL')
      AND "resultado" IN ('SEM_DIFERENCA', 'COM_DIFERENCA')
      AND ("abrangencia" = 'PARCIAL' OR "declaracao_fisica")
      AND (("abrangencia" = 'COMPLETA') = ("reconferencia_id" IS NOT NULL))
      AND "itens" > 0 AND "alterados" BETWEEN 0 AND "itens" AND "diferencas" BETWEEN 0 AND "itens"
      AND (("resultado" = 'COM_DIFERENCA') = ("diferencas" > 0))
      AND ("volumes_antes" IS NULL OR "volumes_antes" >= 0) AND ("volumes_depois" IS NULL OR "volumes_depois" >= 0)
      AND ("observacao" IS NULL OR length(btrim("observacao")) > 0))
);
CREATE UNIQUE INDEX "conferencia_volumes_escopo_id_id_key" ON "conferencia_volumes"("escopo_id", "id");
CREATE INDEX "conferencia_volumes_escopo_id_palete_id_idx" ON "conferencia_volumes"("escopo_id", "palete_id", "registrada_em");
ALTER TABLE "conferencia_volumes" ADD CONSTRAINT "conferencia_volumes_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conferencia_volumes" ADD CONSTRAINT "conferencia_volumes_reconferencia_id_fkey" FOREIGN KEY ("reconferencia_id") REFERENCES "reconferencia_palete"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conferencia_volumes" ADD CONSTRAINT "conferencia_volumes_registrada_por_id_fkey" FOREIGN KEY ("registrada_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contagem_volumes" ADD COLUMN "conferencia_id" UUID;
ALTER TABLE "contagem_volumes" ADD CONSTRAINT "contagem_volumes_escopo_id_conferencia_id_fkey" FOREIGN KEY ("escopo_id", "conferencia_id") REFERENCES "conferencia_volumes"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "contagem_volumes_conferencia_id_idx" ON "contagem_volumes"("conferencia_id") WHERE "conferencia_id" IS NOT NULL;

CREATE TABLE "item_conferencia_volumes" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "conferencia_id" UUID NOT NULL,
    "conteudo_id" UUID,
    "vinculo_id" UUID,
    "volumes_anteriores" INTEGER,
    "volumes_contados" INTEGER NOT NULL,
    "contagem_id" UUID,

    CONSTRAINT "item_conferencia_volumes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "item_conferencia_volumes_coerente" CHECK (
      num_nonnulls("conteudo_id", "vinculo_id") = 1
      AND "volumes_contados" >= 0 AND ("volumes_anteriores" IS NULL OR "volumes_anteriores" >= 0)
      -- Valor alterado (ou sem referência) grava contagem; igual ao atual só registra a abrangência.
      AND (("contagem_id" IS NULL) = ("volumes_anteriores" IS NOT NULL AND "volumes_anteriores" = "volumes_contados")))
);
CREATE UNIQUE INDEX "item_conferencia_volumes_alvo_key" ON "item_conferencia_volumes"("conferencia_id", coalesce("conteudo_id", "vinculo_id"));
CREATE INDEX "item_conferencia_volumes_escopo_id_conteudo_id_idx" ON "item_conferencia_volumes"("escopo_id", "conteudo_id") WHERE "conteudo_id" IS NOT NULL;
CREATE INDEX "item_conferencia_volumes_escopo_id_vinculo_id_idx" ON "item_conferencia_volumes"("escopo_id", "vinculo_id") WHERE "vinculo_id" IS NOT NULL;
ALTER TABLE "item_conferencia_volumes" ADD CONSTRAINT "item_conferencia_volumes_escopo_id_conferencia_id_fkey" FOREIGN KEY ("escopo_id", "conferencia_id") REFERENCES "conferencia_volumes"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_conferencia_volumes" ADD CONSTRAINT "item_conferencia_volumes_escopo_id_conteudo_id_fkey" FOREIGN KEY ("escopo_id", "conteudo_id") REFERENCES "conteudo_palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_conferencia_volumes" ADD CONSTRAINT "item_conferencia_volumes_escopo_id_vinculo_id_fkey" FOREIGN KEY ("escopo_id", "vinculo_id") REFERENCES "vinculo_documento_palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "item_conferencia_volumes" ADD CONSTRAINT "item_conferencia_volumes_contagem_id_fkey" FOREIGN KEY ("contagem_id") REFERENCES "contagem_volumes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Histórico, operação de conferência, itens e trocas de código só se acrescentam.
CREATE FUNCTION "registro_so_acrescentado"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'REGISTRO_IMUTAVEL: % não é alterado nem apagado (registre um evento novo)', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER "historico_conteudo_imutavel" BEFORE UPDATE OR DELETE ON "historico_conteudo"
FOR EACH ROW EXECUTE FUNCTION "registro_so_acrescentado"();
CREATE TRIGGER "historico_codigo_palete_imutavel" BEFORE UPDATE OR DELETE ON "historico_codigo_palete"
FOR EACH ROW EXECUTE FUNCTION "registro_so_acrescentado"();
CREATE TRIGGER "conferencia_volumes_imutavel" BEFORE UPDATE OR DELETE ON "conferencia_volumes"
FOR EACH ROW EXECUTE FUNCTION "registro_so_acrescentado"();
CREATE TRIGGER "item_conferencia_volumes_imutavel" BEFORE UPDATE OR DELETE ON "item_conferencia_volumes"
FOR EACH ROW EXECUTE FUNCTION "registro_so_acrescentado"();
