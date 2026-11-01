const express = require('express');
const cors = require('cors');
// Import routes
const rateRoutes = require('./routes/rateRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const aiRoutes = require('./routes/aiRoutes');


function createApp(config = { allowedOrigins: [] }) {
  const app = express();

  // CORS must run before body parsing and route definitions
  const allowedOriginRegex = /\.vercel\.app$/;
  const staticAllowedOrigins = [
    '*',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:4173',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:4173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173'
  ];

  const corsOptions = {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // Allow server-to-server / curl / Postman requests

      const customAllowed = config.allowedOrigins;

      if (
        staticAllowedOrigins.includes('*') ||
        staticAllowedOrigins.includes(origin) ||
        customAllowed.includes(origin) ||
        customAllowed.includes('*') ||
        allowedOriginRegex.test(origin)
      ) {
        return callback(null, true);
      }

      return callback(new Error(`CORS policy blocks access from origin: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'Courier Bill Generator API',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/rates', rateRoutes);
app.use('/api/rates', aiRoutes);
app.use('/api/invoices', invoiceRoutes);

// 404 handler for undefined endpoints
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Centralized error handling middleware
app.use((err, req, res, next) => {
  console.error('API Error:', err.message || err);
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

return app;
}
module.exports = { createApp };
