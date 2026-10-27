-- Planilha automática e proteção dos dados (26 out. 2026). Pedido:
-- PROMPT-CLAUDE-PLANILHA-E-PROTECAO-AUTOMATICA.txt. Migração aditiva: nada é
-- apagado; o histórico de `publicacao_planilha` fica preservado (somente
-- leitura a partir daqui).
--
-- 1. Revisão dos dados por escopo (crescente) e estado do envio ao destino
--    independente, separado da geração local.
-- 2. Geração local (uma linha por tentativa; GERADA = arquivo validado com
--    revisão própria) e envio externo (planilha de uma revisão ou backup
--    completo; CONFIRMADO só depois de relido e conferido no destino).
-- 3. Concessão e espera das rotinas globais (backup automático).
-- 4. Fila da planilha: gatilhos também nas tabelas criadas depois de 10/10
--    (conteúdos, contagens, conferências, históricos, volumes da janela);
--    pedidos e downloads da própria planilha não marcam alteração.

-- ---------- 1. Revisão e envio por escopo ----------

ALTER TABLE "controle_planilha"
  ADD COLUMN "revisao_dados" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revisao_publicada" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "envio_falhas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "envio_proxima_em" TIMESTAMPTZ(3),
  ADD COLUMN "envio_ultima_falha" TEXT,
  ADD COLUMN "envio_ultima_falha_em" TIMESTAMPTZ(3);

ALTER TABLE "controle_planilha" ADD CONSTRAINT "controle_planilha_revisoes"
  CHECK ("revisao_dados" >= 0 AND "revisao_publicada" >= 0 AND "envio_falhas" >= 0
         AND (("envio_ultima_falha" IS NULL) = ("envio_ultima_falha_em" IS NULL)));

-- ---------- 2. Geração local e envio externo ----------

CREATE TABLE "geracao_planilha" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "revisao" INTEGER,
    "situacao" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "solicitado_por_id" UUID,
    "iniciado_em" TIMESTAMPTZ(3) NOT NULL,
    "concluido_em" TIMESTAMPTZ(3),
    "instante_dados" TIMESTAMPTZ(3),
    "ultima_alteracao_em" TIMESTAMPTZ(3),
    "alteracoes_incluidas" INTEGER NOT NULL DEFAULT 0,
    "lote_ativo" TEXT,
    "pre_substituicao" BOOLEAN NOT NULL DEFAULT false,
    "registros" JSONB,
    "arquivos" JSONB,
    "nome_arquivo" TEXT,
    "hash_arquivo" TEXT,
    "tamanho_bytes" INTEGER,
    "erro" TEXT,

    CONSTRAINT "geracao_planilha_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "geracao_planilha_escopo_id_revisao_key" ON "geracao_planilha"("escopo_id", "revisao");
CREATE INDEX "geracao_planilha_escopo_id_iniciado_em_idx" ON "geracao_planilha"("escopo_id", "iniciado_em");
ALTER TABLE "geracao_planilha" ADD CONSTRAINT "geracao_planilha_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "geracao_planilha" ADD CONSTRAINT "geracao_planilha_solicitado_por_id_fkey" FOREIGN KEY ("solicitado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Revisão só em geração concluída com arquivo validado (a tentativa que falha não
-- ocupa número: nada dela foi observável); falha sempre com motivo.
ALTER TABLE "geracao_planilha" ADD CONSTRAINT "geracao_planilha_coerente"
  CHECK ("situacao" IN ('GERANDO', 'GERADA', 'FALHOU')
         AND "motivo" IN ('ALTERACAO', 'RECONCILIACAO', 'MANUAL', 'PRE_SUBSTITUICAO')
         AND "alteracoes_incluidas" >= 0
         AND ("situacao" = 'GERANDO' OR "concluido_em" IS NOT NULL)
         AND (("situacao" = 'GERADA') = ("revisao" IS NOT NULL))
         AND ("revisao" IS NULL OR "revisao" >= 1)
         AND ("situacao" <> 'GERADA'
              OR ("instante_dados" IS NOT NULL AND "hash_arquivo" ~ '^[0-9a-f]{64}$' AND "tamanho_bytes" > 0
                  AND "nome_arquivo" IS NOT NULL AND jsonb_typeof("registros") = 'object'
                  AND jsonb_typeof("arquivos") = 'array' AND "erro" IS NULL))
         AND ("situacao" <> 'FALHOU' OR "erro" IS NOT NULL));

CREATE TABLE "envio_externo" (
    "id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "escopo_id" UUID,
    "referencia" TEXT NOT NULL,
    "situacao" TEXT NOT NULL,
    "destino_tipo" TEXT NOT NULL,
    "destino" TEXT NOT NULL,
    "chave" TEXT,
    "hash" TEXT,
    "tamanho_bytes" BIGINT,
    "arquivos" INTEGER,
    "iniciado_em" TIMESTAMPTZ(3) NOT NULL,
    "concluido_em" TIMESTAMPTZ(3),
    "erro" TEXT,
    "detalhes" JSONB,

    CONSTRAINT "envio_externo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "envio_externo_tipo_escopo_id_iniciado_em_idx" ON "envio_externo"("tipo", "escopo_id", "iniciado_em");
ALTER TABLE "envio_externo" ADD CONSTRAINT "envio_externo_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Idempotência: a mesma revisão (ou o mesmo backup) é confirmada no destino uma vez só.
CREATE UNIQUE INDEX "envio_externo_confirmado_unico" ON "envio_externo"
  ("tipo", coalesce("escopo_id", '00000000-0000-0000-0000-000000000000'::uuid), "referencia")
  WHERE "situacao" = 'CONFIRMADO';

ALTER TABLE "envio_externo" ADD CONSTRAINT "envio_externo_coerente"
  CHECK ("tipo" IN ('PLANILHA', 'BACKUP')
         AND "situacao" IN ('ENVIANDO', 'CONFIRMADO', 'FALHOU')
         AND "destino_tipo" IN ('S3', 'PASTA')
         AND (("tipo" = 'PLANILHA') = ("escopo_id" IS NOT NULL))
         AND length(btrim("referencia")) > 0
         AND ("situacao" = 'ENVIANDO' OR "concluido_em" IS NOT NULL)
         AND ("situacao" <> 'CONFIRMADO'
              OR ("hash" ~ '^[0-9a-f]{64}$' AND "tamanho_bytes" > 0 AND "chave" IS NOT NULL AND "erro" IS NULL))
         AND ("situacao" <> 'FALHOU' OR "erro" IS NOT NULL)
         AND ("detalhes" IS NULL OR jsonb_typeof("detalhes") = 'object'));

-- Situação final não muda mais (a tentativa em andamento é concluída uma vez).
CREATE FUNCTION "proteger_registro_concluido"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."situacao" NOT IN ('GERANDO', 'ENVIANDO') THEN
    RAISE EXCEPTION 'HISTORICO_IMUTAVEL: registro concluído de geração ou envio não é alterado nem apagado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "geracao_planilha_protegida" BEFORE UPDATE OR DELETE ON "geracao_planilha"
FOR EACH ROW EXECUTE FUNCTION "proteger_registro_concluido"();
CREATE TRIGGER "envio_externo_protegido" BEFORE UPDATE OR DELETE ON "envio_externo"
FOR EACH ROW EXECUTE FUNCTION "proteger_registro_concluido"();

-- ---------- 3. Rotinas globais (backup automático) ----------

CREATE TABLE "controle_protecao" (
    "chave" TEXT NOT NULL,
    "executando_desde" TIMESTAMPTZ(3),
    "executando_por" TEXT,
    "falhas" INTEGER NOT NULL DEFAULT 0,
    "proxima_em" TIMESTAMPTZ(3),
    "ultima_falha" TEXT,
    "ultima_falha_em" TIMESTAMPTZ(3),

    CONSTRAINT "controle_protecao_pkey" PRIMARY KEY ("chave"),
    CONSTRAINT "controle_protecao_coerente" CHECK ("chave" IN ('BACKUP') AND "falhas" >= 0
      AND (("executando_desde" IS NULL) = ("executando_por" IS NULL))
      AND (("ultima_falha" IS NULL) = ("ultima_falha_em" IS NULL)))
);

-- ---------- 4. Fila da planilha ----------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conteudo_palete', 'contagem_volumes', 'conferencia_volumes', 'reconferencia_palete',
                           'historico_conteudo', 'historico_codigo_palete', 'evento_volumes_janela'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS linhas FOR EACH STATEMENT EXECUTE FUNCTION "marcar_alteracao_planilha"()', t || '_planilha_ins', t);
    EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING NEW TABLE AS linhas FOR EACH STATEMENT EXECUTE FUNCTION "marcar_alteracao_planilha"()', t || '_planilha_upd', t);
    EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS linhas FOR EACH STATEMENT EXECUTE FUNCTION "marcar_alteracao_planilha"()', t || '_planilha_del', t);
  END LOOP;
END $$;

-- Auditoria: pedidos, downloads e verificações da própria planilha/proteção não são alteração do inventário.
CREATE OR REPLACE FUNCTION "marcar_alteracao_planilha_auditoria"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "alteracao_planilha" ("escopo_id", "origem")
  SELECT DISTINCT "escopo_id", 'evento_auditoria' FROM "linhas"
   WHERE "escopo_id" IS NOT NULL AND "resultado" = 'SUCESSO'
     AND "acao" NOT LIKE 'LOGIN%' AND "acao" NOT IN ('LOGOUT', 'ESCOPO_ALTERADO', 'ACESSO_NEGADO', 'ETIQUETA_EMITIDA', 'BUSCA_EXPORTADA')
     AND "acao" NOT LIKE '%BAIXADO' AND "acao" NOT LIKE '%EXPORTAD_'
     AND "acao" NOT LIKE 'PLANILHA\_%' AND "acao" NOT LIKE 'PROTECAO\_%';
  RETURN NULL;
END;
$$;
