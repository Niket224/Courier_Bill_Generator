const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  shipperCode: { type: String, required: true, immutable: true, index: true },
  revision: { type: Number, required: true }, card: { type: mongoose.Schema.Types.Mixed, required: true },
  operations: [{ _id: false, requestId: String, hash: String, revision: Number }]
}, { timestamps: true, bufferCommands: false });
schema.index({ 'operations.requestId': 1 }, { unique: true });
module.exports = mongoose.model('RateCardDraft', schema);
