import type { Layout, PaleteResumo } from '@praca-reversa/contracts';
import { useState } from 'react';
import { posicoesLivres, type Aviso, type PosicaoLivre } from './regras';

const CLASSE_AVISO: Record<Aviso['tipo'], string> = {
  ok: 'mensagem-ok',
  campo: 'estado-erro',
  saldo: 'mensagem-conflito',
  destino: 'mensagem-conflito',
  conflito: 'mensagem-conflito',
  permissao: 'estado-erro',
  rede: 'mensagem-conflito',
  bloqueio: 'mensagem-conflito',
  erro: 'estado-erro',
};

/** Resposta da movimentação, com reenvio (mesma chave) quando a resposta foi incerta. */
export function AvisoMovimento({
  aviso,
  podeReenviar,
  enviando,
  aoReenviar,
  testId,
}: {
  aviso: Aviso | null;
  podeReenviar: boolean;
  enviando: boolean;
  aoReenviar: () => void;
  testId: string;
}) {
  if (aviso === null) return null;
  return (
    <div className={`aviso-movimento ${CLASSE_AVISO[aviso.tipo]}`} role={aviso.tipo === 'ok' ? 'status' : 'alert'} data-testid={testId} data-tipo={aviso.tipo}>
      <p>
        <strong>{aviso.titulo}.</strong> {aviso.texto}
      </p>
      {aviso.incerto && podeReenviar && (
        <button type="button" className="botao-secundario" onClick={aoReenviar} disabled={enviando} data-testid="reenviar-movimento">
          {enviando ? 'Reenviando…' : 'Reenviar com a mesma chave'}
        </button>
      )}
      {(aviso.tipo === 'saldo' || aviso.tipo === 'destino') && (
        <p className="bloco-nota">Os dados atuais foram consultados de novo no servidor: revise a prévia antes de confirmar.</p>
      )}
    </div>
  );
}

/** Aviso de rede: movimentações só são confirmadas com resposta do servidor. */
export function SemConexaoMovimento() {
  return (
    <p className="mensagem-conflito" role="alert" data-testid="movimento-sem-conexao">
      <strong>Sem conexão.</strong> Movimentações só são registradas com resposta do servidor; nada fica guardado para envio automático depois.
    </p>
  );
}

/**
 * Escolha da posição de destino: digitar/ler o código ou tocar numa posição
 * livre da lista (layout ativo, disponível e sem palete). A ocupação mostrada
 * é a da última consulta; o servidor confere de novo na confirmação.
 */
export function EscolhaPosicao({
  layout,
  paletes,
  atualId,
  escolhida,
  aoEscolher,
  rotulo,
}: {
  layout: Layout | null;
  paletes: readonly PaleteResumo[];
  atualId: string | null;
  escolhida: PosicaoLivre | null;
  aoEscolher: (p: PosicaoLivre | null) => void;
  rotulo: string;
}) {
  const [busca, setBusca] = useState('');
  const livres = posicoesLivres(layout, paletes, busca, atualId);
  const termo = busca.trim().toUpperCase();
  const exata = layout?.positions.find((p) => p.code === termo) ?? null;
  const ocupante = exata === null ? null : (paletes.find((p) => p.positionId === exata.id) ?? null);
  const LIMITE = 24;
  if (layout === null) return <p className="estado-erro">Sem layout ativo neste escopo: não há posição para escolher.</p>;
  return (
    <div className="escolha-posicao" data-testid="escolha-posicao">
      <label className="campo">
        <span className="campo-rotulo">{rotulo}</span>
        <input
          value={busca}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="Ex.: F03-P09"
          onChange={(e) => { setBusca(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const unica = livres.length === 1 ? livres[0] : livres.find((p) => p.codigo === termo);
            if (unica) aoEscolher(unica);
          }}
          data-testid="busca-posicao"
        />
      </label>
      {exata !== null && ocupante !== null && exata.id !== atualId && (
        <p className="bloco-nota" role="status">
          {exata.code} está ocupada pelo palete {ocupante.code}: escolha uma posição livre.
        </p>
      )}
      {exata !== null && !exata.available && <p className="bloco-nota">{exata.code} está indisponível{exata.unavailableReason ? ` (${exata.unavailableReason})` : ''}.</p>}
      {exata !== null && exata.id === atualId && <p className="bloco-nota">{exata.code} é a posição atual do palete.</p>}
      {livres.length === 0 ? (
        <p className="sem-itens">Nenhuma posição livre corresponde à busca.</p>
      ) : (
        <ul className="lista-escolha" aria-label="Posições livres">
          {livres.slice(0, LIMITE).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={escolhida?.id === p.id ? 'escolha escolha--ativa' : 'escolha'}
                aria-pressed={escolhida?.id === p.id}
                onClick={() => { aoEscolher(p); }}
              >
                <strong>{p.codigo}</strong>
                <span>{p.fileira}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {livres.length > LIMITE && <p className="bloco-nota">Mais {livres.length - LIMITE} posições livres: digite parte do código para filtrar.</p>}
    </div>
  );
}
