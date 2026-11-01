const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const RELEASE = 'courier-phase6';
const PROTOCOL = 'courier-api-v1';
const EVENTS = new Set(['request', 'startup_ready', 'startup_failed', 'shutdown_started', 'shutdown_complete', 'shutdown_forced', 'database_disconnected', 'database_connected', 'database_error']);
function safeLogger(sink = line => process.stdout.write(line + '\n')) {
  return (event, data = {}) => {
    if (!EVENTS.has(event)) return;
    const record = { time: new Date().toISOString(), event };
    if (/^[a-f0-9-]{36}$/.test(data.requestId || '')) record.requestId = data.requestId;
    if (['health', 'auth', 'invoice', 'rates', 'ai', 'privacy', 'ops', 'other'].includes(data.area)) record.area = data.area;
    if (['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'].includes(data.method)) record.method = data.method;
    if (Number.isInteger(data.status) && data.status >= 100 && data.status <= 599) record.status = data.status;
    if (Number.isFinite(data.durationMs) && data.durationMs >= 0) record.durationMs = Math.round(data.durationMs);
    try { sink(JSON.stringify(record)); } catch { /* Logging failure must not corrupt business requests. */ }
  };
}
function area(path) {
  if (path.startsWith('/api/health')) return 'health';
  if (path.startsWith('/api/auth')) return 'auth';
  if (path.startsWith('/api/invoices')) return 'invoice';
  if (path === '/api/rates/parse-pdf') return 'ai';
  if (path.startsWith('/api/rates') || path.startsWith('/api/rate-cards')) return 'rates';
  if (path.startsWith('/api/privacy')) return 'privacy';
  if (path.startsWith('/api/ops')) return 'ops';
  return 'other';
}
function createOperations({ probe, log = safeLogger(), deadlineMs = 1500 } = {}) {
  const started = Date.now(); let draining = false;
  const counters = { requests: 0, serverErrors: 0, authFailures: 0, invoiceFailures: 0, aiFailures: 0, rateFailures: 0 };
  async function ready() {
    if (draining) return false;
    let timer;
    try { return !!await Promise.race([Promise.resolve().then(probe || (async () => {
      const connection = require('mongoose').connection;
      if (connection.readyState !== 1) return false;
      await connection.db.command({ ping: 1 }, { maxTimeMS: 1000 });
      await connection.db.collection('operator_sessions').findOne({ _id: '__readiness__' }, { projection: { _id: 1 }, maxTimeMS: 1000 });
      return true;
    })), new Promise(resolve => { timer = setTimeout(() => resolve(false), deadlineMs); })]); }
    catch { return false; } finally { clearTimeout(timer); }
  }
  function middleware(req, res, next) {
    const requestId = randomUUID(), begin = performance.now(), group = area(req.path);
    req.requestId = requestId; res.set('X-Request-ID', requestId); res.set('X-Courier-Release', RELEASE); res.set('X-Courier-Protocol', PROTOCOL);
    res.once('finish', () => {
      counters.requests++; const status = res.statusCode;
      if (status >= 500) counters.serverErrors++;
      if (group === 'auth' && [400, 401, 403, 429].includes(status)) counters.authFailures++;
      if (group === 'invoice' && req.method !== 'GET' && status >= 400) counters.invoiceFailures++;
      if (group === 'ai' && status >= 400) counters.aiFailures++;
      if (group === 'rates' && req.method !== 'GET' && status >= 400) counters.rateFailures++;
      log('request', { requestId, area: group, method: req.method, status, durationMs: performance.now() - begin });
    });
    if (draining && !req.path.startsWith('/api/health')) return res.status(503).json({ success: false, code: 'DRAINING', error: 'Server is restarting. Retry the same saved request shortly.' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Courier-Protocol') && req.get('X-Courier-Protocol') !== PROTOCOL) return res.status(409).json({ success: false, code: 'CLIENT_VERSION', error: 'Reload the application before making changes. Your draft is preserved.' });
    next();
  }
  return { ready, middleware, log, drain() { draining = true; }, status() { return { uptimeSeconds: Math.floor((Date.now() - started) / 1000), draining, counters: { ...counters } }; } };
}
module.exports = { RELEASE, PROTOCOL, safeLogger, createOperations };
