const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { resolvePublicPath } = require('../../scripts/static-path.cjs');
test('static hosting rejects encoded sibling traversal, malformed URLs and private files without exposing content', () => {
  const root = path.resolve('synthetic/mobile-bill-app');
  for (const url of ['/%2e%2e%2fmobile-bill-app-sibling/private.json', '/%zz', '/%2e%2e%5cserver%5c.env', '/.env', '/.git/config', '/server/server.js', '/backup.json', '/assets/.env', '/assets/../../server/.env', '/assets/%00.png']) assert.equal(resolvePublicPath(root, url), null, url);
  assert.equal(resolvePublicPath(root, '/'), path.join(root, 'index.html'));
  assert.equal(resolvePublicPath(root, '/app.js?v=11'), path.join(root, 'app.js'));
  assert.equal(resolvePublicPath(root, '/assets/logo.png'), path.join(root, 'assets/logo.png'));
});
test('coverage threshold failure produces nonzero exit even when the assertions pass', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'courier-coverage-acceptance-'));
  try {
    const file = path.join(directory, 'example.test.cjs');
    await fs.writeFile(path.join(directory, 'logic.cjs'), 'module.exports = function uncalled(){\n return 42;\n};\n');
    await fs.writeFile(file, "const {test}=require('node:test');\nrequire('./logic.cjs');\ntest('synthetic passing assertion',()=>{});\n");
    const { testEnvironment } = await import('../../scripts/test-environment.mjs');
    const result = spawnSync(process.execPath, ['--test', '--experimental-test-coverage', '--test-coverage-include=**/logic.cjs', '--test-coverage-lines=100', file], { encoding: 'utf8', cwd: directory, env: testEnvironment() });
    assert.equal(result.status, 1, result.stdout + result.stderr); assert.match(result.stdout + result.stderr, /coverage|threshold/i);
  } finally { const resolved = await fs.realpath(directory); assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('courier-coverage-acceptance-')); await fs.rm(resolved, { recursive: true }); }
});
