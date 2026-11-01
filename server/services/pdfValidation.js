const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { RateCardError } = require('./rateCards');
function reject() { throw new RateCardError(400, 'INVALID_PDF', 'Upload a nonempty, unencrypted standard PDF (up to 10 MB and 20 pages). Re-export compressed-object, interactive or damaged PDFs before retrying.'); }
async function validatePdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100 || buffer.length > 10 * 1024 * 1024 || !/^%PDF-(1\.[0-7]|2\.0)/.test(buffer.subarray(0, 9).toString('ascii'))) reject();
  const tail = buffer.subarray(-1024).toString('latin1');
  const end = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if (!end || Number(end[1]) >= buffer.length || buffer.subarray(Number(end[1]), Number(end[1]) + 4).toString() !== 'xref') reject();
  const source = buffer.toString('latin1').replace(/#([0-9a-f]{2})/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
  // Conservative accepted subset: no object-stream decompression or active content.
  if (/\/(ObjStm|XRef|Encrypt|JavaScript|JS|OpenAction|AA|Launch|EmbeddedFile|XFA|RichMedia)\b/i.test(source) || (source.match(/\b\d+\s+\d+\s+obj\b/g) || []).length > 5000) reject();
  return new Promise((resolve, rejectPromise) => {
    const worker = new Worker(path.join(__dirname, 'pdf-worker.js'), { workerData: buffer, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 } });
    let settled = false;
    const finish = (value) => {
      if (settled) return; settled = true; clearTimeout(timer); worker.terminate();
      if (value?.valid) resolve(value);
      else rejectPromise(new RateCardError(400, 'INVALID_PDF', 'PDF is malformed, unsupported, or exceeds safe parsing limits. Re-export it and retry.'));
    };
    const timer = setTimeout(() => finish(null), 3000);
    worker.once('message', finish); worker.once('error', () => finish(null)); worker.once('exit', () => finish(null));
  });
}
module.exports = { validatePdf };
