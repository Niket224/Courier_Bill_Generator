import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { testEnvironment } from './test-environment.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2] || 'unit';
if (!['unit', 'integration', 'coverage'].includes(mode)) throw new Error('Unknown test suite');
// Do not inherit credentials, dotenv loaders, or MongoDB binary overrides.
const env = testEnvironment();
const args = ['--test'];
if (mode === 'coverage') args.push('--experimental-test-coverage', '--test-coverage-include=server/**/*.js', '--test-coverage-exclude=**/node_modules/**', '--test-coverage-exclude=**/test/**');
args.push(...(mode === 'integration' ? ['server/test/integration/*.test.js'] : ['server/test/*.test.js', 'tests/unit/*.test.cjs']));
if (mode === 'coverage') args.push('server/test/integration/*.test.js');
const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
if (result.error) console.error('Test runner could not start:', result.error.code);
process.exitCode = result.status ?? 1;
