const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../../server/security/password');
const { securityConfig } = require('../../server/config/security');
const { validateEnv } = require('../../server/config/env');
const fake = { BROWSER_DRAFT_KEY: Buffer.alloc(32, 7).toString('base64'), ADMIN_USERNAME: 'test', ADMIN_PASSWORD_HASH: 'scrypt$131072$8$1$' + 'a'.repeat(32) + '$' + 'b'.repeat(128), SESSION_SECRET: 'a'.repeat(64) };
test('scrypt uses random salts, verifies correct passwords and rejects invalid inputs', async () => {
  const password = 'Synthetic-password-only!';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('incorrect', first), false);
  assert.equal(await verifyPassword(password, 'invalid'), false);
  assert.equal(await verifyPassword('x'.repeat(1025), first), false);
  await assert.rejects(hashPassword('short'));
});
test('security environment rejects missing and unsafe values without echoing them', () => {
  assert.throws(() => securityConfig({}), /ADMIN_USERNAME/);
  for (const patch of [{ ADMIN_PASSWORD_HASH: 'plaintext-secret' }, { SESSION_SECRET: 'short-secret' },
    { SESSION_TTL_MINUTES: '0' }, { SESSION_TTL_MINUTES: '1441' }, { TRUST_PROXY: 'true' }, { ADMIN_USERNAME: ' ' }]) {
    assert.throws(() => securityConfig({ ...fake, ...patch }));
  }
  assert.equal(securityConfig(fake).sessionMaxAge, 480 * 60000);
});
test('production CORS rejects wildcard, absent origins and insecure schemes', () => {
  for (const ALLOWED_ORIGINS of ['', '*', 'https://*.vercel.app', 'http://billing.example.test']) {
    assert.throws(() => validateEnv({ ...fake, MONGO_URI: 'mongodb://127.0.0.1/test', NODE_ENV: 'production', ALLOWED_ORIGINS }), /ALLOWED_ORIGINS/);
  }
});
test('service worker never intercepts authenticated API or external responses', () => {
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const events = {};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../mobile-bill-app/sw.js'), 'utf8'), {
    URL, self: { location: { origin: 'https://billing.example.test', href: 'https://billing.example.test/sw.js' }, addEventListener: (name, fn) => { events[name] = fn; } }
  });
  for (const url of ['https://billing.example.test/api/invoices', 'https://billing.example.test/api/auth/session', 'https://external.example/test']) {
    events.fetch({ request: { method: 'GET', url }, respondWith: () => assert.fail('Private response intercepted') });
  }
});
test('app factory fails closed without security configuration or a session store', () => {
  const { createApp } = require('../../server/app');
  assert.throws(() => createApp(), /Validated security configuration/);
  assert.throws(() => createApp({ sessionSecret: 'test', adminPasswordHash: 'test', allowedOrigins: [] }), /session store is required/);
});
test('credential helper refuses noninteractive input without printing a password', () => {
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../server/scripts/hash-admin-password.js')], { encoding: 'utf8', input: 'synthetic-never-echo-this', timeout: 5000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /interactive terminal/);
  assert.ok(!result.stdout.includes('synthetic-never-echo-this'));
});
