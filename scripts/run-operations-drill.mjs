import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testEnvironment } from './test-environment.mjs';
const result = spawnSync(process.execPath, [fileURLToPath(new URL('./operations-drill.cjs', import.meta.url))], { cwd: fileURLToPath(new URL('../', import.meta.url)), env: testEnvironment(), stdio: 'inherit' });
if (result.error) console.error('Disposable operations drill could not start.');
process.exitCode = result.status ?? 1;
