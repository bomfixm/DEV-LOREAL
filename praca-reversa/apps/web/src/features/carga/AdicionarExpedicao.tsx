import { API_PREFIXO, CargaJanelaSchema, JanelasCargaSchema, type PaleteResumo } from '@praca-reversa/contracts';
import { useState } from 'react';
import { useChaves } from '../../api/chaves';
import { enviarJson, mensagemDeFalha, obterJson } from '../../api/cliente';
import { IconeCaminhao } from '../../components/Icones';
import { voarParaExpedicao } from './voo-carrinho';

/** Veículo que ainda recebe paletes (montagem, com vaga), com a janela dele. */
interface VeiculoAberto {
  id: string;
  janela: string;
  rotulo: string;
  placa: string | null;
  ocupados: number;
  capacidade: number;
}

/**
 * "Adicionar à expedição" na janela do palete: escolhe um veículo em montagem e
 * põe o palete inteiro nele (FULL, sem posição — a posição se escolhe depois no
 * mapa do veículo). Usa a mesma criação da tela Expedição, com as mesmas
 * regras (palete na praça, sem FULL em outra carga, sem NF em fracionado).
 * Nada baixa estoque. Ao confirmar, o palete "voa" para a Expedição no menu.
 */
export function AdicionarExpedicao({ palete, aoAlterado }: { palete: PaleteResumo; aoAlterado: (texto: string) => void }) {
  const chaves = useChaves();
  const [aberto, setAberto] = useState(false);
  const [veiculos, setVeiculos] = useState<VeiculoAberto[] | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function abrir() {
    setAberto(true);
    setErro(null);
    setCarregando(true);
    try {
      const janelas = (await obterJson(`${API_PREFIXO}/cargas/janelas`, JanelasCargaSchema)).items.filter((j) => j.vehicles > 0 && j.state !== 'CANCELADA' && j.state !== 'ENCERRADA');
      const cargas = await Promise.all(janelas.map((j) => obterJson(`${API_PREFIXO}/cargas/janelas/${j.id}`, CargaJanelaSchema)));
      setVeiculos(
        cargas.flatMap((c) =>
          c.vehicles
            .filter((v) => v.state === 'MONTAGEM')
            .map((v) => ({ id: v.id, janela: c.window.code, rotulo: v.label, placa: v.plate, ocupados: v.occupied, capacidade: v.capacity })),
        ),
      );
    } catch (e) {
      setErro(mensagemDeFalha(e));
    } finally {
      setCarregando(false);
    }
  }

  async function adicionar(v: VeiculoAberto, botao: HTMLElement) {
    const assinatura = `palete-expedicao:${palete.id}:${v.id}`;
    setEnviando(v.id);
    setErro(null);
    try {
      await enviarJson('POST', `${API_PREFIXO}/cargas/veiculos/${v.id}/paletes`, CargaJanelaSchema, {
        corpo: { kind: 'FULL', number: null, position: null, sourcePalletId: palete.id },
        idempotencia: chaves.para(assinatura),
      });
      chaves.concluir(assinatura);
      voarParaExpedicao(botao, `P ${palete.code}`);
      setAberto(false);
      aoAlterado(`Palete ${palete.code} adicionado à ${v.rotulo} (${v.janela}) como FULL, ainda sem posição: escolha a posição no mapa do veículo, em Expedição.`);
    } catch (e) {
      chaves.concluir(assinatura, e);
      setErro(mensagemDeFalha(e));
    } finally {
      setEnviando(null);
    }
  }

  if (!aberto) {
    return (
      <button type="button" className="botao-secundario" onClick={() => void abrir()} data-testid="acao-adicionar-expedicao">
        <IconeCaminhao />
        Adicionar à expedição
      </button>
    );
  }
  return (
    <div className="adicionar-expedicao" data-testid="adicionar-expedicao">
      <strong>Adicionar o palete {palete.code} a qual veículo?</strong>
      <span className="campo-ajuda">Entra inteiro (FULL), sem posição. A posição no veículo se escolhe depois, na Expedição.</span>
      {carregando && <span>Buscando veículos em montagem…</span>}
      {veiculos !== null && veiculos.length === 0 && <span>Nenhum veículo em montagem. Adicione uma carreta ou um truck numa janela, na Expedição.</span>}
      {veiculos !== null && veiculos.length > 0 && (
        <ul className="adicionar-expedicao-lista">
          {veiculos.map((v) => {
            const cheio = v.ocupados >= v.capacidade;
            return (
              <li key={v.id}>
                <button
                  type="button"
                  className="botao-secundario"
                  disabled={enviando !== null || cheio}
                  onClick={(e) => void adicionar(v, e.currentTarget)}
                  data-testid="adicionar-expedicao-veiculo"
                  data-veiculo={`${v.janela} ${v.rotulo}`}
                >
                  <span>
                    {enviando === v.id ? 'Adicionando…' : v.rotulo}
                    {v.placa !== null && ` · ${v.placa}`}
                  </span>
                  <small>
                    {v.janela} · {v.ocupados}/{v.capacidade} paletes{cheio ? ' · cheio' : ''}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {erro !== null && (
        <span className="mensagem-conflito" role="alert">
          {erro}
        </span>
      )}
      <button type="button" className="botao-link" onClick={() => setAberto(false)}>
        Cancelar
      </button>
    </div>
  );
}
