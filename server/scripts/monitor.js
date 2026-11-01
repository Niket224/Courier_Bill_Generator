const fs = require('node:fs/promises');
const path = require('node:path');
const Ops = require('../services/backupOperations');
async function monitor(env = process.env, request = fetch) {
  const base = new URL(env.MONITOR_BASE_URL || 'http://127.0.0.1:5000');
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/' || base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('Use an explicit HTTPS origin or loopback development origin.');
  const result = { event: 'operations_check', alerts: [] };
  for (const name of ['live', 'ready']) {
    try { const response = await request(new URL(`/api/health/${name}`, base), { signal: AbortSignal.timeout(3000), redirect: 'error' }); const data = await response.json(); if (!response.ok || data.status !== (name === 'live' ? 'alive' : 'ready')) result.alerts.push(name === 'live' ? 'BACKEND_DOWN' : 'DATABASE_NOT_READY'); }
    catch { result.alerts.push(name === 'live' ? 'BACKEND_DOWN' : 'DATABASE_NOT_READY'); }
  }
  const policy = Ops.policy(env);
  if (!env.BACKUP_STATUS_FILE) result.alerts.push('BACKUP_MONITOR_NOT_CONFIGURED');
  else {
    try {
      const file = require('./business-backup').external(await fs.realpath(env.BACKUP_STATUS_FILE));
      const receipt = JSON.parse(await fs.readFile(file, 'utf8')); result.backup = Ops.assess(receipt, policy); result.alerts.push(...result.backup.alerts);
      result.freeMb = Math.floor(await Ops.capacity(path.dirname(file), policy.minFreeMb) / 1048576);
      if (typeof receipt.archive !== 'string' || path.basename(receipt.archive) !== receipt.archive || !receipt.archive.endsWith('.cbackup')) result.alerts.push('BACKUP_ARCHIVE_UNCONFIRMED');
      else {
        const localArchive = await fs.stat(path.join(path.dirname(file), receipt.archive));
        if (localArchive.size < 44) result.alerts.push('BACKUP_ARCHIVE_UNCONFIRMED');
        if (!env.BACKUP_COPY_DIR) result.alerts.push('BACKUP_COPY_NOT_CONFIGURED');
        else {
          const copyDirectory = require('./business-backup').external(await fs.realpath(env.BACKUP_COPY_DIR));
          const copiedArchive = await fs.stat(path.join(copyDirectory, receipt.archive));
          if (copiedArchive.size !== localArchive.size) result.alerts.push('BACKUP_COPY_UNCONFIRMED');
          await Ops.capacity(copyDirectory, policy.minFreeMb);
        }
      }
    } catch { result.alerts.push('BACKUP_STATUS_OR_STORAGE_UNAVAILABLE'); }
  }
  result.healthy = result.alerts.length === 0; return result;
}
if (require.main === module) monitor().then(result => { console.log(JSON.stringify(result)); process.exitCode = result.healthy ? 0 : 1; }).catch(() => { console.error('Monitoring configuration invalid.'); process.exitCode = 1; });
module.exports = { monitor };
