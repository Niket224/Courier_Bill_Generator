const mongoose = require('mongoose');

const rateSchema = new mongoose.Schema(
  {
    shipperCode: {
      type: String,
      required: [true, 'Shipper code is required'],
      index: true,
      trim: true,
      uppercase: true
    },
    targetName: {
      type: String,
      required: [true, 'Target name is required'],
      lowercase: true,
      trim: true
    },
    targetType: {
      type: String,
      required: [true, 'Target type is required'],
      enum: {
        values: ['CITY', 'STATE', 'CUSTOM_ZONE', 'REGION', 'DEFAULT'],
        message: '{VALUE} is not a valid target type'
      }
    },
    baseKg: {
      type: Number,
      default: 1,
      min: [0, 'Base weight cannot be negative']
    },
    perKgRate: {
      type: Number,
      required: [true, 'Per kg rate is required'],
      min: [0, 'Rate cannot be negative']
    }
  },
  {
    timestamps: true
  }
);

// Compound index to ensure uniqueness per shipper and target
rateSchema.index({ shipperCode: 1, targetName: 1, targetType: 1 }, { unique: true });

module.exports = mongoose.model('Rate', rateSchema);
