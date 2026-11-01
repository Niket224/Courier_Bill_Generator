// Dedicated browser-test API: never load dotenv or accept an external database URI.
const { assertTestMode, assertOwnedUri } = require('../server/config/test-db');
assertTestMode(process.env);
const { MongoMemoryServer } = require('mongodb-memory-server');
const { randomUUID } = require('node:crypto');
const mongoose = require('../server/node_modules/mongoose');
const { createApp } = require('../server/app');
const { createSessionStore } = require('../server/security/store');
const { authConfig } = require('../tests/fixtures/auth.cjs');
let mongo, server;
const port = Number(process.env.E2E_API_PORT || 4188);
if (![4188, 4189].includes(port)) throw new Error('Unsupported isolated test port.');
async function stop() {
  if (server) await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
}
async function main() {
  const dbName = `courier_test_${randomUUID().replaceAll('-', '')}`;
  mongo = await MongoMemoryServer.create({ binary: { version: '7.0.24' }, instance: { ip: '127.0.0.1', dbName } });
  const uri = mongo.getUri(dbName);
  assertOwnedUri(uri, dbName);
  await mongoose.connect(uri);
  // Published synthetic card for the original authenticated regression workflows.
  await require('../tests/fixtures/rate-card.cjs').publishFixture(require('../tests/fixtures/rate-card.cjs').card());
  const config = await authConfig();
  const store = createSessionStore(Promise.resolve(mongoose.connection.getClient()), config);
  await store.collectionP;
  server = createApp(config, { sessionStore: store,
    aiProvider: async () => JSON.stringify(require('../tests/fixtures/rate-card.cjs').card()) }).listen(port, '127.0.0.1');
  server.on('error', () => { console.error('Test API could not listen on its reserved port.'); stop().finally(() => process.exit(1)); });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop().finally(() => process.exit(0)));
main().catch(() => { console.error('Isolated browser API setup failed.'); stop().finally(() => process.exit(1)); });
