// No dotenv loading. No implicit MONGO_URI. Explicit CLI access is separate from the web app.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { MongoClient } = require('mongoose').mongo;
const Archive = require('../services/backupArchive');
const Recovery = require('../services/businessRecovery');
const root = path.resolve(__dirname, '../..');
function external(filename) {
  const resolved = path.resolve(filename || '');
  const relative = path.relative(root, resolved);
  if (!filename || !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('Backup files and keys must be outside the repository.');
  return resolved;
}
async function main(argv = process.argv.slice(2), env = process.env) {
  const [command, ...rest] = argv; const flags = {};
  for (let i = 0; i < rest.length; i += 2) { if (!rest[i].startsWith('--') || rest[i + 1] === undefined) throw new Error('Use explicit option/value pairs.'); flags[rest[i].slice(2)] = rest[i + 1]; }
  if (Object.keys(flags).some(k => !['key-file', 'file', 'out-dir', 'authorize-read'].includes(k))) throw new Error('Unknown option.');
  let keyFile = external(flags['key-file']);
  keyFile = external(path.join(await fs.realpath(path.dirname(keyFile)), path.basename(keyFile)));
  if (command === 'keygen') { await fs.writeFile(keyFile, randomBytes(32), { flag: 'wx', mode: 0o600 }); console.log('Backup key created. Store a separate protected recovery copy.'); return; }
  keyFile = external(await fs.realpath(keyFile));
  const key = await fs.readFile(keyFile); if (key.length !== 32) throw new Error('Backup key must contain exactly 32 bytes.');
  let client;
  try {
    if (command === 'verify' || command === 'restore') {
      const file = external(flags.file); const stat = await fs.stat(file); if (stat.size > Archive.MAX_BYTES + 100) throw new Error('Archive exceeds safety limit.');
      const manifest = Archive.open(await fs.readFile(file), key);
      if (command === 'verify') { console.log(JSON.stringify({ status: 'VERIFIED_ARCHIVE', createdAt: manifest.createdAt, counts: manifest.inventory.map(({ name, count }) => ({ name, count })) })); return; }
      Recovery.assertRestoreUri(env.RESTORE_MONGO_URI);
      client = new MongoClient(env.RESTORE_MONGO_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 30000 }); await client.connect();
      console.log(JSON.stringify(await Recovery.restore(client, manifest))); return;
    }
    if (command !== 'create' || flags['authorize-read'] !== 'yes') throw new Error('Backup creation requires create --authorize-read yes and explicit source configuration.');
    if (env.NODE_ENV === 'test') throw new Error('CLI source backups are disabled in tests; use the isolated harness.');
    if (!env.BACKUP_SOURCE_URI || !/^[A-Za-z0-9_-]{1,64}$/.test(env.BACKUP_SOURCE_DB || '')) throw new Error('BACKUP_SOURCE_URI and BACKUP_SOURCE_DB are required; MONGO_URI is never used.');
    const directory = external(flags['out-dir']);
    const realDirectory = await fs.realpath(directory); external(realDirectory);
    client = new MongoClient(env.BACKUP_SOURCE_URI, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 30000 }); await client.connect();
    const manifest = await Recovery.capture(client, env.BACKUP_SOURCE_DB);
    const bytes = Archive.seal(manifest, key); Archive.open(bytes, key);
    const file = path.join(realDirectory, `courier-business-v1-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.cbackup`);
    await require('../services/backupFile').writeVerifiedArchive(file, bytes, key);
    console.log(JSON.stringify({ status: 'VERIFIED_BACKUP', file, createdAt: manifest.createdAt, records: manifest.inventory.reduce((n, x) => n + x.count, 0) }));
  } finally { key.fill(0); if (client) await client.close(); }
}
if (require.main === module) main().catch(() => { console.error('Backup/recovery failed. No success was confirmed. Check configuration, key, archive integrity, replica-set support and storage availability. Sensitive details are not logged.'); process.exitCode = 1; });
module.exports = { main, external };
