import { criarApp } from './app.js';
import { carregarEnvLocal, lerConfiguracao } from './config.js';
import { criarBanco } from './db/cliente.js';
import { iniciarAgendadorPlanilha } from './modules/planilha/agendador.js';

carregarEnvLocal();
const config = lerConfiguracao(process.env, process.argv);
let registrarErroPool: (erro: Error) => void = (erro) => {
  console.error('Erro em conexão ociosa do banco', erro.message);
};
const db = criarBanco(config.databaseUrl, (erro) => {
  registrarErroPool(erro);
});
const app = await criarApp({
  db,
  config,
  interfaceDir: config.interfaceDir,
  limitesImportacao: config.limitesImportacao,
  limitesImportacaoPlanilha: config.limitesImportacaoPlanilha,
  exportacaoMaxLinhas: config.exportacaoMaxLinhas,
  claims: config.claims,
  planilha: config.planilha,
  selecaoClienteTeste: config.selecaoClienteTeste,
  aplicativo: { versao: config.versao, caminhoBase: config.caminhoBase, persistenciaLocal: config.persistenciaLocal },
  logger: {
    level: config.logLevel,
    // Cookies e cabeçalhos de autenticação nunca vão para o log.
    redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
  },
});
registrarErroPool = (erro) => {
  app.log.error({ err: erro }, 'Erro em conexão ociosa do banco');
};

app.log.info(
  {
    ambiente: config.ambiente,
    cookieSeguro: config.cookieSeguro,
    interface: config.interfaceDir ?? 'não servida (use o Vite em desenvolvimento)',
    urlEtiquetas: config.urlPublica,
    caminhoBase: config.caminhoBase,
    rascunhoLocalNoNavegador: config.persistenciaLocal,
    versao: config.versao,
    importacao: { maxMB: config.limitesImportacao.maxBytes / 1_048_576, maxLinhas: config.limitesImportacao.maxRows },
  },
  'Praça Reversa: API iniciada',
);

// Planilha única: agendador no processo (fila e concessão no banco; ver modules/planilha).
const agendadorPlanilha = config.planilha.automatica ? iniciarAgendadorPlanilha(db, config.planilha, app.log) : null;
app.log.info(
  { automatica: config.planilha.automatica, destino: config.planilha.destino?.descricao ?? 'não configurado (só geração local)', pastaLocal: config.planilha.pastaLocal },
  'Planilha única',
);

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sinal, () => {
    app.log.info({ sinal }, 'Encerrando API');
    void (agendadorPlanilha?.parar() ?? Promise.resolve())
      .then(() => app.close())
      .then(() => db.$disconnect())
      .then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
