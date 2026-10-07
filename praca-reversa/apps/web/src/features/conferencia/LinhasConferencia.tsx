import {
  CONDICOES_MATERIAL,
  TIPOS_ORIGEM_DOCUMENTO,
  type CondicaoMaterial,
  type ConferenciaDetalhe,
  type CorrigirObservacao,
  type LinhaObservacao,
  type TipoOrigemDocumento,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { formatarDataHora } from '../../utils/datas';
import { formatarQuantidade } from '../../utils/numeros';
import { ROTULOS_ORIGEM_DOCUMENTO } from '../paletes/conteudo';
import { ROTULOS_CONDICAO } from '../paletes/estados';
import type { EnvioPendente } from './fila';
import { ROTULOS_MODO, ROTULOS_PENDENCIA, quantidadeComUnidade, textoOrigem } from './rotulos';

interface Props {
  detalhe: ConferenciaDetalhe;
  /** Linhas confirmadas pelo servidor que ainda não chegaram na última leitura do rascunho. */
  recentes: readonly LinhaObservacao[];
  naoEnviadas: readonly EnvioPendente[];
  /** Política da instalação: entradas não confirmadas também ficam no sessionStorage da aba. */
  guardadasNaAba: boolean;
  editavel: boolean;
  podeEnviar: boolean;
  aoReenviar: (id: string) => void;
  aoVerificar: (id: string) => void;
  aoDescartar: (id: string) => void;
  aoCorrigir: (linha: LinhaObservacao, corpo: CorrigirObservacao) => Promise<string | null>;
  aoRemover: (linha: LinhaObservacao, motivo: string | null) => Promise<string | null>;
}

function descreverQuantidade(l: LinhaObservacao): string {
  const informada = `${formatarQuantidade(l.quantity)} ${l.unit}`;
  if (l.pending !== null) return `${informada} (sem conversão)`;
  if (l.canonicalUnit === l.unit || l.factor === null || l.canonicalQuantity === null) return informada;
  return `${informada} × ${formatarQuantidade(l.factor)} = ${formatarQuantidade(l.canonicalQuantity)} ${l.canonicalUnit ?? ''}`;
}

function FormularioCorrecao({ linha, aoSalvar, aoFechar }: { linha: LinhaObservacao; aoSalvar: (c: CorrigirObservacao) => Promise<string | null>; aoFechar: () => void }) {
  const [quantidade, setQuantidade] = useState(linha.quantity);
  const [unidade, setUnidade] = useState(linha.unit);
  const [lote, setLote] = useState(linha.lot ?? '');
  const [tipo, setTipo] = useState<TipoOrigemDocumento | ''>(linha.originType ?? '');
  const [referencia, setReferencia] = useState(linha.originReference ?? '');
  const [condicao, setCondicao] = useState<CondicaoMaterial>(linha.condition);
  const [manterPendencia, setManterPendencia] = useState(linha.pending !== null);
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  return (
    <form
      className="formulario-coluna correcao-linha"
      onSubmit={(e) => {
        e.preventDefault();
        setGravando(true);
        setErro(null);
        void aoSalvar({
          expectedRevision: linha.revision,
          productId: linha.productId,
          packagingCode: null,
          quantity: quantidade.trim().replace(',', '.'),
          unit: unidade.trim().toUpperCase(),
          description: linha.productId === null ? linha.description : null,
          registerAsPending: linha.productId === null || manterPendencia,
          lot: lote.trim() || null,
          originType: tipo === '' ? null : tipo,
          originReference: tipo === '' ? null : referencia.trim() || null,
          condition: condicao,
          note: linha.note,
          evidence: linha.evidence,
          reason: motivo.trim() || null,
        }).then((falha) => {
          setGravando(false);
          if (falha === null) aoFechar();
          else setErro(falha);
        });
      }}
    >
      <div className="formulario-grade">
        <label className="campo">
          <span className="campo-rotulo">Quantidade</span>
          <input value={quantidade} inputMode="decimal" onChange={(e) => { setQuantidade(e.target.value); }} />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Unidade</span>
          <input value={unidade} maxLength={10} autoCapitalize="characters" onChange={(e) => { setUnidade(e.target.value); }} />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Lote (vazio = pendente)</span>
          <input value={lote} maxLength={64} onChange={(e) => { setLote(e.target.value); }} />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Documento de origem</span>
          <select value={tipo} onChange={(e) => { setTipo(e.target.value as TipoOrigemDocumento | ''); }}>
            <option value="">Origem pendente</option>
            {TIPOS_ORIGEM_DOCUMENTO.map((t) => (
              <option key={t} value={t}>
                {ROTULOS_ORIGEM_DOCUMENTO[t]}
              </option>
            ))}
          </select>
        </label>
        {tipo !== '' && (
          <label className="campo">
            <span className="campo-rotulo">Referência</span>
            <input value={referencia} maxLength={64} onChange={(e) => { setReferencia(e.target.value); }} />
          </label>
        )}
        <label className="campo">
          <span className="campo-rotulo">Condição</span>
          <select value={condicao} onChange={(e) => { setCondicao(e.target.value as CondicaoMaterial); }}>
            {CONDICOES_MATERIAL.map((c) => (
              <option key={c} value={c}>
                {ROTULOS_CONDICAO[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Motivo da correção (opcional)</span>
          <input value={motivo} maxLength={300} onChange={(e) => { setMotivo(e.target.value); }} />
        </label>
      </div>
      {linha.pending === 'FATOR_DESCONHECIDO' && (
        <label className="opcao">
          <input type="checkbox" checked={manterPendencia} onChange={(e) => { setManterPendencia(e.target.checked); }} />
          Manter como pendência se ainda não houver fator aprovado
        </label>
      )}
      {erro !== null && (
        <p className="estado-erro" role="alert">
          {erro}
        </p>
      )}
      <div className="acoes-linha">
        <button type="submit" className="botao-primario botao-compacto" disabled={gravando}>
          {gravando ? 'Gravando…' : 'Gravar correção'}
        </button>
        <button type="button" className="botao-link" onClick={aoFechar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function Linha({ linha, editavel, aoCorrigir, aoRemover }: { linha: LinhaObservacao; editavel: boolean } & Pick<Props, 'aoCorrigir' | 'aoRemover'>) {
  const [modo, setModo] = useState<'ver' | 'corrigir' | 'remover'>('ver');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const removida = linha.removed !== null;
  return (
    <li className={`linha-observacao${removida ? ' linha-observacao--removida' : ''}${linha.pending ? ' linha-observacao--pendente' : ''}`} data-testid="linha-observacao" data-ordem={linha.order}>
      <div className="linha-observacao-topo">
        <span className="linha-ordem">#{linha.order}</span>
        <span className="item-sku">{linha.sku ?? 'Produto não identificado'}</span>
        <span className="linha-descricao">{linha.description}</span>
        <span className="item-quantidade">{descreverQuantidade(linha)}</span>
      </div>
      <p className="linha-detalhes">
        {ROTULOS_MODO[linha.entryMode].curto}
        {linha.codeRead !== null && (
          <>
            {' · código '}
            <code>{linha.codeRead}</code>
          </>
        )}
        {' · '}
        {linha.lot ?? 'Lote pendente'} · {textoOrigem(linha.originType, linha.originReference)} · {ROTULOS_CONDICAO[linha.condition]}
        {' · '}
        {linha.registeredBy?.name ?? 'carga de demonstração'}, {formatarDataHora(linha.registeredAt)}
        {linha.corrected !== null && ` · corrigida (rev. ${String(linha.revision)}) por ${linha.corrected.by?.name ?? '—'}`}
        {linha.note !== null && ` · obs.: ${linha.note}`}
        {linha.evidence !== null && ` · evidência: ${linha.evidence}`}
      </p>
      {linha.pending !== null && <p className="linha-pendencia">⚠ {ROTULOS_PENDENCIA[linha.pending]}</p>}
      {removida && (
        <p className="linha-pendencia">
          Removida do rascunho por {linha.removed?.by?.name ?? '—'}
          {linha.removed?.reason ? `: ${linha.removed.reason}` : ''}. Fica no histórico; não conta.
        </p>
      )}
      {editavel && !removida && modo === 'ver' && (
        <div className="acoes-linha">
          <button type="button" className="botao-link" onClick={() => { setModo('corrigir'); }}>
            Corrigir linha {linha.order}
          </button>
          <button type="button" className="botao-link" onClick={() => { setModo('remover'); }}>
            Remover linha {linha.order}
          </button>
        </div>
      )}
      {modo === 'corrigir' && <FormularioCorrecao linha={linha} aoSalvar={(c) => aoCorrigir(linha, c)} aoFechar={() => { setModo('ver'); }} />}
      {modo === 'remover' && (
        <form
          className="formulario-coluna"
          onSubmit={(e) => {
            e.preventDefault();
            void aoRemover(linha, motivo.trim() || null).then((falha) => {
              if (falha === null) setModo('ver');
              else setErro(falha);
            });
          }}
        >
          <label className="campo">
            <span className="campo-rotulo">Motivo da remoção (opcional)</span>
            <input value={motivo} maxLength={300} onChange={(e) => { setMotivo(e.target.value); }} />
          </label>
          {erro !== null && (
            <p className="estado-erro" role="alert">
              {erro}
            </p>
          )}
          <div className="acoes-linha">
            <button type="submit" className="botao-perigo">
              Confirmar remoção
            </button>
            <button type="button" className="botao-link" onClick={() => { setModo('ver'); }}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

/** Rascunho no servidor (totais, pendências, linhas) e o que ainda não foi enviado. */
const SITUACAO_ENVIO: Record<EnvioPendente['estado'], string> = {
  'nao-enviada': 'não enviada',
  enviando: 'enviando…',
  incerta: 'em confirmação',
  verificando: 'verificando no servidor…',
};

export function LinhasConferencia({
  detalhe,
  recentes,
  naoEnviadas,
  guardadasNaAba,
  editavel,
  podeEnviar,
  aoReenviar,
  aoVerificar,
  aoDescartar,
  aoCorrigir,
  aoRemover,
}: Props) {
  const conhecidas = new Set(detalhe.lines.map((l) => l.id));
  const linhas = [...detalhe.lines, ...recentes.filter((l) => !conhecidas.has(l.id))].sort((a, b) => b.order - a.order);
  const ativas = linhas.filter((l) => l.removed === null).length;
  return (
    <section className="cartao" aria-labelledby="titulo-rascunho" data-testid="rascunho">
      <h3 id="titulo-rascunho">{detalhe.state === 'EM_ANDAMENTO' ? 'Rascunho no servidor' : 'Observações registradas'}</h3>

      {naoEnviadas.length > 0 && (
        <div className="nao-enviadas" role="alert" data-testid="nao-enviadas">
          <h4>
            {naoEnviadas.length} entrada(s) não confirmada(s) pelo servidor — não contam no rascunho até a confirmação
          </h4>
          <ul>
            {naoEnviadas.map((e) => (
              <li key={e.id} className="nao-enviada" data-estado={e.estado} data-testid="entrada-nao-confirmada">
                <span>
                  {e.resumo} — <strong>{SITUACAO_ENVIO[e.estado]}</strong>
                  {e.erro !== null && e.estado !== 'enviando' && e.estado !== 'verificando' ? ` (${e.erro})` : ''}
                </span>
                {(e.estado === 'nao-enviada' || e.estado === 'incerta') && (
                  <span className="acoes-linha">
                    {e.estado === 'incerta' && (
                      <button type="button" className="botao-secundario botao-compacto" disabled={!podeEnviar} onClick={() => { aoVerificar(e.id); }}>
                        Verificar no servidor
                      </button>
                    )}
                    <button type="button" className="botao-secundario botao-compacto" disabled={!podeEnviar} onClick={() => { aoReenviar(e.id); }}>
                      {e.estado === 'incerta' ? 'Reenviar (mesma chave)' : 'Enviar agora'}
                    </button>
                    <button type="button" className="botao-link" onClick={() => { aoDescartar(e.id); }}>
                      Descartar
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="bloco-nota">
            Reenviar usa a mesma chave da entrada: se o servidor já tinha recebido, nada é somado de novo. Nada é enviado sozinho.{' '}
            {guardadasNaAba
              ? 'Guardadas também nesta aba do navegador (rótulo “não enviado”), só para reenvio; nunca são saldo.'
              : 'Guardadas só na memória desta aba: fechar ou recarregar a aba as perde.'}
          </p>
        </div>
      )}

      <div className="bloco-itens" data-testid="totais-conferencia">
        <h4>Observado (somente linhas convertidas)</h4>
        {detalhe.totals.length === 0 ? (
          <p className="sem-itens">Nenhuma quantidade convertida ainda.</p>
        ) : (
          <ul className="itens">
            {detalhe.totals.map((t) => (
              <li key={t.key} className="item-conteudo">
                <div className="item-conteudo-topo">
                  <span className="item-sku">{t.sku}</span>
                  <span className="item-descricao">{t.description}</span>
                  <span className="item-quantidade">{quantidadeComUnidade(t.quantity, t.unit)}</span>
                </div>
                <dl className="item-conteudo-dados">
                  <div>
                    <dt>Lote</dt>
                    <dd className={t.lot === null ? 'pendente' : undefined}>{t.lot ?? 'Lote pendente'}</dd>
                  </div>
                  <div>
                    <dt>Origem</dt>
                    <dd className={t.originType === null ? 'pendente' : undefined}>{textoOrigem(t.originType, t.originReference)}</dd>
                  </div>
                  <div>
                    <dt>Condição</dt>
                    <dd>{ROTULOS_CONDICAO[t.condition]}</dd>
                  </div>
                  <div>
                    <dt>Linhas</dt>
                    <dd>{t.lines}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </div>

      {detalhe.pending.length > 0 && (
        <div className="bloco-itens bloco-pendencias" data-testid="pendencias-conferencia">
          <h4>Pendências a resolver ({detalhe.pending.length})</h4>
          <p className="bloco-nota">Não entram em saldo. Cadastre o código ou aprove o fator; no rascunho, corrija a linha; depois de concluída, solicite recontagem.</p>
          <ul className="itens">
            {detalhe.pending.map((p) => (
              <li key={p.lineId} className="item-conteudo">
                <span className="linha-pendencia">⚠ {ROTULOS_PENDENCIA[p.kind]}</span> — {p.sku ?? p.codeRead ?? p.description}: {quantidadeComUnidade(p.quantity, p.unit)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="linhas-registradas" open={detalhe.state === 'EM_ANDAMENTO'}>
        <summary>
          Linhas registradas: {ativas} ativa(s){linhas.length > ativas ? `, ${String(linhas.length - ativas)} removida(s)` : ''}
        </summary>
        {linhas.length === 0 ? (
          <p className="sem-itens">Nenhuma linha registrada.</p>
        ) : (
          <ul className="lista-linhas">
            {linhas.map((l) => (
              <Linha key={l.id} linha={l} editavel={editavel} aoCorrigir={aoCorrigir} aoRemover={aoRemover} />
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}
