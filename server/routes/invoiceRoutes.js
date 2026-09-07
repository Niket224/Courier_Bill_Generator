const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');

/**
 * @route   POST /api/invoices/save
 * @desc    Save or update generated invoice with shipments array
 * @access  Public
 */
router.post('/save', async (req, res, next) => {
  try {
    const {
      invoiceNumber,
      shipperCode,
      client,
      clientName,
      clientGst,
      invoiceDate,
      dueDate,
      shipments,
      subtotal,
      taxRate,
      taxAmount,
      totalAmount,
      status,
      notes
    } = req.body;

    if (!invoiceNumber || typeof invoiceNumber !== 'string' || !invoiceNumber.trim()) {
      return res.status(400).json({
        success: false,
        error: 'invoiceNumber is required'
      });
    }

    if (!shipperCode || typeof shipperCode !== 'string' || !shipperCode.trim()) {
      return res.status(400).json({
        success: false,
        error: 'shipperCode is required'
      });
    }

    const normalizedInvoiceNo = invoiceNumber.trim().toUpperCase();
    const normalizedShipperCode = shipperCode.trim().toUpperCase();

    // Format shipments array and strip out empty items
    const formattedShipments = Array.isArray(shipments)
      ? shipments
          .filter((shipment) => {
            const awbVal = shipment.awb || shipment.cno;
            return awbVal && String(awbVal).trim().length > 0;
          })
          .map((shipment) => ({
            awb: String(shipment.awb || shipment.cno).trim(),
            bookingDate: shipment.bookingDate || shipment.date || Date.now(),
            origin: shipment.origin || '',
            destination: shipment.destination || '',
            receiverName: shipment.receiverName || '',
            actualWeight: Math.max(0, Number(shipment.actualWeight || shipment.weight || 0)),
            chargedWeight: Math.max(0, Number(shipment.chargedWeight || shipment.weight || 0)),
            rate: Math.max(0, Number(shipment.rate || 0)),
            amount: Math.max(0, Number(shipment.amount || 0))
          }))
      : [];

    const computedSubtotal = subtotal !== undefined
      ? Number(subtotal)
      : formattedShipments.reduce((acc, curr) => acc + (curr.amount || 0), 0);

    const effectiveTaxRate = taxRate !== undefined ? Number(taxRate) : 18;
    const computedTaxAmount = taxAmount !== undefined
      ? Number(taxAmount)
      : Math.round((computedSubtotal * (effectiveTaxRate / 100) + Number.EPSILON) * 100) / 100;

    const computedTotalAmount = totalAmount !== undefined
      ? Number(totalAmount)
      : Math.round((computedSubtotal + computedTaxAmount + Number.EPSILON) * 100) / 100;

    // Upsert invoice document
    const invoice = await Invoice.findOneAndUpdate(
      { invoiceNumber: normalizedInvoiceNo },
      {
        invoiceNumber: normalizedInvoiceNo,
        shipperCode: normalizedShipperCode,
        client: client || null,
        clientName: clientName ? clientName.trim() : '',
        clientGst: clientGst ? clientGst.trim().toUpperCase() : '',
        invoiceDate: invoiceDate ? new Date(invoiceDate) : Date.now(),
        dueDate: dueDate ? new Date(dueDate) : undefined,
        shipments: formattedShipments,
        subtotal: Math.max(0, computedSubtotal),
        taxRate: Math.max(0, effectiveTaxRate),
        taxAmount: Math.max(0, computedTaxAmount),
        totalAmount: Math.max(0, computedTotalAmount),
        status: status || 'GENERATED',
        notes: notes ? notes.trim() : ''
      },
      { new: true, upsert: true, runValidators: true }
    );

    return res.status(201).json({
      success: true,
      message: 'Invoice saved successfully',
      data: invoice
    });
  } catch (error) {
    next(error);
  }
});

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
      const regex = { $regex: String(q).trim(), $options: 'i' };
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
          'shipments.awb': { $regex: String(targetAwb).trim(), $options: 'i' }
        });
      }

      if (shipperCode && String(shipperCode).trim()) {
        orTextConditions.push({
          shipperCode: { $regex: String(shipperCode).trim(), $options: 'i' }
        });
      }

      if (invoiceNumber && String(invoiceNumber).trim()) {
        orTextConditions.push({
          invoiceNumber: { $regex: String(invoiceNumber).trim(), $options: 'i' }
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
          end.setHours(23, 59, 59, 999);
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
      invoice = await Invoice.findById(id);
    }

    if (!invoice) {
      invoice = await Invoice.findOne({ invoiceNumber: id.trim().toUpperCase() });
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
