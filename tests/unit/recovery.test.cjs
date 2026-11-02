const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto, randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Archive = require('../../server/services/backupArchive');
const Recovery = require('../../server/services/businessRecovery');
const Data = require('../../mobile-bill-app/browser-data');
const { create, suffix } = require('../../mobile-bill-app/draft-vault');
const fixture = require('../fixtures/bill.json');
const key = randomBytes(32);
const empty = () => Archive.createManifest(Object.fromEntries(Archive.COLLECTIONS.map(name => [name, []])), {});
class Storage {
  constructor() { this.data = new Map(); }
  get length() { return this.data.size; }
  key(i) { return [...this.data.keys()][i]; }
  getItem(k) { return this.data.get(k) ?? null; }
  setItem(k, v) { this.data.set(k, v); }
  removeItem(k) { this.data.delete(k); }
}
test('backup metadata has explicit format/schema/application version, time, inventory and checksums', () => {
  const m = empty(); assert.equal(m.version, 1); assert.equal(m.schemaVersion, 5); assert.equal(m.applicationVersion, '1.0.0');
  assert.equal(m.inventory.length, 6); assert.equal(m.inventory[0].count, 0); assert.match(m.inventory[0].sha256, /^[a-f0-9]{64}$/); assert.ok(Date.parse(m.createdAt));
});
test('AES-GCM archive decrypts exactly and random nonces produce different ciphertext', () => {
  const m = empty(), a = Archive.seal(m, key), b = Archive.seal(m, key);
  assert.notDeepEqual(a, b); assert.deepEqual(Archive.open(a, key), m);
  assert.equal(a.includes(Buffer.from('collections')), false);
});
test('wrong backup key is rejected', () => assert.throws(() => Archive.open(Archive.seal(empty(), key), randomBytes(32)), /corrupt/));
test('missing backup key is rejected', () => assert.throws(() => Archive.open(Buffer.alloc(10)), /key/));
test('corrupt encrypted archive and authenticated header fail closed', () => {
  for (const offset of [0, 20, 40]) { const b = Archive.seal(empty(), key); b[offset] ^= 1; assert.throws(() => Archive.open(b, key)); }
});
for (const [name, change] of [
  ['unsupported backup version', m => m.version++], ['missing manifest field', m => delete m.createdAt],
  ['checksum mismatch', m => m.inventory[0].sha256 = '0'.repeat(64)], ['count mismatch', m => m.inventory[0].count++],
  ['missing collection', m => delete m.collections.clients], ['unexpected collection', m => m.collections.sessions = []],
  ['duplicate inventory', m => m.inventory[0] = m.inventory[1]]
]) test(name, () => { const m = empty(); change(m); assert.throws(() => Archive.validateManifest(m)); });
test('production and malformed restore targets are rejected without connection', () => {
  for (const uri of ['mongodb+srv://production.example/db', 'mongodb://user:password@127.0.0.1:27017/db', 'mongodb://127.0.0.1:27017/production', 'mongodb://localhost:27017', undefined]) assert.throws(() => Recovery.assertRestoreUri(uri));
  Recovery.assertRestoreUri('mongodb://127.0.0.1:27017');
});
test('browser legacy import remains compatible and versioned export contains all private archives', () => {
  const imported = Data.importBackup(JSON.stringify(fixture)); assert.equal(imported.legacy, true);
  const archive = { 'courier-bill-archive-test': JSON.stringify({ createdAt: new Date().toISOString(), state: fixture }) };
  const exported = Data.exportBackup(fixture, archive); assert.equal(exported.version, 1); assert.deepEqual(Data.importBackup(JSON.stringify(exported)).records, archive);
  const legacyGif = structuredClone(fixture); legacyGif.bill.logoSrc = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
  assert.equal(Data.importBackup(JSON.stringify(legacyGif)).state.bill.logoSrc, legacyGif.bill.logoSrc);
  assert.equal(Data.exportBackup(legacyGif, {}).state.bill.logoSrc, legacyGif.bill.logoSrc);
});
test('malformed JSON, missing browser fields, unsupported versions and invalid amounts are rejected', () => {
  for (const text of ['{', '{}', JSON.stringify({ format: 'courier-browser-backup', version: 99 }), JSON.stringify({ ...fixture, shipments: [{ ...fixture.shipments[0], weight: -1 }] })]) assert.throws(() => Data.importBackup(text));
});
test('prototype pollution and embedded secrets are rejected recursively', () => {
  for (const key of ['__proto__', 'constructor', 'prototype', 'password', 'csrfToken', 'sessionSecret', 'SESSION_SECRET', 'BROWSER_DRAFT_KEY', 'GEMINI_API_KEY', 'MONGO_URI']) {
    assert.throws(() => Data.parse(`{"nested":{"${key}":"synthetic"}}`)); assert.throws(() => Archive.safeJSON(`{"${['__proto__', 'constructor', 'prototype'].includes(key) ? key : '__proto__'}":{}}`));
  }
  assert.equal({}.polluted, undefined);
});
test('unsafe images, malformed dates, and non-finite browser amounts fail import validation', () => {
  for (const patch of [{ logoSrc: 'javascript:alert(1)' }, { invoiceDate: '2026-02-30' }, { fuelPct: -1 }]) assert.throws(() => Data.importBackup(JSON.stringify({ ...fixture, bill: { ...fixture.bill, ...patch } })));
  assert.throws(() => Data.parse('{"amount":1e999}'));
});
test('browser draft migration verifies ciphertext before removing originals and recovers after refresh', async () => {
  const storage = new Storage(); const raw = JSON.stringify(fixture); storage.setItem('courier-bill-app-v2', raw);
  const vault = create(storage, webcrypto); await vault.unlock(key.toString('base64'));
  assert.equal(storage.getItem('courier-bill-app-v2'), null); assert.equal(vault.getItem('courier-bill-app-v2'), raw);
  assert.equal(storage.getItem('courier-bill-app-v2' + suffix).includes('Synthetic Customer'), false);
  const fresh = create(storage, webcrypto); await fresh.unlock(key.toString('base64')); assert.equal(fresh.getItem('courier-bill-app-v2'), raw);
});
test('vault lock removes access to private memory and key; ciphertext remains recoverable', async () => {
  const storage = new Storage(), vault = create(storage, webcrypto); await vault.unlock(key.toString('base64'));
  vault.setItem('courier-bill-app-v2', JSON.stringify(fixture)); await vault.flush(); vault.lock();
  assert.equal(vault.isUnlocked(), false); assert.throws(() => vault.entries(), /Sign in/); assert.throws(() => vault.getItem('courier-bill-app-v2'));
  await vault.unlock(key.toString('base64')); assert.equal(JSON.parse(vault.getItem('courier-bill-app-v2')).shipments.length, 1);
});
test('wrong browser key and corrupt ciphertext preserve encrypted data', async () => {
  const storage = new Storage(), vault = create(storage, webcrypto); await vault.unlock(key.toString('base64'));
  vault.setItem('courier-bill-app-v2', JSON.stringify(fixture)); await vault.flush(); const before = storage.getItem('courier-bill-app-v2' + suffix);
  await assert.rejects(create(storage, webcrypto).unlock(randomBytes(32).toString('base64'))); assert.equal(storage.getItem('courier-bill-app-v2' + suffix), before);
  storage.setItem('courier-bill-app-v2' + suffix, '{corrupt'); await assert.rejects(create(storage, webcrypto).unlock(key.toString('base64')));
});
test('quota failure during migration retains plaintext original', async () => {
  const storage = new Storage(); storage.setItem('courier-bill-app-v2', 'original'); storage.setItem = () => { throw new Error('Quota'); };
  await assert.rejects(create(storage, webcrypto).unlock(key.toString('base64'))); assert.equal(storage.getItem('courier-bill-app-v2'), 'original');
});
test('quota failure during encrypted save preserves old ciphertext and reports failed flush', async () => {
  const storage = new Storage(), vault = create(storage, webcrypto); await vault.unlock(key.toString('base64')); vault.setItem('courier-bill-app-v2', 'first'); await vault.flush();
  const original = storage.getItem('courier-bill-app-v2' + suffix); storage.setItem = () => { throw new Error('Quota'); };
  vault.setItem('courier-bill-app-v2', 'edited'); await assert.rejects(vault.flush()); assert.equal(storage.getItem('courier-bill-app-v2' + suffix), original); assert.equal(vault.getItem('courier-bill-app-v2'), 'edited');
});
test('different plaintext and ciphertext copies are never silently merged during migration', async () => {
  const storage = new Storage(), vault = create(storage, webcrypto); await vault.unlock(key.toString('base64')); vault.setItem('courier-bill-app-v2', 'encrypted'); await vault.flush(); storage.setItem('courier-bill-app-v2', 'other');
  await assert.rejects(create(storage, webcrypto).unlock(key.toString('base64')), /differ/); assert.equal(storage.getItem('courier-bill-app-v2'), 'other');
});
test('concurrent browser tabs cannot silently overwrite the winning encrypted draft', async () => {
  const storage = new Storage(), a = create(storage, webcrypto), b = create(storage, webcrypto); await a.unlock(key.toString('base64')); await b.unlock(key.toString('base64'));
  a.setItem('courier-bill-app-v2', 'winner'); await a.flush(); b.setItem('courier-bill-app-v2', 'stale'); await assert.rejects(b.flush(), /Another tab/);
  const fresh = create(storage, webcrypto); await fresh.unlock(key.toString('base64')); assert.equal(fresh.getItem('courier-bill-app-v2'), 'winner');
});
test('CLI refuses repository output, absent authorization and unavailable disk', async () => {
  const { main, external } = require('../../server/scripts/business-backup');
  assert.throws(() => external(path.resolve('private.cbackup')), /outside/);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'courier-synthetic-recovery-'));
  try {
    const file = path.join(dir, 'key.backup-key'); await fs.writeFile(file, key);
    await assert.rejects(main(['create', '--key-file', file], { NODE_ENV: 'test' }), /authorize/);
    await assert.rejects(main(['keygen', '--key-file', path.join(dir, 'missing', 'key')]), /ENOENT/);
    const { writeVerifiedArchive } = require('../../server/services/backupFile');
    const archive = path.join(dir, 'synthetic.cbackup'), bytes = Archive.seal(empty(), key);
    await writeVerifiedArchive(archive, bytes, key); assert.deepEqual(Archive.open(await fs.readFile(archive), key).collections, empty().collections);
    await assert.rejects(writeVerifiedArchive(archive, bytes, key), /EEXIST/);
    const interrupted = path.join(dir, 'interrupted.cbackup');
    await assert.rejects(writeVerifiedArchive(interrupted, bytes, key, { signal: AbortSignal.abort() }), /interrupted/);
    await assert.rejects(fs.stat(interrupted), /ENOENT/); assert.ok((await fs.stat(interrupted + '.partial')).size > 0);
  } finally {
    const resolved = await fs.realpath(dir), temporary = await fs.realpath(os.tmpdir());
    assert.equal(path.dirname(resolved), temporary); assert.ok(path.basename(resolved).startsWith('courier-synthetic-recovery-'));
    await fs.rm(resolved, { recursive: true });
  }
});
