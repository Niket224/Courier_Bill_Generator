const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertTestMode, assertOwnedUri } = require('../../server/config/test-db');
test('both launchers use an environment that strips credentials and loaders', async () => {
  const { testEnvironment } = await import('../../scripts/test-environment.mjs');
  assert.deepEqual(testEnvironment({ PATH: 'test-path', MONGO_URI: 'dummy', TEST_MONGO_URI: 'dummy',
    GEMINI_API_KEY: 'dummy', NODE_OPTIONS: '--require unsafe', MONGOMS_SYSTEM_BINARY: 'unsafe', NODE_ENV: 'production' }),
  { PATH: 'test-path', NODE_ENV: 'test', TEST_DB_MODE: 'memory' });
});
test('test database configuration fails closed', () => {
  for (const env of [{}, { NODE_ENV: 'test' }, { NODE_ENV: 'production', TEST_DB_MODE: 'memory' },
    { NODE_ENV: 'test', TEST_DB_MODE: 'memory', MONGO_URI: 'mongodb://example.invalid/live' },
    { NODE_ENV: 'test', TEST_DB_MODE: 'memory', TEST_MONGO_URI: 'mongodb://127.0.0.1/live' }]) {
    assert.throws(() => assertTestMode(env));
  }
  assert.doesNotThrow(() => assertTestMode({ NODE_ENV: 'test', TEST_DB_MODE: 'memory' }));
});
test('only a generated loopback URI is accepted', () => {
  const name = 'courier_test_' + 'a'.repeat(32);
  assert.doesNotThrow(() => assertOwnedUri(`mongodb://127.0.0.1:12345/${name}?`, name));
  assert.doesNotThrow(() => assertOwnedUri(`mongodb://127.0.0.1:12345/${name}`, name));
  for (const uri of ['mongodb://example.invalid/live', 'mongodb://127.0.0.1:27017/live', `mongodb://localhost:27017/${name}?`]) {
    assert.throws(() => assertOwnedUri(uri, name));
  }
  assert.throws(() => assertOwnedUri('mongodb://127.0.0.1:12345/live?', 'live'));
});
test('production connector and entry point refuse test mode before reading dotenv', async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  await assert.rejects(require('../../server/config/db')(), /disabled in test mode/);
  assert.throws(() => require('../../server/server'), /isolated test harness/);
});
