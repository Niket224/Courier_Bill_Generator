const { randomUUID } = require('node:crypto');
const Contract = require('../../mobile-bill-app/rate-card');
function card(shipperCode = 'TEST', rates = [{ targetName: 'patna', targetType: 'CITY', baseKg: 3, baseRate: 45, perKgRate: 15 }]) {
  return { shipperCode, clientInfo: { clientName: 'Synthetic Customer', address: 'Synthetic address', quotationDate: '2026-01-01' },
    globalRules: { minWeightKg: null, fuelSurchargePct: 20, notes: '' },
    rates: rates.map((row) => ({ ...row, formula: Contract.FORMULA, conditions: '' })) };
}
async function publishFixture(value) {
  const { saveDraft, publish } = require('../../server/services/rateCards');
  const Book = require('../../server/models/RateBook');
  const draft = await saveDraft({ requestId: randomUUID(), expectedRevision: 0, card: value });
  const existing = await Book.findById(value.shipperCode.toUpperCase()).lean();
  return publish({ requestId: randomUUID(), shipperCode: value.shipperCode, expectedRevision: existing?.revision || 0,
    draftId: String(draft.data._id), draftRevision: draft.data.revision, approved: true,
    acknowledgedWarnings: Contract.normalize(value).warnings.map((w) => w.code) }, 'synthetic-test-operator');
}
async function pdf() {
  const { PDFDocument, StandardFonts } = require('../../server/node_modules/pdf-lib');
  const document = await PDFDocument.create();
  const page = document.addPage([400, 400]); const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText('SYNTHETIC RATE CARD: PATNA base 3 kg Rs 45; extra Rs 15/kg.', { x: 15, y: 350, size: 9, font });
  return Buffer.from(await document.save({ useObjectStreams: false }));
}
module.exports = { card, publishFixture, pdf };
