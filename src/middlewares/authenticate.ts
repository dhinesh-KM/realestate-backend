import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../shared/apiError';
import { getRedisClient } from '../lib/redis';

export interface JwtPayload {
  sub: string;      // user id
  email: string;
  role: string;
  iat: number;
  exp: number;
}

// Extend Express Request to carry authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * authenticate — verifies the JWT access token from the Authorization header.
 *
 * Design decisions:
 * 1. Token lives in Authorization header (Bearer), NOT cookies.
 *    Cookies hold only the refresh token (HttpOnly). This prevents CSRF
 *    on the access token while still protecting the refresh token from XSS.
 *
 * 2. Checks Redis blacklist for logged-out tokens.
 *    When a user logs out, the access token's jti (or sub+iat) is stored
 *    in Redis with TTL = remaining token lifetime. This ensures logout
 *    is effective even before the 15-min window expires.
 *
 * 3. Distinguishes expired vs invalid tokens with different error messages,
 *    so the frontend knows when to attempt a refresh vs when to re-login.
 */
export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw AppError.unauthorized('Access token missing or malformed');
    }

    const token = authHeader.split(' ')[1];

    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw AppError.unauthorized('Access token expired');
      }
      throw AppError.unauthorized('Access token invalid');
    }

    // Check if token has been blacklisted (logout / security revocation)
    const redis = getRedisClient();
    const blacklistKey = `blacklist:access:${decoded.sub}:${decoded.iat}`;
    const isBlacklisted = await redis.get(blacklistKey);
    if (isBlacklisted) {
      throw AppError.unauthorized('Token has been revoked');
    }

    req.user = decoded;
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * optionalAuthenticate — same as authenticate but does not block unauthenticated
 * requests. Used for public routes where auth enriches the response (e.g., showing
 * "saved" state on property cards for logged-in users).
 */
export const optionalAuthenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return next();

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    req.user = decoded;
  } catch {
    // Silently ignore — optional auth
  }
  next();
};