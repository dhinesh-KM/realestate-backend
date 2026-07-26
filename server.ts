import { createApp } from './app';
import { env } from './src/config/env';
import { connectDatabase, disconnectDatabase } from './src/lib/prisma';
import { connectRedis, disconnectRedis } from './src/lib/redis';
import { logger } from './src/shared/logger';

async function bootstrap() {
  try {
    // 1. Connect to DB
    await connectDatabase();

    // 2. Connect to Redis
    await connectRedis();

    // 3. Create Express app
    const app = createApp();

    // 4. Start server
    const server = app.listen(env.PORT, () => {
      logger.info(`🚀 Server running on http://localhost:${env.PORT}`);
      logger.info(`📚 API Docs: http://localhost:${env.PORT}/api-docs`);
      logger.info(`🔋 Health:   http://localhost:${env.PORT}/health`);
      logger.info(`🌍 Environment: ${env.NODE_ENV}`);
    });

    // ── Graceful shutdown ────────────────────────────────────────
    // On SIGTERM/SIGINT: stop accepting new connections, drain existing ones,
    // then close DB and Redis. Prevents data loss on deploy/restart.
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received — starting graceful shutdown`);

      server.close(async () => {
        logger.info('HTTP server closed');

        try {
          await disconnectDatabase();
          await disconnectRedis();
          logger.info('✅ Graceful shutdown complete');
          process.exit(0);
        } catch (err) {
          logger.error('Error during shutdown:', err);
          process.exit(1);
        }
      });

      // Force exit if graceful shutdown takes too long
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10_000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // ── Unhandled errors ─────────────────────────────────────────
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled promise rejection:', reason);
      // Let the process crash — let the process manager restart it
      // (PM2, Kubernetes, etc.) — never swallow silently
      process.exit(1);
    });

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception:', err);
      process.exit(1);
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

bootstrap();