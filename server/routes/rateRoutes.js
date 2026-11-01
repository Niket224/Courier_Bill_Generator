const express = require('express');
const router = express.Router();
const Rate = require('../models/Rate');
const { activeRates } = require('../services/rateCards');
const locations = require('../data/locations.json');
const Billing = require('../../mobile-bill-app/billing');

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
    const parsedWeight = weight === undefined ? 1 : weight;
    Billing.decimal(parsedWeight, 'weight');

    // Look up destination info in locations.json
    const locationData = locations[normalizedDest];
    const city = normalizedDest;
    const state = locationData ? locationData.state.toLowerCase() : null;
    const region = locationData ? locationData.region.toLowerCase() : null;

    const cards = await activeRates(normalizedShipper, { allowLegacy: true });
    let matchedRate = cards.find((r) => r.targetType === 'CITY' && r.targetName === city);
    if (!matchedRate) matchedRate = cards.find((r) => ['STATE', 'CUSTOM_ZONE'].includes(r.targetType) && [state, city].includes(r.targetName));
    if (!matchedRate) matchedRate = cards.find((r) => r.targetType === 'REGION' && [region, city].includes(r.targetName));
    if (!matchedRate) matchedRate = cards.find((r) => r.targetType === 'DEFAULT' || r.targetName === 'default');
    const matchedRule = matchedRate?.targetType;
    if (!matchedRate) {
      return res.status(404).json({
        success: false,
        error: `No rate rule found for shipper '${normalizedShipper}' and destination '${destination}'`,
        locationInfo: { city, state, region }
      });
    }

    const baseKg = matchedRate.baseKg ?? 1;
    const perKgRate = matchedRate.perKgRate;
    const chargedWeight = Math.max(Number(parsedWeight), baseKg);
    const legacyBase = matchedRate.baseRate === undefined;
    const calculatedAmount = Billing.shipment({ weight: parsedWeight, pcs: req.body.pcs === undefined ? 1 : req.body.pcs }, matchedRate, { legacyBase }).amount;

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
      inputWeight: Number(parsedWeight),
      chargedWeight,
      calculatedAmount,
      calculationContract: !matchedRate.approved ? 'legacy-rate-estimate' : Billing.VERSION, requiresRateReview: !matchedRate.approved || legacyBase
    });

  } catch (error) {
    if (error.code === 'INVALID_CALCULATION') return res.status(400).json({ success: false, error: error.message });
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
    const rates = shipperCode ? await activeRates(query.shipperCode, { allowLegacy: true }) : await Rate.find(query).sort({ shipperCode: 1, targetName: 1 });
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
    const { shipperCode, targetName, targetType, baseKg, perKgRate, baseRate } = req.body;

    if (typeof shipperCode !== 'string' || !shipperCode.trim() || typeof targetName !== 'string' || !targetName.trim() || typeof targetType !== 'string' || perKgRate === undefined) {
      return res.status(400).json({
        success: false,
        error: 'shipperCode, targetName, targetType, and perKgRate are required'
      });
    }

    const normalizedShipper = shipperCode.trim().toUpperCase();
    const normalizedTarget = targetName.trim().toLowerCase();
    const normalizedType = targetType.trim().toUpperCase();
    const requestedBaseKg = baseKg === undefined ? 1 : baseKg;
    Billing.decimal(requestedBaseKg, 'base weight');
    Billing.decimal(perKgRate, 'extra-weight rate');
    if (baseRate !== undefined) Billing.decimal(baseRate, 'base charge');
    for (const value of [requestedBaseKg, perKgRate, ...(baseRate !== undefined ? [baseRate] : [])]) {
      if (Billing.decimal(value, 'rate precision') !== Billing.decimal(Number(value), 'rate precision')) return res.status(400).json({ success: false, error: 'Unsupported rate precision.' });
    }

    return res.status(409).json({ success: false, code: 'PUBLICATION_REQUIRED', error: 'Direct rate writes are disabled. Save a reviewed draft and explicitly publish it.' });
  } catch (error) {
    if (error.code === 'INVALID_CALCULATION') return res.status(400).json({ success: false, error: error.message });
    next(error);
  }
});

module.exports = router;
