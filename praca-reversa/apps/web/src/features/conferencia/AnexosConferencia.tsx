import { API_PREFIXO, AnexoConferenciaSchema, LIMITE_ANEXOS_CONFERENCIA, type AnexoConferencia } from '@praca-reversa/contracts';
import { useId, useState } from 'react';
import { useChaves } from '../../api/chaves';
import { FalhaRequisicao, baixarArquivo, enviarArquivo, mensagemDeFalha } from '../../api/cliente';
import { IconeArquivo } from '../../components/Icones';
import { formatarDataHora } from '../../utils/datas';

interface Props {
  conferenciaId: string;
  anexos: readonly AnexoConferencia[];
  /** Conferência em andamento e permissão de registrar. */
  podeEnviar: boolean;
  conectado: boolean;
  aoEnviado: () => void;
}

type Estado = { tipo: 'enviando'; nome: string } | { tipo: 'erro'; texto: string } | { tipo: 'ok'; texto: string } | null;

/**
 * Fotos e documentos da conferência (etapa 09). A foto vem da câmera do
 * aparelho (captura) ou do seletor de arquivos; o servidor confere tipo pelo
 * conteúdo e tamanho, guarda em privado e devolve o registro. Nada é guardado
 * no navegador: sem conexão ou com falha, o arquivo aparece como não enviado e
 * precisa ser escolhido de novo. Foto não comprova origem, liberação nem
 * regularização.
 */
export function AnexosConferencia({ conferenciaId, anexos, podeEnviar, conectado, aoEnviado }: Props) {
  const ids = useId();
  const chaves = useChaves();
  const [estado, setEstado] = useState<Estado>(null);
  const [erroDownload, setErroDownload] = useState<string | null>(null);
  const limite = anexos.length >= LIMITE_ANEXOS_CONFERENCIA;

  function enviar(arquivo: File | undefined) {
    // Seletor fechado sem arquivo (cancelamento): nada acontece.
    if (!arquivo) return;
    const assinatura = `anexo-conferencia:${conferenciaId}:${arquivo.name}:${String(arquivo.size)}:${String(arquivo.lastModified)}`;
    setEstado({ tipo: 'enviando', nome: arquivo.name });
    enviarArquivo(
      `${API_PREFIXO}/conferencias/${conferenciaId}/anexos`,
      arquivo,
      arquivo.name,
      AnexoConferenciaSchema,
      chaves.para(assinatura),
      'Anexo da conferência',
    ).then(
      (a) => {
        chaves.concluir(assinatura);
        setEstado({ tipo: 'ok', texto: `Anexo “${a.name}” registrado (privado).` });
        aoEnviado();
      },
      (erro: unknown) => {
        chaves.concluir(assinatura, erro);
        const falha = erro instanceof FalhaRequisicao ? erro : null;
        setEstado({
          tipo: 'erro',
          texto:
            falha?.tipo === 'bloqueio'
              ? `“${arquivo.name}” não foi enviado. ${falha.message}`
              : falha?.incerta
                ? `“${arquivo.name}” não aparece como enviado: ${falha.message} Para repetir, escolha o mesmo arquivo de novo.`
                : `“${arquivo.name}” não foi aceito: ${mensagemDeFalha(erro)}`,
        });
      },
    );
  }

  const desativado = !podeEnviar || !conectado || limite || estado?.tipo === 'enviando';

  return (
    <section className="cartao" aria-labelledby={`${ids}-titulo`} data-testid="anexos-conferencia">
      <h3 id={`${ids}-titulo`}>Fotos e documentos</h3>
      {anexos.length === 0 ? (
        <p className="estado-vazio-texto">Nenhum anexo nesta conferência.</p>
      ) : (
        <ul className="lista-anexos" data-testid="lista-anexos-conferencia">
          {anexos.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="botao-link"
                onClick={() => {
                  setErroDownload(null);
                  baixarArquivo(`${API_PREFIXO}/conferencias/${conferenciaId}/anexos/${a.id}`, a.name).catch((e: unknown) => {
                    setErroDownload(mensagemDeFalha(e));
                  });
                }}
              >
                <IconeArquivo />
                {a.name}
              </button>{' '}
              <span className="campo-ajuda">
                {a.contentType === 'application/pdf' ? 'PDF' : 'imagem'}, {Math.ceil(a.size / 1024)} KB · {a.uploadedBy.name} · {formatarDataHora(a.uploadedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {erroDownload !== null && (
        <p className="estado-erro" role="alert">
          {erroDownload}
        </p>
      )}

      {podeEnviar && (
        <div className="anexo-acoes">
          <label className={`botao-secundario botao-arquivo${desativado ? ' botao-arquivo--desativado' : ''}`}>
            Tirar foto
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={desativado}
              onChange={(e) => {
                const arquivo = e.target.files?.[0];
                e.target.value = '';
                enviar(arquivo);
              }}
              data-testid="tirar-foto-conferencia"
            />
          </label>
          <label className={`botao-secundario botao-arquivo${desativado ? ' botao-arquivo--desativado' : ''}`}>
            Escolher arquivo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              disabled={desativado}
              onChange={(e) => {
                const arquivo = e.target.files?.[0];
                e.target.value = '';
                enviar(arquivo);
              }}
              data-testid="enviar-anexo-conferencia"
            />
          </label>
        </div>
      )}
      <p className="campo-ajuda">
        Foto (JPEG, PNG, WebP) ou PDF, privado desta conferência, até o limite configurado; no máximo {LIMITE_ANEXOS_CONFERENCIA} por conferência. A foto registra a situação
        observada e não comprova sozinha origem, liberação ou regularização.
        {podeEnviar && !conectado ? ' Sem conexão: nenhum arquivo é enviado.' : ''}
        {limite ? ' Limite de anexos atingido.' : ''}
      </p>
      <p className={estado?.tipo === 'erro' ? 'estado-erro' : 'retorno-entrada'} role={estado?.tipo === 'erro' ? 'alert' : 'status'} data-testid="estado-anexo-conferencia">
        {estado === null ? '' : estado.tipo === 'enviando' ? `Enviando “${estado.nome}”… (só aparece como anexo depois da resposta do servidor)` : estado.texto}
      </p>
    </section>
  );
}
