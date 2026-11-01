// Test databases are provisioned by the harness, never by a user-supplied URI.
function assertTestMode(env) {
  if (env.NODE_ENV !== 'test' || env.TEST_DB_MODE !== 'memory') {
    throw new Error('Integration tests require NODE_ENV=test and TEST_DB_MODE=memory. Use npm run test:integration.');
  }
  if (env.MONGO_URI || env.TEST_MONGO_URI) {
    throw new Error('Tests refuse MONGO_URI and TEST_MONGO_URI. Only a disposable harness-owned database is allowed.');
  }
}

function assertOwnedUri(uri, expectedName) {
  if (!/^courier_test_[a-f0-9]{32}$/.test(expectedName) ||
      !new RegExp(`^mongodb://127\\.0\\.0\\.1:[0-9]+/${expectedName}(?:\\?)?$`).test(uri)) {
    throw new Error('Refusing database connection: expected a harness-owned loopback test database.');
  }
}
module.exports = { assertTestMode, assertOwnedUri };
