const mongoose = require('mongoose');

const shipmentSchema = new mongoose.Schema(
  {
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      default: null
    },
    awb: {
      type: String,
      required: [true, 'AWB / Tracking number is required'],
      trim: true
    },
    bookingDate: {
      type: Date,
      default: Date.now
    },
    origin: {
      type: String,
      trim: true,
      default: ''
    },
    destination: {
      type: String,
      trim: true,
      default: ''
    },
    receiverName: {
      type: String,
      trim: true,
      default: ''
    },
    actualWeight: {
      type: Number,
      default: 0,
      min: [0, 'Actual weight cannot be negative']
    },
    chargedWeight: {
      type: Number,
      default: 0,
      min: [0, 'Charged weight cannot be negative']
    },
    rate: {
      type: Number,
      default: 0,
      min: [0, 'Rate cannot be negative']
    },
    amount: {
      type: Number,
      default: 0,
      min: [0, 'Amount cannot be negative']
    }
  },
  {
    timestamps: true
  }
);

const Shipment = mongoose.model('Shipment', shipmentSchema);

module.exports = {
  Shipment,
  shipmentSchema
};
