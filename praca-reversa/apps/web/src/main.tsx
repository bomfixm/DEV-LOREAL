import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { iniciarMonitorConexao } from './api/conexao';
import { consultarVersao } from './api/versao';
import { App } from './App';
import { definirFonteDePendencias } from './pwa/abas';
import { avisosAoAtualizar, impedimentosParaAtualizar, iniciarServiceWorker } from './pwa/atualizacao';
import { capturarPedidoDeInstalacao } from './pwa/instalacao';
import './estilos/base.css';

// Etapa 09: instalação, service worker com atualização controlada, estado
// real da conexão, compatibilidade com a API e coordenação entre abas.
capturarPedidoDeInstalacao();
iniciarServiceWorker();
iniciarMonitorConexao();
void consultarVersao();
definirFonteDePendencias(() => [...impedimentosParaAtualizar(), ...avisosAoAtualizar()]);
window.addEventListener('online', () => {
  void consultarVersao();
});

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Elemento raiz da aplicação não encontrado.');

createRoot(raiz).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
