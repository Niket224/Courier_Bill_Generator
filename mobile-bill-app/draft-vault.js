(function (root, factory) {
  const value = factory(typeof module === 'object' && module.exports ? require('./browser-data') : root.BrowserData);
  if (typeof module === 'object' && module.exports) module.exports = value; else root.DraftVault = value.create(localStorage, crypto);
})(typeof window === 'undefined' ? globalThis : window, (Data) => {
  const suffix = '.sealed-v1'; const encoder = new TextEncoder();
  const b64 = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(text); };
  const un64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));
  function create(storage, crypt) {
    let key, generation = 0, values = new Map(), observed = new Map(), chain = Promise.resolve(), failure = null, pending = 0;
    const active = () => { if (!key) throw new Error('Sign in to unlock private drafts.'); };
    async function encrypt(name, raw, k) {
      const iv = crypt.getRandomValues(new Uint8Array(12));
      const bytes = await crypt.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(name), tagLength: 128 }, k, encoder.encode(raw));
      return JSON.stringify({ version: 1, iv: b64(iv), ciphertext: b64(new Uint8Array(bytes)) });
    }
    async function decrypt(name, raw, k) {
      const env = Data.parse(raw, Data.MAX * 2); if (env.version !== 1 || typeof env.iv !== 'string' || typeof env.ciphertext !== 'string' || un64(env.iv).length !== 12) throw new Error('Invalid encrypted draft.');
      return new TextDecoder('utf-8', { fatal: true }).decode(await crypt.subtle.decrypt({ name: 'AES-GCM', iv: un64(env.iv), additionalData: encoder.encode(name), tagLength: 128 }, k, un64(env.ciphertext)));
    }
    const names = () => Array.from({ length: storage.length }, (_, i) => storage.key(i));
    async function unlock(encoded) {
      const mine = ++generation; key = null; values.clear(); observed.clear(); failure = null;
      await chain;
      const bytes = un64(encoded); if (bytes.length !== 32) throw new Error('Browser encryption key is unavailable.');
      const k = await crypt.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']); bytes.fill(0);
      const recovered = new Map(), originals = [];
      for (const name of names()) {
        if (name.endsWith(suffix) && Data.privateKey(name.slice(0, -suffix.length))) {
          const logical = name.slice(0, -suffix.length), raw = storage.getItem(name);
          recovered.set(logical, await decrypt(logical, raw, k)); observed.set(logical, raw);
        }
      }
      for (const name of names().filter(Data.privateKey).filter(n => !n.endsWith(suffix))) {
        const raw = storage.getItem(name);
        if (recovered.has(name) && recovered.get(name) !== raw) throw new Error('Plaintext and encrypted drafts differ. Both copies were preserved; resolve the conflict before continuing.');
        const encrypted = observed.get(name) || await encrypt(name, raw, k);
        storage.setItem(name + suffix, encrypted);
        if (await decrypt(name, storage.getItem(name + suffix), k) !== raw) throw new Error('Draft migration verification failed. Original preserved.');
        recovered.set(name, raw); observed.set(name, encrypted); originals.push([name, raw]);
      }
      if (mine !== generation) return false;
      // Only remove each original after a persisted, authenticated round-trip matches it exactly.
      for (const [name, raw] of originals) { if (storage.getItem(name) !== raw) throw new Error('Draft changed during migration; originals retained.'); }
      for (const [name] of originals) storage.removeItem(name);
      values = recovered; key = k; return true;
    }
    function setItem(name, raw) {
      active(); if (!Data.privateKey(name) || typeof raw !== 'string' || encoder.encode(raw).length > Data.MAX) throw new Error('Invalid private storage entry.');
      const k = key, tracking = observed; values.set(name, raw); pending++;
      chain = chain.then(async () => {
        const sealed = await encrypt(name, raw, k);
        if (storage.getItem(name + suffix) !== (tracking.get(name) ?? null)) throw new Error('Another tab changed this draft. Keep this tab open and export your work.');
        storage.setItem(name + suffix, sealed);
        if (storage.getItem(name + suffix) !== sealed || await decrypt(name, sealed, k) !== raw) throw new Error('Encrypted draft verification failed.');
        tracking.set(name, sealed);
      }).catch(error => { failure = error; if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('courier:storage-error', { detail: 'Encrypted storage failed. Keep this tab open and export your work before leaving.' })); }).finally(() => { pending--; });
    }
    async function flush() { await chain; if (failure) throw failure; }
    function lock() { generation++; key = null; values.clear(); observed = new Map(); }
    return { unlock, flush, lock, setItem, getItem(name) { active(); return values.get(name) ?? null; },
      removeItem(name) { active(); values.delete(name); storage.removeItem(name + suffix); observed.delete(name); },
      key(i) { active(); return [...values.keys()][i] ?? null; }, get length() { active(); return values.size; },
      entries() { active(); return Object.fromEntries(values); }, get pending() { return pending > 0; }, isUnlocked: () => !!key, suffix };
  }
  return { create, suffix };
});
