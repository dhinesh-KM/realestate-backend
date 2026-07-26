import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { v4 as uuidv4 } from 'uuid';

import { env } from './src/config/env';
// import { swaggerSpec } from './config/swagger';
import { globalLimiter } from './src/middlewares/rateLimiter';
import { errorHandler } from './src/middlewares/errorHandler';
import { logger } from './src/shared/logger';

// ── Route imports ──────────────────────────────────────────────
import authRoutes from './src/modules/auth/auth.route';

export function createApp(): Application {
  const app = express();

  // ── Security headers ─────────────────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: env.NODE_ENV === 'production',
      crossOriginEmbedderPolicy: env.NODE_ENV === 'production',
    })
  );

  // ── CORS ─────────────────────────────────────────────────────
  app.use(
    cors({
      origin: env.CLIENT_URL,
      credentials: true, // Required for cookies (refresh token)
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
    })
  );

  // ── Compression ───────────────────────────────────────────────
  app.use(compression());

  // ── Body parsing ──────────────────────────────────────────────
  app.use(express.json({ limit: '10kb' })); // Prevent large payload attacks
  app.use(express.urlencoded({ extended: true, limit: '10kb' }));

  // ── Cookie parsing ────────────────────────────────────────────
  app.use(cookieParser(env.COOKIE_SECRET));

  // ── Request ID — correlates logs with responses ───────────────
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as any).requestId = uuidv4();
    next();
  });

  console.log("env>>",env.NODE_ENV)
  // ── HTTP request logging ──────────────────────────────────────
  if (env.NODE_ENV !== 'test') {
    app.use(
      morgan('combined', {
        stream: { write: (msg: any) => logger.http(msg.trim()) },
        skip: (req: any) => req.url === '/health',
      })
    );
  }

  // ── Global rate limiter ───────────────────────────────────────
  app.use(globalLimiter);

  // ── Health check (before versioned routes) ────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
    });
  });

  // ── Swagger docs ──────────────────────────────────────────────
  // app.use(
  //   '/api-docs',
  //   swaggerUi.serve,
  //   swaggerUi.setup(swaggerSpec, {
  //     explorer: true,
  //     customSiteTitle: 'Real Estate API Docs',
  //   })
  // );

  // ── API routes ────────────────────────────────────────────────
  const apiRouter = express.Router();

  apiRouter.use('/auth', authRoutes);
  // Future: apiRouter.use('/properties', propertyRoutes);
  // Future: apiRouter.use('/search', searchRoutes);
  // Future: apiRouter.use('/inquiries', inquiryRoutes);

  app.use(`/api/${env.API_VERSION}`, apiRouter);

  // ── 404 handler ───────────────────────────────────────────────
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      statusCode: 404,
      message: 'Route not found',
    });
  });

  // ── Global error handler (MUST be last) ───────────────────────
  app.use(errorHandler);

  return app;
}