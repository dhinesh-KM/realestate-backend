import { Request, Response } from 'express';
import { authService } from './auth.service';
import { ApiResponse } from '../../shared/apiResponse';
import { AppError } from '../../shared/apiError';
import { env } from '../../config/env';

// Shared cookie options for the refresh token
// HttpOnly: not accessible via JS (XSS protection)
// Secure: HTTPS only in production
// SameSite=Strict: CSRF protection
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: env.JWT_REFRESH_EXPIRES_MS,
  path: '/api/v1/auth', // scoped: only sent to auth endpoints
};

/**
 * Controllers are intentionally thin:
 * - Extract data from req
 * - Call service
 * - Set cookies
 * - Send response
 *
 * NO business logic here. If you find yourself writing an if/else
 * that's not about req/res, it belongs in the service.
 */
export class AuthController {
  /**
   * POST /api/v1/auth/register
   */
  async register(req: Request, res: Response) {
    const { user, tokens } = await authService.register(req.body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Set refresh token as HttpOnly cookie — never exposed to JS
    res.cookie('refreshToken', tokens.refreshToken, REFRESH_COOKIE_OPTIONS);

    return ApiResponse.created(
      res,
      { user, accessToken: tokens.accessToken },
      'Registration successful'
    );
  }

  /**
   * POST /api/v1/auth/login
   */
  async login(req: Request, res: Response) {
    const { user, tokens } = await authService.login(req.body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.cookie('refreshToken', tokens.refreshToken, REFRESH_COOKIE_OPTIONS);

    return ApiResponse.success(
      res,
      { user, accessToken: tokens.accessToken },
      'Login successful'
    );
  }

  /**
   * POST /api/v1/auth/refresh
   *
   * The refresh token is read from the HttpOnly cookie automatically.
   * Client never touches this token — browser sends it automatically.
   */
  async refresh(req: Request, res: Response) {
    const rawRefreshToken = req.cookies?.refreshToken;
    if (!rawRefreshToken) {
      throw AppError.unauthorized('Refresh token missing');
    }

    const tokens = await authService.refreshTokens(rawRefreshToken, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Rotate the cookie too
    res.cookie('refreshToken', tokens.refreshToken, REFRESH_COOKIE_OPTIONS);

    return ApiResponse.success(
      res,
      { accessToken: tokens.accessToken },
      'Token refreshed'
    );
  }

  /**
   * POST /api/v1/auth/logout
   */
  async logout(req: Request, res: Response) {
    const rawRefreshToken = req.cookies?.refreshToken;
    const authHeader = req.headers.authorization!;
    const accessToken = authHeader.split(' ')[1];

    await authService.logout(
      rawRefreshToken,
      accessToken,
      req.user!.sub,
      req.user!.iat
    );

    // Clear the cookie
    res.clearCookie('refreshToken', {
      ...REFRESH_COOKIE_OPTIONS,
      maxAge: 0,
    });

    return ApiResponse.success(res, null, 'Logged out successfully');
  }

  /**
   * POST /api/v1/auth/logout-all
   * Logs out from all devices by revoking all refresh tokens.
   */
  async logoutAll(req: Request, res: Response) {
    await authService.logoutAllDevices(req.user!.sub, req.user!.iat);

    res.clearCookie('refreshToken', {
      ...REFRESH_COOKIE_OPTIONS,
      maxAge: 0,
    });

    return ApiResponse.success(res, null, 'Logged out from all devices');
  }

  /**
   * GET /api/v1/auth/me
   */
  async getMe(req: Request, res: Response) {
    const user = await authService.getMe(req.user!.sub);
    return ApiResponse.success(res, { user });
  }

  /**
   * PATCH /api/v1/auth/change-password
   */
  async changePassword(req: Request, res: Response) {
    const { currentPassword, newPassword } = req.body;
    await authService.changePassword(req.user!.sub, currentPassword, newPassword);
    return ApiResponse.success(res, null, 'Password changed successfully');
  }
}

export const authController = new AuthController();