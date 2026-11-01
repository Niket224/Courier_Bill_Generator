const { createHash } = require('node:crypto');
const MongoStore = require('connect-mongo').default || require('connect-mongo');
function createSessionStore(clientPromise, config) {
  return MongoStore.create({ clientPromise, collectionName: 'operator_sessions',
    ttl: config.sessionMaxAge / 1000, autoRemove: 'native',
    // A database dump should not contain usable session-cookie IDs.
    transformId: (sid) => createHash('sha256').update(sid).digest('hex') });
}
module.exports = { createSessionStore };
