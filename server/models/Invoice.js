const mongoose = require('mongoose');
const { shipmentSchema } = require('./Shipment');

const invoiceSchema = new mongoose.Schema(
  {
    schemaVersion: Number,
    revision: { type: Number, min: 1 },
    totalsVerified: { type: Boolean, default: false },
    reconstructionComplete: { type: Boolean, default: false },
    calculationContract: String,
    snapshot: mongoose.Schema.Types.Mixed,
    correctionOf: { type: String, default: '' },
    correctionReason: { type: String, default: '' },
    finalizedAt: Date,
    operations: [{ _id: false, requestId: String, hash: String, version: Number, action: String, status: String, reason: String, at: Date }],
    invoiceNumber: {
      type: String,
      required: [true, 'Invoice number is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true
    },
    shipperCode: {
      type: String,
      required: [true, 'Shipper code is required'],
      index: true,
      trim: true,
      uppercase: true
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      default: null
    },
    clientName: {
      type: String,
      trim: true,
      default: ''
    },
    clientGst: {
      type: String,
      trim: true,
      uppercase: true,
      default: ''
    },
    invoiceDate: {
      type: Date,
      default: Date.now
    },
    dueDate: {
      type: Date
    },
    shipments: [shipmentSchema],
    subtotal: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Subtotal cannot be negative']
    },
    taxRate: {
      type: Number,
      default: 18,
      min: [0, 'Tax rate cannot be negative']
    },
    taxAmount: {
      type: Number,
      default: 0,
      min: [0, 'Tax amount cannot be negative']
    },
    totalAmount: {
      type: Number,
      required: true,
      default: 0,
      min: [0, 'Total amount cannot be negative']
    },
    status: {
      type: String,
      enum: {
        values: ['DRAFT', 'GENERATED', 'PAID', 'CANCELLED'],
        message: '{VALUE} is not a valid invoice status'
      },
      default: 'GENERATED'
    },
    notes: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    timestamps: true,
    bufferCommands: false
  }
);

invoiceSchema.index({ shipperCode: 1, invoiceDate: -1 });
invoiceSchema.index({ 'operations.requestId': 1 }, { unique: true, partialFilterExpression: { 'operations.requestId': { $type: 'string' } } });
module.exports = mongoose.model('Invoice', invoiceSchema);
