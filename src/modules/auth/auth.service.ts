import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../lib/prisma';
import { getRedisClient } from '../../lib/redis';
import { env } from '../../config/env';
import { AppError } from '../../shared/apiError';
import { logger } from '../../shared/logger';
import type { RegisterInput, LoginInput, TokenPair, AuthUser } from './auth.type';

const BCRYPT_ROUNDS = 12; // ~250ms on modern hardware — sweet spot security/perf
const REFRESH_TOKEN_BYTES = 64;

export class AuthService {
  // ──────────────────────────────────────────────────────────────
  // REGISTER
  // ──────────────────────────────────────────────────────────────
  async register(input: RegisterInput, meta: { ip?: string; userAgent?: string }): Promise<{
    user: AuthUser;
    tokens: TokenPair;
  }> {
    // 1. Check duplicate email
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw AppError.conflict('An account with this email already exists');
    }

    // 2. Hash password — bcrypt with high cost factor
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    // 3. Create user
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        phone: input.phone,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        isVerified: true,
        createdAt: true,
      },
    });

    // 4. Issue token pair
    const tokens = await this._issueTokenPair(user.id, user.email, user.role, meta);

    logger.info('User registered', { userId: user.id, email: user.email });

    return { user, tokens };
  }

  // ──────────────────────────────────────────────────────────────
  // LOGIN
  // ──────────────────────────────────────────────────────────────
  async login(input: LoginInput, meta: { ip?: string; userAgent?: string }): Promise<{
    user: AuthUser;
    tokens: TokenPair;
  }> {
    // 1. Find user — always fetch passwordHash, but use constant-time compare
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        passwordHash: true,
        isVerified: true,
        createdAt: true,
      },
    });

    // 2. Deliberate: same error for wrong email AND wrong password.
    //    Prevents user enumeration via timing or error messages.
    //    Even if user is not found, run bcrypt compare on a dummy hash
    //    to prevent timing attacks.
    const dummyHash = '$2a$12$dummyhashtopreventtimingattacksonuserenumeration......';
    const passwordToCheck = user?.passwordHash ?? dummyHash;
    const isValid = await bcrypt.compare(input.password, passwordToCheck);

    if (!user || !isValid) {
      throw AppError.unauthorized('Invalid email or password');
    }

    // 3. Issue fresh token pair
    const tokens = await this._issueTokenPair(user.id, user.email, user.role, meta);

    logger.info('User logged in', { userId: user.id });

    const { passwordHash: _, ...safeUser } = user;
    return { user: safeUser, tokens };
  }

  // ──────────────────────────────────────────────────────────────
  // REFRESH — Token Rotation with Reuse Detection
  // ──────────────────────────────────────────────────────────────
  /**
   * Refresh token rotation strategy:
   *
   * 1. Client sends the refresh token (from HttpOnly cookie).
   * 2. We hash it and look it up in DB.
   * 3. If it's been revoked → REUSE DETECTED → revoke entire token family
   *    (all tokens belonging to same family) → force re-login.
   * 4. If valid → revoke it, issue a new pair (rotate).
   *
   * "Token family" means all refresh tokens ever issued in one login session.
   * If any old token in that family is presented, we know it was stolen
   * (since we revoke old ones on rotation), and we nuke the whole family.
   */
  async refreshTokens(
    rawRefreshToken: string,
    meta: { ip?: string; userAgent?: string }
  ): Promise<TokenPair> {
    // 1. Hash the incoming token for DB lookup
    const tokenHash = this._hashToken(rawRefreshToken);

    // 2. Find stored token
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, role: true } } },
    });

    if (!stored) {
      throw AppError.unauthorized('Invalid refresh token');
    }

    // 3. Check if expired
    if (stored.expiresAt < new Date()) {
      throw AppError.unauthorized('Refresh token expired, please login again');
    }

    // 4. REUSE DETECTION — if token was already revoked, someone is reusing it
    if (stored.isRevoked) {
      logger.warn('Refresh token reuse detected — revoking entire family', {
        userId: stored.userId,
        family: stored.family,
        ip: meta.ip,
      });

      // Revoke ALL tokens in this family (invalidates attacker's stolen token too)
      await prisma.refreshToken.updateMany({
        where: { userId: stored.userId, family: stored.family },
        data: { isRevoked: true },
      });

      throw AppError.unauthorized(
        'Session invalidated due to suspicious activity. Please login again.'
      );
    }

    // 5. Revoke current token (rotate: old token dies, new one born)
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { isRevoked: true },
    });

    // 6. Issue new pair — same family, refreshed lifetime
    const tokens = await this._issueTokenPair(
      stored.user.id,
      stored.user.email,
      stored.user.role,
      meta,
      stored.family // preserve family for reuse detection
    );

    logger.info('Tokens refreshed', { userId: stored.userId });

    return tokens;
  }

  // ──────────────────────────────────────────────────────────────
  // LOGOUT
  // ──────────────────────────────────────────────────────────────
  /**
   * Logout strategy:
   * 1. Revoke the refresh token in DB (prevents future refreshes).
   * 2. Blacklist the access token in Redis until it expires naturally.
   *    This ensures the 15-min access token is instantly invalidated too.
   */
  async logout(
    rawRefreshToken: string | undefined,
    accessToken: string,
    userId: string,
    accessTokenIat: number
  ): Promise<void> {
    // 1. Revoke refresh token in DB
    if (rawRefreshToken) {
      const tokenHash = this._hashToken(rawRefreshToken);
      await prisma.refreshToken.updateMany({
        where: { tokenHash, userId, isRevoked: false },
        data: { isRevoked: true },
      });
    }

    // 2. Blacklist access token in Redis
    //    TTL = remaining time until access token expires
    const redis = getRedisClient();
    const now = Math.floor(Date.now() / 1000);
    const accessTokenExpiry = accessTokenIat + 15 * 60; // iat + 15 min
    const ttl = Math.max(accessTokenExpiry - now, 1);

    await redis.setEx(
      `blacklist:access:${userId}:${accessTokenIat}`,
      ttl,
      '1'
    );

    logger.info('User logged out', { userId });
  }

  // ──────────────────────────────────────────────────────────────
  // LOGOUT ALL DEVICES
  // ──────────────────────────────────────────────────────────────
  async logoutAllDevices(userId: string, accessTokenIat: number): Promise<void> {
    // Revoke all refresh tokens for this user
    await prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });

    // Blacklist current access token
    const redis = getRedisClient();
    const now = Math.floor(Date.now() / 1000);
    const ttl = Math.max(accessTokenIat + 15 * 60 - now, 1);
    await redis.setEx(`blacklist:access:${userId}:${accessTokenIat}`, ttl, '1');

    logger.info('User logged out from all devices', { userId });
  }

  // ──────────────────────────────────────────────────────────────
  // CHANGE PASSWORD
  // ──────────────────────────────────────────────────────────────
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user) throw AppError.notFound('User not found');

    const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValid) throw AppError.unauthorized('Current password is incorrect');

    if (currentPassword === newPassword) {
      throw AppError.badRequest('New password must be different from current password');
    }

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    // Force re-login on all devices after password change
    await prisma.refreshToken.updateMany({
      where: { userId, isRevoked: false },
      data: { isRevoked: true },
    });

    logger.info('Password changed', { userId });
  }

  // ──────────────────────────────────────────────────────────────
  // GET CURRENT USER
  // ──────────────────────────────────────────────────────────────
  async getMe(userId: string): Promise<AuthUser> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        isVerified: true,
        createdAt: true,
      },
    });
    if (!user) throw AppError.notFound('User not found');
    return user;
  }

  // ──────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ──────────────────────────────────────────────────────────────

  /**
   * Issues an access token + refresh token pair.
   * Access token: signed JWT, 15 min, lives in memory / Authorization header.
   * Refresh token: random 64-byte hex string, 7 days, stored as hash in DB,
   *                sent as HttpOnly cookie.
   */
  private async _issueTokenPair(
    userId: string,
    email: string,
    role: string,
    meta: { ip?: string; userAgent?: string },
    existingFamily?: string
  ): Promise<TokenPair> {
    const family = existingFamily ?? uuidv4(); // new session = new family

    // ── Access Token (JWT) ──────────────────────────────────────
    // Cast expiresIn to satisfy jsonwebtoken's StringValue type
    const accessToken = jwt.sign(
      { sub: userId, email, role },
      env.JWT_ACCESS_SECRET,
      {
        expiresIn: env.JWT_ACCESS_EXPIRES_IN as any,
        issuer: 'realestate-api',
        audience: 'realestate-client',
      }
    );

    // ── Refresh Token (opaque random string) ───────────────────
    const rawRefreshToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const tokenHash = this._hashToken(rawRefreshToken);

    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        family,
        expiresAt: new Date(Date.now() + env.JWT_REFRESH_EXPIRES_MS),
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      },
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  /**
   * Hash the raw refresh token before storing/comparing.
   * We never store the raw token — only its SHA-256 hash.
   * Even if the DB is compromised, raw tokens are not exposed.
   */
  private _hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }
}

export const authService = new AuthService();