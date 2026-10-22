import {
  API_PREFIXO,
  ListaAuditoriaSchema,
  ListaUsuariosSchema,
  PERFIS,
  PERFIS_APROVACAO_FINANCEIRA,
  PERFIS_SELECAO_TESTE,
  UsuarioAdminSchema,
  type Perfil,
  type Sessao,
  type UsuarioAdmin,
} from '@praca-reversa/contracts';
import { useState, type SubmitEvent } from 'react';
import { useChaves } from '../../api/chaves';
import { enviarJson, mensagemDeFalha } from '../../api/cliente';
import { useRecurso } from '../../api/use-recurso';
import { ROTULOS_PERFIL } from '../../sessao/perfis';
import { formatarDataHora } from '../../utils/datas';

const URL_USUARIOS = `${API_PREFIXO}/admin/usuarios`;
const URL_AUDITORIA = `${API_PREFIXO}/admin/auditoria?limite=50`;

const ROTULOS_ACAO: Record<string, string> = {
  LOGIN_SUCESSO: 'Login',
  LOGIN_FALHA: 'Falha de login',
  LOGIN_BLOQUEADO: 'Login bloqueado por tentativas',
  LOGOUT: 'Saída',
  ESCOPO_ALTERADO: 'Troca de escopo',
  ACESSO_NEGADO: 'Acesso negado',
  USUARIO_CRIADO: 'Usuário criado',
  VINCULO_ALTERADO: 'Vínculo alterado',
  CONTA_DESATIVADA: 'Conta desativada',
  CONTA_REATIVADA: 'Conta reativada',
  ADMIN_BOOTSTRAP: 'Primeiro administrador (comando local)',
  SEED_DEMONSTRACAO: 'Seed de demonstração',
  PRODUTO_CRIADO: 'Produto cadastrado',
  PRODUTO_ALTERADO: 'Produto alterado',
  PALETE_CADASTRADO: 'Palete cadastrado',
  PALETE_ALTERADO: 'Palete alterado',
  PALETE_ARQUIVADO: 'Cadastro de palete arquivado',
  ETIQUETA_EMITIDA: 'Etiqueta emitida',
  LAYOUT_CRIADO: 'Layout criado',
  LAYOUT_ALTERADO: 'Layout alterado',
};

const ROTULOS_RESULTADO = { SUCESSO: 'Sucesso', NEGADO: 'Negado', FALHA: 'Falha' } as const;

interface Props {
  sessao: Sessao;
  aoVoltar: () => void;
}

export function TelaAcesso({ sessao, aoVoltar }: Props) {
  const usuarios = useRecurso(URL_USUARIOS, ListaUsuariosSchema);
  const podeAuditar = sessao.permissions.includes('auditoria.consultar');
  const auditoria = useRecurso(podeAuditar ? URL_AUDITORIA : null, ListaAuditoriaSchema);
  const chaves = useChaves();
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const [novo, setNovo] = useState({ login: '', name: '', initialPassword: '', role: 'CONSULTA' as Perfil });

  async function executar(assinatura: string, acao: (chave: string) => Promise<UsuarioAdmin>, sucesso: (u: UsuarioAdmin) => string) {
    setOcupado(assinatura);
    setMensagem(null);
    try {
      const usuario = await acao(chaves.para(assinatura));
      chaves.concluir(assinatura);
      setMensagem({ tipo: 'ok', texto: sucesso(usuario) });
      usuarios.recarregar();
      auditoria.recarregar();
      return true;
    } catch (erro) {
      chaves.concluir(assinatura, erro);
      setMensagem({ tipo: 'erro', texto: mensagemDeFalha(erro) });
      return false;
    } finally {
      setOcupado(null);
    }
  }

  async function criar(evento: SubmitEvent<HTMLFormElement>) {
    evento.preventDefault();
    const assinatura = `criar:${JSON.stringify(novo)}`;
    const ok = await executar(
      assinatura,
      (chave) => enviarJson('POST', URL_USUARIOS, UsuarioAdminSchema, { corpo: novo, idempotencia: chave }),
      (u) => `Usuário ${u.login} criado com perfil ${ROTULOS_PERFIL[u.role]}. Informe a senha inicial por canal seguro.`,
    );
    if (ok) setNovo({ login: '', name: '', initialPassword: '', role: 'CONSULTA' });
  }

  function alterarVinculo(u: UsuarioAdmin, role: Perfil, active: boolean, financialApproval?: boolean, clientSelectionTest?: boolean) {
    const corpo = { role, active, ...(financialApproval === undefined ? {} : { financialApproval }), ...(clientSelectionTest === undefined ? {} : { clientSelectionTest }) };
    void executar(
      `vinculo:${u.id}:${JSON.stringify(corpo)}`,
      (chave) => enviarJson('PUT', `${URL_USUARIOS}/${u.id}/vinculo`, UsuarioAdminSchema, { corpo, idempotencia: chave }),
      (r) =>
        `Vínculo de ${r.login} atualizado: ${ROTULOS_PERFIL[r.role]}, ${r.membershipActive ? 'ativo' : 'inativo'}${r.financialApproval ? ', com aprovação financeira de claims' : ''}${r.clientSelectionTest ? ', com acesso à Seleção cliente — teste' : ''}.`,
    );
  }

  function alterarConta(u: UsuarioAdmin, active: boolean) {
    void executar(
      `conta:${u.id}:${String(active)}`,
      (chave) => enviarJson('PATCH', `${URL_USUARIOS}/${u.id}/conta`, UsuarioAdminSchema, { corpo: { active }, idempotencia: chave }),
      (r) => `Conta de ${r.login} ${r.accountActive ? 'reativada' : 'desativada; sessões abertas foram encerradas'}.`,
    );
  }

  return (
    <main className="principal principal--pagina tela-acesso" data-testid="tela-acesso">
      <div className="pagina-conteudo">
        <header className="pagina-topo">
          <h2>Administração de acesso</h2>
          <p>
            Escopo: <strong>{sessao.activeScope?.name}</strong>. Contas são individuais; o acesso vale apenas para os escopos
            vinculados.
          </p>
          <button type="button" className="botao-secundario" onClick={aoVoltar}>
            Voltar ao mapa
          </button>
        </header>

        {mensagem !== null && (
          <p className={mensagem.tipo === 'ok' ? 'mensagem-ok' : 'estado-erro'} role={mensagem.tipo === 'ok' ? 'status' : 'alert'} data-testid="mensagem-acesso">
            {mensagem.texto}
          </p>
        )}

        <section className="cartao" aria-labelledby="titulo-novo">
          <h3 id="titulo-novo">Novo usuário neste escopo</h3>
          <form
            className="formulario-grade"
            onSubmit={(evento) => {
              void criar(evento);
            }}
          >
            <label className="campo">
              <span className="campo-rotulo">Login</span>
              <input
                name="novo-login"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={novo.login}
                onChange={(e) => {
                  setNovo({ ...novo, login: e.target.value });
                }}
              />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Nome</span>
              <input
                name="novo-nome"
                autoComplete="off"
                required
                value={novo.name}
                onChange={(e) => {
                  setNovo({ ...novo, name: e.target.value });
                }}
              />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Senha inicial (mín. 12 caracteres)</span>
              <input
                name="novo-senha"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={novo.initialPassword}
                onChange={(e) => {
                  setNovo({ ...novo, initialPassword: e.target.value });
                }}
              />
            </label>
            <label className="campo">
              <span className="campo-rotulo">Perfil</span>
              <select
                value={novo.role}
                onChange={(e) => {
                  setNovo({ ...novo, role: e.target.value as Perfil });
                }}
              >
                {PERFIS.map((p) => (
                  <option key={p} value={p}>
                    {ROTULOS_PERFIL[p]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="botao-primario" disabled={ocupado !== null}>
              Criar usuário
            </button>
          </form>
        </section>

        <section className="cartao" aria-labelledby="titulo-usuarios" aria-busy={usuarios.carga?.estado === 'carregando'}>
          <h3 id="titulo-usuarios">Usuários do escopo</h3>
          {usuarios.carga?.estado === 'erro' ? (
            <p className="estado-erro" role="alert">
              {usuarios.carga.mensagem}
            </p>
          ) : usuarios.carga?.estado === 'pronto' ? (
            <ul className="lista-usuarios">
              {usuarios.carga.dados.items.map((u) => {
                const proprio = u.id === sessao.user.id;
                return (
                  <li key={u.id} className="usuario-linha" data-login={u.login}>
                    <div className="usuario-dados">
                      <strong>{u.name}</strong> <code>{u.login}</code>
                      <span className="usuario-situacao">
                        Conta {u.accountActive ? 'ativa' : 'desativada'} · vínculo {u.membershipActive ? 'ativo' : 'inativo'}
                        {u.financialApproval ? ' · aprova resultados de claims' : ''}
                        {u.clientSelectionTest ? ' · Seleção cliente — teste' : ''}
                        {proprio ? ' · você' : ''}
                      </span>
                    </div>
                    <label className="campo campo--compacto">
                      <span className="campo-rotulo">Perfil</span>
                      <select
                        value={u.role}
                        disabled={ocupado !== null || proprio}
                        aria-label={`Perfil de ${u.login}`}
                        onChange={(e) => {
                          alterarVinculo(u, e.target.value as Perfil, u.membershipActive);
                        }}
                      >
                        {PERFIS.map((p) => (
                          <option key={p} value={p}>
                            {ROTULOS_PERFIL[p]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="usuario-acoes">
                      <button
                        type="button"
                        className="botao-secundario"
                        disabled={ocupado !== null || proprio}
                        onClick={() => {
                          alterarVinculo(u, u.role, !u.membershipActive);
                        }}
                      >
                        {u.membershipActive ? 'Desativar vínculo' : 'Reativar vínculo'}
                      </button>
                      {PERFIS_APROVACAO_FINANCEIRA.includes(u.role) && (
                        <button
                          type="button"
                          className="botao-secundario"
                          disabled={ocupado !== null || proprio}
                          onClick={() => {
                            alterarVinculo(u, u.role, u.membershipActive, !u.financialApproval);
                          }}
                          data-testid="alternar-aprovacao-financeira"
                        >
                          {u.financialApproval ? 'Retirar aprovação financeira de claims' : 'Conceder aprovação financeira de claims'}
                        </button>
                      )}
                      {/* Concessão explícita ao responsável interno (pode ser a própria conta do administrador). */}
                      {PERFIS_SELECAO_TESTE.includes(u.role) && (
                        <button
                          type="button"
                          className="botao-secundario"
                          disabled={ocupado !== null}
                          onClick={() => {
                            alterarVinculo(u, u.role, u.membershipActive, undefined, !u.clientSelectionTest);
                          }}
                          data-testid="alternar-selecao-teste"
                        >
                          {u.clientSelectionTest ? 'Retirar acesso à Seleção cliente — teste' : 'Liberar Seleção cliente — teste'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="botao-secundario"
                        disabled={ocupado !== null || proprio}
                        onClick={() => {
                          alterarConta(u, !u.accountActive);
                        }}
                      >
                        {u.accountActive ? 'Desativar conta' : 'Reativar conta'}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="estado-carregando">Carregando usuários…</p>
          )}
        </section>

        {podeAuditar && (
          <section className="cartao" aria-labelledby="titulo-auditoria">
            <h3 id="titulo-auditoria">Auditoria do escopo (últimos 50 eventos)</h3>
            {auditoria.carga?.estado === 'erro' ? (
              <p className="estado-erro" role="alert">
                {auditoria.carga.mensagem}
              </p>
            ) : auditoria.carga?.estado === 'pronto' ? (
              <ol className="lista-auditoria" data-testid="lista-auditoria">
                {auditoria.carga.dados.items.map((e) => (
                  <li key={e.id}>
                    <time dateTime={e.at}>{formatarDataHora(e.at)}</time>
                    <span className="auditoria-acao">{ROTULOS_ACAO[e.action] ?? e.action}</span>
                    <span className={`auditoria-resultado auditoria-resultado--${e.result}`}>{ROTULOS_RESULTADO[e.result]}</span>
                    <span>{e.actor ? e.actor.login : 'sistema/anônimo'}</span>
                    {e.details && <code className="auditoria-detalhes">{JSON.stringify(e.details)}</code>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="estado-carregando">Carregando auditoria…</p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
