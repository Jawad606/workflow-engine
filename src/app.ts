import express from 'express';
import { apiV1 } from './api/v1/index.js';

export function buildApp() {
  const app = express();

  app.use(express.json());
  app.get('/health', (_request, response) => response.json({ ok: true }));
  app.use('/api/v1', apiV1);

  return app;
}