import {
  API_PREFIXO,
  ResultadoPublicacaoPlanilhaSchema,
  SituacaoPlanilhaSchema,
  type EstadoProtecao,
  type RevisaoPlanilha,
  type SituacaoPlanilha,
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
  Atualizando: '↻',
  Aguardando: '…',
  Atrasada: '!',
  Falhou: '×',
  'Não configurado': '–',
};

const CLASSE: Readonly<Record<EstadoProtecao, string>> = {
  Atualizada: 'ok',
  Atualizando: 'pendente',
  Aguardando: 'pendente',
  Atrasada: 'atrasada',
  Falhou: 'falha',
  'Não configurado': 'inativo',
};

const MOTIVO: Readonly<Record<RevisaoPlanilha['reason'], string>> = {
  ALTERACAO: 'alteração confirmada',
  RECONCILIACAO: 'conferência periódica',
  MANUAL: 'pedido manual',
  PRE_SUBSTITUICAO: 'antes da substituição do inventário',
};

const ETAPA = { GERACAO: 'Geração', ENVIO: 'Envio ao destino', BACKUP: 'Backup' } as const;

function Estado({ estado }: { estado: EstadoProtecao }) {
  return (
    <span className={`selo selo-protecao selo-protecao--${CLASSE[estado]}`}>
      <span className="selo-marcador" aria-hidden="true">
        {MARCADOR[estado]}
      </span>
      {estado}
    </span>
  );
}

type Mensagem = { tipo: 'ok' | 'erro' | 'conflito' | 'aviso'; texto: string } | null;

const quando = (iso: string | null) => (iso === null ? '—' : formatarDataHora(iso));
const espera = (s: number | null) => (s === null ? '' : s < 120 ? ` há ${String(s)} s` : ` há ${String(Math.round(s / 60))} min`);

function Resumo({ s }: { s: SituacaoPlanilha }) {
  const d = s.destination;
  return (
    <dl className="situacao" data-testid="planilha-resumo">
      <div>
        <dt>Destino independente</dt>
        <dd data-testid="planilha-destino">
          {s.demo
            ? 'Não se aplica (dados fictícios de demonstração)'
            : !d.configured
              ? 'Não configurado — a planilha fica só no servidor do aplicativo'
              : d.independent
                ? (d.description ?? 'Configurado')
                : `${d.description ?? 'Pasta'} — não conta como independente: ${d.reason ?? ''}`}
        </dd>
      </div>
      <div>
        <dt>Última alteração confirmada</dt>
        <dd data-testid="planilha-ultima-alteracao">
          {s.lastChange.at === null ? 'Nenhuma registrada' : `${quando(s.lastChange.at)} · revisão ${String(s.lastChange.revision ?? '—')}${s.lastChange.pending ? ' (aguardando geração)' : ''}`}
        </dd>
      </div>
      <div>
        <dt>Última revisão gerada (servidor)</dt>
        <dd data-testid="planilha-gerada">{s.latest === null ? 'Nenhuma ainda' : `Revisão ${String(s.latest.revision)} · dados de ${quando(s.latest.dataAt)}`}</dd>
      </div>
      <div>
        <dt>Última revisão publicada no destino</dt>
        <dd data-testid="planilha-publicada">{s.revisions.published === null ? 'Nenhuma' : `Revisão ${String(s.revisions.published)} · ${quando(s.revisions.publishedAt)}`}</dd>
      </div>
      <div>
        <dt>Alterações aguardando</dt>
        <dd data-testid="planilha-pendentes">
          {s.pending.count === 0 ? 'Nenhuma' : `${String(s.pending.count)} marcação(ões)${espera(s.pending.delaySeconds)}`}
          {s.working ? ' · trabalho em andamento' : ''}
        </dd>
      </div>
      <div>
        <dt>Atualização automática</dt>
        <dd>{s.automatic ? `Ligada: depois de cada alteração confirmada, alvo de até ${String(s.targetSeconds)} s (não é garantia); "Atrasada" depois de ${String(s.delayLimitSeconds)} s.` : 'Desligada neste servidor'}</dd>
      </div>
    </dl>
  );
}

function rotuloRevisao(v: RevisaoPlanilha): string {
  return `Revisão ${String(v.revision)} · dados de ${quando(v.dataAt)} · ${v.publishedAt ? `publicada no destino em ${quando(v.publishedAt)}` : 'só no servidor (não publicada no destino)'}`;
}

/**
 * Planilha e proteção dos dados: situação real de cada parte (destino
 * independente, geração local, publicação, versão anterior, backup externo e
 * teste de restauração), "Tentar novamente agora" (reprocessa o que está
 * pendente), download da última revisão e das anteriores preservadas e
 * "Atualizar" (relê a situação). Nada aparece como atualizado sem evidência.
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
      const rev = r.revision === null ? '' : ` ${String(r.revision)}`;
      setMensagem(
        r.result === 'PUBLICADA'
          ? { tipo: 'ok', texto: `Revisão${rev} publicada no destino independente (relida e conferida).` }
          : r.result === 'GERADA'
            ? { tipo: 'aviso', texto: `Revisão${rev} gerada e validada no servidor. Sem destino independente configurado, ela não foi publicada fora do servidor.` }
            : r.result === 'EM_DIA'
              ? { tipo: 'ok', texto: `Nada pendente: a revisão${rev} já está gerada${r.situation.destination.independent ? ' e publicada' : ''}.` }
              : r.result === 'OCUPADO'
                ? { tipo: 'aviso', texto: 'Outro trabalho da planilha deste escopo está em andamento. Aguarde e atualize.' }
                : { tipo: 'erro', texto: `Falhou: ${r.error ?? ''} A última cópia boa continua valendo; nova tentativa automática com espera.` },
      );
    } catch (erro) {
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
    } finally {
      setOcupado(false);
      setVersao((v) => v + 1);
    }
  }

  function baixar(url: string, nome: string) {
    baixarArquivo(url, nome).catch((erro: unknown) => {
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
    });
  }

  return (
    <Pagina
      titulo="Planilha e proteção"
      testId="tela-planilha"
      aoVoltar={aoVoltar}
      descricao="Cópia do inventário em Excel atualizada automaticamente depois de cada alteração confirmada (abas Inventário, Movimentações e Proteção e ajuda). O aplicativo continua sendo a fonte oficial: alterações são feitas aqui, não na planilha."
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
                  {ocupado ? 'Reprocessando…' : 'Tentar novamente agora'}
                </button>
              )}
              {s.canDownload && s.latest && (
                <button type="button" className="botao-secundario" disabled={!conectado} onClick={() => baixar(`${API_PREFIXO}/planilha/arquivo`, s.fileName)} data-testid="planilha-baixar">
                  Baixar a última planilha gerada
                </button>
              )}
              <button type="button" className="botao-link" onClick={() => setVersao((v) => v + 1)} data-testid="planilha-atualizar">
                <IconeAtualizar />
                Atualizar
              </button>
            </div>
            {s.canDownload && s.latest && <p className="campo-ajuda" data-testid="planilha-baixar-detalhe">{rotuloRevisao(s.latest)}.</p>}
            <MensagemAcao mensagem={mensagem} testId="planilha-mensagem" />
            <p className="campo-ajuda">Consultado em {formatarDataHora(s.consultedAt)} (horário de Brasília). A planilha pode ficar desatualizada durante uma falha; esta tela mostra a situação atual.</p>
          </section>
          {s.failures.length > 0 && (
            <section className="detalhe-secao" aria-labelledby="planilha-falhas">
              <h3 id="planilha-falhas">Falhas recentes</h3>
              <ul className="lista-protecao" data-testid="planilha-falhas">
                {s.failures.map((f) => (
                  <li key={`${f.stage}-${f.at}`}>
                    <div className="lista-protecao-topo">
                      <strong>{ETAPA[f.stage]}</strong>
                      <span>{formatarDataHora(f.at)}</span>
                    </div>
                    <p className="campo-ajuda">{f.message}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="detalhe-secao" aria-labelledby="planilha-versoes">
            <h3 id="planilha-versoes">Revisões recentes</h3>
            {s.versions.length === 0 ? (
              <p className="sem-itens">Nenhuma revisão gerada ainda.</p>
            ) : (
              <ul className="lista-protecao" data-testid="planilha-versoes">
                {s.versions.map((v) => (
                  <li key={v.revision}>
                    <div className="lista-protecao-topo">
                      <strong>
                        Revisão {v.revision}
                        {v.preReplacement ? ' · antes da substituição' : ''}
                      </strong>
                      <span>{v.publishedAt ? 'Publicada no destino' : 'Só no servidor'}</span>
                    </div>
                    <p className="campo-ajuda">
                      {MOTIVO[v.reason]} · dados de {quando(v.dataAt)}
                      {v.activeBatch ? ` · lote ${v.activeBatch}` : ''} · {String(v.records.ESTOQUE ?? 0)} registro(s) no estoque, {String(v.records.VALIDACAO ?? 0)} em validação, {String(v.records.PENDENTE ?? 0)} pendente(s)
                      {` · ${(v.sizeBytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB`}
                      {v.files > 1 ? ` · ${String(v.files)} arquivos` : ''}
                    </p>
                    {s.canDownload && v.downloadable && (
                      <button type="button" className="botao-link" disabled={!conectado} onClick={() => baixar(`${API_PREFIXO}/planilha/revisoes/${String(v.revision)}/arquivo`, s.fileName)}>
                        Baixar a revisão {v.revision}
                      </button>
                    )}
                    {!v.downloadable && <p className="campo-ajuda">Removida da pasta do servidor pela retenção{v.publishedAt ? '; consulte as versões no destino independente.' : '.'}</p>}
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
