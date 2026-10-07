import {
  API_PREFIXO,
  AlterarClaimSchema,
  ClaimDetalheSchema,
  CriarClaimSchema,
  MOTIVOS_CLAIM,
  PRIORIDADES_CLAIM,
  ResponsaveisClaimSchema,
  TIPOS_ORIGEM_DOCUMENTO,
  type BaseValor,
  type ClaimDetalhe,
  type MotivoClaim,
  type PrioridadeClaim,
  type TipoOrigemDocumento,
} from '@praca-reversa/contracts';
import { useId, useState } from 'react';
import { useChaves } from '../../api/chaves';
import { FalhaRequisicao, enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar, IconeMais } from '../../components/Icones';
import { MensagemAcao, Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import type { Navegar } from '../../rotas';
import { ROTULOS_MOTIVO, ROTULOS_ORIGEM, ROTULOS_PRIORIDADE } from './rotulos';

interface LinhaForm {
  id?: string;
  lineRef: string;
  sku: string;
  description: string;
  quantity: string;
  unit: string;
  lot: string;
  lotRequired: boolean;
  originType: TipoOrigemDocumento | '';
  originReference: string;
  originLine: string;
  estimatedValue: string;
  valueBase: BaseValor | '';
  /** Linha com recuperação ou resultado: produto, unidade, lote e origem não mudam. */
  protegida: boolean;
}

interface Form {
  externalReference: string;
  reason: MotivoClaim;
  priority: PrioridadeClaim | '';
  deadline: string;
  openedOn: string;
  occurredOn: string;
  responsibleId: string;
  currency: string;
  valueSource: string;
  externalStatus: string;
  chargeReference: string;
  chargeFinalized: boolean;
  notes: string;
  lines: LinhaForm[];
  reasonForChange: string;
}

const linhaVazia = (n: number): LinhaForm => ({
  lineRef: String(n),
  sku: '',
  description: '',
  quantity: '',
  unit: 'UN',
  lot: '',
  lotRequired: false,
  originType: 'DEVOLUCAO',
  originReference: '',
  originLine: '',
  estimatedValue: '',
  valueBase: '',
  protegida: false,
});

function formDe(c: ClaimDetalhe | null): Form {
  if (c === null) {
    return {
      externalReference: '',
      reason: 'EXTRAVIO_FALTA',
      priority: '',
      deadline: '',
      openedOn: '',
      occurredOn: '',
      responsibleId: '',
      currency: 'BRL',
      valueSource: '',
      externalStatus: '',
      chargeReference: '',
      chargeFinalized: false,
      notes: '',
      lines: [linhaVazia(1)],
      reasonForChange: '',
    };
  }
  return {
    externalReference: c.externalReference ?? '',
    reason: c.reason,
    priority: c.priority ?? '',
    deadline: c.deadline ?? '',
    openedOn: c.openedOn ?? '',
    occurredOn: c.occurredOn ?? '',
    responsibleId: c.responsible?.id ?? '',
    currency: c.currency ?? '',
    valueSource: c.valueSource ?? '',
    externalStatus: c.externalStatus ?? '',
    chargeReference: c.chargeReference ?? '',
    chargeFinalized: c.chargeFinalized,
    notes: c.notes ?? '',
    lines: c.lines.map((l) => ({
      id: l.id,
      lineRef: l.lineRef,
      sku: l.sku,
      description: l.description ?? '',
      quantity: l.quantity,
      unit: l.unit,
      lot: l.lot ?? '',
      lotRequired: l.lotRequired,
      originType: l.originType ?? '',
      originReference: l.originReference ?? '',
      originLine: l.originLine ?? '',
      estimatedValue: l.estimatedValue ?? '',
      valueBase: l.valueBase ?? '',
      protegida: l.recovered !== '0' || l.covered !== '0',
    })),
    reasonForChange: '',
  };
}

const ou = (t: string) => (t.trim() === '' ? null : t.trim());

function corpoDe(f: Form, versao: number | null) {
  const corpo = {
    externalReference: ou(f.externalReference),
    reason: f.reason,
    priority: f.priority === '' ? null : f.priority,
    deadline: ou(f.deadline),
    openedOn: ou(f.openedOn),
    occurredOn: ou(f.occurredOn),
    responsibleId: ou(f.responsibleId),
    currency: ou(f.currency),
    valueSource: ou(f.valueSource),
    externalStatus: ou(f.externalStatus),
    chargeReference: ou(f.chargeReference),
    chargeFinalized: f.chargeFinalized,
    notes: ou(f.notes),
    lines: f.lines.map((l) => ({
      ...(l.id ? { id: l.id } : {}),
      lineRef: l.lineRef.trim(),
      sku: l.sku.trim(),
      description: ou(l.description),
      quantity: l.quantity.trim().replace(',', '.'),
      unit: l.unit.trim().toUpperCase(),
      lot: ou(l.lot),
      lotRequired: l.lotRequired,
      originType: l.originType === '' || ou(l.originReference) === null ? null : l.originType,
      originReference: ou(l.originReference),
      originLine: ou(l.originLine),
      estimatedValue: ou(l.estimatedValue.replace(',', '.')),
      valueBase: l.valueBase === '' ? null : l.valueBase,
    })),
  };
  return versao === null ? corpo : { ...corpo, expectedVersion: versao, reasonForChange: f.reasonForChange.trim() };
}

/** Erros por campo (caminho → mensagem), do mesmo contrato que o servidor valida. */
function errosDe(f: Form, versao: number | null): Map<string, string> {
  const r = versao === null ? CriarClaimSchema.safeParse(corpoDe(f, null)) : AlterarClaimSchema.safeParse(corpoDe(f, versao));
  const erros = new Map<string, string>();
  if (!r.success) for (const i of r.error.issues) erros.set(i.path.join('.'), i.message);
  return erros;
}

/**
 * Cadastro e edição do caso. Campos mínimos: motivo e ao menos uma linha com
 * SKU, quantidade e unidade; o resto pode ficar pendente (triagem). Datas e
 * valores nunca são inventados; edição exige motivo e não apaga linhas.
 */
export function TelaFormularioClaim({ id, aoNavegar, aoGravar }: { id: string | null; aoNavegar: Navegar; aoGravar: () => void }) {
  const ids = useId();
  const conectado = useConectado();
  const chaves = useChaves();
  const atual = useRecurso(id === null ? null : `${API_PREFIXO}/claims/${id}`, ClaimDetalheSchema);
  const caso = atual.carga?.estado === 'pronto' ? atual.carga.dados : null;
  const responsaveis = useRecurso(`${API_PREFIXO}/claims/responsaveis`, ResponsaveisClaimSchema);
  const [form, setForm] = useState<Form | null>(id === null ? formDe(null) : null);
  const [tentou, setTentou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'erro' | 'conflito' | 'ok'; texto: string } | null>(null);
  if (form === null && caso !== null) setForm(formDe(caso));
  const versao = id === null ? null : (caso?.version ?? null);
  const erros = form && tentou ? errosDe(form, versao) : new Map<string, string>();
  const erro = (caminho: string) => erros.get(caminho) ?? null;
  const voltar = () => {
    aoNavegar(id === null ? { tipo: 'claims' } : { tipo: 'claim', id, linha: null, aba: null });
  };

  if (id !== null && form === null) {
    return (
      <Pagina titulo="Editar claim" testId="tela-editar-claim" aoVoltar={voltar} rotuloVoltar="Voltar ao claim">
        {atual.carga?.estado === 'erro' ? (
          <div className="estado-erro" role="alert">
            <p>{atual.carga.mensagem}</p>
            <button type="button" className="botao-secundario" onClick={atual.recarregar}>
              <IconeAtualizar />
              Tentar novamente
            </button>
          </div>
        ) : (
          <p className="estado-carregando">Carregando…</p>
        )}
      </Pagina>
    );
  }
  if (form === null) return null;
  const mudar = (parcial: Partial<Form>) => {
    setForm({ ...form, ...parcial });
  };
  const mudarLinha = (i: number, parcial: Partial<LinhaForm>) => {
    setForm({ ...form, lines: form.lines.map((l, j) => (j === i ? { ...l, ...parcial } : l)) });
  };

  async function gravar() {
    if (!form) return;
    setTentou(true);
    if (errosDe(form, versao).size > 0) {
      setMensagem({ tipo: 'erro', texto: 'Corrija os campos indicados.' });
      return;
    }
    const corpo = corpoDe(form, versao);
    const assinatura = `${id ?? 'novo'}:${JSON.stringify(corpo)}`;
    setEnviando(true);
    setMensagem(null);
    try {
      const r = await enviarJson(id === null ? 'POST' : 'PUT', id === null ? `${API_PREFIXO}/claims` : `${API_PREFIXO}/claims/${id}`, ClaimDetalheSchema, {
        corpo,
        idempotencia: chaves.para(assinatura),
      });
      chaves.concluir(assinatura);
      aoGravar();
      aoNavegar({ tipo: 'claim', id: r.id, linha: null, aba: null }, { substituir: true });
    } catch (e) {
      chaves.concluir(assinatura, e);
      const rede = e instanceof FalhaRequisicao && e.tipo === 'rede';
      const conflito = e instanceof FalhaRequisicao && e.codigo === 'CONFLITO_VERSAO';
      setMensagem({
        tipo: conflito ? 'conflito' : 'erro',
        texto: rede ? 'Sem resposta do servidor: não é possível saber se foi gravado. Tente de novo: não será duplicado.' : mensagemDeFalha(e),
      });
      if (conflito) {
        setForm(null);
        atual.recarregar();
      }
    } finally {
      setEnviando(false);
    }
  }

  const campoErro = (caminho: string) => {
    const m = erro(caminho);
    return m ? (
      <span className="campo-erro" role="alert">
        {m}
      </span>
    ) : null;
  };

  return (
    <Pagina
      titulo={id === null ? 'Novo claim' : `Editar ${caso?.code ?? 'claim'}`}
      testId={id === null ? 'tela-novo-claim' : 'tela-editar-claim'}
      aoVoltar={voltar}
      rotuloVoltar={id === null ? 'Voltar aos claims' : 'Voltar ao claim'}
      descricao={
        <p>
          Obrigatórios: motivo e, em cada linha, identificador, SKU, quantidade e unidade. O restante pode ficar pendente (o caso fica em triagem); nada é presumido.
        </p>
      }
    >
      <form
        className="formulario-claim"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void gravar();
        }}
      >
        <fieldset className="cartao">
          <legend className="campo-rotulo">Caso</legend>
          <div className="formulario-grade">
            <label className="campo">
              <span className="campo-rotulo">Referência externa (texto)</span>
              <input value={form.externalReference} maxLength={80} onChange={(e) => { mudar({ externalReference: e.target.value }); }} data-testid="claim-referencia" />
              {campoErro('externalReference')}
            </label>
            <label className="campo">
              <span className="campo-rotulo">Motivo*</span>
              <select value={form.reason} onChange={(e) => { mudar({ reason: e.target.value as MotivoClaim }); }} data-testid="claim-motivo">
                {MOTIVOS_CLAIM.map((m) => (
                  <option key={m} value={m}>
                    {ROTULOS_MOTIVO[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span className="campo-rotulo">Prioridade manual</span>
              <select value={form.priority} onChange={(e) => { mudar({ priority: e.target.value as PrioridadeClaim | '' }); }}>
                <option value="">Não definida</option>
                {PRIORIDADES_CLAIM.map((p) => (
                  <option key={p} value={p}>
                    {ROTULOS_PRIORIDADE[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span className="campo-rotulo">Prazo informado</span>
              <input type="date" value={form.deadline} onChange={(e) => { mudar({ deadline: e.target.value }); }} data-testid="claim-prazo" />
              <span className="campo-ajuda">Vazio = não informado (nenhum prazo é calculado).</span>
              {campoErro('deadline')}
            </label>
            <label className="campo">
              <span className="campo-rotulo">Data de abertura</span>
              <input type="date" value={form.openedOn} onChange={(e) => { mudar({ openedOn: e.target.value }); }} />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Data da ocorrência</span>
              <input type="date" value={form.occurredOn} onChange={(e) => { mudar({ occurredOn: e.target.value }); }} />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Responsável</span>
              <select value={form.responsibleId} onChange={(e) => { mudar({ responsibleId: e.target.value }); }} data-testid="claim-responsavel">
                <option value="">Sem responsável</option>
                {responsaveis.carga?.estado === 'pronto' &&
                  responsaveis.carga.dados.items.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.login})
                    </option>
                  ))}
              </select>
            </label>
            <label className="campo">
              <span className="campo-rotulo">Moeda do valor estimado</span>
              <input value={form.currency} maxLength={3} onChange={(e) => { mudar({ currency: e.target.value.toUpperCase() }); }} />
              {campoErro('currency')}
            </label>
            <label className="campo">
              <span className="campo-rotulo">Fonte do valor estimado</span>
              <input value={form.valueSource} maxLength={200} onChange={(e) => { mudar({ valueSource: e.target.value }); }} />
              {campoErro('valueSource')}
            </label>
            <label className="campo">
              <span className="campo-rotulo">Situação externa (cliente)</span>
              <input value={form.externalStatus} maxLength={120} onChange={(e) => { mudar({ externalStatus: e.target.value }); }} />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Referência da cobrança/tratativa</span>
              <input value={form.chargeReference} maxLength={80} onChange={(e) => { mudar({ chargeReference: e.target.value }); }} />
            </label>
            <label className="opcao">
              <input type="checkbox" checked={form.chargeFinalized} onChange={(e) => { mudar({ chargeFinalized: e.target.checked }); }} />
              <span>Cobrança já finalizada financeiramente no cliente (resultado só com prova externa)</span>
            </label>
          </div>
          <label className="campo">
            <span className="campo-rotulo">Observações</span>
            <textarea value={form.notes} maxLength={2000} rows={2} onChange={(e) => { mudar({ notes: e.target.value }); }} />
          </label>
        </fieldset>

        {form.lines.map((l, i) => (
          <fieldset key={l.id ?? `nova-${String(i)}`} className="cartao" data-testid="claim-linha-form">
            <legend className="campo-rotulo">
              Linha {l.lineRef || String(i + 1)}
              {l.protegida ? ' (com recuperação ou resultado: produto, unidade, lote e origem não mudam)' : ''}
            </legend>
            <div className="formulario-grade">
              <label className="campo">
                <span className="campo-rotulo">Identificador da linha*</span>
                <input value={l.lineRef} maxLength={40} disabled={l.id !== undefined} onChange={(e) => { mudarLinha(i, { lineRef: e.target.value }); }} />
                {campoErro(`lines.${String(i)}.lineRef`)}
              </label>
              <label className="campo">
                <span className="campo-rotulo">SKU*</span>
                <input value={l.sku} maxLength={60} disabled={l.protegida} onChange={(e) => { mudarLinha(i, { sku: e.target.value }); }} data-testid="claim-sku" />
                {campoErro(`lines.${String(i)}.sku`)}
              </label>
              <label className="campo">
                <span className="campo-rotulo">Descrição</span>
                <input value={l.description} maxLength={200} onChange={(e) => { mudarLinha(i, { description: e.target.value }); }} />
              </label>
              <label className="campo">
                <span className="campo-rotulo">Quantidade em análise*</span>
                <input value={l.quantity} inputMode="decimal" onChange={(e) => { mudarLinha(i, { quantity: e.target.value }); }} data-testid="claim-quantidade" />
                {campoErro(`lines.${String(i)}.quantity`)}
              </label>
              <label className="campo">
                <span className="campo-rotulo">Unidade*</span>
                <input value={l.unit} maxLength={10} disabled={l.protegida} onChange={(e) => { mudarLinha(i, { unit: e.target.value.toUpperCase() }); }} />
                {campoErro(`lines.${String(i)}.unit`)}
              </label>
              <label className="campo">
                <span className="campo-rotulo">Lote</span>
                <input value={l.lot} maxLength={60} disabled={l.protegida} onChange={(e) => { mudarLinha(i, { lot: e.target.value }); }} />
              </label>
              <label className="opcao">
                <input type="checkbox" checked={l.lotRequired} disabled={l.protegida} onChange={(e) => { mudarLinha(i, { lotRequired: e.target.checked }); }} />
                <span>Lote exigido para validar</span>
              </label>
              <label className="campo">
                <span className="campo-rotulo">Tipo da origem</span>
                <select value={l.originType} disabled={l.protegida} onChange={(e) => { mudarLinha(i, { originType: e.target.value as TipoOrigemDocumento | '' }); }}>
                  <option value="">Não informado</option>
                  {TIPOS_ORIGEM_DOCUMENTO.map((t) => (
                    <option key={t} value={t}>
                      {ROTULOS_ORIGEM[t]}
                    </option>
                  ))}
                </select>
                {campoErro(`lines.${String(i)}.originType`)}
              </label>
              <label className="campo">
                <span className="campo-rotulo">Referência da origem</span>
                <input value={l.originReference} maxLength={80} disabled={l.protegida} onChange={(e) => { mudarLinha(i, { originReference: e.target.value }); }} data-testid="claim-origem" />
              </label>
              <label className="campo">
                <span className="campo-rotulo">Linha da origem</span>
                <input value={l.originLine} maxLength={40} disabled={l.protegida} onChange={(e) => { mudarLinha(i, { originLine: e.target.value }); }} />
              </label>
              <label className="campo">
                <span className="campo-rotulo">Valor estimado</span>
                <input value={l.estimatedValue} inputMode="decimal" onChange={(e) => { mudarLinha(i, { estimatedValue: e.target.value }); }} />
                {campoErro(`lines.${String(i)}.estimatedValue`)}
              </label>
              <label className="campo">
                <span className="campo-rotulo">Base do valor</span>
                <select value={l.valueBase} onChange={(e) => { mudarLinha(i, { valueBase: e.target.value as BaseValor | '' }); }}>
                  <option value="">—</option>
                  <option value="UNITARIO">Unitário (× quantidade)</option>
                  <option value="TOTAL_LINHA">Total da linha (não multiplica)</option>
                </select>
                {campoErro(`lines.${String(i)}.valueBase`)}
              </label>
            </div>
            {l.id === undefined && form.lines.length > 1 && (
              <button
                type="button"
                className="botao-link"
                onClick={() => {
                  setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) });
                }}
              >
                Remover esta linha nova
              </button>
            )}
          </fieldset>
        ))}
        <button
          type="button"
          className="botao-secundario"
          onClick={() => {
            setForm({ ...form, lines: [...form.lines, linhaVazia(form.lines.length + 1)] });
          }}
        >
          <IconeMais />
          Acrescentar linha
        </button>
        {campoErro('lines')}

        {id !== null && (
          <label className="campo">
            <span className="campo-rotulo">Motivo da alteração*</span>
            <input value={form.reasonForChange} maxLength={500} onChange={(e) => { mudar({ reasonForChange: e.target.value }); }} data-testid="claim-motivo-alteracao" />
            {campoErro('reasonForChange')}
          </label>
        )}
        <MensagemAcao mensagem={mensagem} testId="mensagem-claim-form" />
        {!conectado && <p className="mensagem-conflito">Sem conexão: nada é registrado.</p>}
        <div className="acoes-linha">
          <button type="submit" className="botao-primario" disabled={enviando || !conectado} data-testid="gravar-claim" aria-describedby={`${ids}-nota`}>
            {enviando ? 'Gravando…' : id === null ? 'Registrar claim' : 'Gravar alterações'}
          </button>
          <span id={`${ids}-nota`} className="campo-ajuda">
            Registrar não altera estoque nem o sistema do cliente.
          </span>
        </div>
      </form>
    </Pagina>
  );
}
