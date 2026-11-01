// Pure validation: importing this module never loads files or opens connections.
const { securityConfig } = require('./security');
function validatePort(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return Number(value);
}

function validateEnv(env) {
  const errors = [];
  if (!env.MONGO_URI || !env.MONGO_URI.trim()) {
    errors.push('MONGO_URI is required. Set a MongoDB connection URI.');
  } else if (!/^mongodb(?:\+srv)?:\/\/[^\s/?#]+(?:[/?][^\s]*)?$/.test(env.MONGO_URI)) {
    errors.push('MONGO_URI must be a mongodb:// or mongodb+srv:// connection URI.');
  }
  let port;
  try { port = validatePort(env.PORT, 5000); } catch (error) { errors.push(error.message); }
  const nodeEnv = env.NODE_ENV === undefined ? 'development' : env.NODE_ENV;
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    errors.push('NODE_ENV must be development, production, or test.');
  }
  const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || origin.includes('*') ||
          (nodeEnv === 'production' && url.protocol !== 'https:')) throw new Error();
    } catch {
      errors.push('ALLOWED_ORIGINS must contain explicit HTTP(S) origins (HTTPS in production); wildcards are forbidden.');
      break;
    }
  }
  if (nodeEnv === 'production' && !allowedOrigins.length) errors.push('ALLOWED_ORIGINS is required in production.');
  let security;
  const bindHost = env.BIND_HOST || '127.0.0.1';
  if (!['127.0.0.1', '0.0.0.0'].includes(bindHost)) errors.push('BIND_HOST must be 127.0.0.1 or 0.0.0.0.');
  const shutdownTimeoutMs = env.SHUTDOWN_TIMEOUT_MS ?? '10000';
  if (!/^\d+$/.test(shutdownTimeoutMs) || +shutdownTimeoutMs < 1000 || +shutdownTimeoutMs > 30000) errors.push('SHUTDOWN_TIMEOUT_MS must be 1000–30000.');
  const geminiModel = env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (!/^gemini-[a-z0-9][a-z0-9.-]{1,80}$/.test(geminiModel)) errors.push('GEMINI_MODEL must be a documented Gemini model identifier.');
  const geminiTimeoutMs = env.GEMINI_TIMEOUT_MS ?? '8000';
  const geminiRetries = env.GEMINI_RETRIES ?? '2';
  if (!/^\d+$/.test(geminiTimeoutMs) || +geminiTimeoutMs < 1000 || +geminiTimeoutMs > 10000) errors.push('GEMINI_TIMEOUT_MS must be 1000–10000.');
  if (!/^[0-2]$/.test(geminiRetries)) errors.push('GEMINI_RETRIES must be 0, 1 or 2.');
  try { security = securityConfig(env); } catch (error) { errors.push(error.message); }
  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}\nSee .env.example for setup instructions.`);
  }
  return {
    port, nodeEnv, bindHost, shutdownTimeoutMs: +shutdownTimeoutMs, allowedOrigins, ...security, geminiModel, geminiTimeoutMs: +geminiTimeoutMs, geminiRetries: +geminiRetries,
    warnings: !env.GEMINI_API_KEY || !env.GEMINI_API_KEY.trim()
      ? ['GEMINI_API_KEY is missing; PDF rate-card parsing is unavailable. Set it to enable this feature.'] : []
  };
}

module.exports = { validateEnv, validatePort };
