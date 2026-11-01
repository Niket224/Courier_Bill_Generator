const { hashPassword } = require('../../server/security/password');
const password = 'Synthetic-only-password-2026!';
let hash;
async function authConfig(overrides = {}) {
  hash ||= hashPassword(password);
  return { nodeEnv: 'test', adminUsername: 'test-admin', adminPasswordHash: await hash,
    sessionSecret: 'synthetic-session-secret-for-tests-only-123456789', sessionMaxAge: 480 * 60000,
    allowedOrigins: ['http://127.0.0.1:4187', 'https://billing.example.test'], trustProxy: false, ...overrides };
}
module.exports = { authConfig, password };
