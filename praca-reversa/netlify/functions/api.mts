// Netlify Function da API do Praça Reversa (Functions API v2). Atende /api/*
// na mesma origem da interface com a aplicação Fastify existente (sem listen).
// Os arquivos que o servidor tradicional lê do disco em runtime entram aqui
// por import estático (empacotados pelo esbuild da Netlify).
import pacoteApi from '../../apps/api/package.json' with { type: 'json' };
import desenhoAprovado from '../../examples/layout-desenho-aprovado.json' with { type: 'json' };
import { definirVersaoEmbutida } from '../../apps/api/src/config.ts';
import { definirDesenhoAprovadoEmbutido } from '../../apps/api/src/modules/layout/desenho-aprovado.ts';
import { criarAppFuncao, criarObtentor, respostaIndisponivel, responderComFastify, type ContextoFuncao } from '../../apps/api/src/netlify/adaptador.ts';

definirVersaoEmbutida(pacoteApi.version);
definirDesenhoAprovadoEmbutido(desenhoAprovado);

const obterApp = criarObtentor(() => criarAppFuncao(process.env));

export default async (req: Request, context: ContextoFuncao): Promise<Response> => {
  let app;
  try {
    app = await obterApp();
  } catch (erro) {
    // Mensagem sem a URL do banco nem segredos; a próxima solicitação tenta inicializar de novo.
    console.error('Praça Reversa: falha ao inicializar a API', erro instanceof Error ? erro.message.replace(/postgres(ql)?:\/\/\S+/gi, '[url]') : 'erro');
    return respostaIndisponivel(context.requestId);
  }
  return responderComFastify(app, req, context);
};

export const config = { path: '/api/*' };
