import { API_PREFIXO, DocumentoPublicadoSchema, NOME_DOCUMENTO, type TipoDocumento } from '@praca-reversa/contracts';
import { useRecurso } from '../../api/use-recurso';
import { formatarDataHora } from '../../utils/datas';
import { TextoDocumento } from './TextoDocumento';
import './documentos.css';

const TIPO: Record<'termos' | 'privacidade', TipoDocumento> = { termos: 'TERMOS_DE_USO', privacidade: 'AVISO_DE_PRIVACIDADE' };

/**
 * Termos de uso ou aviso de privacidade publicados — abre com ou sem entrar.
 * Sem versão aprovada publicada, diz isso (sem texto provisório no lugar).
 */
export function TelaDocumentoPublico({ documento, aoVoltar, rotuloVoltar }: { documento: 'termos' | 'privacidade'; aoVoltar: () => void; rotuloVoltar: string }) {
  const { carga } = useRecurso(`${API_PREFIXO}/documentos-publicos/${documento}`, DocumentoPublicadoSchema);
  const nome = NOME_DOCUMENTO[TIPO[documento]];
  const d = carga?.estado === 'pronto' ? carga.dados : null;
  const naoPublicado = carga?.estado === 'erro' && (carga.codigo === 'NAO_PUBLICADO' || carga.codigo === 'NAO_INSTALADO');

  return (
    <main className="principal documento-publico" data-testid="tela-documento" data-documento={documento}>
      <article className="documento-cartao" aria-labelledby="documento-titulo">
        <button type="button" className="botao-link documento-voltar" onClick={aoVoltar}>
          {rotuloVoltar}
        </button>
        <h2 id="documento-titulo">{d?.title ?? nome}</h2>
        {(carga === null || carga.estado === 'carregando') && <p className="estado-carregando">Carregando…</p>}
        {naoPublicado && (
          <p className="documento-pendente" role="status" data-testid="documento-nao-publicado">
            Ainda não há versão aprovada publicada deste documento. Em caso de dúvida, fale com o responsável pela operação.
          </p>
        )}
        {carga?.estado === 'erro' && !naoPublicado && (
          <p className="estado-erro" role="alert">
            Não foi possível carregar o documento. {carga.mensagem}
          </p>
        )}
        {d && (
          <>
            <p className="documento-versao" data-testid="documento-versao">
              Versão {d.version} · publicada em {formatarDataHora(d.publishedAt)} · código de conferência {d.hash.slice(0, 12)}
            </p>
            <TextoDocumento conteudo={d.content} />
          </>
        )}
      </article>
    </main>
  );
}
