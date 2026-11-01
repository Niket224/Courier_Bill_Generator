const { createDecipheriv } = require('node:crypto');
// Test-only key, never loaded by the application bundle. Inspect encrypted persistence after logout.
module.exports = async function readVault(page, name = 'courier-bill-app-v2') {
  const sealed = await page.evaluate(name => localStorage.getItem(name + '.sealed-v1'), name);
  const envelope = JSON.parse(sealed), bytes = Buffer.from(envelope.ciphertext, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.alloc(32, 7), Buffer.from(envelope.iv, 'base64'));
  decipher.setAAD(Buffer.from(name)); decipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString());
};
