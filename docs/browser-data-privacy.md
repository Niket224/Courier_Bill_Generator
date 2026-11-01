# Browser draft privacy

## Key and storage model

The single operator's backend requires a new **BROWSER_DRAFT_KEY**, an independent random 32-byte key encoded as base64. Generate it once, store it in the hosting secret store and keep a protected recovery copy separate from customer backups. Do not derive it from the login password or rotate it casually. Changing the password/session secret does not change this key. Losing it makes existing browser ciphertext unrecoverable; the server archive does not contain it.

After authenticated session verification, the browser POSTs to `/api/privacy/draft-key` with a session-bound CSRF token. The response is `no-store`, protected by existing CORS and HTTPS deployment requirements. Web Crypto imports a non-extractable AES-GCM CryptoKey. The key and decrypted records stay in memory; neither passwords nor keys are placed in localStorage/sessionStorage/IndexedDB. This is server-assisted encryption, not encryption against the authenticated server or a malicious active operator.

Private storage keys retain their logical names with `.sealed-v1` suffixes; values contain only version, random IV and authenticated ciphertext. Every encryption uses a fresh 96-bit IV and authenticates the logical key name, preventing ciphertext substitution between entries. Current bill, bill archives, review archives and pending invoice-status operations are covered. Key names may reveal existence/count of drafts, but not their contents.

Edits queue encryption and display a local-storage state; server saves/publications wait for encrypted retry envelopes to persist. Destructive local replacement waits for a verified encrypted archive. Quota/encryption/conflict failures retain the working memory and previous persisted ciphertext and display failure. Keep the tab open and export current work before leaving. A before-unload warning is best effort; a power cut before asynchronous encryption finishes can lose the latest keystrokes.

Logout waits for pending storage, then removes private workspace state and DOM and drops the key. Absolute expiry clears access immediately; already queued encryption may finish using short-lived closure references before garbage collection. JavaScript cannot promise physical memory zeroization. Refresh requires authenticated online access to unlock again; an already unlocked tab can keep editing offline, but offline refresh cannot unlock without the server. This avoids storing a decryption key beside the encrypted drafts.

## Existing plaintext migration

Migration runs only after authentication and key delivery:

1. Read each known existing private entry without changing it.
2. Encrypt to a separate suffixed entry, read it back, authenticate/decrypt and compare the **exact original bytes**.
3. Verify the originals did not change during migration.
4. Only then remove the plaintext keys. Interrupted migration can safely resume when both copies match.

A differing plaintext/ciphertext pair, unavailable key, quota failure or corrupt ciphertext stops activation. Existing data is not replaced with empty state. Even unreadable legacy JSON is preserved byte-for-byte inside authenticated encryption and offered for recovery after sign-in. The recovery download may contain plaintext if migration could not complete; protect it. No actual operator browser was migrated during this task—only synthetic test profiles.

Before rollout, export each actual operator profile securely, provision and separately back up BROWSER_DRAFT_KEY, deploy the matching server/frontend/service worker, sign in, verify the current bill and archives, sign out, then sign back in and verify again. Keep the pre-update export until a recovery drill succeeds. Roll back by restoring a verified browser export in a compatible app; never paste ciphertext into the former plaintext slot. Old caches and historical source bundles can contain the former bundled samples; purge deployed static caches on rollout, without clearing the operator's draft storage.

## Export/import

Exports are versioned browser-only JSON with the active state and all known private recovery entries. No session, auth token, password hash, server key or MongoDB credentials are exported. The user confirms plaintext export and gets a request message, not an unsupported claim that the operating system saved the download. Validate the file after download.

Imports reject malformed JSON, prototype keys, known secret fields, wrong versions, missing required structure, unsafe images, dates and numeric values. Compatible legacy `{bill,rates,shipments}` files remain accepted. A summary precedes confirmation; the current draft is archived before replacement. Conflicting recovery entries are rejected. Persistence and readback are verified before success. If copying recovery entries fails, additional non-conflicting entries may remain preserved, but the current working draft remains unchanged and no successful import is reported. Corrupt archives require deliberate repair; they cannot silently replace a valid draft.

## Limits on shared devices

Encryption protects retained data after logout from casual localStorage inspection. It does not defend against malware, a compromised OS/browser extension, XSS running during an authenticated session, devtools used by an already authenticated operator, copied live cookies, or someone who possesses the server key. A still-valid authenticated cookie can unlock on refresh until logout/expiry. Use a dedicated OS account, disk encryption, screen locking and explicit logout. Old plaintext exports, browser forensic remnants and downloaded/printed PDFs are outside the vault. Do not claim secure erasure of storage sectors or absolute privacy on a hostile computer.
