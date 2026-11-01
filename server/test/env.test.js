const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { validateEnv, validatePort } = require('../config/env');

const valid = { MONGO_URI: 'mongodb://127.0.0.1:27017/test', ADMIN_USERNAME: 'test-admin',
  ADMIN_PASSWORD_HASH: 'scrypt$131072$8$1$' + 'a'.repeat(32) + '$' + 'b'.repeat(128),
  SESSION_SECRET: 'synthetic-session-secret-for-tests-only-123456789' };

test('defaults and missing optional Gemini configuration', () => {
  const result = validateEnv(valid);
  assert.equal(result.port, 5000);
  assert.equal(result.nodeEnv, 'development');
  assert.deepEqual(result.allowedOrigins, []);
  assert.match(result.warnings[0], /GEMINI_API_KEY.*missing/);
});

test('configured values and dummy credentials do not need network access', () => {
  const env = {
    ...valid,
    MONGO_URI: 'mongodb+srv://dummy:fake@cluster.example.test/bills',
    GEMINI_API_KEY: 'fake-test-key', PORT: '8080', NODE_ENV: 'production',
    ALLOWED_ORIGINS: ' https://example.test, https://billing.example.test '
  };
  const snapshot = { ...env };
  const result = validateEnv(env);
  assert.equal(result.port, 8080);
  assert.equal(result.nodeEnv, 'production');
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.allowedOrigins, ['https://example.test', 'https://billing.example.test']);
  assert.deepEqual(env, snapshot);
});

test('required configuration is validated even in test mode', () => {
  for (const MONGO_URI of [undefined, '', '   ']) {
    assert.throws(() => validateEnv({ MONGO_URI, NODE_ENV: 'test' }), /MONGO_URI is required/);
  }
  assert.equal(validateEnv({ ...valid, NODE_ENV: 'test' }).nodeEnv, 'test');
});

test('aggregated errors identify variables without exposing supplied values', () => {
  const secret = 'DO-NOT-PRINT-THIS';
  assert.throws(() => validateEnv({
    MONGO_URI: `https://${secret}`, GEMINI_API_KEY: secret,
    PORT: secret, NODE_ENV: secret, ALLOWED_ORIGINS: `https://user:${secret}@example.test`
  }), (error) => {
    for (const name of ['MONGO_URI', 'PORT', 'NODE_ENV', 'ALLOWED_ORIGINS']) {
      assert.ok(error.message.includes(name));
    }
    assert.ok(!error.message.includes(secret));
    assert.match(error.message, /\.env.example/);
    return true;
  });
});

test('MongoDB URI requires a scheme and host', () => {
  for (const MONGO_URI of ['mongodb://', 'mongodb:///db', 'https://example.test', 'mongodb://host/with space']) {
    assert.throws(() => validateEnv({ MONGO_URI }), /MONGO_URI must/);
  }
});

test('ports accept boundaries and reject malformed, blank, and out-of-range values', () => {
  assert.equal(validatePort(undefined, 4173), 4173);
  assert.equal(validatePort('1', 4173), 1);
  assert.equal(validatePort('65535', 4173), 65535);
  for (const value of ['', ' ', '0', '-1', '65536', '1.5', '5e3', '5000abc', 'NaN']) {
    assert.throws(() => validatePort(value, 4173), /PORT must be an integer between 1 and 65535/);
  }
});

test('CORS entries must be origins', () => {
  for (const ALLOWED_ORIGINS of ['invalid', 'ftp://example.test', 'https://example.test/path', 'https://example.test/']) {
    assert.throws(() => validateEnv({ ...valid, ALLOWED_ORIGINS }), /ALLOWED_ORIGINS must/);
  }
});

test('blank Gemini key warns without preventing startup', () => {
  assert.equal(validateEnv({ ...valid, GEMINI_API_KEY: '  ' }).warnings.length, 1);
});

test('frontend server exits before listening when PORT is invalid', () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../scripts/serve_mobile_app.mjs')], {
    env: { ...process.env, PORT: 'invalid-test-port' }, encoding: 'utf8', timeout: 5000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /PORT must be an integer between 1 and 65535/);
  assert.ok(!result.stderr.includes('invalid-test-port'));
  assert.ok(!result.stdout.includes('running at'));
});
