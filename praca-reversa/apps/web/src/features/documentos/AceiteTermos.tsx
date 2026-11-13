import { AceiteDocumentoSchema, API_PREFIXO, DocumentoPublicadoSchema, type SituacaoDocumentos } from '@praca-reversa/contracts';
import { useState } from 'react';
import { enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { paraEndereco } from '../../base';
import { formatarDataHora } from '../../utils/datas';
import { TextoDocumento } from './TextoDocumento';
import './documentos.css';
import { Carregando } from '../../components/carregamento/Carregando';

/**
 * Aceite dos termos de uso publicados — só aparece quando a instalação exige
 * (DOCUMENTOS_EXIGIR_ACEITE) e há versão publicada ainda não aceita. Caixa
 * sem marcação prévia, sem rolagem obrigatória; usuário, versão e horário
 * são do servidor. O aviso de privacidade fica em link: ler não é consentir.
 */
export function AceiteTermos({ situacao, aoAceitar, aoSair }: { situacao: SituacaoDocumentos; aoAceitar: () => void; aoSair: () => void }) {
  const termos = situacao.terms;
  const { carga } = useRecurso(`${API_PREFIXO}/documentos-publicos/termos`, DocumentoPublicadoSchema);
  const [li, setLi] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  if (termos === null) return null;
  const d = carga?.estado === 'pronto' && carga.dados.hash === termos.hash ? carga.dados : null;

  async function aceitar() {
    if (termos === null) return;
    setEnviando(true);
    setErro(null);
    try {
      await enviarJson('POST', `${API_PREFIXO}/documentos/${termos.id}/aceite`, AceiteDocumentoSchema, { corpo: {} });
      aoAceitar();
    } catch (e) {
      setErro(mensagemDeFalha(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main className="principal documento-publico" data-testid="tela-aceite-termos">
      <article className="documento-cartao" aria-labelledby="aceite-titulo">
        <h2 id="aceite-titulo">{termos.title}</h2>
        <p className="documento-versao">
          Versão {termos.version} · publicada em {formatarDataHora(termos.publishedAt)}. Para continuar a usar o Praça Reversa, leia e aceite esta versão.
        </p>
        {d === null ? <Carregando mensagem="Carregando o texto…" /> : <TextoDocumento conteudo={d.content} />}
        <p>
          O <a href={paraEndereco('/privacidade')}>aviso de privacidade</a> explica como os dados são tratados; ele é informativo e não pede consentimento.
        </p>
        <label className="documento-confirmacao">
          <input type="checkbox" checked={li} onChange={(e) => setLi(e.target.checked)} data-testid="aceite-li" />
          <span>Li os termos de uso, versão {termos.version}.</span>
        </label>
        {erro !== null && (
          <p className="estado-erro" role="alert">
            {erro}
          </p>
        )}
        <div className="documento-acoes">
          <button type="button" className="botao-primario" disabled={!li || enviando || d === null} aria-busy={enviando} onClick={() => void aceitar()} data-testid="aceite-confirmar">
            Aceitar a versão {termos.version} e continuar
          </button>
          <button type="button" className="botao-secundario" onClick={aoSair}>
            Sair
          </button>
        </div>
      </article>
    </main>
  );
}
