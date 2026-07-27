import { Router } from 'express';
import { inquiryController } from './inquiry.controller';
import { authenticate } from '../../middlewares/authenticate';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { inquiryLimiter } from '../../middlewares/rateLimiter';
import {
  sendInquirySchema,
  updateInquiryStatusSchema,
  inquiryListSchema,
  uuidParamSchema,
} from './inquiry.validation';

const router = Router();

// ── All inquiry routes require authentication ─────────────────
// Unauthenticated users cannot contact anyone.
// This is enforced at the router level, not per-route,
// so there's no risk of accidentally leaving a route unprotected.
router.use(authenticate);

router.post(
  '/',
  inquiryLimiter,                           // IP-based: 3/hour from rateLimiter.ts
  validate({ body: sendInquirySchema }),
  asyncHandler(inquiryController.send.bind(inquiryController))
);

// ─────────────────────────────────────────────────────────────
// INBOX / SENT BOX
// ─────────────────────────────────────────────────────────────

router.get(
  '/received',
  validate({ query: inquiryListSchema }),
  asyncHandler(inquiryController.getReceived.bind(inquiryController))
);

router.get(
  '/sent',
  validate({ query: inquiryListSchema }),
  asyncHandler(inquiryController.getSent.bind(inquiryController))
);

// ─────────────────────────────────────────────────────────────
// SINGLE INQUIRY
// ─────────────────────────────────────────────────────────────

router.get(
  '/:id',
  validate({ params: uuidParamSchema }),
  asyncHandler(inquiryController.getById.bind(inquiryController))
);

router.patch(
  '/:id/status',
  validate({ params: uuidParamSchema, body: updateInquiryStatusSchema }),
  asyncHandler(inquiryController.updateStatus.bind(inquiryController))
);

router.delete(
  '/:id',
  validate({ params: uuidParamSchema }),
  asyncHandler(inquiryController.remove.bind(inquiryController))
);

export default router;