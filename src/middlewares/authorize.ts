import { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/apiError';

/**
 * authorize — role-based access control guard.
 * Always runs AFTER authenticate (which attaches req.user).
 *
 * Usage:
 *   router.delete('/admin/users/:id', authenticate, authorize('ADMIN'), handler)
 */
export const authorize = (...allowedRoles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(AppError.unauthorized('Not authenticated'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        AppError.forbidden(
          `Role '${req.user.role}' is not permitted to perform this action`
        )
      );
    }

    next();
  };
};