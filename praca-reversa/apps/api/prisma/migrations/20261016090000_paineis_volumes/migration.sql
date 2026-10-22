-- Painéis da operação DHL e do cliente: perfil de consulta do cliente, meta
-- da janela em VOLUMES (contagem operacional do inventário/pedido; não é m³,
-- caixas, paletes nem unidades de SKU) e eventos de separação/expedição por
-- conteúdo do palete (vínculo NF × palete importado ou conteúdo registrado).
-- Só acrescenta: nada existente muda de valor.

ALTER TYPE "Perfil" ADD VALUE IF NOT EXISTS 'CLIENTE_CONSULTA';

-- Meta da janela informada pelo cliente (vigente = a mais recente pela ordem de registro; histórico preservado).
CREATE TABLE "meta_janela_volumes" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "janela_id" UUID NOT NULL,
    "selecao_id" UUID,
    "volumes" INTEGER NOT NULL,
    "referencia" TEXT,
    "informado_por_id" UUID NOT NULL,
    "informado_em" TIMESTAMPTZ(3) NOT NULL,
    "ordem" SERIAL NOT NULL,

    CONSTRAINT "meta_janela_volumes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "meta_janela_volumes_escopo_id_janela_id_informado_em_idx" ON "meta_janela_volumes"("escopo_id", "janela_id", "informado_em");
ALTER TABLE "meta_janela_volumes" ADD CONSTRAINT "meta_janela_volumes_escopo_id_janela_id_fkey" FOREIGN KEY ("escopo_id", "janela_id") REFERENCES "janela_devolucao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meta_janela_volumes" ADD CONSTRAINT "meta_janela_volumes_escopo_id_selecao_id_fkey" FOREIGN KEY ("escopo_id", "selecao_id") REFERENCES "selecao_cliente"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meta_janela_volumes" ADD CONSTRAINT "meta_janela_volumes_informado_por_id_fkey" FOREIGN KEY ("informado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "meta_janela_volumes" ADD CONSTRAINT "meta_janela_volumes_coerente"
  CHECK ("volumes" >= 0 AND ("referencia" IS NULL OR (char_length("referencia") BETWEEN 1 AND 120 AND "referencia" = btrim("referencia"))));

-- Separação e expedição por volumes, conteúdo × palete × janela (só acrescentado).
CREATE TABLE "evento_volumes_janela" (
    "id" UUID NOT NULL,
    "escopo_id" UUID NOT NULL,
    "janela_id" UUID NOT NULL,
    "selecao_id" UUID,
    "linha_selecao_id" UUID,
    "vinculo_id" UUID,
    "conteudo_id" UUID,
    "palete_id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "volumes" INTEGER NOT NULL,
    "motivo" TEXT,
    "evento_corrigido_id" UUID,
    "autor_id" UUID NOT NULL,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evento_volumes_janela_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "evento_volumes_janela_escopo_id_janela_id_idx" ON "evento_volumes_janela"("escopo_id", "janela_id");
CREATE INDEX "evento_volumes_janela_escopo_id_vinculo_id_idx" ON "evento_volumes_janela"("escopo_id", "vinculo_id");
CREATE INDEX "evento_volumes_janela_escopo_id_conteudo_id_idx" ON "evento_volumes_janela"("escopo_id", "conteudo_id");
CREATE INDEX "evento_volumes_janela_escopo_id_palete_id_idx" ON "evento_volumes_janela"("escopo_id", "palete_id");
ALTER TABLE "evento_volumes_janela" ADD CONSTRAINT "evento_volumes_janela_escopo_id_janela_id_fkey" FOREIGN KEY ("escopo_id", "janela_id") REFERENCES "janela_devolucao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evento_volumes_janela" ADD CONSTRAINT "evento_volumes_janela_escopo_id_selecao_id_fkey" FOREIGN KEY ("escopo_id", "selecao_id") REFERENCES "selecao_cliente"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evento_volumes_janela" ADD CONSTRAINT "evento_volumes_janela_escopo_id_linha_selecao_id_fkey" FOREIGN KEY ("escopo_id", "linha_selecao_id") REFERENCES "linha_selecao"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evento_volumes_janela" ADD CONSTRAINT "evento_volumes_janela_escopo_id_vinculo_id_fkey" FOREIGN KEY ("escopo_id", "vinculo_id") REFERENCES "vinculo_documento_palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evento_volumes_janela" ADD CONSTRAINT "evento_volumes_janela_escopo_id_conteudo_id_fkey" FOREIGN KEY ("escopo_id", "conteudo_id") REFERENCES "conteudo_palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evento_volumes_janela" ADD CONSTRAINT "evento_volumes_janela_escopo_id_palete_id_fkey" FOREIGN KEY ("escopo_id", "palete_id") REFERENCES "palete"("escopo_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evento_volumes_janela" ADD CONSTRAINT "evento_volumes_janela_evento_corrigido_id_fkey" FOREIGN KEY ("evento_corrigido_id") REFERENCES "evento_volumes_janela"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evento_volumes_janela" ADD CONSTRAINT "evento_volumes_janela_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evento_volumes_janela" ADD CONSTRAINT "evento_volumes_janela_coerente"
  CHECK ("tipo" IN ('SEPARACAO', 'ESTORNO_SEPARACAO', 'EXPEDICAO', 'ESTORNO_EXPEDICAO')
         AND "volumes" > 0
         AND num_nonnulls("vinculo_id", "conteudo_id") = 1
         AND (("tipo" IN ('ESTORNO_SEPARACAO', 'ESTORNO_EXPEDICAO')) = ("evento_corrigido_id" IS NOT NULL AND "motivo" IS NOT NULL))
         AND ("motivo" IS NULL OR (char_length("motivo") BETWEEN 3 AND 300 AND "motivo" = btrim("motivo"))));

CREATE FUNCTION "proteger_evento_volumes_janela"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'VOLUMES_JANELA_IMUTAVEL: eventos de separação e expedição não são alterados nem apagados' USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "evento_volumes_janela_protegido" BEFORE UPDATE OR DELETE ON "evento_volumes_janela"
FOR EACH ROW EXECUTE FUNCTION "proteger_evento_volumes_janela"();

CREATE FUNCTION "proteger_meta_janela_volumes"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'META_JANELA_IMUTAVEL: a meta registrada não é alterada nem apagada (registre a nova)' USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "meta_janela_volumes_protegida" BEFORE UPDATE OR DELETE ON "meta_janela_volumes"
FOR EACH ROW EXECUTE FUNCTION "proteger_meta_janela_volumes"();
