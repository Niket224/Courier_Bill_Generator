const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  _id: String, revision: { type: Number, required: true }, activeVersion: { type: Number, required: true },
  versions: [{ _id: false, version: Number, card: mongoose.Schema.Types.Mixed, draftId: String, draftRevision: Number,
    approvedBy: String, approvedAt: Date, warnings: [String], kind: String, sourceVersion: Number }],
  operations: [{ _id: false, requestId: String, hash: String, version: Number }]
}, { timestamps: true, bufferCommands: false });
schema.index({ 'operations.requestId': 1 }, { unique: true });
module.exports = mongoose.model('RateBook', schema);
