const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');

const { saveInvoice, transitionInvoice } = require('../services/invoicePersistence');
const { InvoiceError, date: validateDate } = require('../services/invoiceValidation');
const { validateInvoice } = require('../services/invoiceValidation');
const { calculate, differences } = require('../services/billingVerification');
function operation(handler) {
  return async (req, res, next) => {
    try {
      const result = await handler(req);
      res.status(!result.replayed && result.operationVersion === 1 ? 201 : 200).json({
        success: true, data: result.invoice, replayed: result.replayed, operationVersion: result.operationVersion,
        totalsVerified: result.invoice.totalsVerified === true
      });
    } catch (error) {
      if (error instanceof InvoiceError) return res.status(error.status).json({ success: false, code: error.code, error: error.message, ...(error.reconciliation ? { reconciliation: error.reconciliation } : {}) });
      next(error);
    }
  };
}
router.post('/save', operation((req) => saveInvoice(req.body)));
router.post('/calculate', async (req, res, next) => {
  try {
    const { data } = validateInvoice(req.body);
    const calculation = await calculate(data);
    res.json({ success: true, calculation, mismatches: differences(data, calculation) });
  } catch (error) {
    if (error instanceof InvoiceError) return res.status(error.status).json({ success: false, code: error.code, error: error.message });
    next(error);
  }
});
router.post('/:id/status', operation((req) => transitionInvoice(req.params.id, req.body)));
router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  try {
    for (const [key, value] of Object.entries(req.query)) {
      if (!['q', 'cno', 'awb', 'shipperCode', 'invoiceNumber', 'startDate', 'endDate', 'page', 'limit', 'status'].includes(key) || typeof value !== 'string' || value.length > 200) throw new Error();
    }
    for (const key of ['startDate', 'endDate']) if (req.query[key]) validateDate(req.query[key], key);
    if (req.query.startDate && req.query.endDate && req.query.startDate > req.query.endDate) throw new Error();
    if (req.query.status && !['DRAFT', 'GENERATED', 'PAID', 'CANCELLED'].includes(req.query.status.toUpperCase())) throw new Error();
    for (const key of ['page', 'limit']) if (req.query[key] !== undefined && (!/^[1-9]\d*$/.test(req.query[key]) || !Number.isSafeInteger(Number(req.query[key])))) throw new Error();
    next();
  } catch { res.status(400).json({ success: false, error: 'Invalid invoice search filters.' }); }
});
const literalSearch = (value) => String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * @route   GET /api/invoices
 * @desc    Get paginated list of past invoices
 * @access  Public
 */
router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const query = {};
    if (req.query.status) {
      query.status = String(req.query.status).trim().toUpperCase();
    }
    if (req.query.shipperCode) {
      query.shipperCode = String(req.query.shipperCode).trim().toUpperCase();
    }

    const [invoices, total] = await Promise.all([
      Invoice.find(query)
        .select('-snapshot -operations -calculationSnapshot')
        .sort({ invoiceDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Invoice.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      count: invoices.length,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      },
      data: invoices
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/invoices/search
 * @desc    Filter invoices by C/NO (AWB), shipperCode, invoice number, or date range
 * @access  Public
 */
router.get('/search', async (req, res, next) => {
  try {
    const { q, cno, awb, shipperCode, invoiceNumber, startDate, endDate } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const andConditions = [];
    const orTextConditions = [];

    // Unified query term or individual field queries combined with $or
    if (q && String(q).trim()) {
      const regex = { $regex: literalSearch(q), $options: 'i' };
      orTextConditions.push(
        { 'shipments.awb': regex },
        { shipperCode: regex },
        { clientName: regex },
        { invoiceNumber: regex }
      );
    } else {
      const targetAwb = cno || awb;
      if (targetAwb && String(targetAwb).trim()) {
        orTextConditions.push({
          'shipments.awb': { $regex: literalSearch(targetAwb), $options: 'i' }
        });
      }

      if (shipperCode && String(shipperCode).trim()) {
        orTextConditions.push({
          shipperCode: { $regex: literalSearch(shipperCode), $options: 'i' }
        });
      }

      if (invoiceNumber && String(invoiceNumber).trim()) {
        orTextConditions.push({
          invoiceNumber: { $regex: literalSearch(invoiceNumber), $options: 'i' }
        });
      }
    }

    if (orTextConditions.length > 0) {
      andConditions.push({ $or: orTextConditions });
    }

    // Date range filtering
    if (startDate || endDate) {
      const dateQuery = {};
      if (startDate) {
        const start = new Date(startDate);
        if (!isNaN(start.getTime())) {
          dateQuery.$gte = start;
        }
      }
      if (endDate) {
        const end = new Date(endDate);
        if (!isNaN(end.getTime())) {
          // Set to end of day if only date is passed
          end.setUTCHours(23, 59, 59, 999);
          dateQuery.$lte = end;
        }
      }
      if (Object.keys(dateQuery).length > 0) {
        andConditions.push({ invoiceDate: dateQuery });
      }
    }

    const query = andConditions.length > 0 ? { $and: andConditions } : {};

    const [invoices, total] = await Promise.all([
      Invoice.find(query)
        .select('-snapshot -operations -calculationSnapshot')
        .sort({ invoiceDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Invoice.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      count: invoices.length,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      },
      data: invoices
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/invoices/:id
 * @desc    Get single invoice by ID or invoiceNumber
 * @access  Public
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    let invoice = null;

    if (id.match(/^[0-9a-fA-F]{24}$/)) {
      invoice = await Invoice.findById(id).lean();
    }

    if (!invoice) {
      invoice = await Invoice.findOne({ invoiceNumber: id.trim().toUpperCase() }).lean();
    }

    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found'
      });
    }

    return res.status(200).json({
      success: true,
      data: invoice
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
