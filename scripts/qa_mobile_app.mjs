// Portable assertions and fresh isolated browser contexts; failures propagate to CI.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { testEnvironment } from './test-environment.mjs';
const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), env: testEnvironment(), stdio: 'inherit'
});
if (result.error) console.error('Browser QA could not start:', result.error.code);
process.exitCode = result.status ?? 1;
