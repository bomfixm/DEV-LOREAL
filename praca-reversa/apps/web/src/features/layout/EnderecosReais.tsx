import {
  API_PREFIXO,
  CorrespondenciaEnderecosSchema,
  ROTULOS_LADO,
  ROTULOS_SENTIDO,
  expandirSegmentos,
  type FaixaEnderecos,
  type SentidoSequencia,
} from '@praca-reversa/contracts';
import { useId, useState } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { formatarDataHora } from '../../utils/datas';

type Executar = (metodo: 'POST' | 'PUT', url: string, corpo: object) => Promise<boolean>;

const ROTULOS_ESTADO: Record<FaixaEnderecos['state'], string> = {
  SEM_SEQUENCIA: 'Sequência não informada',
  PROPOSTA: 'Proposta a revisar',
  CONFIRMADA: 'Confirmada',
};

/** Sequência informada → proposta revisável → confirmação explícita (uma faixa por vez). */
function Faixa({ faixa, prefixo, revisao, podeConfigurar, ocupado, executar }: { faixa: FaixaEnderecos; prefixo: string | null; revisao: number; podeConfigurar: boolean; ocupado: boolean; executar: Executar }) {
  const ids = useId();
  const [editando, setEditando] = useState(false);
  const [segmentos, setSegmentos] = useState(faixa.sequence?.segments ?? '');
  const [sentido, setSentido] = useState<SentidoSequencia>(faixa.sequence?.direction ?? 'P01_PRIMEIRO');
  const [fonte, setFonte] = useState(faixa.sequence?.source ?? '');
  const [motivoTroca, setMotivoTroca] = useState('');
  const expandida = segmentos.trim() === '' ? null : expandirSegmentos(segmentos);
  const confere = expandida?.ok === true && expandida.codigos.length === faixa.positions;
  const propostos = faixa.addresses.filter((a) => a.state === 'PROPOSTO');
  const temConfirmados = faixa.addresses.some((a) => a.state === 'CONFIRMADO');
  const primeiro = faixa.addresses[0];
  const ultimo = faixa.addresses[faixa.addresses.length - 1];
  return (
    <li className="faixa-enderecos" data-testid="faixa-enderecos" data-faixa={faixa.rowCode} data-estado={faixa.state}>
      <div className="faixa-enderecos-topo">
        <strong>{faixa.rowCode}</strong>
        <span>{faixa.side ? ROTULOS_LADO[faixa.side] : 'lado não informado'}</span>
        <span>{faixa.positions} posição(ões)</span>
        <span className={`selo-faixa selo-faixa--${faixa.state}`}>{ROTULOS_ESTADO[faixa.state]}</span>
      </div>
      {faixa.sequence && (
        <p className="campo-ajuda">
          Sequência {faixa.sequence.segments} · {ROTULOS_SENTIDO[faixa.sequence.direction]} · fonte: {faixa.sequence.source}
          {faixa.sequence.informedBy ? ` · ${faixa.sequence.informedBy.name}` : ''} em {formatarDataHora(faixa.sequence.informedAt)}
        </p>
      )}
      {primeiro && ultimo && (
        <p>
          {primeiro.positionCode} = {primeiro.address} … {ultimo.positionCode} = {ultimo.address} ({faixa.addresses.length} endereço(s){propostos.length > 0 ? `, ${String(propostos.length)} proposto(s)` : ''})
        </p>
      )}
      {podeConfigurar && faixa.state === 'PROPOSTA' && propostos.length > 0 && (
        <button
          type="button"
          className="botao-primario botao-compacto"
          disabled={ocupado}
          onClick={() => {
            void executar('POST', `${API_PREFIXO}/layout/fileiras/${faixa.rowId}/enderecos/confirmar`, { expectedRevision: revisao, expectedProposed: propostos.length });
          }}
          data-testid="confirmar-enderecos"
        >
          Confirmar os {propostos.length} endereço(s) propostos de {faixa.rowCode}
        </button>
      )}
      {podeConfigurar && !editando && (
        <button type="button" className="botao-link" onClick={() => { setEditando(true); }} data-testid="informar-sequencia">
          {faixa.sequence ? 'Alterar a sequência…' : 'Informar a sequência…'}
        </button>
      )}
      {podeConfigurar && editando && (
        <form
          className="formulario-coluna"
          onSubmit={(e) => {
            e.preventDefault();
            void executar('PUT', `${API_PREFIXO}/layout/fileiras/${faixa.rowId}/sequencia`, {
              expectedRevision: revisao,
              segments: segmentos,
              direction: sentido,
              source: fonte,
              notes: null,
              replaceConfirmedReason: temConfirmados ? motivoTroca : null,
            }).then((ok) => {
              if (ok) setEditando(false);
            });
          }}
        >
          <label className="campo">
            <span className="campo-rotulo">Códigos locais na ordem (prefixo {prefixo ?? '?'} é do bloco)</span>
            <input value={segmentos} maxLength={300} onChange={(e) => { setSegmentos(e.target.value); }} placeholder="ex.: A101-A133/2" data-testid="segmentos-sequencia" />
            <span className="campo-ajuda">Início-fim/passo, separados por vírgula (ex.: A79-A89/2, A103-A123/2). Nada é completado nem corrigido.</span>
          </label>
          {expandida && (
            <p className={confere ? 'campo-ajuda' : 'mensagem-conflito'} role={confere ? undefined : 'alert'}>
              {expandida.ok
                ? `${String(expandida.codigos.length)} código(s): ${expandida.codigos.slice(0, 3).join(', ')}${expandida.codigos.length > 3 ? ` … ${expandida.codigos[expandida.codigos.length - 1] ?? ''}` : ''}${confere ? '' : ` — a faixa tem ${String(faixa.positions)} posições.`}`
                : expandida.mensagem}
            </p>
          )}
          <fieldset className="campo">
            <legend className="campo-rotulo">Sentido no desenho</legend>
            {(['P01_PRIMEIRO', 'P01_ULTIMO'] as const).map((s) => (
              <label key={s} className="opcao">
                <input type="radio" name={`${ids}-sentido`} checked={sentido === s} onChange={() => { setSentido(s); }} />
                {ROTULOS_SENTIDO[s]}
              </label>
            ))}
          </fieldset>
          <label className="campo">
            <span className="campo-rotulo">Fonte da informação</span>
            <input value={fonte} maxLength={200} onChange={(e) => { setFonte(e.target.value); }} placeholder="ex.: levantamento na praça em 06/10 (supervisor)" />
          </label>
          {temConfirmados && (
            <label className="campo">
              <span className="campo-rotulo">Motivo para trocar endereços já confirmados</span>
              <input value={motivoTroca} maxLength={300} onChange={(e) => { setMotivoTroca(e.target.value); }} />
            </label>
          )}
          <div className="acoes-linha">
            <button type="submit" className="botao-secundario" disabled={ocupado || !confere || fonte.trim().length < 3 || (temConfirmados && motivoTroca.trim().length < 3)}>
              Gerar proposta (a confirmar)
            </button>
            <button type="button" className="botao-link" onClick={() => { setEditando(false); }}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

/**
 * Endereços reais: nomes operacionais dos blocos (Fileiras 11–16/GR) e a
 * tabela de correspondência posição ↔ endereço por faixa. Só a
 * correspondência confirmada coloca um endereço informado no mapa; sem ela, o
 * endereço fica como pendência (nenhuma posição é presumida).
 */
export function EnderecosReais({ versao, podeConfigurar, ocupado, executar }: { versao: number; podeConfigurar: boolean; ocupado: boolean; executar: Executar }) {
  const { carga } = useRecurso(`${API_PREFIXO}/layout/enderecos`, CorrespondenciaEnderecosSchema, versao);
  const dados = carga?.estado === 'pronto' ? carga.dados : null;
  const semNomes = dados?.blocks.some((b) => !b.deactivated && b.code.startsWith('FB') && b.operationalName === null) ?? false;
  return (
    <section className="cartao" aria-labelledby="titulo-enderecos-reais" data-testid="enderecos-reais">
      <h3 id="titulo-enderecos-reais">Endereços reais</h3>
      {carga?.estado === 'erro' && <p className="estado-erro">{carga.mensagem}</p>}
      {carga?.estado === 'carregando' && <p className="estado-carregando">Carregando a tabela de endereços…</p>}
      {dados && (
        <>
          <p>
            <strong>{dados.confirmedAddresses}</strong> endereço(s) confirmado(s) · <strong>{dados.proposedAddresses}</strong> proposto(s). O endereço é fileira/GR + código
            local: “15 - A120” e “13 - A120” são posições diferentes.
          </p>
          {dados.pending.length > 0 && (
            <ul className="mensagem-conflito" data-testid="pendencias-enderecos">
              {dados.pending.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {podeConfigurar && semNomes && dados.layoutId !== null && (
            <button
              type="button"
              className="botao-secundario"
              disabled={ocupado}
              onClick={() => {
                void executar('POST', `${API_PREFIXO}/layout/nomenclatura-aprovada`, { expectedRevision: dados.revision });
              }}
              data-testid="aplicar-nomes-operacionais"
            >
              Aplicar nomes operacionais (Fileiras 11–16/GR)
            </button>
          )}
          <ul className="blocos-enderecos">
            {dados.blocks
              .filter((b) => !b.deactivated)
              .map((b) => (
                <li key={b.elementId} data-testid="bloco-enderecos" data-bloco={b.code}>
                  <h4>
                    {b.operationalName ?? b.label} <span className="tabela-nota">({b.code}{b.addressPrefix ? ` · prefixo ${b.addressPrefix}` : ' · prefixo não definido'})</span>
                  </h4>
                  <ul className="faixas-enderecos">
                    {b.rows.map((f) => (
                      <Faixa key={`${f.rowId}:${String(dados.revision)}`} faixa={f} prefixo={b.addressPrefix} revisao={dados.revision} podeConfigurar={podeConfigurar} ocupado={ocupado} executar={executar} />
                    ))}
                  </ul>
                </li>
              ))}
          </ul>
          {dados.blocks.some((b) => b.deactivated) && (
            <p className="campo-ajuda">
              Área desativada: {dados.blocks.filter((b) => b.deactivated).length} bloco(s), fora da capacidade ativa; uma posição só recebe palete depois de ativada na lista de
              posições.
            </p>
          )}
        </>
      )}
    </section>
  );
}
