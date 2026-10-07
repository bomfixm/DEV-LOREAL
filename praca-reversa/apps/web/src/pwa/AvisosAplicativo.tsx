import { useEffect, useState } from 'react';
import { useConexao } from '../api/conexao';
import { aindaPodeProcessar, descartarIncerta, pendente, useIncertas, type OperacaoIncerta } from '../api/incertas';
import { reenviarIncerta, verificarIncerta, verificarPendentes } from '../api/recuperacao';
import { useVersao } from '../api/versao';
import { formatarHora } from '../utils/datas';
import { atualizarAgora, avisosAoAtualizar, useAtualizacao } from './atualizacao';

/**
 * Avisos da aplicação (etapa 09): versão incompatível, nova versão, versão
 * ativada em outra aba e operações em confirmação. Ficam acima do conteúdo
 * em todas as telas.
 */
export function AvisosAplicativo({ autenticado }: { autenticado: boolean }) {
  const versao = useVersao();
  const atualizacao = useAtualizacao();
  const [motivos, setMotivos] = useState<string[] | null>(null);
  const [atualizando, setAtualizando] = useState(false);

  async function atualizar() {
    const avisos = avisosAoAtualizar();
    if (avisos.length > 0 && !window.confirm(`${avisos.join(' ')} A página será recarregada e reabrirá no mesmo endereço; o rascunho confirmado continua no servidor. Atualizar agora?`)) {
      return;
    }
    setAtualizando(true);
    const resultado = await atualizarAgora();
    if (!resultado.ok) {
      setMotivos(resultado.motivos);
      setAtualizando(false);
    }
  }

  const botao = (rotulo: string) => (
    <button type="button" className="botao-primario botao-compacto" disabled={atualizando} onClick={() => void atualizar()} data-testid="atualizar-aplicativo">
      {atualizando ? 'Atualizando…' : rotulo}
    </button>
  );

  return (
    <>
      {versao.incompativel && (
        <div className="aviso-versao aviso-versao--bloqueio" role="alert" data-testid="aviso-incompativel">
          <span>
            <strong>Versão incompatível com o servidor.</strong> Esta tela não grava nada até ser atualizada. O que ainda não foi enviado continua nesta tela.
          </span>
          {botao('Atualizar')}
        </div>
      )}
      {!versao.incompativel && atualizacao.novaVersao && (
        <div className="aviso-versao" role="status" data-testid="aviso-nova-versao">
          <span>
            <strong>Nova versão disponível.</strong> Ela só entra quando você escolher; contagens e confirmações em andamento não são interrompidas.
          </span>
          {botao('Atualizar')}
        </div>
      )}
      {atualizacao.ativadaEmOutraAba && !versao.incompativel && (
        <div className="aviso-versao" role="status" data-testid="aviso-outra-aba">
          <span>
            <strong>Outra aba ativou a nova versão.</strong> Esta aba continua na versão anterior até você atualizá-la; termine ou envie o que está em andamento primeiro.
          </span>
          {botao('Atualizar esta aba')}
        </div>
      )}
      {motivos !== null && (
        <div className="aviso-versao aviso-versao--bloqueio" role="alert" data-testid="impedimentos-atualizacao">
          <div>
            <strong>Atualização adiada.</strong> Resolva antes de recarregar:
            <ul>
              {motivos.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
          <button
            type="button"
            className="botao-secundario botao-compacto"
            onClick={() => {
              setMotivos(null);
            }}
          >
            Entendi
          </button>
        </div>
      )}
      {autenticado && <PainelIncertas />}
    </>
  );
}

const SITUACAO: Record<OperacaoIncerta['situacao'], string> = {
  incerta: 'em confirmação',
  verificando: 'verificando…',
  confirmada: 'confirmada pelo servidor',
  recusada: 'recusada pelo servidor',
  'nao-registrada': 'não registrada',
};

/** Operações com resposta perdida: verificação automática, reenvio e descarte só por ação da pessoa. */
function PainelIncertas() {
  const itens = useIncertas();
  const { rede } = useConexao();
  const pendentes = itens.filter(pendente).length;

  // Verificação somente leitura ao reconectar e, enquanto o servidor ainda pode estar processando, de tempos em tempos.
  useEffect(() => {
    if (rede !== 'conectado' || pendentes === 0) return;
    verificarPendentes();
    const intervalo = setInterval(verificarPendentes, 10_000);
    return () => {
      clearInterval(intervalo);
    };
  }, [rede, pendentes]);

  if (itens.length === 0) return null;
  return (
    <section className="painel-incertas" aria-label="Operações em confirmação" data-testid="painel-incertas">
      <h2>{pendentes > 0 ? `Em confirmação (${String(pendentes)})` : 'Resultado das operações em confirmação'}</h2>
      <p className="bloco-nota">
        Resposta perdida não é recusa: o servidor pode ter gravado. A verificação consulta o servidor pela chave do pedido; repetir usa a mesma chave e o mesmo conteúdo,
        sem duplicar. Nada é reenviado sozinho.
      </p>
      <ul>
        {itens.map((i) => (
          <li key={i.id} className="operacao-incerta" data-situacao={i.situacao} data-testid="operacao-incerta">
            <div>
              <strong>{i.descricao}</strong> — <span data-testid="situacao-operacao">{SITUACAO[i.situacao]}</span>
              <span className="campo-ajuda"> · pedido sem resposta às {formatarHora(new Date(i.criadaEm).toISOString())}</span>
              {i.mensagem !== null && <p className="campo-ajuda">{i.mensagem}</p>}
            </div>
            <div className="acoes-linha">
              {i.situacao === 'incerta' && (
                <button type="button" className="botao-secundario botao-compacto" disabled={rede === 'sem-conexao'} onClick={() => void verificarIncerta(i)}>
                  Verificar agora
                </button>
              )}
              {(i.situacao === 'incerta' || i.situacao === 'nao-registrada') && i.corpo !== undefined && (
                <button type="button" className="botao-secundario botao-compacto" disabled={rede === 'sem-conexao'} onClick={() => void reenviarIncerta(i)} data-testid="reenviar-incerta">
                  Repetir (mesma chave)
                </button>
              )}
              {(i.situacao === 'nao-registrada' || i.situacao === 'confirmada' || i.situacao === 'recusada') && (
                <button type="button" className="botao-link" onClick={() => { descartarIncerta(i.id); }} data-testid="dispensar-incerta">
                  {i.situacao === 'nao-registrada' ? 'Descartar' : 'Ciente'}
                </button>
              )}
              {i.situacao === 'incerta' && !aindaPodeProcessar(i) && i.corpo === undefined && (
                <span className="campo-ajuda">Arquivo: para repetir, escolha-o de novo na tela de origem.</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
