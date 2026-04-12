import dotenv from 'dotenv';

dotenv.config();

export const config = {
  env: process.env.SE_ENV ?? 'development',
  port: Number(process.env.SE_PORT ?? 8000),
  databaseUrl: process.env.SE_DATABASE_URL ?? '',
  redisUrl: process.env.SE_REDIS_URL ?? ''
};