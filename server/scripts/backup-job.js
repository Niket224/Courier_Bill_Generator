const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const Ops = require('../services/backupOperations');
async function main(env = process.env) {
  if (env.NODE_ENV === 'test' || env.BACKUP_JOB_APPROVED !== 'yes') throw new Error('Backup job requires explicit operator approval and is not activated by tests.');
  const config = { ...Ops.policy(env), approved: true, localDir: env.BACKUP_LOCAL_DIR, copyDir: env.BACKUP_COPY_DIR, keyFile: env.BACKUP_KEY_FILE };
  const result = await Ops.runJob(config, { createBackup: async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [path.join(__dirname, 'business-backup.js'), 'create', '--authorize-read', 'yes', '--key-file', config.keyFile, '--out-dir', config.localDir], { env, timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true });
    return JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
  } });
  console.log(JSON.stringify({ event: 'backup_job_verified', lastSuccessAt: result.lastSuccessAt }));
}
if (require.main === module) main().catch(() => { console.error(JSON.stringify({ event: 'backup_job_failed', action: 'Check authorization, lock, capacity, key, source and copy destination. No cleanup was performed.' })); process.exitCode = 1; });
module.exports = { main };
