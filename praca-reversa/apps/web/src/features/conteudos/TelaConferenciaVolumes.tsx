import {
  API_PREFIXO,
  AlterarConteudoSchema,
  ConteudosPaleteSchema,
  PaleteDetalheSchema,
  RegistrarContagemSchema,
  TipoDocumentoConteudoSchema,
  type ConteudoPalete,
  type ConteudosPalete,
  type Permissao,
} from '@praca-reversa/contracts';
import { useState } from 'react';
import { ehConflitoDeVersao, useChaves } from '../../api/chaves';
import { enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar } from '../../components/Icones';
import { MensagemAcao, Pagina } from '../../components/Moldura';
import { useConectado } from '../../hooks/ambiente';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { ConferenciaTabela } from './ConferenciaTabela';
import { identificacaoPendente, textoConferencia, textoDelivery, textoDocumento, textoVolumesConteudo } from './textos';

type Mensagem = { tipo: 'ok' | 'erro' | 'conflito'; texto: string } | null;
type Modo = 'contar' | 'feita' | 'identificar' | null;

interface Envio {
  ocupado: boolean;
  enviar: (assinatura: string, metodo: 'POST' | 'PUT', caminho: string, corpo: unknown, sucesso: string) => Promise<boolean>;
}

const inteiro = (texto: string): number | null => (/^\d{1,6}$/.test(texto.trim()) ? Number(texto.trim()) : null);

/** Um conteúdo do palete com as ações da conferência de volumes. */
function ItemConteudo({ c, podeContar, podeIdentificar, envio }: { c: ConteudoPalete; podeContar: boolean; podeIdentificar: boolean; envio: Envio }) {
  const [modo, setModo] = useState<Modo>(null);
  const [contador, setContador] = useState(0);
  const [contados, setContados] = useState('');
  const [previstos, setPrevistos] = useState('');
  const [referencia, setReferencia] = useState('');
  const [ident, setIdent] = useState({ remetente: c.sender ?? '', tipo: c.documentType ?? '', numero: c.documentNumber ?? '', delivery: c.delivery ?? '', descricao: c.description ?? '' });
  const volumes = textoVolumesConteudo(c);
  const alvo = { kind: c.kind, id: c.id };

  const registrar = async (origem: 'CONTAGEM_FISICA' | 'CONTAGEM_INFORMADA', n: number, previsto: number | null, ref: string) => {
    const corpo = { target: alvo, counted: n, expected: previsto, origin: origem, reference: ref };
    if (!RegistrarContagemSchema.safeParse(corpo).success) return;
    const ok = await envio.enviar(`contagem:${c.id}:${JSON.stringify(corpo)}`, 'POST', '/contagens', corpo, 'Contagem registrada.');
    if (ok) setModo(null);
  };

  return (
    <li className="cartao conteudo-item" data-testid="conteudo-item" data-id={c.id} data-kind={c.kind}>
      <div className="conteudo-item-topo">
        <p className="conteudo-item-remetente">{c.sender ?? 'Remetente não informado'}</p>
        <span className={c.count.state === 'AGUARDANDO' ? 'selo selo-alerta' : 'selo selo-ok'} data-testid="conteudo-conferencia">
          {textoConferencia(c)}
        </span>
        {identificacaoPendente(c) && (
          <span className="selo selo-divergencia" data-testid="conteudo-identificacao-pendente">
            Identificação pendente
          </span>
        )}
      </div>
      <dl className="situacao">
        <div>
          <dt>Documento</dt>
          <dd className={c.documentNumber === null ? 'pendente' : undefined} data-testid="conteudo-documento">
            {textoDocumento(c)}
          </dd>
        </div>
        {c.senderCnpj !== null && (
          <div>
            <dt>CNPJ remetente</dt>
            <dd data-testid="conteudo-cnpj">{c.senderCnpj}</dd>
          </div>
        )}
        <div>
          <dt>Delivery</dt>
          <dd className={c.delivery === null ? 'pendente' : undefined} data-testid="conteudo-delivery">
            {textoDelivery(c)}
          </dd>
        </div>
        <div>
          <dt>Volumes</dt>
          <dd className={volumes.situacao === 'pendente' ? 'pendente' : undefined} data-testid="conteudo-volumes">
            {volumes.texto}
            {volumes.legenda !== null && <span className="tabela-nota"> ({volumes.legenda})</span>}
          </dd>
        </div>
        {c.count.state === 'REALIZADA' && c.count.at !== null && (
          <div>
            <dt>Contagem</dt>
            <dd className="tabela-nota">
              {formatarDataHora(c.count.at)}
              {c.count.by !== null && ` · ${c.count.by}`}
              {c.count.reference !== null && ` · ${c.count.reference}`}
            </dd>
          </div>
        )}
        {c.source !== null && (
          <div>
            <dt>Origem</dt>
            <dd className="tabela-nota">{c.source}</dd>
          </div>
        )}
      </dl>
      {modo === null && (
        <div className="acoes-linha">
          {podeContar && (
            <>
              <button
                type="button"
                className="botao-primario"
                onClick={() => {
                  setContador(0);
                  setModo('contar');
                }}
                data-testid="contar-volumes"
              >
                {c.count.state === 'REALIZADA' ? 'Recontar volumes' : 'Contar volumes'}
              </button>
              <button
                type="button"
                className="botao-secundario"
                onClick={() => {
                  setContados('');
                  setPrevistos('');
                  setReferencia('');
                  setModo('feita');
                }}
                data-testid="contagem-feita"
              >
                Registrar contagem já feita
              </button>
            </>
          )}
          {podeIdentificar && c.kind === 'REGISTRADO' && (
            <button
              type="button"
              className="botao-link"
              onClick={() => {
                setModo('identificar');
              }}
              data-testid="completar-identificacao"
            >
              {identificacaoPendente(c) ? 'Completar identificação' : 'Corrigir identificação'}
            </button>
          )}
        </div>
      )}
      {modo === 'contar' && (
        <div className="contador-volumes" data-testid="contador-volumes">
          <p className="campo-rotulo">Conte os volumes deste conteúdo no palete</p>
          <div className="contador-linha">
            <button type="button" className="botao-secundario botao-icone" aria-label="Menos um volume" onClick={() => { setContador((n) => Math.max(0, n - 1)); }}>
              −
            </button>
            <input
              className="contador-valor"
              inputMode="numeric"
              aria-label="Volumes contados"
              value={String(contador)}
              onChange={(e) => {
                const n = inteiro(e.target.value === '' ? '0' : e.target.value);
                if (n !== null) setContador(n);
              }}
              data-testid="contador-valor"
            />
            <button type="button" className="botao-primario botao-icone" aria-label="Mais um volume" onClick={() => { setContador((n) => n + 1); }} data-testid="contador-mais">
              +
            </button>
          </div>
          <div className="acoes-linha">
            <button type="button" className="botao-primario" disabled={envio.ocupado} onClick={() => void registrar('CONTAGEM_FISICA', contador, null, '')} data-testid="concluir-contagem">
              Concluir contagem ({contador} {contador === 1 ? 'volume' : 'volumes'})
            </button>
            <button type="button" className="botao-link" onClick={() => { setModo(null); }}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {modo === 'feita' && (
        <form
          className="formulario-coluna"
          onSubmit={(e) => {
            e.preventDefault();
            const n = inteiro(contados);
            if (n === null) return;
            void registrar('CONTAGEM_INFORMADA', n, previstos.trim() === '' ? null : inteiro(previstos), referencia);
          }}
          data-testid="form-contagem-feita"
        >
          <div className="formulario-grade">
            <label className="campo">
              <span className="campo-rotulo">Volumes contados</span>
              <input inputMode="numeric" value={contados} required onChange={(e) => { setContados(e.target.value); }} data-testid="contagem-contados" />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Volumes previstos (se o documento informar)</span>
              <input inputMode="numeric" value={previstos} onChange={(e) => { setPrevistos(e.target.value); }} data-testid="contagem-previstos" />
            </label>
          </div>
          <label className="campo">
            <span className="campo-rotulo">Referência da contagem (opcional)</span>
            <input value={referencia} maxLength={200} placeholder="Ex.: contagem do turno da manhã" onChange={(e) => { setReferencia(e.target.value); }} />
          </label>
          <div className="acoes-linha">
            <button
              type="submit"
              className="botao-primario"
              disabled={envio.ocupado || inteiro(contados) === null || (previstos.trim() !== '' && inteiro(previstos) === null)}
              data-testid="registrar-contagem"
            >
              Registrar contagem
            </button>
            <button type="button" className="botao-link" onClick={() => { setModo(null); }}>
              Cancelar
            </button>
          </div>
        </form>
      )}
      {modo === 'identificar' && (
        <form
          className="formulario-coluna"
          onSubmit={(e) => {
            e.preventDefault();
            const corpo = {
              expectedVersion: c.version,
              sender: ident.remetente,
              documentType: ident.tipo === '' ? null : ident.tipo,
              documentNumber: ident.numero,
              delivery: ident.delivery,
              description: ident.descricao,
            };
            if (!AlterarConteudoSchema.safeParse(corpo).success) return;
            void envio.enviar(`identificar:${c.id}:${JSON.stringify(corpo)}`, 'PUT', `/${c.id}`, corpo, 'Identificação atualizada; a contagem continua a mesma.').then((ok) => {
              if (ok) setModo(null);
            });
          }}
          data-testid="form-identificacao"
        >
          <div className="formulario-grade">
            <label className="campo">
              <span className="campo-rotulo">Remetente</span>
              <input value={ident.remetente} maxLength={200} required onChange={(e) => { setIdent({ ...ident, remetente: e.target.value }); }} />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Tipo de documento</span>
              <select value={ident.tipo} disabled={c.fromBipagem} onChange={(e) => { setIdent({ ...ident, tipo: e.target.value }); }} data-testid="identificacao-tipo">
                <option value="">Sem documento identificado</option>
                {TipoDocumentoConteudoSchema.options.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span className="campo-rotulo">Número do documento</span>
              <input value={ident.numero} maxLength={60} readOnly={c.fromBipagem} onChange={(e) => { setIdent({ ...ident, numero: e.target.value }); }} data-testid="identificacao-numero" />
            </label>
            {c.fromBipagem && <p className="campo-ajuda">Tipo, número e CNPJ vêm da bipagem e identificam o documento; complete Delivery ou corrija o remetente.</p>}
            <label className="campo">
              <span className="campo-rotulo">Delivery</span>
              <input value={ident.delivery} maxLength={60} onChange={(e) => { setIdent({ ...ident, delivery: e.target.value }); }} data-testid="identificacao-delivery" />
            </label>
          </div>
          <div className="acoes-linha">
            <button type="submit" className="botao-primario" disabled={envio.ocupado || ident.remetente.trim() === ''} data-testid="salvar-identificacao">
              Salvar identificação
            </button>
            <button type="button" className="botao-link" onClick={() => { setModo(null); }}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

/**
 * Conferência de volumes do palete (out. 2026): para cada conteúdo
 * (registrado ou importado), contar agora ou registrar uma contagem já feita.
 * Sem contagem = aguardando conferência; a identificação pendente aparece à
 * parte e não impede a contagem. Nada aqui altera estoque, reserva ou posição.
 */
export function TelaConferenciaVolumes({ id, permissoes, aoNavegar, aoGravar }: { id: string; permissoes: readonly Permissao[]; aoNavegar: Navegar; aoGravar: () => void }) {
  const url = `${API_PREFIXO}/paletes/${id}/conteudos`;
  const palete = useRecurso(`${API_PREFIXO}/paletes/${id}`, PaleteDetalheSchema);
  const { carga, recarregar } = useRecurso(url, ConteudosPaleteSchema);
  const chaves = useChaves();
  const conectado = useConectado();
  const [atualizado, setAtualizado] = useState<ConteudosPalete | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const dados = atualizado ?? (carga?.estado === 'pronto' ? carga.dados : null);
  const p = palete.carga?.estado === 'pronto' ? palete.carga.dados : null;
  const pode = (x: Permissao) => permissoes.includes(x);

  async function enviar(assinatura: string, metodo: 'POST' | 'PUT', caminho: string, corpo: unknown, sucesso: string): Promise<boolean> {
    if (!conectado) {
      setMensagem({ tipo: 'erro', texto: 'Sem conexão: nada é registrado. Tente quando a rede voltar.' });
      return false;
    }
    setOcupado(true);
    setMensagem(null);
    try {
      setAtualizado(await enviarJson(metodo, `${url}${caminho}`, ConteudosPaleteSchema, { corpo, idempotencia: chaves.para(assinatura) }));
      chaves.concluir(assinatura);
      setMensagem({ tipo: 'ok', texto: sucesso });
      aoGravar();
      return true;
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      setMensagem({ tipo: ehConflitoDeVersao(erro) ? 'conflito' : 'erro', texto: mensagemDeFalha(erro) });
      if (ehConflitoDeVersao(erro)) {
        setAtualizado(null);
        recarregar();
      }
      return false;
    } finally {
      setOcupado(false);
    }
  }

  const aguardando = dados?.items.filter((i) => i.count.state === 'AGUARDANDO').length ?? 0;
  return (
    <Pagina
      titulo="Conferência de volumes"
      testId="tela-conferencia-volumes"
      aoVoltar={() => {
        aoNavegar({ tipo: 'palete', id });
      }}
      rotuloVoltar="Voltar ao palete"
      descricao={<p>Confira o palete inteiro numa tabela: confirme todos sem diferença, registre só as diferenças ou marque a parte conferida. A quantidade contada passa a ser a atual; a anterior e a diferença ficam no histórico.</p>}
    >
      <section className="cartao" data-testid="volumes-palete">
        <p>
          Palete <strong className="sucesso-codigo">{p?.code ?? '…'}</strong>
          {p !== null && <span className="campo-ajuda"> · {p.positionCode === null ? 'sem posição registrada' : `posição ${p.positionCode}`}</span>}
        </p>
        {dados !== null && (
          <p className="campo-ajuda" data-testid="volumes-resumo">
            {dados.items.length} conteúdo(s) · {aguardando} aguardando conferência · {dados.documents} documento(s) identificado(s)
            {dados.withoutDocument > 0 && ` · ${String(dados.withoutDocument)} sem documento`}
          </p>
        )}
        {pode('palete.cadastrar') && (
          <button
            type="button"
            className="botao-secundario"
            onClick={() => {
              aoNavegar({ tipo: 'novo-conteudo', palete: id });
            }}
            data-testid="volumes-registrar-conteudo"
          >
            Registrar conteúdo
          </button>
        )}
      </section>
      {pode('conferencia.registrar') && (
        <section className="cartao" data-testid="volumes-tabela">
          <ConferenciaTabela
            paleteId={id}
            paleteCodigo={p?.code ?? '…'}
            aoCancelar={() => {
              aoNavegar({ tipo: 'palete', id });
            }}
            aoConcluir={() => {
              // Gravado: volta ao palete no mapa, que mostra o que ficou no banco.
              aoGravar();
              aoNavegar({ tipo: 'palete', id });
            }}
            aoReconferido={() => {
              aoGravar();
              aoNavegar({ tipo: 'palete', id });
            }}
          />
        </section>
      )}
      <h2 className="secao-titulo">Identificação dos conteúdos</h2>
      <MensagemAcao mensagem={mensagem} testId="mensagem-volumes" />
      {carga?.estado === 'erro' && atualizado === null && (
        <div className="estado-erro" role="alert">
          <p>Não foi possível carregar o conteúdo do palete. {carga.mensagem}</p>
          <button type="button" className="botao-secundario" onClick={recarregar}>
            <IconeAtualizar />
            Tentar novamente
          </button>
        </div>
      )}
      {dados === null && carga?.estado !== 'erro' && <p className="estado-carregando">Carregando conteúdo…</p>}
      {dados !== null && dados.items.length === 0 && (
        <p className="estado-vazio" data-testid="volumes-vazio">
          Nenhum conteúdo neste palete ainda. Importe a bipagem ou registre o conteúdo recebido.
        </p>
      )}
      {dados !== null && dados.items.length > 0 && (
        <ul className="lista-conteudos">
          {dados.items.map((c) => (
            <ItemConteudo key={`${c.id}:${String(c.version)}:${c.count.at ?? ''}`} c={c} podeContar={false} podeIdentificar={pode('palete.cadastrar')} envio={{ ocupado, enviar }} />
          ))}
        </ul>
      )}
    </Pagina>
  );
}
