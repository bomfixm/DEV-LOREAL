import {
  API_PREFIXO,
  ContextoDocumentoSelecaoSchema,
  PaginaInventariosSchema,
  PaginaSelecoesSchema,
  type ContextoDocumentoSelecao,
  type DefinicaoTipoDocumento,
  type EstruturaArquivo,
  type ParametrosInventario,
  type ParametrosSelecao,
  type TipoImportacao,
} from '@praca-reversa/contracts';
import { useId } from 'react';
import { useRecurso } from '../../api/use-recurso';
import type { ParametrosPlanilha } from './parametros';

const lista = (texto: string): string[] => [...new Set(texto.split(/[;,]/).map((t) => t.trim()).filter(Boolean))];
const textoOuNulo = (t: string): string | null => (t.trim() === '' ? null : t);

const ROTULOS_CONTEXTO: Record<ContextoDocumentoSelecao, string> = {
  DOCUMENTO_INVENTARIO: 'Documento como aparece no inventário (TIPO + NUMERO)',
  ORIGEM_DEVOLUCAO: 'Origem da devolução nos registros de estoque (NF/devolução do segmento)',
  OUTRA_REFERENCIA: 'Outra referência (só comparada como texto, sem equivalência presumida)',
};

const ORIGENS: readonly DefinicaoTipoDocumento['originType'][] = ['DEVOLUCAO', 'NOTA_FISCAL', 'MANIFESTO', 'OUTRO'];

function CamposInventario({ valor, aoMudar, estrutura, colunaEndereco }: { valor: ParametrosInventario; aoMudar: (p: ParametrosInventario) => void; estrutura: EstruturaArquivo; colunaEndereco: number | null }) {
  const ids = useId();
  const inventarios = useRecurso(`${API_PREFIXO}/inventarios?tamanho=100`, PaginaInventariosSchema);
  const ativos = inventarios.carga?.estado === 'pronto' ? inventarios.carga.dados.items.filter((i) => i.state === 'ATIVO') : [];
  const mudar = (parcial: Partial<ParametrosInventario>) => {
    aoMudar({ ...valor, ...parcial });
  };
  const cores = colunaEndereco === null ? [] : (estrutura.fontColors.find((c) => c.index === colunaEndereco)?.colors ?? []);
  const tipos = valor.documentTypes;
  return (
    <fieldset className="cartao parametros-planilha" data-testid="parametros-inventario">
      <legend className="campo-rotulo">Inventário conferido: identificação e regras</legend>
      <div className="formulario-grade formulario-grade--compacta">
        <label className="campo">
          <span className="campo-rotulo">Versão do inventário *</span>
          <input value={valor.description} maxLength={200} onChange={(e) => { mudar({ description: e.target.value }); }} placeholder="ex.: definitivo conferido em 28/09" data-testid="param-descricao" />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Referência da conferência *</span>
          <input value={valor.countReference} maxLength={120} onChange={(e) => { mudar({ countReference: e.target.value }); }} data-testid="param-referencia-conferencia" />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Data da conferência (se informada)</span>
          <input type="date" value={valor.countDate ?? ''} onChange={(e) => { mudar({ countDate: e.target.value === '' ? null : e.target.value }); }} data-testid="param-data-conferencia" />
          <span className="campo-ajuda">Não é deduzida da data do envio nem do nome da aba.</span>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Fonte da conferência</span>
          <input value={valor.countSource ?? ''} maxLength={200} onChange={(e) => { mudar({ countSource: textoOuNulo(e.target.value) }); }} placeholder="ex.: equipe do turno A" />
        </label>
      </div>
      <label className="opcao">
        <input type="checkbox" checked={valor.definitive} onChange={(e) => { mudar({ definitive: e.target.checked }); }} data-testid="param-definitivo" />
        Este é o arquivo que a operação identificou como versão definitiva (o modelo de estrutura não serve para gravar estoque).
      </label>
      <fieldset className="campo">
        <legend className="campo-rotulo">Significado do N° Pallet</legend>
        <label className="opcao">
          <input type="radio" name={`${ids}-npallet`} checked={valor.palletNumberMeaning === 'IDENTIFICADOR_PALETE'} onChange={() => { mudar({ palletNumberMeaning: 'IDENTIFICADOR_PALETE' }); }} data-testid="param-npallet-palete" />
          Identifica o palete (código permanente; QR existentes são preservados)
        </label>
        <label className="opcao">
          <input type="radio" name={`${ids}-npallet`} checked={valor.palletNumberMeaning === 'NUMERACAO_POSICAO'} onChange={() => { mudar({ palletNumberMeaning: 'NUMERACAO_POSICAO' }); }} data-testid="param-npallet-posicao" />
          Numera a posição (a identidade do palete é resolvida pelo endereço)
        </label>
        {valor.palletNumberMeaning === null && <span className="campo-ajuda pendente">Ainda não confirmado: a prévia mostra, mas a confirmação exige a escolha.</span>}
      </fieldset>
      <fieldset className="campo">
        <legend className="campo-rotulo">Endereço livre (convenção vigente)</legend>
        {cores.length > 0 ? (
          <div className="opcoes-cor">
            {cores.map((c) => (
              <label key={c.color} className="opcao">
                <input
                  type="checkbox"
                  checked={valor.freeAddressFontColors.includes(c.color)}
                  onChange={(e) => {
                    mudar({ freeAddressFontColors: e.target.checked ? [...valor.freeAddressFontColors, c.color] : valor.freeAddressFontColors.filter((x) => x !== c.color) });
                  }}
                  data-testid={`param-cor-${c.color}`}
                />
                <span className="amostra-cor" style={{ background: `#${c.color.slice(2)}` }} aria-hidden="true" /> Fonte {c.color} na coluna do endereço ({c.cells} célula(s)) significa endereço livre
              </label>
            ))}
          </div>
        ) : (
          <span className="campo-ajuda">{colunaEndereco === null ? 'Escolha a coluna do endereço (RUA) para ver as cores de fonte.' : 'Nenhuma cor de fonte gravada na coluna do endereço (formatação condicional não é avaliada).'}</span>
        )}
        <label className="campo">
          <span className="campo-rotulo">Valores da coluna "Situação do endereço" que significam livre (CSV)</span>
          <input defaultValue={valor.freeAddressValues.join(', ')} onBlur={(e) => { mudar({ freeAddressValues: lista(e.target.value) }); }} placeholder="ex.: LIVRE" />
        </label>
        <span className="campo-ajuda">Só a cor da coluna do endereço conta; o verde da DOCUMENTAÇÃO tem outro significado e não é usado.</span>
      </fieldset>
      <fieldset className="campo">
        <legend className="campo-rotulo">Tipos documentais com definição operacional</legend>
        <span className="campo-ajuda">Sem definição, a sigla (NFD, MI…) não é relacionada à origem dos segmentos de estoque.</span>
        {tipos.map((t, i) => (
          <div key={i} className="formulario-grade formulario-grade--compacta">
            <label className="campo">
              <span className="campo-rotulo">Sigla</span>
              <input value={t.code} maxLength={20} onChange={(e) => { mudar({ documentTypes: tipos.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)) }); }} />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Significado confirmado</span>
              <input value={t.meaning} maxLength={200} onChange={(e) => { mudar({ documentTypes: tipos.map((x, j) => (j === i ? { ...x, meaning: e.target.value } : x)) }); }} />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Origem nos registros</span>
              <select value={t.originType} onChange={(e) => { mudar({ documentTypes: tipos.map((x, j) => (j === i ? { ...x, originType: e.target.value as DefinicaoTipoDocumento['originType'] } : x)) }); }}>
                {ORIGENS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="botao-link" onClick={() => { mudar({ documentTypes: tipos.filter((_, j) => j !== i) }); }}>
              Remover
            </button>
          </div>
        ))}
        {tipos.length < 20 && (
          <button type="button" className="botao-secundario botao-compacto" onClick={() => { mudar({ documentTypes: [...tipos, { code: '', meaning: '', originType: 'DEVOLUCAO' }] }); }}>
            Acrescentar definição
          </button>
        )}
      </fieldset>
      <div className="formulario-grade formulario-grade--compacta">
        <label className="campo">
          <span className="campo-rotulo">Versão nova de um inventário (revisão com diferenças)</span>
          <select value={valor.replacesInventoryId ?? ''} onChange={(e) => { mudar({ replacesInventoryId: e.target.value === '' ? null : e.target.value, complementsInventoryId: null }); }}>
            <option value="">Não: inventário novo</option>
            {ativos.map((i) => (
              <option key={i.id} value={i.id}>
                {i.code} — {i.description}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Reapresentar pendências corrigidas de</span>
          <select value={valor.complementsInventoryId ?? ''} onChange={(e) => { mudar({ complementsInventoryId: e.target.value === '' ? null : e.target.value, replacesInventoryId: null }); }}>
            <option value="">Não</option>
            {ativos.map((i) => (
              <option key={i.id} value={i.id}>
                {i.code} — {i.totals.pending} pendência(s)
              </option>
            ))}
          </select>
        </label>
      </div>
    </fieldset>
  );
}

function CamposSelecao({ valor, aoMudar }: { valor: ParametrosSelecao; aoMudar: (p: ParametrosSelecao) => void }) {
  const ids = useId();
  const inventarios = useRecurso(`${API_PREFIXO}/inventarios?tamanho=100`, PaginaInventariosSchema);
  const selecoes = useRecurso(`${API_PREFIXO}/selecoes?tamanho=100`, PaginaSelecoesSchema);
  const listaInventarios = inventarios.carga?.estado === 'pronto' ? inventarios.carga.dados.items : [];
  const listaSelecoes = selecoes.carga?.estado === 'pronto' ? selecoes.carga.dados.items.filter((s) => s.state === 'REGISTRADA') : [];
  const mudar = (parcial: Partial<ParametrosSelecao>) => {
    aoMudar({ ...valor, ...parcial });
  };
  return (
    <fieldset className="cartao parametros-planilha" data-testid="parametros-selecao">
      <legend className="campo-rotulo">Seleção do cliente: modalidade e significado</legend>
      <fieldset className="campo">
        <legend className="campo-rotulo">Modalidade</legend>
        <label className="opcao">
          <input type="radio" name={`${ids}-modo`} checked={valor.mode === 'LISTA'} onChange={() => { mudar({ mode: 'LISTA' }); }} data-testid="param-modo-lista" />
          Lista já selecionada: cada linha é uma solicitação
        </label>
        <label className="opcao">
          <input type="radio" name={`${ids}-modo`} checked={valor.mode === 'MARCACAO'} onChange={() => { mudar({ mode: 'MARCACAO' }); }} data-testid="param-modo-marcacao" />
          Inventário com marcação: só as linhas com os valores abaixo na coluna de decisão
        </label>
      </fieldset>
      {valor.mode === 'MARCACAO' && (
        <label className="campo">
          <span className="campo-rotulo">Valores que significam seleção *</span>
          <input defaultValue={valor.markValues.join(', ')} onBlur={(e) => { mudar({ markValues: lista(e.target.value) }); }} placeholder="ex.: SIM, X" data-testid="param-valores-marcacao" />
          <span className="campo-ajuda">Vazio ou outro texto não é aprovação: a prévia mostra as linhas incluídas e as que ficaram fora.</span>
        </label>
      )}
      <div className="formulario-grade formulario-grade--compacta">
        <label className="campo">
          <span className="campo-rotulo">Referência do pedido *</span>
          <input value={valor.orderReference} maxLength={80} onChange={(e) => { mudar({ orderReference: e.target.value }); }} data-testid="param-pedido" />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Versão informada pelo cliente</span>
          <input value={valor.orderVersionLabel ?? ''} maxLength={40} onChange={(e) => { mudar({ orderVersionLabel: textoOuNulo(e.target.value) }); }} />
        </label>
        <label className="campo">
          <span className="campo-rotulo">Inventário de referência</span>
          <select value={valor.inventoryId ?? ''} onChange={(e) => { mudar({ inventoryId: e.target.value === '' ? null : e.target.value }); }} data-testid="param-inventario">
            <option value="">Nenhum (só registros atuais)</option>
            {listaInventarios.map((i) => (
              <option key={i.id} value={i.id}>
                {i.code} — {i.description}
                {i.state === 'SUBSTITUIDO' ? ' (substituído)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Versão substitutiva de</span>
          <select value={valor.replacesSelectionId ?? ''} onChange={(e) => { mudar({ replacesSelectionId: e.target.value === '' ? null : e.target.value }); }} data-testid="param-substitui">
            <option value="">Não: pedido novo</option>
            {listaSelecoes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — pedido {s.orderReference} (v{s.orderVersion})
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="campo">
        <span className="campo-rotulo">Significado da coluna NF</span>
        <select value={valor.documentContext} onChange={(e) => { mudar({ documentContext: ContextoDocumentoSelecaoSchema.parse(e.target.value) }); }} data-testid="param-contexto-nf">
          {ContextoDocumentoSelecaoSchema.options.map((c) => (
            <option key={c} value={c}>
              {ROTULOS_CONTEXTO[c]}
            </option>
          ))}
        </select>
        <span className="campo-ajuda">Números iguais de contextos diferentes não são equivalentes.</span>
      </label>
      <div className="formulario-grade formulario-grade--compacta">
        <label className="campo">
          <span className="campo-rotulo">Tipo documental quando a coluna não existe</span>
          <input value={valor.defaultDocumentType ?? ''} maxLength={20} onChange={(e) => { mudar({ defaultDocumentType: textoOuNulo(e.target.value.toUpperCase()) }); }} placeholder="ex.: NFD (vazio = não informado)" />
        </label>
        <label className="campo">
          <span className="campo-rotulo">NF sem quantidade</span>
          <select value={valor.documentWithoutQuantity} onChange={(e) => { mudar({ documentWithoutQuantity: e.target.value === 'TODO_MATERIAL_DO_INVENTARIO' ? 'TODO_MATERIAL_DO_INVENTARIO' : 'PENDENTE' }); }} data-testid="param-nf-sem-quantidade">
            <option value="PENDENTE">Quantidade pendente (não vira zero nem quantidade fiscal)</option>
            <option value="TODO_MATERIAL_DO_INVENTARIO">Todo o material da NF que constava no inventário (regra configurada)</option>
          </select>
        </label>
        <label className="campo">
          <span className="campo-rotulo">Linhas repetidas</span>
          <select
            value={valor.duplicates ?? ''}
            onChange={(e) => { mudar({ duplicates: e.target.value === 'AGRUPAR_IDENTICAS' ? 'AGRUPAR_IDENTICAS' : e.target.value === 'MANTER_SEPARADAS' ? 'MANTER_SEPARADAS' : null }); }}
            data-testid="param-duplicidade"
          >
            <option value="">Decidir depois de ver a prévia</option>
            <option value="AGRUPAR_IDENTICAS">Agrupar as idênticas (sem somar quantidades)</option>
            <option value="MANTER_SEPARADAS">Manter separadas (linhas distintas)</option>
          </select>
        </label>
      </div>
    </fieldset>
  );
}

export function ParametrosTipo({
  tipo,
  valor,
  aoMudar,
  estrutura,
  colunas,
}: {
  tipo: TipoImportacao;
  valor: ParametrosPlanilha | null;
  aoMudar: (p: ParametrosPlanilha) => void;
  estrutura: EstruturaArquivo;
  colunas: Readonly<Record<string, number | null>>;
}) {
  if (valor === null) return null;
  if (tipo === 'INVENTARIO') return <CamposInventario valor={valor as ParametrosInventario} aoMudar={aoMudar} estrutura={estrutura} colunaEndereco={colunas.address ?? null} />;
  if (tipo === 'SELECAO_CLIENTE') return <CamposSelecao valor={valor as ParametrosSelecao} aoMudar={aoMudar} />;
  return null;
}
