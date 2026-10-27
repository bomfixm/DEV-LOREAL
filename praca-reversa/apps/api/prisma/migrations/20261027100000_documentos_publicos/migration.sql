-- Termos de uso e aviso de privacidade (27 out. 2026). Pedido:
-- PROMPT-CLAUDE-PRACA-REVERSA-TERMOS-PRIVACIDADE-E-SEGURANCA.txt.
-- Migração aditiva: duas tabelas novas; nenhuma tabela existente muda. Sem
-- backfill: nenhuma minuta, aprovação, publicação ou aceite é criado aqui.
-- Reversão: as tabelas podem ficar sem uso (o código anterior não as lê);
-- não apagar versões nem aceites já registrados.

CREATE TABLE "documento_publico" (
    "id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "versao" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "conteudo" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "situacao" TEXT NOT NULL,
    "criado_por_id" UUID NOT NULL,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aprovacao_referencia" TEXT,
    "aprovacao_responsavel" TEXT,
    "aprovado_por_id" UUID,
    "aprovado_em" TIMESTAMPTZ(3),
    "publicado_por_id" UUID,
    "publicado_em" TIMESTAMPTZ(3),
    "substituido_em" TIMESTAMPTZ(3),

    CONSTRAINT "documento_publico_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "aceite_documento" (
    "id" UUID NOT NULL,
    "documento_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "hash" TEXT NOT NULL,
    "aceito_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aceite_documento_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "documento_publico_tipo_versao_key" ON "documento_publico"("tipo", "versao");
CREATE UNIQUE INDEX "aceite_documento_documento_id_usuario_id_key" ON "aceite_documento"("documento_id", "usuario_id");
-- No máximo uma versão publicada por tipo.
CREATE UNIQUE INDEX "documento_publico_um_publicado" ON "documento_publico"("tipo") WHERE "situacao" = 'PUBLICADO';

ALTER TABLE "documento_publico" ADD CONSTRAINT "documento_publico_criado_por_id_fkey" FOREIGN KEY ("criado_por_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documento_publico" ADD CONSTRAINT "documento_publico_aprovado_por_id_fkey" FOREIGN KEY ("aprovado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documento_publico" ADD CONSTRAINT "documento_publico_publicado_por_id_fkey" FOREIGN KEY ("publicado_por_id") REFERENCES "usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "aceite_documento" ADD CONSTRAINT "aceite_documento_documento_id_fkey" FOREIGN KEY ("documento_id") REFERENCES "documento_publico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "aceite_documento" ADD CONSTRAINT "aceite_documento_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Coerência: o hash é o SHA-256 do conteúdo (UTF-8); cada situação tem os
-- campos dela (aprovação com referência e responsável; publicação com autor).
ALTER TABLE "documento_publico" ADD CONSTRAINT "documento_publico_coerente"
  CHECK ("tipo" IN ('TERMOS_DE_USO', 'AVISO_DE_PRIVACIDADE')
         AND "versao" > 0
         AND "situacao" IN ('MINUTA', 'APROVADO', 'PUBLICADO', 'SUBSTITUIDO')
         AND length(btrim("titulo")) > 0
         AND length(btrim("conteudo")) > 0
         AND "hash" = encode(sha256(convert_to("conteudo", 'UTF8')), 'hex')
         AND (("situacao" = 'MINUTA') = ("aprovado_em" IS NULL))
         AND ("aprovado_em" IS NULL
              OR (length(btrim(coalesce("aprovacao_referencia", ''))) >= 5
                  AND length(btrim(coalesce("aprovacao_responsavel", ''))) >= 3))
         AND (("situacao" IN ('PUBLICADO', 'SUBSTITUIDO')) = ("publicado_em" IS NOT NULL))
         AND (("situacao" = 'SUBSTITUIDO') = ("substituido_em" IS NOT NULL)));

-- Texto, número e autoria nunca mudam (texto novo = versão nova). A situação
-- só avança MINUTA → APROVADO → PUBLICADO → SUBSTITUIDO, e o que já foi
-- registrado em cada passo não é reescrito. Só minuta pode ser apagada.
CREATE FUNCTION "proteger_documento_publico"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."situacao" = 'MINUTA' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'DOCUMENTO_IMUTAVEL: versão aprovada ou publicada não é apagada' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW."tipo", NEW."versao", NEW."titulo", NEW."conteudo", NEW."hash", NEW."criado_por_id", NEW."criado_em")
     IS DISTINCT FROM (OLD."tipo", OLD."versao", OLD."titulo", OLD."conteudo", OLD."hash", OLD."criado_por_id", OLD."criado_em") THEN
    RAISE EXCEPTION 'DOCUMENTO_IMUTAVEL: o texto de uma versão não muda; crie uma nova versão' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."situacao" <> OLD."situacao"
     AND (OLD."situacao", NEW."situacao") NOT IN (('MINUTA', 'APROVADO'), ('APROVADO', 'PUBLICADO'), ('PUBLICADO', 'SUBSTITUIDO')) THEN
    RAISE EXCEPTION 'DOCUMENTO_IMUTAVEL: situação % não passa para %', OLD."situacao", NEW."situacao" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."aprovado_em" IS NOT NULL
     AND (NEW."aprovacao_referencia", NEW."aprovacao_responsavel", NEW."aprovado_por_id", NEW."aprovado_em")
         IS DISTINCT FROM (OLD."aprovacao_referencia", OLD."aprovacao_responsavel", OLD."aprovado_por_id", OLD."aprovado_em") THEN
    RAISE EXCEPTION 'DOCUMENTO_IMUTAVEL: a aprovação registrada não é reescrita' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."publicado_em" IS NOT NULL
     AND (NEW."publicado_por_id", NEW."publicado_em") IS DISTINCT FROM (OLD."publicado_por_id", OLD."publicado_em") THEN
    RAISE EXCEPTION 'DOCUMENTO_IMUTAVEL: a publicação registrada não é reescrita' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."substituido_em" IS NOT NULL AND NEW."substituido_em" IS DISTINCT FROM OLD."substituido_em" THEN
    RAISE EXCEPTION 'DOCUMENTO_IMUTAVEL: a substituição registrada não é reescrita' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "documento_publico_protegido" BEFORE UPDATE OR DELETE ON "documento_publico"
FOR EACH ROW EXECUTE FUNCTION "proteger_documento_publico"();

-- Aceite: só da versão publicada dos termos de uso, com o hash dela; depois
-- de gravado não muda nem é apagado.
CREATE FUNCTION "conferir_aceite_documento"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'ACEITE_IMUTAVEL: aceite registrado não muda nem é apagado' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "documento_publico" d
    WHERE d."id" = NEW."documento_id" AND d."tipo" = 'TERMOS_DE_USO' AND d."situacao" = 'PUBLICADO' AND d."hash" = NEW."hash"
  ) THEN
    RAISE EXCEPTION 'ACEITE_INVALIDO: só a versão publicada dos termos de uso recebe aceite' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "aceite_documento_conferido" BEFORE INSERT OR UPDATE OR DELETE ON "aceite_documento"
FOR EACH ROW EXECUTE FUNCTION "conferir_aceite_documento"();

-- Auditoria de segurança e administração (logins, acessos negados, contas,
-- documentos): só acrescentada, como os históricos de conteúdo (lacuna da
-- auditoria de 27/10/2026). A aplicação nunca altera nem apaga estes eventos;
-- agora o banco também recusa. Limite: quem administra o PostgreSQL pode
-- desligar o gatilho — não é imutabilidade criptográfica.
CREATE TRIGGER "evento_auditoria_imutavel" BEFORE UPDATE OR DELETE ON "evento_auditoria"
FOR EACH ROW EXECUTE FUNCTION "registro_so_acrescentado"();
