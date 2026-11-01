const { scrypt, randomBytes, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const HASH_PATTERN = /^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/;

async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 1024) {
    throw new Error('Password must have at least 12 characters and at most 1024 bytes.');
  }
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64, options);
  return `scrypt$131072$8$1$${salt}$${key.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || Buffer.byteLength(password) > 1024 || !HASH_PATTERN.test(encoded)) return false;
  const parts = encoded.split('$');
  const actual = await derive(password, parts[4], 64, options);
  return timingSafeEqual(actual, Buffer.from(parts[5], 'hex'));
}
module.exports = { hashPassword, verifyPassword, HASH_PATTERN };
