-- Expedição DHL: montagem da carga por veículo (11 nov. 2026).
-- Migração aditiva: seis tabelas novas; nenhuma tabela existente muda e não há
-- backfill. Nada aqui baixa estoque: a baixa continua no evento EXPEDICAO por
-- volumes (evento_volumes_janela) registrado pelo fluxo existente da janela.
-- Reversão: as tabelas podem ficar sem uso (o código anterior não as lê).

-- Veículo de uma janela: Carreta (até 28) ou Truck (até 16). Sequência por tipo na janela.
CREATE TABLE "veiculo_carga" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "janela_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "sequencia" INTEGER NOT NULL,
    "capacidade" INTEGER NOT NULL,
    "nome" TEXT,
    "placa" TEXT,
    -- Grade da vista de cima: fileiras da frente (cabine) até a porta × colunas.
    "fileiras" INTEGER NOT NULL,
    "colunas" INTEGER NOT NULL,
    -- Falso = grade provisória (não é a disposição física confirmada).
    "disposicao_confirmada" BOOLEAN NOT NULL DEFAULT false,
    -- MONTAGEM, FECHADO ou CANCELADO.
    "situacao" TEXT NOT NULL DEFAULT 'MONTAGEM',
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "veiculo_carga_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "veiculo_carga_tipo_check" CHECK ("tipo" IN ('CARRETA', 'TRUCK')),
    CONSTRAINT "veiculo_carga_situacao_check" CHECK ("situacao" IN ('MONTAGEM', 'FECHADO', 'CANCELADO')),
    CONSTRAINT "veiculo_carga_capacidade_check" CHECK ("capacidade" BETWEEN 1 AND 40),
    CONSTRAINT "veiculo_carga_grade_check" CHECK ("fileiras" BETWEEN 1 AND 40 AND "colunas" BETWEEN 1 AND 4 AND "fileiras" * "colunas" >= "capacidade"),
    CONSTRAINT "veiculo_carga_janela_fkey" FOREIGN KEY ("escopo_id", "janela_id") REFERENCES "janela_devolucao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "veiculo_carga_criado_por_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "veiculo_carga_escopo_id_id_key" ON "veiculo_carga"("escopo_id", "id");
CREATE UNIQUE INDEX "veiculo_carga_janela_tipo_sequencia_key" ON "veiculo_carga"("janela_id", "tipo", "sequencia");
CREATE INDEX "veiculo_carga_escopo_janela_idx" ON "veiculo_carga"("escopo_id", "janela_id");

-- Palete de embarque: número no veículo (01..capacidade), posição planejada e
-- confirmada, tipo FULL ou FRACIONADO, revisão do conteúdo e conferência física.
CREATE TABLE "palete_embarque" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "veiculo_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "posicao" INTEGER,
    "posicao_confirmada" BOOLEAN NOT NULL DEFAULT false,
    "posicao_confirmada_por_id" UUID,
    "posicao_confirmada_em" TIMESTAMPTZ(3),
    "tipo" TEXT NOT NULL,
    -- FULL: o palete de origem inteiro. FRACIONADO: nulo (a origem fica por linha).
    "palete_origem_id" UUID,
    "revisao" INTEGER NOT NULL DEFAULT 1,
    "fisico_revisao" INTEGER,
    "fisico_por_id" UUID,
    "fisico_em" TIMESTAMPTZ(3),
    -- ATIVO ou CANCELADO.
    "situacao" TEXT NOT NULL DEFAULT 'ATIVO',
    "motivo_cancelamento" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL,
    "atualizado_em" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "palete_embarque_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "palete_embarque_tipo_check" CHECK ("tipo" IN ('FULL', 'FRACIONADO')),
    CONSTRAINT "palete_embarque_situacao_check" CHECK ("situacao" IN ('ATIVO', 'CANCELADO')),
    CONSTRAINT "palete_embarque_numero_check" CHECK ("numero" >= 1),
    CONSTRAINT "palete_embarque_posicao_check" CHECK ("posicao" IS NULL OR "posicao" >= 1),
    CONSTRAINT "palete_embarque_full_check" CHECK (("tipo" = 'FULL') = ("palete_origem_id" IS NOT NULL)),
    CONSTRAINT "palete_embarque_confirmada_check" CHECK (NOT "posicao_confirmada" OR "posicao" IS NOT NULL),
    CONSTRAINT "palete_embarque_veiculo_fkey" FOREIGN KEY ("escopo_id", "veiculo_id") REFERENCES "veiculo_carga"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "palete_embarque_origem_fkey" FOREIGN KEY ("escopo_id", "palete_origem_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "palete_embarque_escopo_id_id_key" ON "palete_embarque"("escopo_id", "id");
-- Um número por veículo e uma posição por veículo entre os ativos.
CREATE UNIQUE INDEX "palete_embarque_numero_ativo_key" ON "palete_embarque"("veiculo_id", "numero") WHERE "situacao" = 'ATIVO';
CREATE UNIQUE INDEX "palete_embarque_posicao_ativa_key" ON "palete_embarque"("veiculo_id", "posicao") WHERE "situacao" = 'ATIVO' AND "posicao" IS NOT NULL;
-- Um FULL ativo por palete de origem (não sai fechado em duas cargas).
CREATE UNIQUE INDEX "palete_embarque_full_ativo_key" ON "palete_embarque"("palete_origem_id") WHERE "situacao" = 'ATIVO' AND "tipo" = 'FULL';
CREATE INDEX "palete_embarque_escopo_veiculo_idx" ON "palete_embarque"("escopo_id", "veiculo_id");

-- Linha do palete de embarque: uma ocorrência de origem (vínculo do inventário
-- OU conteúdo registrado) e os volumes que vão neste palete. A mesma NF pode
-- aparecer em mais de uma linha/palete (parcial) sem virar duplicidade.
CREATE TABLE "linha_palete_embarque" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_embarque_id" UUID NOT NULL,
    "vinculo_id" UUID,
    "conteudo_id" UUID,
    "palete_origem_id" UUID NOT NULL,
    "palete_origem_codigo" TEXT NOT NULL,
    "volumes" INTEGER NOT NULL,
    "tipo_documento" TEXT,
    "numero_documento" TEXT,
    "remetente" TEXT,
    "delivery" TEXT,
    "ordem" INTEGER NOT NULL,
    -- NF retirada do palete depois de ter conferência documental: sai da carga, o registro fica.
    "removida_em" TIMESTAMPTZ(3),
    CONSTRAINT "linha_palete_embarque_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "linha_palete_embarque_volumes_check" CHECK ("volumes" > 0),
    CONSTRAINT "linha_palete_embarque_ocorrencia_check" CHECK (("vinculo_id" IS NULL) <> ("conteudo_id" IS NULL)),
    CONSTRAINT "linha_palete_embarque_palete_fkey" FOREIGN KEY ("escopo_id", "palete_embarque_id") REFERENCES "palete_embarque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "linha_palete_embarque_vinculo_fkey" FOREIGN KEY ("escopo_id", "vinculo_id") REFERENCES "vinculo_documento_palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "linha_palete_embarque_conteudo_fkey" FOREIGN KEY ("escopo_id", "conteudo_id") REFERENCES "conteudo_palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "linha_palete_embarque_origem_fkey" FOREIGN KEY ("escopo_id", "palete_origem_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "linha_palete_embarque_escopo_id_id_key" ON "linha_palete_embarque"("escopo_id", "id");
CREATE INDEX "linha_palete_embarque_palete_idx" ON "linha_palete_embarque"("escopo_id", "palete_embarque_id");
CREATE INDEX "linha_palete_embarque_vinculo_idx" ON "linha_palete_embarque"("escopo_id", "vinculo_id");
CREATE INDEX "linha_palete_embarque_conteudo_idx" ON "linha_palete_embarque"("escopo_id", "conteudo_id");

-- Conferência documental (administrativo) por linha e revisão do conteúdo. Só
-- acrescentada: a situação vigente é a mais recente da revisão atual.
CREATE TABLE "documento_embarque" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "palete_embarque_id" UUID NOT NULL,
    "linha_id" UUID NOT NULL,
    "revisao" INTEGER NOT NULL,
    "situacao" TEXT NOT NULL,
    "observacao" TEXT,
    "autor_id" UUID NOT NULL,
    "registrado_em" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "documento_embarque_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "documento_embarque_situacao_check" CHECK ("situacao" IN ('CONFERIDO', 'FALTANTE', 'DIVERGENTE')),
    CONSTRAINT "documento_embarque_palete_fkey" FOREIGN KEY ("escopo_id", "palete_embarque_id") REFERENCES "palete_embarque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "documento_embarque_linha_fkey" FOREIGN KEY ("escopo_id", "linha_id") REFERENCES "linha_palete_embarque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "documento_embarque_autor_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "documento_embarque_palete_idx" ON "documento_embarque"("escopo_id", "palete_embarque_id", "revisao");

-- Emissões impressas (etiqueta, espelho de embarque, mapa da carga): rascunho
-- ou final, com a identidade e a revisão emitidas, para apontar versão desatualizada.
CREATE TABLE "emissao_embarque" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "veiculo_id" UUID NOT NULL,
    "palete_embarque_id" UUID,
    "tipo" TEXT NOT NULL,
    "final" BOOLEAN NOT NULL,
    "revisao" INTEGER,
    "identidade" TEXT NOT NULL,
    "fotografia" JSONB NOT NULL,
    "autor_id" UUID NOT NULL,
    "emitido_em" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "emissao_embarque_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "emissao_embarque_tipo_check" CHECK ("tipo" IN ('ETIQUETA', 'ESPELHO', 'MAPA', 'DOCUMENTOS')),
    CONSTRAINT "emissao_embarque_veiculo_fkey" FOREIGN KEY ("escopo_id", "veiculo_id") REFERENCES "veiculo_carga"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "emissao_embarque_palete_fkey" FOREIGN KEY ("escopo_id", "palete_embarque_id") REFERENCES "palete_embarque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "emissao_embarque_autor_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "emissao_embarque_veiculo_idx" ON "emissao_embarque"("escopo_id", "veiculo_id", "tipo");

-- Histórico da montagem (só acrescentado).
CREATE TABLE "evento_embarque" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "veiculo_id" UUID NOT NULL,
    "palete_embarque_id" UUID,
    "tipo" TEXT NOT NULL,
    "detalhes" JSONB NOT NULL DEFAULT '{}',
    "autor_id" UUID NOT NULL,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "evento_embarque_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "evento_embarque_veiculo_fkey" FOREIGN KEY ("escopo_id", "veiculo_id") REFERENCES "veiculo_carga"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "evento_embarque_palete_fkey" FOREIGN KEY ("escopo_id", "palete_embarque_id") REFERENCES "palete_embarque"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "evento_embarque_autor_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "evento_embarque_veiculo_idx" ON "evento_embarque"("escopo_id", "veiculo_id", "ocorrido_em");
CREATE INDEX "evento_embarque_palete_idx" ON "evento_embarque"("escopo_id", "palete_embarque_id");

-- Registros só acrescentados: conferência documental, emissões e histórico.
CREATE FUNCTION "carga_somente_acrescentar"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Registro da expedição só pode ser acrescentado (%).', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER "documento_embarque_imutavel" BEFORE UPDATE OR DELETE ON "documento_embarque" FOR EACH ROW EXECUTE FUNCTION "carga_somente_acrescentar"();
CREATE TRIGGER "emissao_embarque_imutavel" BEFORE UPDATE OR DELETE ON "emissao_embarque" FOR EACH ROW EXECUTE FUNCTION "carga_somente_acrescentar"();
CREATE TRIGGER "evento_embarque_imutavel" BEFORE UPDATE OR DELETE ON "evento_embarque" FOR EACH ROW EXECUTE FUNCTION "carga_somente_acrescentar"();
