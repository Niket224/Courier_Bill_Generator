const { randomUUID } = require('node:crypto');
async function seed() {
  const mongoose = require('../../server/node_modules/mongoose');
  const Client = require('../../server/models/Client');
  const { Shipment } = require('../../server/models/Shipment');
  const { saveInvoice, transitionInvoice } = require('../../server/services/invoicePersistence');
  const adapter = require('../../mobile-bill-app/persistence');
  const cards = require('./rate-card.cjs');
  await Promise.all([Client.init(), Shipment.init(), require('../../server/models/Rate').init()]);
  const clients = await Client.create([{ shipperCode: 'TEST', name: 'Synthetic recovery client', address: 'Synthetic address' }, { shipperCode: 'RECOVERY-2', name: 'Synthetic second client' }]);
  await cards.publishFixture(cards.card());
  const invoices = [];
  for (const status of ['GENERATED', 'PAID', 'CANCELLED', 'CORRECTION']) {
    const state = structuredClone(require('./bill.json')); state.bill.invoiceNo = `RECOVERY-${status}`;
    state.invoiceMetadata = { client: String(clients[0]._id), notes: 'Synthetic recovery note' };
    const input = adapter.payload(state, 'GENERATED', () => ({ status: 'ok', amount: 45 }), () => ({ gross: 45, fuel: 9, subtotal: 54, cgst: 4.86, sgst: 4.86, igst: 0, final: 63.72 }));
    if (status === 'CORRECTION') { input.correctionOf = 'RECOVERY-GENERATED'; input.correctionReason = 'Synthetic correction'; }
    let { invoice } = await saveInvoice({ ...input, requestId: randomUUID(), expectedVersion: 0 });
    if (['PAID', 'CANCELLED'].includes(status)) ({ invoice } = await transitionInvoice(String(invoice._id), { requestId: randomUUID(), expectedVersion: invoice.revision, status, reason: 'Synthetic lifecycle reference' }));
    invoices.push(invoice.toObject ? invoice.toObject() : invoice);
  }
  await Shipment.create({ invoiceId: invoices[0]._id, awb: 'RECOVERY-STANDALONE', amount: 45 });
  const changed = cards.card(); changed.rates[0].baseRate = 90; await cards.publishFixture(changed);
  await mongoose.connection.db.collection('sessions').insertOne({ _id: 'synthetic-excluded-session', session: 'not-a-real-session' });
  await mongoose.connection.db.collection('operator_sessions').insertOne({ _id: 'synthetic-excluded-operator-session', session: 'not-a-real-session', expires: new Date(Date.now() + 600000) });
  return invoices;
}
module.exports = { seed };
