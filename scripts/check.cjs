const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function validateWorkflow(value) {
  const text = JSON.stringify(value);
  if (!value.on?.pull_request?.branches?.includes('main') || !value.on?.push?.branches?.includes('fix/production-hardening') || value.permissions?.contents !== 'read' || Object.keys(value.permissions).length !== 1 || /pull_request_target|secrets\.|id-token|write-all/.test(text)) throw new Error('Unsafe CI triggers or permissions.');
  const job = value.jobs?.verify;
  if (!job || job['runs-on'] !== 'ubuntu-24.04' || job['timeout-minutes'] > 30 || job.steps.some(s => s['continue-on-error'])) throw new Error('Invalid CI failure policy.');
  const runs = job.steps.filter(s => s.run).map(s => s.run).join('\n');
  for (const command of ['npm ci', 'npm ci --prefix server', 'npx playwright install --with-deps chromium', 'npm run check', 'npm run check:secrets', 'npm test', 'npm run test:coverage', 'npm audit --audit-level=moderate', 'npm audit --prefix server --audit-level=moderate', 'npm run test:operations']) if (!runs.includes(command)) throw new Error('Missing required CI command.');
  if (/deploy|business:backup|BACKUP_SOURCE_URI|MONGO_URI|\|\|\s*(true|echo)/.test(runs)) throw new Error('CI must not deploy, ignore failures or use real backup credentials.');
  for (const s of job.steps.filter(s => s.uses)) if (!/^actions\/(checkout|setup-node|upload-artifact)@[a-f0-9]{40}$/.test(s.uses)) throw new Error('CI actions must be approved and SHA-pinned.');
  if (job.steps.find(s => s.uses?.startsWith('actions/checkout'))?.with?.['persist-credentials'] !== false) throw new Error('CI credentials must not persist.');
  return true;
}
function listFiles() {
  const result = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Could not enumerate source files safely.');
  return [...new Set(result.stdout.split('\0').filter(Boolean))];
}
function main() {
  const files = listFiles().filter(f => /\.(js|cjs|mjs)$/.test(f));
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`Syntax check failed: ${file}`);
  }
  validateWorkflow(JSON.parse(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')));
  console.log(`Syntax checked ${files.length} JavaScript files; workflow JSON/YAML and safety policy validated. No linter is configured.`);
}
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { validateWorkflow, listFiles, root };
