const mongoose = require('mongoose');

const clientSchema = new mongoose.Schema(
  {
    shipperCode: {
      type: String,
      required: [true, 'Shipper code is required'],
      unique: true,
      trim: true,
      uppercase: true,
      index: true
    },
    name: {
      type: String,
      required: [true, 'Client name is required'],
      trim: true
    },
    gst: {
      type: String,
      trim: true,
      uppercase: true,
      default: ''
    },
    address: {
      type: String,
      trim: true,
      default: ''
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model('Client', clientSchema);
