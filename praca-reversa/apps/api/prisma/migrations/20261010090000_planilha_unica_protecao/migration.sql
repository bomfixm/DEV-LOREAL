-- Planilha única automática e proteção dos dados (6 out. 2026): fila durável
-- da planilha por gatilhos, controle e histórico das publicações por escopo e
-- registro dos backups e testes de restauração verificados. Estrutura gerada
-- com `prisma migrate diff` e acrescida à mão de CHECKs e gatilhos.

-- CreateTable
CREATE TABLE "alteracao_planilha" (
    "id" BIGSERIAL NOT NULL,
    "escopo_id" UUID NOT NULL,
    "origem" TEXT NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alteracao_planilha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "controle_planilha" (
    "escopo_id" UUID NOT NULL,
    "versao_atual" INTEGER NOT NULL DEFAULT 0,
    "publicando_desde" TIMESTAMPTZ(3),
    "publicando_por" TEXT,
    "falhas_seguidas" INTEGER NOT NULL DEFAULT 0,
    "proxima_tentativa_em" TIMESTAMPTZ(3),
    "ultima_falha" TEXT,
    "ultima_falha_em" TIMESTAMPTZ(3),

    CONSTRAINT "controle_planilha_pkey" PRIMARY KEY ("escopo_id")
);

-- CreateTable
CREATE TABLE "publicacao_planilha" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "versao" INTEGER NOT NULL,
    "situacao" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "solicitado_por_id" UUID,
    "iniciado_em" TIMESTAMPTZ(3) NOT NULL,
    "concluido_em" TIMESTAMPTZ(3),
    "instante_snapshot" TIMESTAMPTZ(3),
    "alteracoes_incluidas" INTEGER NOT NULL DEFAULT 0,
    "registros" JSONB,
    "nome_arquivo" TEXT,
    "hash_arquivo" TEXT,
    "tamanho_bytes" INTEGER,
    "destino" TEXT,
    "identificacao_publicacao" TEXT,
    "versao_anterior_preservada" TEXT,
    "erro" TEXT,

    CONSTRAINT "publicacao_planilha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_protecao" (
    "id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "situacao" TEXT NOT NULL,
    "iniciado_em" TIMESTAMPTZ(3) NOT NULL,
    "concluido_em" TIMESTAMPTZ(3) NOT NULL,
    "identificador" TEXT,
    "tamanho_bytes" BIGINT,
    "destino" TEXT,
    "fora_do_servidor" BOOLEAN NOT NULL DEFAULT false,
    "ambiente" TEXT,
    "dados" TEXT,
    "responsavel" TEXT,
    "mensagem" TEXT,
    "detalhes" JSONB,

    CONSTRAINT "registro_protecao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alteracao_planilha_escopo_id_id_idx" ON "alteracao_planilha"("escopo_id", "id");

-- CreateIndex
CREATE INDEX "publicacao_planilha_escopo_id_iniciado_em_idx" ON "publicacao_planilha"("escopo_id", "iniciado_em");

-- CreateIndex
CREATE UNIQUE INDEX "publicacao_planilha_escopo_id_versao_key" ON "publicacao_planilha"("escopo_id", "versao");

-- CreateIndex
CREATE INDEX "registro_protecao_tipo_concluido_em_idx" ON "registro_protecao"("tipo", "concluido_em");

-- AddForeignKey
ALTER TABLE "controle_planilha" ADD CONSTRAINT "controle_planilha_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publicacao_planilha" ADD CONSTRAINT "publicacao_planilha_escopo_id_fkey" FOREIGN KEY ("escopo_id") REFERENCES "escopo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publicacao_planilha" ADD CONSTRAINT "publicacao_planilha_solicitado_por_id_fkey" FOREIGN KEY ("solicitado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- Acréscimos à mão ----------

-- Controle por escopo: concessão com autoria; contadores não negativos.
ALTER TABLE "controle_planilha" ADD CONSTRAINT "controle_planilha_coerente"
  CHECK ("versao_atual" >= 0 AND "falhas_seguidas" >= 0
         AND (("publicando_desde" IS NULL) = ("publicando_por" IS NULL))
         AND (("ultima_falha" IS NULL) = ("ultima_falha_em" IS NULL)));

-- Publicação: sucesso só com arquivo validado (hash, tamanho, snapshot); publicada
-- só no destino independente; falha com motivo. Situação final não muda mais.
ALTER TABLE "publicacao_planilha" ADD CONSTRAINT "publicacao_planilha_coerente"
  CHECK ("versao" >= 1 AND "alteracoes_incluidas" >= 0
         AND "situacao" IN ('GERANDO', 'PUBLICADA', 'GERADA_LOCAL', 'FALHOU')
         AND "motivo" IN ('ALTERACAO', 'RECONCILIACAO', 'MANUAL')
         AND ("destino" IS NULL OR "destino" IN ('PASTA', 'LOCAL'))
         AND ("registros" IS NULL OR jsonb_typeof("registros") = 'object')
         AND ("situacao" = 'GERANDO' OR "concluido_em" IS NOT NULL)
         AND ("situacao" NOT IN ('PUBLICADA', 'GERADA_LOCAL')
              OR ("instante_snapshot" IS NOT NULL AND "hash_arquivo" ~ '^[0-9a-f]{64}$' AND "tamanho_bytes" > 0
                  AND "nome_arquivo" IS NOT NULL AND "registros" IS NOT NULL AND "erro" IS NULL))
         AND ("situacao" <> 'PUBLICADA' OR ("destino" = 'PASTA' AND "identificacao_publicacao" IS NOT NULL))
         AND ("situacao" <> 'GERADA_LOCAL' OR "destino" = 'LOCAL')
         AND ("situacao" <> 'FALHOU' OR "erro" IS NOT NULL));

CREATE FUNCTION "proteger_publicacao_planilha"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."situacao" <> 'GERANDO' THEN
    RAISE EXCEPTION 'HISTORICO_IMUTAVEL: publicação da planilha concluída não é alterada nem apagada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "publicacao_planilha_protegida" BEFORE UPDATE OR DELETE ON "publicacao_planilha"
FOR EACH ROW EXECUTE FUNCTION "proteger_publicacao_planilha"();

-- Backup e teste de restauração: registro do que foi verificado (imutável).
ALTER TABLE "registro_protecao" ADD CONSTRAINT "registro_protecao_coerente"
  CHECK ("tipo" IN ('BACKUP', 'TESTE_RESTAURACAO')
         AND "situacao" IN ('VERIFICADO', 'FALHOU')
         AND "concluido_em" >= "iniciado_em"
         AND ("situacao" <> 'FALHOU' OR "mensagem" IS NOT NULL)
         AND ("dados" IS NULL OR "dados" IN ('OPERACAO', 'FICTICIOS'))
         AND ("tamanho_bytes" IS NULL OR "tamanho_bytes" >= 0)
         AND ("detalhes" IS NULL OR jsonb_typeof("detalhes") = 'object'));

CREATE TRIGGER "registro_protecao_imutavel" BEFORE UPDATE OR DELETE ON "registro_protecao"
FOR EACH ROW EXECUTE FUNCTION "impedir_alteracao_historico"();

-- Fila da planilha: marca o escopo alterado na mesma transação da alteração
-- (gatilho por instrução, com tabela de transição: uma marcação por instrução
-- e escopo, não por linha). Só insere: não disputa bloqueio com a operação.
CREATE FUNCTION "marcar_alteracao_planilha"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "alteracao_planilha" ("escopo_id", "origem")
  SELECT DISTINCT "escopo_id", TG_TABLE_NAME FROM "linhas" WHERE "escopo_id" IS NOT NULL;
  RETURN NULL;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['palete', 'vinculo_documento_palete', 'linha_inventario', 'inventario_referencia', 'informacao_documento',
                           'conteudo_documento_palete', 'descricao_caixa_documento', 'endereco_posicao', 'sessao_conferencia',
                           'evento_localizacao', 'evento_estoque'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS linhas FOR EACH STATEMENT EXECUTE FUNCTION "marcar_alteracao_planilha"()', t || '_planilha_ins', t);
    EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING NEW TABLE AS linhas FOR EACH STATEMENT EXECUTE FUNCTION "marcar_alteracao_planilha"()', t || '_planilha_upd', t);
    EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS linhas FOR EACH STATEMENT EXECUTE FUNCTION "marcar_alteracao_planilha"()', t || '_planilha_del', t);
  END LOOP;
END $$;

-- Auditoria: só eventos operacionais confirmados mudam a aba Movimentações
-- (consultas, logins, downloads e exportações não).
CREATE FUNCTION "marcar_alteracao_planilha_auditoria"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "alteracao_planilha" ("escopo_id", "origem")
  SELECT DISTINCT "escopo_id", 'evento_auditoria' FROM "linhas"
   WHERE "escopo_id" IS NOT NULL AND "resultado" = 'SUCESSO'
     AND "acao" NOT LIKE 'LOGIN%' AND "acao" NOT IN ('LOGOUT', 'ESCOPO_ALTERADO', 'ACESSO_NEGADO', 'ETIQUETA_EMITIDA', 'BUSCA_EXPORTADA')
     AND "acao" NOT LIKE '%BAIXADO' AND "acao" NOT LIKE '%EXPORTAD_';
  RETURN NULL;
END;
$$;

CREATE TRIGGER "evento_auditoria_planilha_ins" AFTER INSERT ON "evento_auditoria"
REFERENCING NEW TABLE AS linhas FOR EACH STATEMENT EXECUTE FUNCTION "marcar_alteracao_planilha_auditoria"();
