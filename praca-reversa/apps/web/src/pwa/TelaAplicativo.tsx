import { VERSAO_CONTRATO } from '@praca-reversa/contracts';
import { useState } from 'react';
import { TEXTO_REDE, useConexao } from '../api/conexao';
import { useVersao } from '../api/versao';
import { CAMINHO_BASE, VERSAO_INTERFACE } from '../base';
import { formatarHora } from '../utils/datas';
import { useAtualizacao } from './atualizacao';
import { AjudaTarefa } from '../features/ajuda/AjudaTarefa';
import { INSTRUCOES, instalar, plataformaProvavel, useInstalacao } from './instalacao';

function sim(valor: boolean): string {
  return valor ? 'sim' : 'não';
}

/**
 * "Aplicativo e aparelho" (etapa 09): instalação conforme o navegador,
 * origem segura, câmera, service worker, versões e estado da conexão. Serve
 * também para registrar a matriz de equipamentos do piloto. Não mostra dados
 * da operação.
 */
export function TelaAplicativo({ aoVoltar }: { aoVoltar: () => void }) {
  const instalacao = useInstalacao();
  const atualizacao = useAtualizacao();
  const versao = useVersao();
  const conexao = useConexao();
  const [resultado, setResultado] = useState<string | null>(null);
  const plataforma = plataformaProvavel(navigator.userAgent);
  const seguro = window.isSecureContext;
  const camera = typeof (navigator as { mediaDevices?: Partial<MediaDevices> }).mediaDevices?.getUserMedia === 'function';
  const detectorNativo = 'BarcodeDetector' in window;

  return (
    <main className="principal principal--pagina" data-testid="tela-aplicativo">
      <div className="pagina-conteudo">
        <header className="pagina-topo">
          <h2>Aplicativo e aparelho</h2>
          <button type="button" className="botao-secundario" onClick={aoVoltar}>
            Voltar
          </button>
        </header>
        <AjudaTarefa tarefa="camera" />

        <section className="cartao" aria-labelledby="titulo-instalacao">
          <h3 id="titulo-instalacao">Instalação</h3>
          {instalacao.standalone ? (
            <p data-testid="modo-aplicativo">Aberto como aplicativo instalado (janela própria).</p>
          ) : instalacao.disponivel ? (
            <div className="acoes-linha">
              <button
                type="button"
                className="botao-primario"
                onClick={() => {
                  void instalar().then((r) => {
                    setResultado(r === 'aceita' ? 'Instalação aceita: abra pelo ícone do aparelho.' : r === 'recusada' ? 'Instalação recusada: o uso pelo navegador continua igual.' : 'O navegador não oferece mais a instalação agora.');
                  });
                }}
                data-testid="instalar-aplicativo"
              >
                Instalar aplicativo
              </button>
            </div>
          ) : (
            <p data-testid="instrucoes-instalacao">{instalacao.instalado ? 'Instalado neste aparelho. ' : ''}{INSTRUCOES[plataforma]}</p>
          )}
          {resultado !== null && <p role="status">{resultado}</p>}
          <p className="bloco-nota">
            A instalação abre a interface neste aparelho; os dados continuam no servidor e exigem conexão. Cada navegador trata a instalação de um jeito: sem a opção, use
            pelo navegador normalmente.
          </p>
        </section>

        <section className="cartao" aria-labelledby="titulo-aparelho">
          <h3 id="titulo-aparelho">Este aparelho</h3>
          <dl className="situacao" data-testid="dados-aparelho">
            <div>
              <dt>Origem</dt>
              <dd>
                {window.location.origin}
                {CAMINHO_BASE === '/' ? '' : CAMINHO_BASE.slice(0, -1)} — {seguro ? 'segura (HTTPS ou localhost)' : 'NÃO segura: câmera e instalação ficam indisponíveis; use o endereço HTTPS'}
              </dd>
            </div>
            <div>
              <dt>Câmera</dt>
              <dd>{camera && seguro ? `disponível para pedir permissão (leitor ${detectorNativo ? 'nativo do navegador, se aceitar os formatos; senão, decodificador local' : 'decodificador local, sem envio de imagens'})` : 'indisponível: use o leitor-teclado ou digite o código'}</dd>
            </div>
            <div>
              <dt>Modo aplicativo</dt>
              <dd>{sim(instalacao.standalone)}</dd>
            </div>
            <div>
              <dt>Abertura sem conexão</dt>
              <dd>{atualizacao.suportado ? (atualizacao.registrado ? 'casca da interface guardada (sem dados de estoque)' : 'preparando…') : 'navegador sem service worker'}</dd>
            </div>
            <div>
              <dt>Conexão</dt>
              <dd>
                {TEXTO_REDE[conexao.rede]}
                {conexao.ultimaRespostaEm !== null ? ` · última resposta às ${formatarHora(new Date(conexao.ultimaRespostaEm).toISOString())}` : ''}
              </dd>
            </div>
            <div>
              <dt>Navegador</dt>
              <dd className="texto-quebravel">{navigator.userAgent}</dd>
            </div>
          </dl>
        </section>

        <section className="cartao" aria-labelledby="titulo-versoes">
          <h3 id="titulo-versoes">Versões</h3>
          <dl className="situacao" data-testid="versoes">
            <div>
              <dt>Interface</dt>
              <dd>
                {VERSAO_INTERFACE} (contrato {VERSAO_CONTRATO})
              </dd>
            </div>
            <div>
              <dt>Servidor</dt>
              <dd>
                {versao.servidor ? `${versao.servidor.application} (contrato ${String(versao.servidor.contract)}; aceita interface ${String(versao.servidor.minimumClientContract)}–${String(versao.servidor.contract)})` : 'não consultado'}
                {versao.incompativel ? ' — incompatível: atualize' : ''}
              </dd>
            </div>
            <div>
              <dt>Rascunho no navegador</dt>
              <dd>
                {versao.servidor === null
                  ? 'desconhecido (só memória)'
                  : versao.servidor.localDrafts
                    ? 'permitido nesta instalação (dados fictícios): só o não enviado, por usuário, escopo e conferência'
                    : 'desativado: o não enviado fica só na memória da aba'}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </main>
  );
}
