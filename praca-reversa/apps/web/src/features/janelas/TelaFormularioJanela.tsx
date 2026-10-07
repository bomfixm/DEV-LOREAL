import {
  API_PREFIXO,
  AlterarJanelaSchema,
  CONDICOES_MATERIAL,
  CriarJanelaSchema,
  JanelaDetalheSchema,
  METRICAS_CAPACIDADE,
  TIPOS_ORIGEM_DOCUMENTO,
  type BasePeso,
  type CondicaoMaterial,
  type JanelaDetalhe,
  type MetricaCapacidade,
  type TipoOrigemDocumento,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { useRecurso } from '../../api/use-recurso';
import { MensagemAcao, Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import type { Navegar } from '../../rotas';
import { mesAtual, paraEntradaLocal, paraIsoNoFuso } from '../../utils/datas';
import { useAcoes } from './acoes';
import { ROTULOS_BASE_PESO, ROTULOS_CONDICAO, ROTULOS_METRICA, ROTULOS_ORIGEM } from './rotulos';

interface RestricaoForm {
  metric: MetricaCapacidade;
  unit: string;
  weightBase: BasePeso;
  limit: string;
}

interface Form {
  name: string;
  clientReference: string;
  referenceMonth: string;
  exitStart: string;
  exitEnd: string;
  preparationDeadline: string;
  restrictions: RestricaoForm[];
  defined: boolean;
  conditions: CondicaoMaterial[];
  anyOrigin: boolean;
  origins: TipoOrigemDocumento[];
  requireLot: boolean;
  requireOrigin: boolean;
  documents: string;
  criteriaNotes: string;
  source: string;
  reference: string;
  date: string;
  responsible: string;
  notes: string;
  justification: string;
  changeSource: string;
}

const VAZIO: Form = {
  name: '',
  clientReference: '',
  referenceMonth: mesAtual(),
  exitStart: '',
  exitEnd: '',
  preparationDeadline: '',
  restrictions: [],
  defined: false,
  conditions: ['SAUDAVEL'],
  anyOrigin: true,
  origins: [],
  requireLot: false,
  requireOrigin: false,
  documents: '',
  criteriaNotes: '',
  source: '',
  reference: '',
  date: '',
  responsible: '',
  notes: '',
  justification: '',
  changeSource: '',
};

function doDetalhe(j: JanelaDetalhe): Form {
  return {
    name: j.name,
    clientReference: j.clientReference ?? '',
    referenceMonth: j.referenceMonth,
    exitStart: paraEntradaLocal(j.exitStart),
    exitEnd: paraEntradaLocal(j.exitEnd),
    preparationDeadline: paraEntradaLocal(j.preparationDeadline),
    restrictions: j.restrictions.map((r) => ({ metric: r.metric, unit: r.metric === 'QUANTIDADE' ? r.unit : 'UN', weightBase: r.weightBase ?? 'BRUTO', limit: r.limit === null ? '' : r.limit.replace('.', ',') })),
    defined: j.criteria.defined,
    conditions: j.criteria.acceptedConditions,
    anyOrigin: j.criteria.acceptedOriginTypes === null,
    origins: j.criteria.acceptedOriginTypes ?? [],
    requireLot: j.criteria.requireLot,
    requireOrigin: j.criteria.requireOrigin,
    documents: j.criteria.requiredDocuments.join('\n'),
    criteriaNotes: j.criteria.notes ?? '',
    source: j.authorization.source ?? '',
    reference: j.authorization.reference ?? '',
    date: j.authorization.date ?? '',
    responsible: j.authorization.responsible ?? '',
    notes: j.notes ?? '',
    justification: '',
    changeSource: '',
  };
}

const ou = (t: string) => (t.trim() === '' ? null : t.trim());

function corpo(f: Form) {
  return {
    name: f.name,
    clientReference: ou(f.clientReference),
    referenceMonth: f.referenceMonth,
    exitStart: f.exitStart ? paraIsoNoFuso(f.exitStart) : null,
    exitEnd: f.exitEnd ? paraIsoNoFuso(f.exitEnd) : null,
    preparationDeadline: f.preparationDeadline ? paraIsoNoFuso(f.preparationDeadline) : null,
    restrictions: f.restrictions.map((r) => ({
      metric: r.metric,
      unit: r.metric === 'QUANTIDADE' ? r.unit.trim().toUpperCase() : null,
      weightBase: r.metric === 'PESO_KG' ? r.weightBase : null,
      limit: r.limit.trim() === '' ? null : r.limit.trim().replace(',', '.'),
    })),
    criteria: {
      defined: f.defined,
      acceptedConditions: f.conditions,
      acceptedOriginTypes: f.anyOrigin ? null : f.origins,
      requireLot: f.requireLot,
      requireOrigin: f.requireOrigin,
      requiredDocuments: f.documents
        .split('\n')
        .map((d) => d.trim())
        .filter(Boolean),
      notes: ou(f.criteriaNotes),
    },
    authorization: { source: ou(f.source), reference: ou(f.reference), date: ou(f.date), responsible: ou(f.responsible) },
    notes: ou(f.notes),
  };
}

/**
 * Cadastro e alteração da janela. Rascunho aceita campos pendentes; depois
 * de confirmada, mudar limite, período ou critérios exige justificativa e
 * fonte (nova versão das regras; reservas e saídas anteriores mantêm a
 * fotografia). Datas digitadas no fuso da operação e gravadas em UTC.
 */
export function TelaFormularioJanela({ id, aoNavegar, aoGravar }: { id: string | null; aoNavegar: Navegar; aoGravar: () => void }) {
  const conectado = useConectado();
  const atual = useRecurso(id === null ? null : `${API_PREFIXO}/janelas/${id}`, JanelaDetalheSchema);
  const janela = atual.carga?.estado === 'pronto' ? atual.carga.dados : null;
  const [form, setForm] = useState<Form | null>(id === null ? VAZIO : null);
  if (form === null && janela !== null) setForm(doDetalhe(janela));
  const [erros, setErros] = useState<Record<string, string>>({});
  const acoes = useAcoes(atual.recarregar);
  const voltar = () => {
    aoNavegar(id === null ? { tipo: 'janelas', mes: null } : { tipo: 'janela', id, aba: null });
  };
  if (form === null) {
    return (
      <Pagina titulo="Janela" testId="tela-formulario-janela" aoVoltar={voltar} rotuloVoltar="Voltar">
        {atual.carga?.estado === 'erro' ? <p className="estado-erro">{atual.carga.mensagem}</p> : <p className="estado-carregando">Carregando…</p>}
      </Pagina>
    );
  }
  const f = form;
  const mudar = (parcial: Partial<Form>) => {
    setForm({ ...f, ...parcial });
  };
  const confirmada = janela !== null && janela.state !== 'RASCUNHO';
  const erro = (campo: string) =>
    erros[campo] ? (
      <span className="campo-erro" role="alert">
        {erros[campo]}
      </span>
    ) : null;

  async function enviar() {
    const dados = corpo(f);
    const datasInvalidas = (f.exitStart && dados.exitStart === null) || (f.exitEnd && dados.exitEnd === null);
    const validacao =
      janela === null
        ? CriarJanelaSchema.safeParse(dados)
        : AlterarJanelaSchema.safeParse({
            ...dados,
            expectedVersion: janela.version,
            ruleChange: f.justification.trim() || f.changeSource.trim() ? { justification: f.justification, source: f.changeSource } : null,
          });
    const novos: Record<string, string> = {};
    if (datasInvalidas) novos.exitStart = 'Data e hora inválidas.';
    if (!validacao.success) {
      for (const issue of validacao.error.issues) {
        const chave = issue.path.map(String).join('.');
        novos[chave] ??= issue.message;
        const raiz = String(issue.path[0] ?? '');
        novos[raiz] ??= issue.message;
      }
    }
    setErros(novos);
    if (Object.keys(novos).length > 0 || !validacao.success) return;
    const r = await acoes.executar(
      janela === null ? 'criar-janela' : `alterar-janela:${janela.id}`,
      janela === null ? 'POST' : 'PUT',
      janela === null ? `${API_PREFIXO}/janelas` : `${API_PREFIXO}/janelas/${janela.id}`,
      validacao.data,
      JanelaDetalheSchema,
      janela === null ? 'Janela cadastrada em rascunho.' : 'Janela alterada.',
    );
    if (r) {
      aoGravar();
      aoNavegar({ tipo: 'janela', id: r.id, aba: null });
    }
  }

  return (
    <Pagina titulo={janela === null ? 'Nova janela de devolução' : `Alterar ${janela.code}`} testId="tela-formulario-janela" aoVoltar={voltar} rotuloVoltar="Cancelar">
      <form
        className="formulario-janela"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
        noValidate
      >
        <section className="cartao">
          <h3>Identificação e período</h3>
          <div className="formulario-grade">
            <label className="campo">
              <span className="campo-rotulo">Nome/referência da janela *</span>
              <input value={f.name} maxLength={120} onChange={(e) => { mudar({ name: e.target.value }); }} data-testid="janela-nome" />
              {erro('name')}
            </label>
            <label className="campo">
              <span className="campo-rotulo">Referência do cliente</span>
              <input value={f.clientReference} maxLength={80} onChange={(e) => { mudar({ clientReference: e.target.value }); }} data-testid="janela-referencia" />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Mês de referência *</span>
              <input type="month" value={f.referenceMonth} onChange={(e) => { mudar({ referenceMonth: e.target.value }); }} data-testid="janela-mes" />
              {erro('referenceMonth')}
            </label>
            <label className="campo">
              <span className="campo-rotulo">Saída autorizada — início (horário de Brasília)</span>
              <input type="datetime-local" value={f.exitStart} onChange={(e) => { mudar({ exitStart: e.target.value }); }} data-testid="janela-saida-inicio" />
              {erro('exitStart')}
            </label>
            <label className="campo">
              <span className="campo-rotulo">Saída autorizada — fim</span>
              <input type="datetime-local" value={f.exitEnd} onChange={(e) => { mudar({ exitEnd: e.target.value }); }} data-testid="janela-saida-fim" />
              {erro('exitEnd')}
            </label>
            <label className="campo">
              <span className="campo-rotulo">Prazo de preparação (se informado)</span>
              <input type="datetime-local" value={f.preparationDeadline} onChange={(e) => { mudar({ preparationDeadline: e.target.value }); }} />
            </label>
          </div>
          <p className="campo-ajuda">Vazio = pendente. Nenhuma data, dia da semana, corte ou tolerância é presumida; saída fora do intervalo exige alteração autorizada.</p>
        </section>

        <section className="cartao">
          <h3>Capacidade (restrições)</h3>
          <p className="campo-ajuda">Limite vazio = pendente (nunca ilimitado). Limite 0 = sem capacidade. Todas as restrições precisam caber juntas.</p>
          {f.restrictions.map((r, i) => (
            <div key={`${r.metric}-${String(i)}`} className="formulario-grade formulario-grade--compacta linha-restricao" data-testid="linha-restricao">
              <label className="campo">
                <span className="campo-rotulo">Métrica</span>
                <select
                  value={r.metric}
                  onChange={(e) => {
                    mudar({ restrictions: f.restrictions.map((x, j) => (j === i ? { ...x, metric: e.target.value as MetricaCapacidade } : x)) });
                  }}
                  data-testid="restricao-metrica"
                >
                  {METRICAS_CAPACIDADE.map((m) => (
                    <option key={m} value={m}>
                      {ROTULOS_METRICA[m]}
                    </option>
                  ))}
                </select>
              </label>
              {r.metric === 'QUANTIDADE' && (
                <label className="campo">
                  <span className="campo-rotulo">Unidade</span>
                  <input value={r.unit} maxLength={10} onChange={(e) => { mudar({ restrictions: f.restrictions.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)) }); }} />
                </label>
              )}
              {r.metric === 'PESO_KG' && (
                <label className="campo">
                  <span className="campo-rotulo">Base do peso</span>
                  <select value={r.weightBase} onChange={(e) => { mudar({ restrictions: f.restrictions.map((x, j) => (j === i ? { ...x, weightBase: e.target.value as BasePeso } : x)) }); }}>
                    <option value="BRUTO">{ROTULOS_BASE_PESO.BRUTO}</option>
                    <option value="LIQUIDO">{ROTULOS_BASE_PESO.LIQUIDO}</option>
                  </select>
                </label>
              )}
              <label className="campo">
                <span className="campo-rotulo">Limite autorizado</span>
                <input
                  value={r.limit}
                  inputMode="decimal"
                  placeholder="pendente"
                  onChange={(e) => { mudar({ restrictions: f.restrictions.map((x, j) => (j === i ? { ...x, limit: e.target.value } : x)) }); }}
                  data-testid="restricao-limite"
                />
                {erro(`restrictions.${String(i)}.limit`)}
              </label>
              <button type="button" className="botao-link" onClick={() => { mudar({ restrictions: f.restrictions.filter((_, j) => j !== i) }); }}>
                Remover
              </button>
            </div>
          ))}
          {erro('restrictions')}
          {f.restrictions.length < METRICAS_CAPACIDADE.length && (
            <button
              type="button"
              className="botao-secundario botao-compacto"
              onClick={() => {
                const livre = METRICAS_CAPACIDADE.find((m) => !f.restrictions.some((r) => r.metric === m)) ?? 'QUANTIDADE';
                mudar({ restrictions: [...f.restrictions, { metric: livre, unit: 'UN', weightBase: 'BRUTO', limit: '' }] });
              }}
              data-testid="adicionar-restricao"
            >
              Adicionar restrição
            </button>
          )}
        </section>

        <section className="cartao">
          <h3>Critérios de material aceito e documentos</h3>
          <label className="campo campo--linha">
            <input type="checkbox" checked={f.defined} onChange={(e) => { mudar({ defined: e.target.checked }); }} data-testid="criterios-definidos" />
            <span>Critérios informados pelo cliente (sem isto a reserva fica bloqueada)</span>
          </label>
          <fieldset className="campo">
            <legend className="campo-rotulo">Condições aceitas</legend>
            {CONDICOES_MATERIAL.map((c) => (
              <label key={c} className="campo--linha">
                <input
                  type="checkbox"
                  checked={f.conditions.includes(c)}
                  onChange={(e) => {
                    mudar({ conditions: e.target.checked ? [...f.conditions, c] : f.conditions.filter((x) => x !== c) });
                  }}
                />
                <span>{ROTULOS_CONDICAO[c]}</span>
              </label>
            ))}
            {erro('criteria')}
          </fieldset>
          <fieldset className="campo">
            <legend className="campo-rotulo">Origem</legend>
            <label className="campo--linha">
              <input type="checkbox" checked={f.anyOrigin} onChange={(e) => { mudar({ anyOrigin: e.target.checked }); }} />
              <span>Qualquer tipo de origem</span>
            </label>
            {!f.anyOrigin &&
              TIPOS_ORIGEM_DOCUMENTO.map((o) => (
                <label key={o} className="campo--linha">
                  <input type="checkbox" checked={f.origins.includes(o)} onChange={(e) => { mudar({ origins: e.target.checked ? [...f.origins, o] : f.origins.filter((x) => x !== o) }); }} />
                  <span>{ROTULOS_ORIGEM[o]}</span>
                </label>
              ))}
            <label className="campo--linha">
              <input type="checkbox" checked={f.requireOrigin} onChange={(e) => { mudar({ requireOrigin: e.target.checked }); }} />
              <span>Exige origem comprovada</span>
            </label>
            <label className="campo--linha">
              <input type="checkbox" checked={f.requireLot} onChange={(e) => { mudar({ requireLot: e.target.checked }); }} />
              <span>Exige lote conhecido</span>
            </label>
          </fieldset>
          <label className="campo">
            <span className="campo-rotulo">Documentos exigidos na saída (um por linha, conforme o processo informado)</span>
            <textarea rows={3} value={f.documents} onChange={(e) => { mudar({ documents: e.target.value }); }} data-testid="janela-documentos" />
          </label>
          <label className="campo">
            <span className="campo-rotulo">Outros critérios informados</span>
            <textarea rows={2} maxLength={1000} value={f.criteriaNotes} onChange={(e) => { mudar({ criteriaNotes: e.target.value }); }} />
          </label>
        </section>

        <section className="cartao">
          <h3>Confirmação/autorização do cliente</h3>
          <div className="formulario-grade">
            <label className="campo">
              <span className="campo-rotulo">Fonte</span>
              <input value={f.source} maxLength={120} onChange={(e) => { mudar({ source: e.target.value }); }} data-testid="autorizacao-fonte" />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Referência (texto; zeros preservados)</span>
              <input value={f.reference} maxLength={120} onChange={(e) => { mudar({ reference: e.target.value }); }} data-testid="autorizacao-referencia" />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Data</span>
              <input type="date" value={f.date} onChange={(e) => { mudar({ date: e.target.value }); }} data-testid="autorizacao-data" />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Responsável no cliente/operação</span>
              <input value={f.responsible} maxLength={120} onChange={(e) => { mudar({ responsible: e.target.value }); }} data-testid="autorizacao-responsavel" />
            </label>
          </div>
          <p className="campo-ajuda">Confirmar a janela exige fonte, referência, data, responsável e intervalo de saída. A evidência pode ser anexada no detalhe.</p>
          <label className="campo">
            <span className="campo-rotulo">Observações</span>
            <textarea rows={2} maxLength={1000} value={f.notes} onChange={(e) => { mudar({ notes: e.target.value }); }} />
          </label>
        </section>

        {confirmada && (
          <section className="cartao cartao-confirmacao">
            <h3>Alteração de regra de janela confirmada</h3>
            <p>Mudar limite, período ou critérios exige justificativa e a fonte da nova autorização. Reservas e saídas anteriores mantêm a fotografia.</p>
            <div className="formulario-grade">
              <label className="campo">
                <span className="campo-rotulo">Justificativa</span>
                <input value={f.justification} maxLength={500} onChange={(e) => { mudar({ justification: e.target.value }); }} data-testid="janela-justificativa" />
                {erro('ruleChange')}
              </label>
              <label className="campo">
                <span className="campo-rotulo">Fonte da alteração</span>
                <input value={f.changeSource} maxLength={120} onChange={(e) => { mudar({ changeSource: e.target.value }); }} data-testid="janela-fonte-alteracao" />
              </label>
            </div>
          </section>
        )}

        <MensagemAcao mensagem={acoes.mensagem} testId="mensagem-janela" />
        <div className="acoes-linha">
          <button type="submit" className="botao-primario" disabled={acoes.enviando !== null || !conectado} data-testid="gravar-janela">
            {acoes.enviando !== null ? 'Gravando…' : janela === null ? 'Cadastrar em rascunho' : 'Gravar alteração'}
          </button>
          {!conectado && <span className="campo-ajuda">Sem conexão: nada é gravado.</span>}
        </div>
      </form>
    </Pagina>
  );
}
