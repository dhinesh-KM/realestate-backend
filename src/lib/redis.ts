import { createClient, RedisClientType } from 'redis';
import { env } from '../config/env';
import { logger } from '../shared/logger';

let redisClient: RedisClientType;

export function getRedisClient(): RedisClientType {
  if (!redisClient) {
    const redisUrl = env.REDIS_URL; 
    logger.info(`🔄 Attempting to connect to Redis at: ${redisUrl}`);
    redisClient = createClient({ url: env.REDIS_URL }) as RedisClientType;

    redisClient.on('error', (err: Error) => logger.error('Redis error:', err));
    redisClient.on('connect', () => logger.info('✅ Redis connected'));
    redisClient.on('reconnecting', () => logger.warn('Redis reconnecting...'));
  }
  return redisClient;
}

export async function connectRedis() {
  const client = getRedisClient();
  if (!client.isOpen) {
    await client.connect();
  }
  return client;
}

export async function disconnectRedis() {
  if (redisClient?.isOpen) {
    await redisClient.quit();
    logger.info('Redis disconnected');
  }
}