import { Router } from 'express';
import { propertyController } from './property.controller';
import { authenticate, optionalAuthenticate } from '../../middlewares/authenticate';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../middlewares/asyncHandler';
import { uploadMiddleware, handleMulterError } from '../../lib/s3';
import {
  createPropertySchema,
  updatePropertySchema,
  listPropertiesSchema,
  uuidParamSchema,
  reorderImagesSchema,

} from './property.validation';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Properties
 *   description: Property listing management
 */

// ── Public routes (no auth required) ─────────────────────────

/**
 * GET /properties
 * Public feed with filters and cursor pagination.
 */
router.get(
  '/',
  optionalAuthenticate,
  validate({ query: listPropertiesSchema }),
  asyncHandler(propertyController.list.bind(propertyController))
);

/**
 * GET /properties/:id
 * Property detail page + similar properties.
 */
router.get(
  '/:id',
  optionalAuthenticate,
  validate({ params: uuidParamSchema }),
  asyncHandler(propertyController.getById.bind(propertyController))
);

/**
 * GET /properties/:id/similar
 * Similar properties only (for lazy-loading on the detail page).
 */
router.get(
  '/:id/similar',
  validate({ params: uuidParamSchema }),
  asyncHandler(propertyController.getSimilar.bind(propertyController))
);

// ── Protected routes (auth required) ─────────────────────────

/**
 * GET /properties/mine
 * Owner's own listings — includes inactive ones.
 * Must come BEFORE /:id route so "mine" isn't treated as a UUID.
 */
router.get(
  '/mine',
  authenticate,
  validate({ query: listPropertiesSchema }),
  asyncHandler(propertyController.getMyListings.bind(propertyController))
);

/**
 * POST /properties
 * Create a listing. Accepts multipart/form-data with "images" files.
 *
 * Middleware order:
 * 1. authenticate   — verify JWT
 * 2. uploadMiddleware — multer parses multipart, puts files in req.files
 * 3. handleMulterError — convert multer errors to AppError
 * 4. validate       — Zod validates req.body (text fields)
 * 5. controller     — business logic
 *
 * Note: validate runs AFTER upload because multer must parse
 * multipart/form-data before body fields are accessible.
 */
router.post(
  '/',
  authenticate,
  uploadMiddleware,
  handleMulterError,
  validate({ body: createPropertySchema }),
  asyncHandler(propertyController.create.bind(propertyController))
);

/**
 * PATCH /properties/:id
 * Update own listing (text fields only — images managed separately).
 */
router.patch(
  '/:id',
  authenticate,
  validate({ params: uuidParamSchema, body: updatePropertySchema }),
  asyncHandler(propertyController.update.bind(propertyController))
);

/**
 * DELETE /properties/:id
 * Soft-delete own listing (sets isActive=false, status=INACTIVE).
 */
router.delete(
  '/:id',
  authenticate,
  validate({ params: uuidParamSchema }),
  asyncHandler(propertyController.remove.bind(propertyController))
);

// ── Image sub-routes ──────────────────────────────────────────

/**
 * POST /properties/:id/images
 * Upload additional images to an existing listing.
 */
router.post(
  '/:id/images',
  authenticate,
  validate({ params: uuidParamSchema }),
  uploadMiddleware,
  handleMulterError,
  asyncHandler(propertyController.addImages.bind(propertyController))
);

/**
 * DELETE /properties/:id/images/:imageId
 * Delete a specific image from a listing.
 */
router.delete(
  '/:id/images/:imageId',
  authenticate,
  validate({ params: uuidParamSchema }),
  asyncHandler(propertyController.deleteImage.bind(propertyController))
);

/**
 * PATCH /properties/:id/images/:imageId/primary
 * Set a specific image as the primary (thumbnail) image.
 */
router.patch(
  '/:id/images/:imageId/primary',
  authenticate,
  validate({ params: uuidParamSchema }),
  asyncHandler(propertyController.setPrimaryImage.bind(propertyController))
);

/**
 * PATCH /properties/:id/images/reorder
 * Reorder images by providing new displayOrder for each image ID.
 */
router.patch(
  '/:id/images/reorder',
  authenticate,
  validate({ params: uuidParamSchema, body: reorderImagesSchema }),
  asyncHandler(propertyController.reorderImages.bind(propertyController))
);

export default router;