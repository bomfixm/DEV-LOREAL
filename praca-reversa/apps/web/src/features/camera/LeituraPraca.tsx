import { API_PREFIXO, IdentificacaoCodigoSchema, interpretarLeitura } from '@praca-reversa/contracts';
import { useRecurso } from '../../api/use-recurso';
import { useConexao } from '../../api/conexao';
import { formatarQuantidade } from '../../utils/numeros';
import { useContextoLeitura } from './contexto';
import { FORMATOS_PRODUTO, type Deteccao } from './deteccao';
import { LeitorCamera, type AcoesLeitura } from './LeitorCamera';

interface Props {
  aoAbrirPalete: (id: string) => void;
  /** Procura o produto lido nos paletes (painel de busca). */
  aoBuscarProduto: ((texto: string) => void) | null;
  aoFechar: () => void;
}

/**
 * "Ler código" no mapa/lista: QR do palete abre o palete (a API confere
 * sessão, escopo e permissão); código de produto/embalagem mostra o cadastro
 * com unidade e fator. Nada é cadastrado nem contado aqui.
 */
export function LeituraPraca({ aoAbrirPalete, aoBuscarProduto, aoFechar }: Props) {
  return (
    <LeitorCamera
      titulo="Ler QR do palete ou código de produto"
      formatos={FORMATOS_PRODUTO}
      aoFechar={aoFechar}
      renderizarResultado={(leitura, acoes) => (
        <ResultadoLeitura key={`${leitura.formato}:${leitura.valor}`} leitura={leitura} acoes={acoes} aoAbrirPalete={aoAbrirPalete} aoBuscarProduto={aoBuscarProduto} />
      )}
    />
  );
}

function ResultadoLeitura({
  leitura,
  acoes,
  aoAbrirPalete,
  aoBuscarProduto,
}: {
  leitura: Deteccao;
  acoes: AcoesLeitura;
  aoAbrirPalete: (id: string) => void;
  aoBuscarProduto: ((texto: string) => void) | null;
}) {
  const contexto = useContextoLeitura();
  const interpretada = interpretarLeitura(leitura.valor, contexto);
  if (interpretada.tipo === 'palete' || interpretada.tipo === 'palete-outra-origem') {
    const { id } = interpretada;
    return (
      <div data-testid="leitura-palete">
        {interpretada.tipo === 'palete' ? (
          <p>QR de palete desta instalação.</p>
        ) : (
          <p className="mensagem-conflito">
            Link de palete com outro endereço ({interpretada.origem}). Por segurança, ele não abre sozinho: abrir aqui consulta o palete pelo identificador nesta
            instalação, com as suas permissões.
          </p>
        )}
        <button
          type="button"
          className="botao-primario"
          onClick={() => {
            acoes.fechar();
            aoAbrirPalete(id);
          }}
          data-testid="abrir-palete-lido"
        >
          Abrir palete
        </button>
      </div>
    );
  }
  if (interpretada.tipo === 'externo') {
    return (
      <p className="mensagem-conflito" data-testid="leitura-externa">
        Endereço externo ou não reconhecido: nada foi aberto nem executado. Texto lido: <span className="texto-quebravel">{interpretada.texto}</span>
      </p>
    );
  }
  if (interpretada.tipo === 'invalido') {
    return <p className="estado-erro">Leitura inválida (vazia, longa demais ou com caracteres de controle).</p>;
  }
  return <ProdutoLido codigo={interpretada.codigo} acoes={acoes} aoBuscarProduto={aoBuscarProduto} />;
}

function ProdutoLido({ codigo, acoes, aoBuscarProduto }: { codigo: string; acoes: AcoesLeitura; aoBuscarProduto: ((texto: string) => void) | null }) {
  const { rede } = useConexao();
  const { carga, recarregar } = useRecurso(`${API_PREFIXO}/produtos/identificar?codigo=${encodeURIComponent(codigo)}`, IdentificacaoCodigoSchema);
  if (carga === null || carga.estado === 'carregando') return <p aria-busy="true">Consultando o cadastro…</p>;
  if (carga.estado === 'erro') {
    if (carga.status === 404) {
      return (
        <p className="mensagem-conflito" data-testid="codigo-desconhecido">
          Código {codigo} não cadastrado neste escopo. Nenhum produto foi criado; na conferência ele pode ser registrado como pendência.
        </p>
      );
    }
    const semResposta = carga.status === null;
    return (
      <div data-testid={semResposta ? 'leitura-pendente-consulta' : 'leitura-erro'}>
        <p className="mensagem-conflito">
          {semResposta
            ? `Código ${codigo} lido e pendente de consulta (${rede === 'sem-conexao' ? 'sem conexão' : 'servidor sem resposta'}). Nada foi identificado nem alterado.`
            : carga.mensagem}
        </p>
        <button type="button" className="botao-secundario botao-compacto" onClick={recarregar}>
          Consultar de novo
        </button>
      </div>
    );
  }
  const p = carga.dados;
  return (
    <div className="cartao-confirmacao" data-testid="produto-lido">
      <p className="confirmacao-produto">
        <strong>{p.sku}</strong> — {p.description}
        {!p.active && <span className="campo-erro"> (inativo no cadastro)</span>}
      </p>
      <dl className="situacao">
        <div>
          <dt>Código</dt>
          <dd>
            <code>{codigo}</code> ({p.match === 'SKU' ? 'SKU' : 'código de barras'})
          </dd>
        </div>
        <div>
          <dt>Embalagem do código</dt>
          <dd data-testid="embalagem-lida">
            {p.packaging}
            {p.factor === null
              ? ' — fator desconhecido: conversão bloqueada'
              : p.packaging === p.canonicalUnit
                ? ' (unidade canônica)'
                : ` = ${formatarQuantidade(p.factor)} ${p.canonicalUnit}`}
          </dd>
        </div>
      </dl>
      <p className="bloco-nota">A leitura não conta nem altera saldo. Para registrar quantidades, abra a conferência do palete e confirme unidade e quantidade lá.</p>
      {aoBuscarProduto !== null && (
        <button
          type="button"
          className="botao-secundario"
          onClick={() => {
            acoes.fechar();
            aoBuscarProduto(p.sku);
          }}
          data-testid="buscar-produto-lido"
        >
          Procurar este produto nos paletes
        </button>
      )}
    </div>
  );
}
