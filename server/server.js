// Long-lived Node entry point; tests import runtime.js with an owned database.
if (process.env.NODE_ENV === 'test') throw new Error('Use the isolated test harness; server.js cannot start in test mode.');
const { safeLogger } = require('./operations');
const log = safeLogger();
async function boot() {
  require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });
  let config;
  try { config = require('./config/env').validateEnv(process.env); }
  catch (error) { console.error(error.message); throw new Error('Invalid configuration.'); }
  if (config.nodeEnv === 'test') throw new Error('Use the isolated test harness.');
  config.warnings.forEach(warning => console.warn(warning));
  const runtime = await require('./runtime').start(config, { log });
  const shutdown = () => runtime.shutdown().then(result => { process.exitCode = result.forced ? 1 : 0; }).catch(() => { log('shutdown_forced'); process.exitCode = 1; });
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  return runtime;
}
const startup = boot().catch(() => { log('startup_failed'); console.error('Startup refused. Check required environment configuration, database readiness and index permissions.'); process.exitCode = 1; });
module.exports = startup;
