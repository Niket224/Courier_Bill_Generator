const fs = require('node:fs/promises');
const Archive = require('./backupArchive');
async function writeVerifiedArchive(file, bytes, key, { signal } = {}) {
  Archive.open(bytes, key);
  const partial = file + '.partial';
  const handle = await fs.open(partial, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  if (signal?.aborted) throw new Error('Backup interrupted. Only an incomplete archive exists.');
  Archive.open(await fs.readFile(partial), key);
  await fs.link(partial, file); await fs.unlink(partial);
  return file;
}
module.exports = { writeVerifiedArchive };
