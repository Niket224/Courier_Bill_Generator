const { Router } = require('express');
const Draft = require('../models/RateCardDraft');
const Book = require('../models/RateBook');
const Service = require('../services/rateCards');
module.exports = function (operator) {
  const router = Router();
  const handle = (fn) => async (req, res, next) => {
    try { res.json({ success: true, ...await fn(req) }); }
    catch (e) { if (e instanceof Service.RateCardError) return res.status(e.status).json({ success: false, code: e.code, error: e.message }); next(e); }
  };
  router.post('/drafts', handle((req) => Service.saveDraft(req.body)));
  router.get('/drafts', handle(async (req) => ({ data: await Draft.find({ shipperCode: Service.shipper(req.query.shipperCode) }).select('-operations').sort({ updatedAt: -1 }).limit(50).lean() })));
  router.get('/drafts/:id', handle(async (req) => {
    const data = await Draft.findOne({ _id: Service.id(req.params.id), shipperCode: Service.shipper(req.query.shipperCode) }).lean();
    if (!data) throw new Service.RateCardError(404, 'DRAFT_NOT_FOUND', 'Draft not found for this shipper.');
    return { data };
  }));
  router.get('/book', handle(async (req) => ({ data: await Book.findById(Service.shipper(req.query.shipperCode)).lean() })));
  router.post('/publish', handle((req) => Service.publish(req.body, operator)));
  router.post('/rollback', handle((req) => Service.publish(req.body, operator, true)));
  return router;
};
