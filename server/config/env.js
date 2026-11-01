// Pure validation: importing this module never loads files or opens connections.
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
    if (origin === '*') continue;
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) throw new Error();
    } catch {
      errors.push('ALLOWED_ORIGINS must contain comma-separated HTTP(S) origins or *.');
      break;
    }
  }
  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}\nSee .env.example for setup instructions.`);
  }
  return {
    port, nodeEnv, allowedOrigins,
    warnings: !env.GEMINI_API_KEY || !env.GEMINI_API_KEY.trim()
      ? ['GEMINI_API_KEY is missing; PDF rate-card parsing is unavailable. Set it to enable this feature.'] : []
  };
}

module.exports = { validateEnv, validatePort };
