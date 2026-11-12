import { API_PREFIXO, AnaliseBipagemEmbarqueSchema, type AnaliseBipagemEmbarque, type LinhaBipagemEmbarque, type LinhaEmbarqueEntrada, type OrigemBipagemEmbarque } from '@praca-reversa/contracts';
import { useState } from 'react';
import { useChaves } from '../../api/chaves';
import { enviarArquivo, mensagemDeFalha } from '../../api/cliente';

/**
 * Palete fracionado pela bipagem (planilha "Etiquetas" de um palete de embarque).
 * O servidor só lê o arquivo e devolve, por NF, as origens na praça. Aqui a
 * pessoa confere: origem única com saldo vem marcada; com mais de uma, escolhe;
 * sem origem ou sem saldo fica pendente e não entra. "Alocar" usa a criação
 * normal do palete fracionado (o servidor confere saldo e FULL de novo).
 */
const serve = (c: OrigemBipagemEmbarque, volumes: number): boolean => c.onSite && c.fullIn === null && c.available !== null && c.available >= volumes;

function motivoNaoServe(c: OrigemBipagemEmbarque): string {
  if (!c.onSite) return 'fora da praça';
  if (c.fullIn !== null) return `sai FULL em ${c.fullIn}`;
  if (c.available === null) return 'volumes não informados';
  return `só ${String(c.available)} disponível(is)`;
}

const rotuloOrigem = (c: OrigemBipagemEmbarque) => `Palete ${c.palletCode}${c.address === null ? '' : ` · ${c.address}`} · disp. ${c.available === null ? 'n/i' : String(c.available)}`;

export function BipagemEmbarque({ janelaId, ocupado, aoAlocar }: { janelaId: string; ocupado: boolean; aoAlocar: (linhas: LinhaEmbarqueEntrada[]) => void }) {
  const chaves = useChaves();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [analise, setAnalise] = useState<AnaliseBipagemEmbarque | null>(null);
  const [escolhas, setEscolhas] = useState<Record<number, string>>({});
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function ler() {
    if (arquivo === null) return;
    const assinatura = `bipagem-embarque:${janelaId}:${arquivo.name}:${String(arquivo.size)}:${String(arquivo.lastModified)}`;
    setLendo(true);
    setErro(null);
    setAnalise(null);
    try {
      const r = await enviarArquivo(`${API_PREFIXO}/cargas/janelas/${janelaId}/bipagem`, arquivo, arquivo.name, AnaliseBipagemEmbarqueSchema, chaves.para(assinatura));
      chaves.concluir(assinatura);
      setAnalise(r);
      setEscolhas({});
    } catch (e) {
      chaves.concluir(assinatura, e);
      setErro(mensagemDeFalha(e));
    } finally {
      setLendo(false);
    }
  }

  const escolhida = (l: LinhaBipagemEmbarque): OrigemBipagemEmbarque | null => {
    const id = escolhas[l.row] ?? l.suggested ?? '';
    const c = l.candidates.find((x) => x.id === id);
    return c !== undefined && serve(c, l.volumes) ? c : null;
  };
  const linhas = analise?.lines ?? [];
  const prontas = linhas.filter((l) => escolhida(l) !== null);
  const pendentes = linhas.filter((l) => escolhida(l) === null);
  // Mesma NF bipada em duas linhas e a mesma origem: uma linha só, com os volumes somados.
  const porOcorrencia = new Map<string, LinhaEmbarqueEntrada>();
  for (const l of prontas) {
    const c = escolhida(l);
    if (c === null) continue;
    const atual = porOcorrencia.get(c.id);
    porOcorrencia.set(c.id, { occurrence: { kind: c.kind, id: c.id }, volumes: (atual?.volumes ?? 0) + l.volumes });
  }
  const entrada = [...porOcorrencia.values()];
  const volumes = entrada.reduce((s, l) => s + l.volumes, 0);

  return (
    <div className="carga-bloco carga-bipagem" data-testid="carga-bipagem">
      <strong>Importar a bipagem deste palete</strong>
      <p className="campo-ajuda">Planilha "Etiquetas" (Tipo, Número, Volumes, Lidos, Remetente) de um palete de embarque. Lidos = volumes que vão neste palete. Nada é gravado até "Alocar".</p>
      <div className="acoes-linha">
        <input
          type="file"
          accept=".xlsx,.csv"
          onChange={(e) => {
            setArquivo(e.currentTarget.files?.[0] ?? null);
            setAnalise(null);
            setErro(null);
          }}
          data-testid="bipagem-embarque-arquivo"
        />
        <button type="button" className="botao-secundario botao-compacto" disabled={arquivo === null || lendo} onClick={() => void ler()} data-testid="bipagem-embarque-ler">
          {lendo ? 'Lendo…' : 'Ler arquivo'}
        </button>
      </div>
      {erro !== null && <p className="estado-erro">{erro}</p>}
      {analise !== null && (
        <>
          <p className="carga-bipagem-resumo" data-testid="bipagem-embarque-resumo">
            {analise.lines.length} NF(s) com volumes lidos · <strong>{prontas.length} pronta(s)</strong>
            {pendentes.length > 0 && <span className="marca-erro"> · {pendentes.length} pendente(s)</span>}
            {analise.withoutReads > 0 && <> · {analise.withoutReads} com Lidos = 0 (não entram)</>}
          </p>
          {analise.errors.length > 0 && (
            <div className="estado-erro" role="alert">
              <strong>Linhas com erro (não entram):</strong>
              <ul>
                {analise.errors.slice(0, 20).map((e) => (
                  <li key={e.row}>
                    Linha {e.row}: {e.messages.join(' ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="carga-tabela-rolagem">
            <table className="janela-tabela" data-testid="bipagem-embarque-linhas">
              <thead>
                <tr>
                  <th>NF / remetente</th>
                  <th className="numero">Lidos</th>
                  <th>Origem na praça</th>
                </tr>
              </thead>
              <tbody>
                {analise.lines.map((l) => {
                  const c = escolhida(l);
                  const diferenca = l.expectedVolumes !== null && l.expectedVolumes !== l.volumes;
                  return (
                    <tr key={l.row} data-testid="bipagem-embarque-linha" data-nf={l.number} data-situacao={c !== null ? 'PRONTA' : (l.problem ?? 'ESCOLHER')} className={c === null ? 'carga-bipagem-pendente' : undefined}>
                      <td>
                        {l.type ?? ''} {l.number}
                        <span className="carga-bipagem-remetente">{l.sender ?? '—'}</span>
                      </td>
                      <td className="numero">
                        {l.volumes}
                        {diferenca && <span className="carga-bipagem-nota"> de {l.expectedVolumes}</span>}
                      </td>
                      <td>
                        {l.candidates.length === 0 ? (
                          <span className="marca-erro">NF não encontrada em nenhum palete da praça</span>
                        ) : (
                          <select
                            value={escolhas[l.row] ?? l.suggested ?? ''}
                            onChange={(e) => {
                              const valor = e.currentTarget.value;
                              setEscolhas((s) => ({ ...s, [l.row]: valor }));
                            }}
                            aria-label={`Origem da NF ${l.number}`}
                            data-testid="bipagem-embarque-origem"
                          >
                            <option value="">{l.problem === 'SEM_SALDO' ? 'Nenhuma origem tem os volumes' : 'Escolha a origem…'}</option>
                            {l.candidates.map((x) => (
                              <option key={x.id} value={x.id} disabled={!serve(x, l.volumes)}>
                                {rotuloOrigem(x)}
                                {serve(x, l.volumes) ? '' : ` (${motivoNaoServe(x)})`}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pendentes.length > 0 && <p className="campo-ajuda">As pendentes ficam fora deste palete. Para incluir, escolha a origem ou ajuste a contagem na praça e leia o arquivo de novo.</p>}
          <button type="button" className="botao-primario" disabled={ocupado || entrada.length === 0} onClick={() => aoAlocar(entrada)} data-testid="bipagem-embarque-alocar">
            Alocar palete com {entrada.length} NF(s) · {volumes} volume(s)
          </button>
        </>
      )}
    </div>
  );
}
