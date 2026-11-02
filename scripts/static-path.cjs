const path = require('node:path');
const PUBLIC_FILES = new Set(['index.html', 'app.js', 'styles.css', 'auth.js', 'persistence.js', 'billing.js', 'browser-data.js', 'draft-vault.js', 'rate-card.js', 'rate-review.js', 'sw.js', 'manifest.webmanifest']);
function resolvePublicPath(root, requestUrl) {
  try {
    const pathname = decodeURIComponent(new URL(requestUrl, 'http://127.0.0.1').pathname);
    if (pathname.includes('\\') || pathname.includes('\0')) return null;
    const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
    const resolved = path.resolve(root, requested), relative = path.relative(root, resolved);
    if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) return null;
    if (relative.split(path.sep).some(segment => segment.startsWith('.'))) return null;
    if (!PUBLIC_FILES.has(requested) && !/^assets\/[A-Za-z0-9_./-]+\.(png|svg|webp|jpg|jpeg)$/.test(requested)) return null;
    return resolved;
  } catch { return null; }
}
module.exports = { resolvePublicPath, PUBLIC_FILES };
