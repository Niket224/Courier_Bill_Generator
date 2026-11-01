const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Archive = require('./backupArchive');
function policy(env) {
  const retain = Number(env.BACKUP_RETAIN_COUNT ?? 7), maxAgeHours = Number(env.BACKUP_MAX_AGE_HOURS ?? 24), minFreeMb = Number(env.BACKUP_MIN_FREE_MB ?? 256);
  if (!Number.isInteger(retain) || retain < 1 || retain > 366 || !Number.isFinite(maxAgeHours) || maxAgeHours < 1 || maxAgeHours > 168 || !Number.isFinite(minFreeMb) || minFreeMb < 128 || minFreeMb > 1048576) throw new Error('Invalid backup operations policy.');
  return { retain, maxAgeHours, minFreeMb };
}
function assess(receipt, { maxAgeHours = 24 } = {}, now = Date.now()) {
  const success = Date.parse(receipt?.lastSuccessAt);
  const ageHours = (now - success) / 3600000;
  const alerts = [];
  if (!Number.isFinite(success) || ageHours < 0 || ageHours > maxAgeHours) alerts.push('BACKUP_STALE');
  if (receipt?.lastOutcome !== 'VERIFIED') alerts.push('BACKUP_FAILED');
  return { healthy: alerts.length === 0, alerts, ageHours: Number.isFinite(ageHours) && ageHours >= 0 ? Number(ageHours.toFixed(2)) : null };
}
function retentionPlan(verified, retain) {
  if (!Number.isInteger(retain) || retain < 1) throw new Error('At least one known-good backup must be retained.');
  const rows = verified.filter(x => x.verified === true && Number.isFinite(Date.parse(x.createdAt))).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { deletionEnabled: false, preserve: rows.slice(0, retain).map(x => x.file), reviewForArchive: rows.slice(retain).map(x => x.file) };
}
async function capacity(directory, minFreeMb) {
  const info = await fs.statfs(directory); const freeBytes = Number(info.bavail) * Number(info.bsize);
  if (!Number.isFinite(freeBytes) || freeBytes < minFreeMb * 1024 * 1024) throw new Error('BACKUP_STORAGE_LOW');
  return freeBytes;
}
async function receiptWrite(file, receipt) {
  const tmp = file + '.' + randomUUID() + '.partial';
  await fs.writeFile(tmp, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 }); await fs.rename(tmp, file);
}
async function runJob(config, { createBackup, now = () => new Date(), checkCapacity = capacity } = {}) {
  if (config.approved !== true) throw new Error('Explicit backup-job authorization is required.');
  const local = await fs.realpath(config.localDir), copy = await fs.realpath(config.copyDir);
  const external = require('../scripts/business-backup').external;
  external(local); external(copy);
  if (local === copy || path.relative(local, copy).split(path.sep)[0] !== '..' && !path.isAbsolute(path.relative(local, copy)) || path.relative(copy, local).split(path.sep)[0] !== '..' && !path.isAbsolute(path.relative(copy, local))) throw new Error('Backup copy destination must be separate from the local directory.');
  const keyLocation = external(await fs.realpath(config.keyFile));
  for (const directory of [local, copy]) { const relative = path.relative(directory, keyLocation); if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)) throw new Error('Keep the backup key outside archive directories.'); }
  const lockPath = path.join(local, '.backup-job.lock'); const lock = await fs.open(lockPath, 'wx', 0o600);
  const statusFile = path.join(local, 'backup-status.json'); let previous = {};
  try {
    try { previous = JSON.parse(await fs.readFile(statusFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Unreadable prior backup status; preserve it for investigation.'); }
    await checkCapacity(local, config.minFreeMb); await checkCapacity(copy, config.minFreeMb);
    const result = await createBackup();
    const file = await fs.realpath(result.file);
    if (path.dirname(file) !== local || !file.endsWith('.cbackup') || result.status !== 'VERIFIED_BACKUP') throw new Error('Backup creation was not confirmed.');
    const keyFile = external(await fs.realpath(config.keyFile)); const key = await fs.readFile(keyFile);
    try {
      if ((await fs.stat(file)).size > Archive.MAX_BYTES + 100) throw new Error('Backup exceeds supported limit.');
      const data = await fs.readFile(file); const manifest = Archive.open(data, key);
      const target = path.join(copy, path.basename(file));
      await require('./backupFile').writeVerifiedArchive(target, data, key);
      Archive.open(await fs.readFile(target), key);
      const completed = { version: 1, lastAttemptAt: now().toISOString(), lastSuccessAt: now().toISOString(), lastOutcome: 'VERIFIED', archive: path.basename(file), sourceCreatedAt: manifest.createdAt };
      await receiptWrite(statusFile, completed); return completed;
    } finally { key.fill(0); }
  } catch {
    await receiptWrite(statusFile, { version: 1, lastAttemptAt: now().toISOString(), lastSuccessAt: previous.lastSuccessAt || null, lastOutcome: 'FAILED' }).catch(() => {});
    throw new Error('BACKUP_JOB_FAILED');
  } finally { await lock.close(); await fs.unlink(lockPath); }
}
module.exports = { policy, assess, retentionPlan, capacity, runJob };
