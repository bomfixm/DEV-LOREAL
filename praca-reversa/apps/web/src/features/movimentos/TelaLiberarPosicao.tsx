import { API_PREFIXO, PaleteDetalheSchema, ResultadoMovimentoSchema, type ResultadoMovimento, type Sessao } from '@praca-reversa/contracts';
import { useState } from 'react';
import { enviarJson } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { IconeAtualizar, IconeVoltar } from '../../components/Icones';
import type { Navegar } from '../../rotas';
import { formatarDataHora } from '../../utils/datas';
import { AvisoMovimento, SemConexaoMovimento } from './comum';
import { useEnvio, useUltimo } from './use-envio';
import type { Aviso } from './regras';
import { Carregando } from '../../components/carregamento/Carregando';

interface Props {
  id: string;
  sessao: Sessao;
  aoNavegar: Navegar;
  aoGravar: () => void;
}

const MOTIVOS = ['Palete não está nesta posição', 'Posição registrada por engano', 'Palete já saiu da praça'];

/**
 * Liberar posição: o palete não está fisicamente no endereço registrado. Tira
 * só o vínculo de endereço (o palete fica em "localização pendente"); o
 * cadastro, o conteúdo e a conferência não mudam e nada é arquivado, então
 * vale também para conteúdo desconhecido. Decide o servidor.
 */
export function TelaLiberarPosicao({ id, sessao, aoNavegar, aoGravar }: Props) {
  const [versao, setVersao] = useState(0);
  const carga = useRecurso(`${API_PREFIXO}/paletes/${id}`, PaleteDetalheSchema, versao);
  const palete = useUltimo(carga.carga);
  const [motivo, setMotivo] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [resultado, setResultado] = useState<ResultadoMovimento | null>(null);
  const envio = useEnvio();
  const voltar = () => {
    aoNavegar({ tipo: 'palete', id });
  };

  if (palete === null) {
    const erro = carga.carga?.estado === 'erro' ? carga.carga : null;
    return (
      <main className="principal principal--pagina" data-testid="tela-liberar">
        <div className="pagina-conteudo">
          {erro ? (
            <div className="estado-erro estado-tela" role="alert">
              <h2>{erro.status === 404 ? 'Palete não encontrado' : 'Não foi possível carregar o palete'}</h2>
              <p>{erro.status === 404 ? 'Ele não existe no escopo ativo ou você não tem acesso a ele.' : erro.mensagem}</p>
              <button type="button" className="botao-primario" onClick={() => { setVersao((v) => v + 1); }}>
                <IconeAtualizar />
                Tentar novamente
              </button>
            </div>
          ) : (
            <Carregando mensagem="Carregando palete…" variante="principal" />
          )}
        </div>
      </main>
    );
  }

  if (resultado !== null) {
    return (
      <main className="principal principal--pagina" data-testid="tela-liberar">
        <div className="pagina-conteudo">
          <section className="cartao cartao-sucesso" role="status" data-testid="liberacao-confirmada">
            <h2>Posição liberada</h2>
            <p>
              A posição <strong>{resultado.event.from?.code ?? '—'}</strong> ficou livre em {formatarDataHora(resultado.event.at)} (horário de Brasília). O palete{' '}
              <strong>{resultado.pallet.code}</strong> continua cadastrado, com localização pendente.
            </p>
            <p className="bloco-nota">Conteúdo e conferência não mudaram. Para dar um novo endereço ao palete, use “Mover palete”.</p>
            <div className="acoes-linha">
              <button type="button" className="botao-primario" onClick={() => { aoNavegar({ tipo: 'praca' }); }}>
                Voltar ao mapa
              </button>
              <button type="button" className="botao-secundario" onClick={() => { aoNavegar({ tipo: 'mover', id }); }}>
                Mover palete
              </button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const impedimentos: string[] = [];
  if (palete.archived !== null) impedimentos.push('Cadastro arquivado: não tem posição.');
  if (palete.flowState === 'EXPEDIDO') impedimentos.push('Palete expedido: já saiu da praça.');
  if (palete.activeCountId !== null) impedimentos.push('Há conferência em andamento neste palete: conclua ou cancele antes.');
  if (palete.positionId === null && palete.archived === null) impedimentos.push('O palete não ocupa posição: não há endereço a liberar.');
  const motivoValido = motivo.trim().length >= 3;
  const pronto = impedimentos.length === 0 && motivoValido && confirmado && envio.conectado && !envio.enviando;

  function confirmar() {
    if (palete === null) return;
    const corpo = { expectedVersion: palete.version, reason: motivo.trim(), confirmChecked: true as const };
    setAviso(null);
    void envio.enviar(
      `liberar:${id}:${JSON.stringify(corpo)}`,
      (chave) => enviarJson('POST', `${API_PREFIXO}/paletes/${id}/liberar-posicao`, ResultadoMovimentoSchema, { corpo, idempotencia: chave, descricao: `Liberar posição do palete ${palete.code}` }),
      (r) => {
        if (r.ok) {
          setResultado(r.dados);
          aoGravar();
          return;
        }
        setAviso(r.aviso);
        if (!r.aviso.incerto) {
          setConfirmado(false);
          setVersao((v) => v + 1);
        }
      },
    );
  }

  return (
    <main className="principal principal--pagina" data-testid="tela-liberar">
      <div className="pagina-conteudo tela-movimento">
        <header className="pagina-topo">
          <button type="button" className="botao-voltar" onClick={voltar}>
            <IconeVoltar />
            Palete {palete.code}
          </button>
          <h2>Liberar posição {palete.positionCode ?? ''}</h2>
          <p className="bloco-nota">
            Use quando o palete {palete.code} não está (mais) nesta posição. O palete continua cadastrado, com localização pendente; conteúdo e conferência não mudam.
          </p>
        </header>
        <section className="cartao" aria-labelledby="liberar-palete">
          <h3 id="liberar-palete">Palete</h3>
          <dl className="situacao">
            <div>
              <dt>Posição que fica livre</dt>
              <dd data-testid="liberar-endereco">{palete.positionCode ?? 'Sem posição'}</dd>
            </div>
          </dl>
          {impedimentos.length > 0 && (
            <ul className="mensagem-conflito lista-impedimentos" role="alert" data-testid="liberar-impedimentos">
              {impedimentos.map((i) => (
                <li key={i}>{i}</li>
              ))}
            </ul>
          )}
        </section>

        {impedimentos.length === 0 && (
          <section className="cartao previa-movimento" aria-labelledby="liberar-confirmar">
            <h3 id="liberar-confirmar">Motivo e confirmação</h3>
            <label className="campo">
              <span className="campo-rotulo">Motivo</span>
              <input
                value={motivo}
                maxLength={500}
                list="motivos-liberar"
                onChange={(e) => {
                  setMotivo(e.target.value);
                  setConfirmado(false);
                  envio.descartar();
                }}
                data-testid="motivo-liberar"
              />
              <datalist id="motivos-liberar">
                {MOTIVOS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <dl className="situacao">
              <div>
                <dt>Responsável</dt>
                <dd>{sessao.user.name}</dd>
              </div>
            </dl>
            <label className="opcao opcao--destaque">
              <input type="checkbox" checked={confirmado} onChange={(e) => { setConfirmado(e.target.checked); }} data-testid="confirmar-liberar" />
              Conferi no local: o palete {palete.code} não está na posição {palete.positionCode ?? ''}.
            </label>
            {!envio.conectado && <SemConexaoMovimento />}
            <div className="acoes-linha">
              <button type="button" className="botao-primario" disabled={!pronto} onClick={confirmar} data-testid="confirmar-liberacao">
                {envio.enviando ? 'Enviando…' : 'Liberar posição'}
              </button>
              <button type="button" className="botao-link" onClick={voltar}>
                Cancelar
              </button>
            </div>
          </section>
        )}
        <AvisoMovimento aviso={aviso} podeReenviar={envio.temPendente && envio.conectado} enviando={envio.enviando} aoReenviar={envio.reenviar} testId="aviso-liberar" />
      </div>
    </main>
  );
}
