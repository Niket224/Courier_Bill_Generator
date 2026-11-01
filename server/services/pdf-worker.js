const { parentPort, workerData } = require('node:worker_threads');
const { PDFDocument } = require('pdf-lib');
// Never forward parser diagnostics (which may quote document bytes).
console.warn = console.error = console.log = () => {};
(async () => {
  try {
    const doc = await PDFDocument.load(new Uint8Array(workerData), { ignoreEncryption: false, throwOnInvalidObject: true, updateMetadata: false });
    const pages = doc.getPages();
    if (!pages.length || pages.length > 20) throw new Error();
    for (const page of pages) { const { width, height } = page.getSize(); if (![width, height].every((v) => Number.isFinite(v) && v > 0 && v <= 20000)) throw new Error(); }
    parentPort.postMessage({ valid: true, pages: pages.length });
  } catch { parentPort.postMessage({ valid: false }); }
})();
