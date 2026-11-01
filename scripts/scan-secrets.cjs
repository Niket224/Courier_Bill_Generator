const fs = require('node:fs');
const path = require('node:path');
const { listFiles, root } = require('./check.cjs');
function inspect(name, text) {
  // Exact, documented negative-test fixture; no general test-directory exemption for URI credentials.
  if (name === 'tests/unit/recovery.test.cjs') text = text.replaceAll('mongodb://' + 'user:password@' + '127.0.0.1:27017/db', 'mongodb://127.0.0.1:27017/db');
  if (/(^|\/)\.env(?:\.|$)/.test(name) && !name.endsWith('.env.example') || /\.(cbackup|backup-key|pem|key|partial|bson|dump)$/.test(name) || /(^|\/)(backups|recovery-data)\//.test(name)) return 'private-file';
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) return 'private-key';
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|AIza[A-Za-z0-9_-]{35})\b/.test(text)) return 'provider-token';
  if (/mongodb(?:\+srv)?:\/\/[^\s"'<>:@]+:[^\s"'<>@]+@(?![^\s/]*\.(?:test|invalid)\b)[^\s"'<>/]+/.test(text)) return 'database-credential';
  if (/^(?:SESSION_SECRET|BROWSER_DRAFT_KEY|GEMINI_API_KEY|ADMIN_PASSWORD_HASH)\s*=\s*['"]?[A-Za-z0-9_+/$=-]{25,}/m.test(text) && !name.startsWith('tests/') && !name.startsWith('server/test/')) return 'configured-secret';
  return null;
}
function main() {
  const findings = [];
  for (const name of listFiles()) {
    const banned = inspect(name, ''); if (banned) { findings.push({ file: name, rule: banned }); continue; }
    if (!/\.(js|cjs|mjs|json|md|txt|html|css|yml|yaml|example)$/.test(name)) continue;
    const file = path.join(root, name); if (fs.statSync(file).size > 4 * 1024 * 1024) throw new Error('Oversized source artifact requires manual review.');
    const rule = inspect(name, fs.readFileSync(file, 'utf8')); if (rule) findings.push({ file: name, rule });
  }
  if (findings.length) { console.error(JSON.stringify({ status: 'FAIL', findings })); process.exitCode = 1; }
  else console.log('Source secret/private-artifact safety scan passed. Ignored environment files were not read.');
}
if (require.main === module) { try { main(); } catch { console.error('Safety scan failed to complete.'); process.exitCode = 1; } }
module.exports = { inspect };
