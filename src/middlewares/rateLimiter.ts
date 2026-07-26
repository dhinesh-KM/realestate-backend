import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from '../shared/apiError';

const handler = (_req: any, _res: any, _next: any, options: any) => {
  throw AppError.tooManyRequests(options.message as string);
};

/**
 * globalLimiter — applied to all routes.
 * Prevents volumetric DDoS and general API abuse.
 * 100 requests per 15 minutes per IP.
 */
export const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,  // Return RateLimit-* headers
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later',
  handler,
  skip: (req) => env.NODE_ENV === 'test' || req.ip === '127.0.0.1',
});

/**
 * authLimiter — applied to login / register / refresh endpoints.
 * Prevents brute-force attacks on credentials.
 * 5 requests per 15 minutes per IP — deliberately tight.
 */
export const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many authentication attempts, please try again in 15 minutes',
  handler,
  skip: () => env.NODE_ENV === 'test',
});

/**
 * inquiryLimiter — applied to the inquiry submission endpoint.
 * Prevents inquiry spam even from authenticated users.
 * 3 requests per hour per IP.
 */
export const inquiryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: env.INQUIRY_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'You have sent too many inquiries. Please wait before sending more.',
  handler,
  skip: () => env.NODE_ENV === 'test',
});