const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { createAuth } = require('./security/auth');
const rateRoutes = require('./routes/rateRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const aiRoutes = require('./routes/aiRoutes');
const rateCardRoutes = require('./routes/rateCardRoutes');

function createApp(config, { sessionStore, limits, aiProvider, aiOptions } = {}) {
  if (!config?.sessionSecret || !config.adminPasswordHash || !Array.isArray(config.allowedOrigins)) {
    throw new Error('Validated security configuration is required.');
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy || false);
  app.use(helmet());
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
      const error = new Error('Origin not allowed.');
      error.status = 403;
      callback(error);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token']
  }));
  // Login bodies stay small; invoice JSON has a separate bounded limit.
  app.use('/api/auth', express.json({ limit: '4kb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 50 }));
  app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'Courier Bill Generator API', timestamp: new Date().toISOString() }));
  const auth = createAuth(config, sessionStore, limits);
  app.use('/api', auth.middleware);
  app.use('/api/auth', auth.router);
  app.post('/api/privacy/draft-key', auth.requireAdmin, auth.csrf, (req, res) => {
    if (!config.browserDraftKey) return res.status(503).json({ success: false, error: 'Browser encryption is not configured. Existing drafts are preserved.' });
    res.json({ success: true, key: config.browserDraftKey });
  });
  app.use('/api/rates', auth.requireAdmin, auth.csrf);
  app.post('/api/rates/parse-pdf', auth.pdfLimit);
  app.use('/api/rates', rateRoutes, aiRoutes({ config, provider: aiProvider, ...aiOptions }));
  app.use('/api/rate-cards', auth.requireAdmin, auth.csrf, rateCardRoutes(config.adminUsername));
  app.use('/api/invoices', auth.requireAdmin, auth.csrf, invoiceRoutes);
  app.use((req, res) => res.status(404).json({ success: false, error: 'Endpoint not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 :
      error.status === 403 ? 403 : ['ValidationError', 'CastError'].includes(error.name) ? 400 : 500;
    const messages = { 400: 'Invalid request.', 403: 'Origin not allowed.', 413: 'Request is too large.', 500: 'Unable to complete request. Please try again.' };
    // Do not log request bodies, provider errors, MongoDB URLs, or session values.
    res.status(status).json({ success: false, error: messages[status] });
  });
  return app;
}
module.exports = { createApp };
