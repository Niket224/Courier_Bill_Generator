const session = require('express-session');
const { Router } = require('express');
const { rateLimit } = require('express-rate-limit');
const { randomBytes, timingSafeEqual, createHash } = require('node:crypto');
const { verifyPassword } = require('./password');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const call = (target, method) => new Promise((resolve, reject) => target[method]((error) => error ? reject(error) : resolve()));
function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.length === b.length &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function limiter(limit, windowMs) {
  return rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false,
    message: { success: false, error: 'Too many requests. Please try again later.' } });
}
function createAuth(config, store, limits = {}) {
  if (!store) throw new Error('An explicit server-side session store is required.');
  const secure = config.nodeEnv === 'production';
  const cookieName = secure ? '__Host-courier.sid' : 'courier.sid';
  const cookie = { httpOnly: true, secure, sameSite: 'lax', path: '/' };
  const version = createHash('sha256').update(config.adminUsername + ':' + config.adminPasswordHash).digest('hex');
  const middleware = session({ name: cookieName, secret: config.sessionSecret, store,
    resave: false, saveUninitialized: false, rolling: false,
    cookie: { ...cookie, maxAge: config.sessionMaxAge } });
  function token(req) {
    if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('hex');
    return req.session.csrfToken;
  }
  function csrf(req, res, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const supplied = req.get('X-CSRF-Token');
    if (!/^[a-f0-9]{64}$/.test(supplied || '') || !equal(supplied, req.session.csrfToken)) {
      return res.status(403).json({ success: false, error: 'Security check failed. Sign in again.', code: 'CSRF_INVALID' });
    }
    next();
  }
  const requireAdmin = wrap(async (req, res, next) => {
    if (!req.session.admin || req.session.authVersion !== version || !Number.isFinite(req.session.expiresAt) || req.session.expiresAt <= Date.now()) {
      if (req.session.admin) await call(req.session, 'destroy');
      res.clearCookie(cookieName, cookie);
      return res.status(401).json({ success: false, error: 'Please sign in to continue.' });
    }
    next();
  });
  const router = Router();
  let verifying = false;
  router.get('/csrf', limiter(60, 15 * 60000), (req, res) => res.json({ csrfToken: token(req) }));
  // Per-IP and single-account global limits bound password hashing work.
  const globalLoginLimit = rateLimit({ windowMs: 15 * 60000, limit: limits.loginGlobal ?? 30,
    keyGenerator: () => 'single-admin', standardHeaders: 'draft-7', legacyHeaders: false,
    message: { success: false, error: 'Too many sign-in attempts. Please try again later.' } });
  router.post('/login', limiter(limits.login ?? 10, 15 * 60000), globalLoginLimit, csrf, wrap(async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || !username || username.length > 128 ||
        typeof password !== 'string' || !password || Buffer.byteLength(password) > 1024) {
      return res.status(400).json({ success: false, error: 'Enter a username and password.' });
    }
    if (verifying) return res.status(429).json({ success: false, error: 'A sign-in is already being checked. Please try again shortly.' });
    verifying = true;
    let verified;
    try { verified = await verifyPassword(password, config.adminPasswordHash); }
    finally { verifying = false; }
    if (!verified || username !== config.adminUsername) return res.status(401).json({ success: false, error: 'Invalid username or password.' });
    await call(req.session, 'regenerate');
    req.session.admin = true;
    req.session.authVersion = version;
    req.session.expiresAt = Date.now() + config.sessionMaxAge;
    const csrfToken = token(req);
    await call(req.session, 'save');
    res.json({ authenticated: true, csrfToken, expiresAt: req.session.expiresAt });
  }));
  router.get('/session', requireAdmin, (req, res) => res.json({ authenticated: true, csrfToken: token(req), expiresAt: req.session.expiresAt }));
  router.post('/logout', requireAdmin, csrf, wrap(async (req, res) => {
    await call(req.session, 'destroy');
    res.clearCookie(cookieName, cookie);
    res.json({ success: true });
  }));
  const pdfLimit = rateLimit({ windowMs: 60 * 60000, limit: limits.pdf ?? 10, keyGenerator: () => 'single-admin',
    standardHeaders: 'draft-7', legacyHeaders: false, message: { success: false, error: 'PDF request limit reached. Please try again later.' } });
  return { middleware, router, requireAdmin, csrf, pdfLimit };
}
module.exports = { createAuth };
