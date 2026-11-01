const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
test('QA wrapper propagates an actual assertion failure as exit 1', () => {
  const root = path.resolve(__dirname, '../..');
  const result = spawnSync(process.execPath, ['scripts/qa_mobile_app.mjs', '--config', 'tests/fixtures/failure/playwright.config.cjs'], {
    cwd: root, env: process.env, encoding: 'utf8', timeout: 30000
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /1 failed/);
  assert.match(result.stdout, /intentional assertion failure/);
});
