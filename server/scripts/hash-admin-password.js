const { hashPassword } = require('../security/password');
const { emitKeypressEvents } = require('node:readline');
const { randomBytes } = require('node:crypto');
async function main() {
  if (!process.stdin.isTTY) throw new Error('Run in an interactive terminal. Password input is hidden.');
  process.stdout.write('Admin password (12+ characters; hidden): ');
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  let password = '';
  try {
    password = await new Promise((resolve, reject) => {
      const read = (text, key = {}) => {
        if (key.ctrl && key.name === 'c') { process.stdin.off('keypress', read); reject(new Error('Cancelled.')); }
        else if (key.name === 'return') { process.stdin.off('keypress', read); resolve(password); }
        else if (key.name === 'backspace') password = Array.from(password).slice(0, -1).join('');
        else if (!key.ctrl && !key.meta && text && !/[\x00-\x1f\x7f]/.test(text) && Buffer.byteLength(password + text) <= 1024) password += text;
      };
      process.stdin.on('keypress', read);
      process.stdin.resume();
    });
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write('\n');
  }
  const hash = await hashPassword(password);
  password = '';
  // Only the hash and independent random session secret are printed.
  console.log(`ADMIN_PASSWORD_HASH='${hash}'\nSESSION_SECRET=${randomBytes(48).toString('base64url')}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
