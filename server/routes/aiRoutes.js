const { Router } = require('express');
const multer = require('multer');
const { validatePdf } = require('../services/pdfValidation');
const { extract } = require('../services/geminiParser');
const { RateCardError } = require('../services/rateCards');
module.exports = function ({ config = {}, provider, timeoutMs, retries, totalMs, delayMs, uploadMs = 10000 } = {}) {
  const router = Router();
  let busy = false;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
    fileFilter(req, file, cb) { cb(null, file.mimetype === 'application/pdf' && /\.pdf$/i.test(file.originalname)); } }).single('pdf');
  router.post('/parse-pdf', async (req, res) => {
    if (busy) return res.status(429).json({ success: false, code: 'AI_BUSY', error: 'A PDF is already being processed. Please retry shortly.' });
    busy = true;
    const controller = new AbortController();
    const closed = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', closed);
    let timer;
    try {
      await new Promise((resolve, reject) => {
        timer = setTimeout(() => { req.unpipe(); req.resume(); reject(new RateCardError(408, 'UPLOAD_TIMEOUT', 'PDF upload timed out. Please retry.')); }, uploadMs);
        upload(req, res, (error) => { clearTimeout(timer); error ? reject(new RateCardError(400, 'INVALID_UPLOAD', 'Upload one PDF up to 10 MB with no extra form fields.')) : resolve(); });
      });
      if (!req.file?.buffer?.length) throw new RateCardError(400, 'PDF_REQUIRED', 'Upload one nonempty PDF file in the pdf field.');
      await validatePdf(req.file.buffer);
      const result = await extract(req.file.buffer, { config, provider, timeoutMs, retries, totalMs, delayMs, signal: controller.signal });
      if (!res.destroyed) res.json({ success: true, data: result.card, issues: result.issues, warnings: result.warnings, complete: result.complete, status: 'REVIEW_REQUIRED' });
    } catch (error) {
      const safe = error instanceof RateCardError ? error : new RateCardError(500, 'PDF_FAILED', 'PDF processing failed. No rates were changed.');
      if (safe.status === 429) res.set('Retry-After', '30');
      if (!res.headersSent && !res.destroyed) res.status(safe.status).json({ success: false, code: safe.code, error: safe.message });
    } finally {
      clearTimeout(timer); controller.abort(); res.removeListener('close', closed);
      if (req.file) req.file.buffer = undefined;
      busy = false;
    }
  });
  return router;
};
