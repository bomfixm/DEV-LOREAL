import {
  API_PREFIXO,
  ResultadoPublicacaoPlanilhaSchema,
  SituacaoPlanilhaSchema,
  type EstadoProtecao,
  type SituacaoPlanilha,
  type VersaoPlanilha,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { baixarArquivo, enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar } from '../../components/Icones';
import { MensagemAcao, Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import { formatarDataHora } from '../../utils/datas';

const MARCADOR: Readonly<Record<EstadoProtecao, string>> = {
  Atualizada: '✓',
  'Atualização pendente': '…',
  Falhou: '!',
  'Não configurado': '–',
  'Não testado': '?',
};

const SITUACAO_VERSAO: Readonly<Record<VersaoPlanilha['state'], string>> = {
  GERANDO: 'Gerando',
  PUBLICADA: 'Publicada no destino',
  GERADA_LOCAL: 'Gerada só no servidor',
  FALHOU: 'Falhou (nada substituído)',
};

const MOTIVO: Readonly<Record<VersaoPlanilha['reason'], string>> = { ALTERACAO: 'alteração', RECONCILIACAO: 'reconciliação periódica', MANUAL: 'pedido manual' };

function Estado({ estado }: { estado: EstadoProtecao }) {
  const classe = estado === 'Atualizada' ? 'ok' : estado === 'Falhou' ? 'falha' : estado === 'Atualização pendente' ? 'pendente' : 'inativo';
  return (
    <span className={`selo selo-protecao selo-protecao--${classe}`}>
      <span className="selo-marcador" aria-hidden="true">
        {MARCADOR[estado]}
      </span>
      {estado}
    </span>
  );
}

type Mensagem = { tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null;

function Resumo({ s }: { s: SituacaoPlanilha }) {
  return (
    <dl className="situacao" data-testid="planilha-resumo">
      <div>
        <dt>Arquivo</dt>
        <dd>{s.fileName}</dd>
      </div>
      <div>
        <dt>Destino independente</dt>
        <dd>{s.destinationConfigured ? (s.destinationDescription ?? 'Configurado') : s.demo ? 'Não se aplica (dados fictícios de demonstração)' : 'Não configurado'}</dd>
      </div>
      <div>
        <dt>Atualização automática</dt>
        <dd>{s.automatic ? 'Ligada (depois das alterações confirmadas e a cada reconciliação)' : 'Desligada neste servidor'}</dd>
      </div>
      <div>
        <dt>Alterações aguardando</dt>
        <dd data-testid="planilha-pendentes">
          {s.pending.count === 0 ? 'Nenhuma' : `${String(s.pending.count)} marcação(ões)${s.pending.delaySeconds === null ? '' : ` · atraso de ${String(s.pending.delaySeconds)} s`}`}
          {s.publishing ? ' · publicação em andamento' : ''}
        </dd>
      </div>
    </dl>
  );
}

/**
 * Planilha única e proteção dos dados: situação da cópia em Excel (destino
 * independente, alterações aguardando, versões, falhas), do backup completo e
 * do teste de restauração; "Tentar novamente" (supervisor/administrador) e
 * download do último arquivo gerado. Sucesso só depois das verificações.
 */
export function TelaPlanilha({ aoVoltar }: { aoVoltar: () => void }) {
  const [versao, setVersao] = useState(0);
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/planilha/situacao`, SituacaoPlanilhaSchema, versao);
  const conectado = useConectado();
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const s = carga?.estado === 'pronto' ? carga.dados : null;

  async function publicar() {
    setOcupado(true);
    setMensagem(null);
    try {
      const r = await enviarJson('POST', `${API_PREFIXO}/planilha/publicar`, ResultadoPublicacaoPlanilhaSchema, { corpo: {} });
      setMensagem(
        r.result === 'PUBLICADA'
          ? { tipo: 'ok', texto: `Versão ${String(r.version ?? '')} publicada no destino independente e validada.` }
          : r.result === 'GERADA_LOCAL'
            ? { tipo: 'conflito', texto: `Versão ${String(r.version ?? '')} gerada só no servidor: o destino independente não está configurado.` }
            : r.result === 'OCUPADO'
              ? { tipo: 'conflito', texto: 'Já há uma publicação em andamento para este escopo. Aguarde e atualize.' }
              : { tipo: 'erro', texto: `A publicação falhou: ${r.error ?? ''} A última versão boa continua valendo; nova tentativa agendada.` },
      );
    } catch (erro) {
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
    } finally {
      setOcupado(false);
      setVersao((v) => v + 1);
    }
  }

  return (
    <Pagina
      titulo="Planilha e proteção"
      testId="tela-planilha"
      aoVoltar={aoVoltar}
      descricao="Cópia do inventário em Excel para consulta (abas Inventário, Movimentações e Proteção e ajuda). O aplicativo continua sendo a fonte oficial: alterações são feitas aqui, não na planilha."
    >
      {carga?.estado === 'carregando' && <p className="estado-carregando">Carregando a situação…</p>}
      {carga?.estado === 'erro' && (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar a situação. {carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {s && (
        <>
          <section className="detalhe-secao" aria-labelledby="planilha-situacao">
            <h3 id="planilha-situacao">Situação</h3>
            <Resumo s={s} />
            <ul className="lista-protecao" data-testid="planilha-itens">
              {s.items.map((i) => (
                <li key={i.resource} data-testid="planilha-item">
                  <div className="lista-protecao-topo">
                    <strong>{i.resource}</strong>
                    <Estado estado={i.state} />
                  </div>
                  <p className="campo-ajuda">
                    {i.lastSuccess ? `Último sucesso: ${formatarDataHora(i.lastSuccess)}. ` : 'Sem sucesso registrado. '}
                    {i.detail}
                  </p>
                </li>
              ))}
            </ul>
            <div className="acoes-linha">
              {s.canPublish && (
                <button type="button" className="botao-primario" disabled={ocupado || !conectado} onClick={() => void publicar()} data-testid="planilha-publicar">
                  {ocupado ? 'Gerando e validando…' : 'Tentar novamente agora'}
                </button>
              )}
              {s.canDownload && (
                <button
                  type="button"
                  className="botao-secundario"
                  disabled={!conectado}
                  onClick={() => {
                    baixarArquivo(`${API_PREFIXO}/planilha/arquivo`, s.fileName).catch((erro: unknown) => {
                      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
                    });
                  }}
                  data-testid="planilha-baixar"
                >
                  Baixar a última planilha gerada
                </button>
              )}
              <button type="button" className="botao-link" onClick={recarregar}>
                <IconeAtualizar />
                Atualizar
              </button>
            </div>
            <MensagemAcao mensagem={mensagem} testId="planilha-mensagem" />
            <p className="campo-ajuda">Consultado em {formatarDataHora(s.consultedAt)} (horário de Brasília). A planilha pode ficar desatualizada durante uma falha; esta tela mostra a situação atual.</p>
          </section>
          <section className="detalhe-secao" aria-labelledby="planilha-versoes">
            <h3 id="planilha-versoes">Versões recentes</h3>
            {s.recent.length === 0 ? (
              <p className="sem-itens">Nenhuma versão gerada ainda.</p>
            ) : (
              <ul className="lista-protecao" data-testid="planilha-versoes">
                {s.recent.map((v) => (
                  <li key={v.version}>
                    <div className="lista-protecao-topo">
                      <strong>Versão {v.version}</strong>
                      <span>{SITUACAO_VERSAO[v.state]}</span>
                    </div>
                    <p className="campo-ajuda">
                      {MOTIVO[v.reason]} · início {formatarDataHora(v.startedAt)}
                      {v.snapshotAt ? ` · dados de ${formatarDataHora(v.snapshotAt)}` : ''}
                      {v.sizeBytes !== null ? ` · ${(v.sizeBytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB` : ''}
                      {v.records ? ` · ${String(v.records.linhasInventario ?? 0)} linhas no inventário, ${String(v.records.eventos ?? 0)} eventos` : ''}
                      {v.error ? ` · ${v.error}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Pagina>
  );
}
