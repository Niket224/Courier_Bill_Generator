const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { safeLogger, createOperations } = require('../../server/operations');
const { start } = require('../../server/runtime');
const { validateWorkflow } = require('../../scripts/check.cjs');
const { inspect } = require('../../scripts/scan-secrets.cjs');
const Ops = require('../../server/services/backupOperations');
const Archive = require('../../server/services/backupArchive');
test('structured logs admit only safe fixed metadata and ignore supplied secrets and customer fields', () => {
  const lines = []; const log = safeLogger(line => lines.push(line));
  log('request', { requestId: 'a'.repeat(36), area: 'invoice', method: 'POST', status: 500, durationMs: 3.4, body: 'customer', token: 'secret', url: '/invoices/customer', error: new Error('mongodb credential'), password: 'private' });
  log('private-event', { value: 'secret' }); const line = JSON.parse(lines[0]);
  assert.equal(lines.length, 1); assert.deepEqual(Object.keys(line).sort(), ['area', 'durationMs', 'event', 'method', 'requestId', 'status', 'time']);
  for (const text of ['customer', 'secret', 'credential', 'password']) assert.ok(!lines.join().includes(text));
  assert.doesNotThrow(() => safeLogger(() => { throw new Error(); })('request'));
});
test('readiness fails on unavailable/hung dependencies and during drain', async () => {
  assert.equal(await createOperations({ probe: async () => true }).ready(), true);
  assert.equal(await createOperations({ probe: async () => { throw new Error('private'); } }).ready(), false);
  assert.equal(await createOperations({ probe: () => new Promise(() => {}), deadlineMs: 5 }).ready(), false);
  const ops = createOperations({ probe: async () => true }); ops.drain(); assert.equal(await ops.ready(), false);
});
test('startup failure disconnects and emits no underlying credential-bearing error', async () => {
  const lines = []; let disconnected = false;
  await assert.rejects(start({}, { log: safeLogger(line => lines.push(line)), connect: async () => ({ connection: { getClient: () => ({}) }, disconnect: async () => { disconnected = true; } }), store: () => { throw new Error('synthetic-sensitive-db-url'); } }), /Startup failed/);
  assert.equal(disconnected, true); assert.ok(!lines.join().includes('sensitive'));
});
test('graceful shutdown drains a real listener and disconnects exactly once', async () => {
  let disconnected = 0; const express = require('../../server/node_modules/express');
  const runtime = await start({ port: 0 }, { log: () => {}, probe: async () => true, connect: async () => ({ connection: { getClient: () => ({}) }, disconnect: async () => { disconnected++; } }), store: () => ({ collectionP: Promise.resolve() }), indexes: async () => {}, app: () => express().get('/', (req, res) => res.send('ok')) });
  const port = runtime.server.address().port; assert.equal((await fetch(`http://127.0.0.1:${port}`)).status, 200);
  const first = runtime.shutdown(); assert.equal(runtime.operations.status().draining, true); assert.equal(first, runtime.shutdown());
  assert.deepEqual(await first, { forced: false }); assert.equal(disconnected, 1); assert.equal(await runtime.operations.ready(), false);
});
test('shutdown force-closes an unfinished request at its deadline', async () => {
  const express = require('../../server/node_modules/express'); let entered;
  const incoming = new Promise(resolve => { entered = resolve; });
  const runtime = await start({ port: 0, shutdownTimeoutMs: 20 }, { log: () => {}, connect: async () => ({ connection: { getClient: () => ({}) }, disconnect: async () => {} }), store: () => ({ collectionP: Promise.resolve() }), indexes: async () => {}, app: () => express().get('/', () => entered()) });
  const response = fetch(`http://127.0.0.1:${runtime.server.address().port}`).catch(() => null); await incoming;
  assert.equal((await runtime.shutdown()).forced, true); await response;
});
test('CI policy rejects missing regressions, mutable actions, writes and ignored failures', async () => {
  const workflow = JSON.parse(await fs.readFile(path.resolve('.github/workflows/ci.yml'), 'utf8')); assert.equal(validateWorkflow(workflow), true);
  for (const mutate of [v => v.jobs.verify.steps = v.jobs.verify.steps.filter(s => s.run !== 'npm test'), v => v.jobs.verify.steps.find(s => s.run === 'npm test').run = 'npm test || true', v => v.permissions.contents = 'write', v => v.jobs.verify.steps[0].uses = 'actions/checkout@main', v => v.jobs.verify.steps[0]['continue-on-error'] = true]) {
    const bad = structuredClone(workflow); mutate(bad); assert.throws(() => validateWorkflow(bad));
  }
});
test('secret scan detects private artifacts and provider credentials without returning their values', () => {
  assert.equal(inspect('server/.env', ''), 'private-file'); assert.equal(inspect('private.cbackup', ''), 'private-file');
  assert.equal(inspect('source.js', 'gh' + 'p_' + 'x'.repeat(40)), 'provider-token');
  assert.equal(inspect('source.js', '-----BEGIN ' + 'PRIVATE KEY-----'), 'private-key');
  assert.equal(inspect('.env.example', 'SESSION_SECRET='), null);
});
test('backup age and failure assessments never treat absent, future or stale receipts as success', () => {
  const now = Date.parse('2026-01-02T12:00:00Z');
  assert.equal(Ops.assess({ lastSuccessAt: '2026-01-02T00:00:00Z', lastOutcome: 'VERIFIED' }, {}, now).healthy, true);
  for (const receipt of [{}, { lastSuccessAt: '2026-01-03', lastOutcome: 'VERIFIED' }, { lastSuccessAt: '2026-01-01', lastOutcome: 'VERIFIED' }, { lastSuccessAt: '2026-01-02', lastOutcome: 'FAILED' }]) assert.equal(Ops.assess(receipt, {}, now).healthy, false);
});
test('retention is planning-only, preserves known-good backups and refuses a zero-copy policy', () => {
  const plan = Ops.retentionPlan([{ file: 'old', createdAt: '2026-01-01', verified: true }, { file: 'new', createdAt: '2026-01-02', verified: true }, { file: 'corrupt', createdAt: '2026-01-03', verified: false }], 1);
  assert.deepEqual(plan, { deletionEnabled: false, preserve: ['new'], reviewForArchive: ['old'] }); assert.throws(() => Ops.retentionPlan([], 0));
  assert.throws(() => Ops.policy({ BACKUP_RETAIN_COUNT: '0' })); assert.throws(() => Ops.policy({ BACKUP_MIN_FREE_MB: '1' }));
});
test('backup job verifies independent copy, detects failures/capacity, and preserves last success', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'courier-ops-test-'));
  try {
    const localDir = path.join(dir, 'local'), copyDir = path.join(dir, 'copy'), keyFile = path.join(dir, 'key.backup-key');
    await fs.mkdir(localDir); await fs.mkdir(copyDir); const key = randomBytes(32); await fs.writeFile(keyFile, key);
    const manifest = Archive.createManifest(Object.fromEntries(Archive.COLLECTIONS.map(name => [name, []])), {});
    const config = { approved: true, localDir, copyDir, keyFile, minFreeMb: 128 };
    await assert.rejects(Ops.runJob({ ...config, approved: false }), /authorization/);
    const result = await Ops.runJob(config, { createBackup: async () => { const file = path.join(localDir, 'synthetic.cbackup'); await require('../../server/services/backupFile').writeVerifiedArchive(file, Archive.seal(manifest, key), key); return { file, status: 'VERIFIED_BACKUP' }; } });
    assert.equal(result.lastOutcome, 'VERIFIED'); assert.ok((await fs.stat(path.join(copyDir, 'synthetic.cbackup'))).size > 0);
    const monitorEnv = { BACKUP_STATUS_FILE: path.join(localDir, 'backup-status.json'), BACKUP_COPY_DIR: copyDir, BACKUP_MIN_FREE_MB: '128' };
    const healthyFetch = async url => ({ ok: true, json: async () => ({ status: String(url).endsWith('/live') ? 'alive' : 'ready' }) });
    assert.equal((await require('../../server/scripts/monitor').monitor(monitorEnv, healthyFetch)).healthy, true);
    await fs.rename(path.join(localDir, 'synthetic.cbackup'), path.join(localDir, 'synthetic.cbackup.moved'));
    assert.equal((await require('../../server/scripts/monitor').monitor(monitorEnv, healthyFetch)).healthy, false);
    await assert.rejects(Ops.runJob(config, { createBackup: async () => { throw new Error('synthetic-private-source-error'); } }), /BACKUP_JOB_FAILED/);
    const failed = JSON.parse(await fs.readFile(path.join(localDir, 'backup-status.json'), 'utf8')); assert.equal(failed.lastSuccessAt, result.lastSuccessAt); assert.equal(failed.lastOutcome, 'FAILED');
    let invoked = false; await assert.rejects(Ops.runJob(config, { checkCapacity: async () => { throw new Error('low capacity'); }, createBackup: () => { invoked = true; } })); assert.equal(invoked, false);
    await fs.writeFile(path.join(localDir, '.backup-job.lock'), 'synthetic'); await assert.rejects(Ops.runJob(config, {}), /EEXIST/);
    assert.ok((await fs.stat(path.join(copyDir, 'synthetic.cbackup'))).size > 0);
  } finally { const resolved = await fs.realpath(dir); assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('courier-ops-test-')); await fs.rm(resolved, { recursive: true }); }
});
test('monitoring emits safe alerts for unavailable backend and unconfigured backup monitoring', async () => {
  const { monitor } = require('../../server/scripts/monitor');
  const result = await monitor({}, async () => { throw new Error('sensitive response'); });
  assert.deepEqual(result.alerts, ['BACKEND_DOWN', 'DATABASE_NOT_READY', 'BACKUP_MONITOR_NOT_CONFIGURED']); assert.equal(result.healthy, false);
  await assert.rejects(monitor({ MONITOR_BASE_URL: 'http://user:password@example.test' }), /HTTPS/);
});
test('production configuration rejects weak and reused keys and invalid operational settings', () => {
  const { validateEnv } = require('../../server/config/env');
  const good = { NODE_ENV: 'production', MONGO_URI: 'mongodb://127.0.0.1/test', ADMIN_USERNAME: 'synthetic', ADMIN_PASSWORD_HASH: 'scrypt$131072$8$1$' + 'a'.repeat(32) + '$' + 'b'.repeat(128), SESSION_SECRET: randomBytes(32).toString('base64url'), BROWSER_DRAFT_KEY: randomBytes(32).toString('base64'), ALLOWED_ORIGINS: 'https://billing.example.test' };
  assert.equal(validateEnv(good).bindHost, '127.0.0.1');
  for (const patch of [{ SESSION_SECRET: 'a'.repeat(64) }, { BROWSER_DRAFT_KEY: Buffer.alloc(32).toString('base64') }, { BROWSER_DRAFT_KEY: undefined }, { TRUST_PROXY: 'true' }, { BIND_HOST: 'public.example.test' }, { SHUTDOWN_TIMEOUT_MS: '0' }, { ALLOWED_ORIGINS: 'http://billing.example.test' }]) assert.throws(() => validateEnv({ ...good, ...patch }));
});
test('service-worker rollout deletes only obsolete app caches and never unrelated origin data', async () => {
  const vm = require('node:vm'), events = {}, removed = []; let activation;
  vm.runInNewContext(await fs.readFile(path.resolve('mobile-bill-app/sw.js'), 'utf8'), {
    URL, self: { clients: { claim: async () => {} }, location: { origin: 'https://billing.example.test' }, addEventListener: (event, callback) => { events[event] = callback; } },
    caches: { keys: async () => ['courier-bill-app-v12', 'courier-bill-app-v13', 'other-application-data'], delete: async name => removed.push(name) }
  });
  events.activate({ waitUntil: promise => { activation = promise; } }); await activation;
  assert.deepEqual(removed, ['courier-bill-app-v12']);
});
