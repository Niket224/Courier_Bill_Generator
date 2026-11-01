const { createApp } = require('./app');
const { createSessionStore } = require('./security/store');
const { createOperations, safeLogger } = require('./operations');
async function start(config, dependencies = {}) {
  const log = dependencies.log || safeLogger();
  const connect = dependencies.connect || require('./config/db');
  let connection, server, stopping;
  const operations = createOperations({ log, probe: dependencies.probe });
  try {
    connection = await connect();
    const store = (dependencies.store || createSessionStore)(Promise.resolve(connection.connection.getClient()), config);
    await store.collectionP;
    if (dependencies.indexes) await dependencies.indexes();
    else await Promise.all([require('./models/Invoice'), require('./models/Client'), require('./models/Shipment').Shipment, require('./models/Rate'), require('./models/RateBook'), require('./models/RateCardDraft')].map(model => model.init()));
    const app = (dependencies.app || createApp)(config, { sessionStore: store, operations });
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(config.port, config.bindHost || '127.0.0.1', () => resolve(listener)); listener.once('error', reject);
    });
    server.requestTimeout = 45000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
    server.setTimeout(60000, socket => socket.destroy());
    const shutdown = () => {
      if (stopping) return stopping;
      operations.drain(); log('shutdown_started');
      stopping = (async () => {
        let timer, forced = false;
        await new Promise(resolve => {
          timer = setTimeout(() => { forced = true; server.closeAllConnections(); resolve(); }, config.shutdownTimeoutMs || 10000);
          server.close(() => resolve()); server.closeIdleConnections();
        }); clearTimeout(timer);
        await connection.disconnect(); log(forced ? 'shutdown_forced' : 'shutdown_complete');
        return { forced };
      })(); return stopping;
    };
    log('startup_ready'); return { app, server, operations, shutdown };
  } catch {
    operations.drain(); if (server) server.close();
    await connection?.disconnect().catch(() => {}); log('startup_failed');
    throw new Error('Startup failed. Check validated configuration, database, indexes and session-store permissions.');
  }
}
module.exports = { start };
