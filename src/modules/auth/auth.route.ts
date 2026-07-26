import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticate } from '../../middlewares/authenticate';
import { validate } from '../../middlewares/validate';
import { authLimiter } from '../../middlewares/rateLimiter';
import { asyncHandler } from '../../middlewares/asyncHandler';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
} from './auth.validation';

const router = Router();


router.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(authController.register.bind(authController))
);


router.post(
  '/login',
  authLimiter,
  validate({ body: loginSchema }),
  asyncHandler(authController.login.bind(authController))
);


router.post(
  '/refresh',
  asyncHandler(authController.refresh.bind(authController))
);


router.post(
  '/logout',
  authenticate,
  asyncHandler(authController.logout.bind(authController))
);


router.post(
  '/logout-all',
  authenticate,
  asyncHandler(authController.logoutAll.bind(authController))
);


router.get(
  '/me',
  authenticate,
  asyncHandler(authController.getMe.bind(authController))
);


router.patch(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  asyncHandler(authController.changePassword.bind(authController))
);

export default router;