import { S3Client, DeleteObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import multer from 'multer';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { AppError } from '../shared/apiError';
import { logger } from '../shared/logger';
import { UploadedImage } from '../modules/properties/property.type';

// ── S3 client singleton ───────────────────────────────────────

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.AWS_REGION ?? 'ap-south-1',
      credentials:
        env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId:     env.AWS_ACCESS_KEY_ID,
              secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            }
          : undefined, // uses IAM role when running on EC2/ECS
    });
  }
  return s3Client;
}

// ── Constants ─────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_MB   = 10;
const MAX_FILES          = 10;
const IMAGE_MAX_WIDTH    = 1920;
const IMAGE_MAX_HEIGHT   = 1080;
const IMAGE_QUALITY      = 85;

// ── Multer — memory storage (we process before uploading) ─────
//
// Why memory storage (not disk)?
// 1. We run sharp on the buffer before uploading to S3.
// 2. Disk storage requires cleanup logic — memory is simpler for
//    short-lived processing. For very large files disk is better,
//    but 10MB images are fine in memory.

const memoryStorage = multer.memoryStorage();

const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new AppError(
        `Invalid file type: ${file.mimetype}. Only JPEG, PNG, and WebP are allowed.`,
        400
      )
    );
  }
};

export const uploadMiddleware = multer({
  storage:   memoryStorage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024, // bytes
    files:    MAX_FILES,
  },
}).array('images', MAX_FILES);  // field name: "images"

// ── Multer error handler wrapper ──────────────────────────────
// Multer throws its own error types — convert to AppError

export const handleMulterError = (
  err: any,
  _req: Request,
  _res: Response,
  next: NextFunction
) => {
  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return next(new AppError(`File too large. Max size is ${MAX_FILE_SIZE_MB}MB`, 400));
      case 'LIMIT_FILE_COUNT':
        return next(new AppError(`Too many files. Max ${MAX_FILES} images per upload`, 400));
      case 'LIMIT_UNEXPECTED_FILE':
        return next(new AppError('Unexpected field name. Use "images" as the field name', 400));
      default:
        return next(new AppError(`Upload error: ${err.message}`, 400));
    }
  }
  next(err);
};

// ── Core upload function ──────────────────────────────────────

/**
 * processAndUpload — takes a raw multer file buffer, runs it through
 * sharp for resize/compress/convert, then streams it to S3.
 *
 * Design decisions:
 * 1. Convert everything to WebP — 30-40% smaller than JPEG at same quality.
 *    Better for page load speed, which affects SEO ranking.
 * 2. Resize to max 1920x1080 — property images don't need more than that.
 * 3. Strip EXIF metadata — removes GPS coordinates (privacy) and reduces size.
 * 4. Use S3 multipart upload via @aws-sdk/lib-storage for reliability.
 */
export async function processAndUpload(
  file: Express.Multer.File,
  folder: string
): Promise<UploadedImage> {
  const key = `${folder}/${uuidv4()}.webp`;

  // ── Image processing via sharp ────────────────────────────
  const processedBuffer = await sharp(file.buffer)
    .resize(IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT, {
      fit:         'inside',    // maintain aspect ratio, never upscale
      withoutEnlargement: true,
    })
    .webp({ quality: IMAGE_QUALITY })
            // strip EXIF (GPS, camera info, etc.)
    .toBuffer();

  // ── Upload to S3 ──────────────────────────────────────────
  const bucket = env.AWS_S3_BUCKET!;

  const upload = new Upload({
    client: getS3Client(),
    params: {
      Bucket:      bucket,
      Key:         key,
      Body:        processedBuffer,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable', // 1 year — content-addressed
    },
  });

  await upload.done();

  const url = `https://${bucket}.s3.${env.AWS_REGION ?? 'ap-south-1'}.amazonaws.com/${key}`;

  logger.info('Image uploaded', { key, size: processedBuffer.length });

  return {
    url,
    key,
    originalName: file.originalname,
  };
}

/**
 * Upload multiple files — parallel uploads for speed.
 * All-or-nothing: if any upload fails, the whole batch fails.
 * (Orphaned S3 objects are handled by S3 lifecycle rules.)
 */
export async function uploadImages(
  files: Express.Multer.File[],
  folder: string
): Promise<UploadedImage[]> {
  if (!files || files.length === 0) return [];

  if (!env.AWS_S3_BUCKET) {
    throw new AppError(
      'Image upload is not configured. AWS S3 credentials are missing.',
      503
    );
  }

  return Promise.all(files.map((file) => processAndUpload(file, folder)));
}

// ── Delete from S3 ────────────────────────────────────────────

export async function deleteImage(key: string): Promise<void> {
  try {
    await getS3Client().send(
      new DeleteObjectCommand({
        Bucket: env.AWS_S3_BUCKET!,
        Key:    key,
      })
    );
    logger.info('Image deleted from S3', { key });
  } catch (err) {
    // Log but don't throw — S3 deletion failure shouldn't block DB operations.
    // The key can be cleaned up later via S3 lifecycle rules or a job.
    logger.error('Failed to delete image from S3', { key, err });
  }
}

export async function deleteImages(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  try {
    await getS3Client().send(
      new DeleteObjectsCommand({
        Bucket:  env.AWS_S3_BUCKET!,
        Delete: {
          Objects: keys.map((Key) => ({ Key })),
          Quiet:   true,
        },
      })
    );
    logger.info('Images deleted from S3', { count: keys.length });
  } catch (err) {
    logger.error('Failed to delete images from S3', { keys, err });
  }
}