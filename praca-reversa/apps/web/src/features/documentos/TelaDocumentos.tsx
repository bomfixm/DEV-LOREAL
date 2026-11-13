import {
  API_PREFIXO,
  ListaDocumentosSchema,
  NOME_DOCUMENTO,
  type ListaDocumentos,
  SLUG_DOCUMENTO,
  TipoDocumentoSchema,
  type SituacaoDocumento,
  type TipoDocumento,
  type VersaoDocumento,
} from '@praca-reversa/contracts';
import { useState, type SubmitEvent } from 'react';
import { z } from 'zod';
import { enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { MensagemAcao, Pagina } from '../../components/Moldura';
import { paraEndereco } from '../../base';
import { formatarDataHora } from '../../utils/datas';
import { TextoDocumento } from './TextoDocumento';
import './documentos.css';
import { Carregando } from '../../components/carregamento/Carregando';

type Mensagem = { tipo: 'ok' | 'erro' | 'aviso'; texto: string } | null;

const ROTULO_SITUACAO: Record<SituacaoDocumento, string> = {
  MINUTA: 'Minuta (não publicada)',
  APROVADO: 'Aprovação registrada — aguardando publicação',
  PUBLICADO: 'Publicada',
  SUBSTITUIDO: 'Substituída por versão mais nova',
};

/**
 * Termos e privacidade (27 out. 2026): minutas, referência da aprovação
 * humana e publicação. Registrar a referência não aprova nada: documenta quem
 * aprovou fora do sistema e onde conferir. Só a versão publicada aparece em
 * /termos e /privacidade; as demais ficam só aqui.
 */
export function TelaDocumentos({ aoVoltar }: { aoVoltar: () => void }) {
  const [versao, setVersao] = useState(0);
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/admin/documentos`, ListaDocumentosSchema, versao);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [ocupado, setOcupado] = useState(false);
  // Ao recarregar depois de uma ação, a lista anterior fica na tela (o que foi digitado não se perde).
  const [ultima, setUltima] = useState<ListaDocumentos | null>(null);
  if (carga?.estado === 'pronto' && carga.dados !== ultima) setUltima(carga.dados);
  const lista = carga?.estado === 'pronto' ? carga.dados : ultima;

  async function executar(acao: () => Promise<unknown>, ok: string): Promise<boolean> {
    setOcupado(true);
    setMensagem(null);
    try {
      await acao();
      setMensagem({ tipo: 'ok', texto: ok });
      return true;
    } catch (erro) {
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
      return false;
    } finally {
      setOcupado(false);
      setVersao((v) => v + 1);
    }
  }

  return (
    <Pagina
      titulo="Termos e privacidade"
      testId="tela-documentos"
      aoVoltar={aoVoltar}
      descricao="Versões dos termos de uso e do aviso de privacidade. Só a versão publicada aparece para os usuários; minutas ficam nesta tela. Publicar depende da aprovação feita fora do sistema (jurídico/privacidade da empresa), registrada aqui com a referência para conferência."
    >
      <MensagemAcao mensagem={mensagem} testId="documentos-mensagem" />
      {carga?.estado === 'carregando' && lista === null && <Carregando mensagem="Carregando…" />}
      {carga?.estado === 'erro' && (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar as versões. {carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            Tentar novamente
          </button>
        </div>
      )}
      {lista && (
        <>
          <p className="documento-config" data-testid="documentos-exigencia">
            Aceite dos termos antes do uso: <strong>{lista.acceptanceRequired ? 'exigido nesta instalação' : 'desligado nesta instalação'}</strong> (configuração
            DOCUMENTOS_EXIGIR_ACEITE do servidor; só vale quando houver termos publicados).
          </p>
          {TipoDocumentoSchema.options.map((tipo) => (
            <SecaoTipo
              key={tipo}
              tipo={tipo}
              versoes={lista.items.filter((v) => v.type === tipo)}
              ocupado={ocupado}
              aoAprovar={(id, referencia, responsavel) =>
                executar(
                  () => enviarJson('POST', `${API_PREFIXO}/admin/documentos/${id}/aprovacao`, ListaDocumentosSchema, { corpo: { reference: referencia, responsible: responsavel } }),
                  'Referência da aprovação registrada. A versão ainda não está publicada.',
                )
              }
              aoPublicar={(v) =>
                executar(
                  () => enviarJson('POST', `${API_PREFIXO}/admin/documentos/${v.id}/publicacao`, ListaDocumentosSchema, { corpo: {} }),
                  `${NOME_DOCUMENTO[v.type]}: versão ${String(v.version)} publicada.`,
                )
              }
            />
          ))}
          <NovaMinuta
            ocupado={ocupado}
            aoCriar={(tipo, titulo, conteudo) =>
              executar(
                () => enviarJson('POST', `${API_PREFIXO}/admin/documentos`, z.object({ id: z.string() }), { corpo: { type: tipo, title: titulo, content: conteudo } }),
                'Minuta criada. Ela não aparece para os usuários até ser aprovada e publicada.',
              )
            }
          />
        </>
      )}
    </Pagina>
  );
}

function SecaoTipo({
  tipo,
  versoes,
  ocupado,
  aoAprovar,
  aoPublicar,
}: {
  tipo: TipoDocumento;
  versoes: VersaoDocumento[];
  ocupado: boolean;
  aoAprovar: (id: string, referencia: string, responsavel: string) => Promise<boolean>;
  aoPublicar: (v: VersaoDocumento) => Promise<boolean>;
}) {
  const publicada = versoes.find((v) => v.status === 'PUBLICADO') ?? null;
  return (
    <section className="detalhe-secao" aria-labelledby={`doc-${tipo}`} data-testid={`documentos-${SLUG_DOCUMENTO[tipo]}`}>
      <h3 id={`doc-${tipo}`}>{NOME_DOCUMENTO[tipo]}</h3>
      <p>
        {publicada === null ? (
          <span data-testid="documento-sem-publicada">Nenhuma versão publicada. A página pública informa que o documento ainda não foi publicado.</span>
        ) : (
          <>
            Publicada: versão {publicada.version}, desde {formatarDataHora(publicada.publishedAt ?? publicada.createdAt)}.{' '}
            <a href={paraEndereco(`/${SLUG_DOCUMENTO[tipo]}`)}>Ver a página pública</a>
          </>
        )}
      </p>
      {versoes.length === 0 ? (
        <p className="documento-vazio">Nenhuma versão cadastrada.</p>
      ) : (
        <ol className="documento-versoes">
          {versoes.map((v) => (
            <Versao key={v.id} v={v} ocupado={ocupado} aoAprovar={aoAprovar} aoPublicar={aoPublicar} />
          ))}
        </ol>
      )}
    </section>
  );
}

function Versao({
  v,
  ocupado,
  aoAprovar,
  aoPublicar,
}: {
  v: VersaoDocumento;
  ocupado: boolean;
  aoAprovar: (id: string, referencia: string, responsavel: string) => Promise<boolean>;
  aoPublicar: (v: VersaoDocumento) => Promise<boolean>;
}) {
  const [referencia, setReferencia] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [confirmarPublicacao, setConfirmarPublicacao] = useState(false);
  return (
    <li className="documento-versao-item" data-testid="documento-versao-item" data-versao={v.version} data-situacao={v.status}>
      <p>
        <strong>Versão {v.version}</strong> — {v.title} · <span className={`documento-situacao documento-situacao--${v.status.toLowerCase()}`}>{ROTULO_SITUACAO[v.status]}</span>
      </p>
      <p className="documento-meta">
        Criada por {v.createdBy} em {formatarDataHora(v.createdAt)} · código de conferência {v.hash.slice(0, 12)}
        {v.type === 'TERMOS_DE_USO' && v.status !== 'MINUTA' && ` · aceites registrados: ${String(v.acceptances)}`}
      </p>
      {v.approval && (
        <p className="documento-meta" data-testid="documento-aprovacao">
          Aprovação: {v.approval.reference} — {v.approval.responsible} (registrada por {v.approval.registeredBy} em {formatarDataHora(v.approval.registeredAt)})
        </p>
      )}
      {v.publishedAt && (
        <p className="documento-meta">
          Publicada por {v.publishedBy ?? '—'} em {formatarDataHora(v.publishedAt)}
          {v.replacedAt && ` · substituída em ${formatarDataHora(v.replacedAt)}`}
        </p>
      )}
      <details className="documento-previa">
        <summary>{v.status === 'MINUTA' ? 'Prévia interna da minuta' : 'Ver o texto desta versão'}</summary>
        <TextoDocumento conteudo={v.content} />
      </details>
      {v.status === 'MINUTA' && (
        <form
          className="documento-form"
          onSubmit={(e: SubmitEvent<HTMLFormElement>) => {
            e.preventDefault();
            void aoAprovar(v.id, referencia, responsavel);
          }}
        >
          <p className="documento-nota">
            Registre somente uma aprovação que já existe fora do sistema (parecer, ata, e-mail corporativo, protocolo). O registro não substitui a revisão jurídica nem a assinatura da empresa.
          </p>
          <label className="campo">
            <span className="campo-rotulo">Referência da aprovação</span>
            <input value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={300} data-testid="documento-referencia" />
          </label>
          <label className="campo">
            <span className="campo-rotulo">Quem aprovou (nome e função)</span>
            <input value={responsavel} onChange={(e) => setResponsavel(e.target.value)} maxLength={160} data-testid="documento-responsavel" />
          </label>
          <button type="submit" className="botao-secundario" disabled={ocupado} data-testid="documento-registrar-aprovacao">
            Registrar referência da aprovação
          </button>
        </form>
      )}
      {v.status === 'APROVADO' &&
        (confirmarPublicacao ? (
          <div className="documento-form" role="group" aria-label={`Publicar a versão ${String(v.version)}`}>
            <p>
              Publicar a versão {v.version}? Ela passa a aparecer para todos{v.type === 'TERMOS_DE_USO' ? ' e, se a exigência de aceite estiver ligada, cada usuário precisará aceitá-la' : ''}. A versão publicada
              hoje, se houver, fica como substituída (o texto dela continua guardado).
            </p>
            <button type="button" className="botao-primario" disabled={ocupado} data-testid="documento-confirmar-publicacao" onClick={() => void aoPublicar(v).then(() => setConfirmarPublicacao(false))}>
              Publicar a versão {v.version}
            </button>{' '}
            <button type="button" className="botao-secundario" onClick={() => setConfirmarPublicacao(false)}>
              Cancelar
            </button>
          </div>
        ) : (
          <button type="button" className="botao-secundario" disabled={ocupado} data-testid="documento-publicar" onClick={() => setConfirmarPublicacao(true)}>
            Publicar…
          </button>
        ))}
    </li>
  );
}

function NovaMinuta({ ocupado, aoCriar }: { ocupado: boolean; aoCriar: (tipo: TipoDocumento, titulo: string, conteudo: string) => Promise<boolean> }) {
  const [tipo, setTipo] = useState<TipoDocumento>('TERMOS_DE_USO');
  const [titulo, setTitulo] = useState('');
  const [conteudo, setConteudo] = useState('');
  return (
    <section className="detalhe-secao" aria-labelledby="doc-nova">
      <h3 id="doc-nova">Nova minuta</h3>
      <p className="documento-nota">
        Texto novo sempre gera versão nova; versões anteriores não são alteradas. Linha em branco separa parágrafos; &quot;# &quot; no início da linha marca um subtítulo.
      </p>
      <form
        className="documento-form"
        onSubmit={(e: SubmitEvent<HTMLFormElement>) => {
          e.preventDefault();
          void aoCriar(tipo, titulo, conteudo).then((ok) => {
            if (ok) {
              setTitulo('');
              setConteudo('');
            }
          });
        }}
      >
        <label className="campo">
          <span className="campo-rotulo">Documento</span>
          <select value={tipo} onChange={(e) => setTipo(TipoDocumentoSchema.parse(e.target.value))} data-testid="documento-tipo">
            {TipoDocumentoSchema.options.map((t) => (
              <option key={t} value={t}>
                {NOME_DOCUMENTO[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Título</span>
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={160} data-testid="documento-titulo-novo" />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Texto</span>
          <textarea value={conteudo} onChange={(e) => setConteudo(e.target.value)} rows={10} data-testid="documento-conteudo-novo" />
        </label>
        <button type="submit" className="botao-secundario" disabled={ocupado} data-testid="documento-criar-minuta">
          Criar minuta
        </button>
      </form>
    </section>
  );
}
