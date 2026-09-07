const express = require('express');
const router = express.Router();
const Rate = require('../models/Rate');
const locations = require('../data/locations.json');

/**
 * @route   POST /api/rates/calculate
 * @desc    Calculate courier rate using a 4-step fallback mechanism
 * @access  Public
 */
router.post('/calculate', async (req, res, next) => {
  try {
    const { shipperCode, destination, weight } = req.body;

    if (!shipperCode || typeof shipperCode !== 'string' || !shipperCode.trim()) {
      return res.status(400).json({
        success: false,
        error: 'shipperCode is required'
      });
    }

    if (!destination || typeof destination !== 'string' || !destination.trim()) {
      return res.status(400).json({
        success: false,
        error: 'destination is required'
      });
    }

    const normalizedShipper = shipperCode.trim().toUpperCase();
    const normalizedDest = destination.trim().toLowerCase();
    const parsedWeight = Math.max(0, Number(weight) || 1);

    // Look up destination info in locations.json
    const locationData = locations[normalizedDest];
    const city = normalizedDest;
    const state = locationData ? locationData.state.toLowerCase() : null;
    const region = locationData ? locationData.region.toLowerCase() : null;

    let matchedRate = null;
    let matchedRule = null;

    // Step a: Exact CITY match
    matchedRate = await Rate.findOne({
      shipperCode: normalizedShipper,
      targetType: 'CITY',
      targetName: city
    });

    if (matchedRate) {
      matchedRule = 'CITY';
    }

    // Step b: STATE match (or CUSTOM_ZONE)
    if (!matchedRate && (state || city)) {
      const searchStates = [state, city].filter(Boolean);
      matchedRate = await Rate.findOne({
        shipperCode: normalizedShipper,
        targetType: { $in: ['STATE', 'CUSTOM_ZONE'] },
        targetName: { $in: searchStates }
      });

      if (matchedRate) {
        matchedRule = matchedRate.targetType;
      }
    }

    // Step c: REGION match
    if (!matchedRate && (region || city)) {
      const searchRegions = [region, city].filter(Boolean);
      matchedRate = await Rate.findOne({
        shipperCode: normalizedShipper,
        targetType: 'REGION',
        targetName: { $in: searchRegions }
      });

      if (matchedRate) {
        matchedRule = 'REGION';
      }
    }

    // Step d: DEFAULT rate
    if (!matchedRate) {
      matchedRate = await Rate.findOne({
        shipperCode: normalizedShipper,
        $or: [
          { targetType: 'DEFAULT' },
          { targetName: 'default' }
        ]
      });

      if (matchedRate) {
        matchedRule = 'DEFAULT';
      }
    }

    if (!matchedRate) {
      return res.status(404).json({
        success: false,
        error: `No rate rule found for shipper '${normalizedShipper}' and destination '${destination}'`,
        locationInfo: { city, state, region }
      });
    }

    const baseKg = matchedRate.baseKg || 1;
    const perKgRate = matchedRate.perKgRate;
    const chargedWeight = Math.max(parsedWeight, baseKg);
    const calculatedAmount = Math.round((chargedWeight * perKgRate + Number.EPSILON) * 100) / 100;

    return res.status(200).json({
      success: true,
      destination: normalizedDest,
      matchedRule,
      locationInfo: {
        city,
        state: state || null,
        region: region || null
      },
      rate: {
        id: matchedRate._id,
        shipperCode: matchedRate.shipperCode,
        targetName: matchedRate.targetName,
        targetType: matchedRate.targetType,
        baseKg: matchedRate.baseKg,
        perKgRate: matchedRate.perKgRate
      },
      inputWeight: parsedWeight,
      chargedWeight,
      calculatedAmount
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/rates
 * @desc    Get all rates, optionally filtered by shipperCode
 * @access  Public
 */
router.get('/', async (req, res, next) => {
  try {
    const { shipperCode } = req.query;
    const query = {};
    if (shipperCode) {
      query.shipperCode = String(shipperCode).trim().toUpperCase();
    }
    const rates = await Rate.find(query).sort({ shipperCode: 1, targetName: 1 });
    return res.status(200).json({
      success: true,
      count: rates.length,
      data: rates
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/rates
 * @desc    Create or update a rate entry
 * @access  Public
 */
router.post('/', async (req, res, next) => {
  try {
    const { shipperCode, targetName, targetType, baseKg, perKgRate } = req.body;

    if (!shipperCode || !targetName || !targetType || perKgRate === undefined) {
      return res.status(400).json({
        success: false,
        error: 'shipperCode, targetName, targetType, and perKgRate are required'
      });
    }

    const normalizedShipper = shipperCode.trim().toUpperCase();
    const normalizedTarget = targetName.trim().toLowerCase();
    const normalizedType = targetType.trim().toUpperCase();

    const rate = await Rate.findOneAndUpdate(
      {
        shipperCode: normalizedShipper,
        targetName: normalizedTarget,
        targetType: normalizedType
      },
      {
        shipperCode: normalizedShipper,
        targetName: normalizedTarget,
        targetType: normalizedType,
        baseKg: baseKg !== undefined ? Math.max(0, Number(baseKg)) : 1,
        perKgRate: Math.max(0, Number(perKgRate))
      },
      { new: true, upsert: true, runValidators: true }
    );

    return res.status(201).json({
      success: true,
      data: rate
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
