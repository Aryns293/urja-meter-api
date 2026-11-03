import express from 'express';
import { fileURLToPath } from 'node:url';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { metersRouter } from './routes/meters.js';
import { transformersRouter } from './routes/transformers.js';

export function createApp({ portalClient }) {
  const app = express();
  app.disable('x-powered-by');

  app.get('/', (_req, res) => {
    res.json({
      name: 'Urja Meter API',
      version: '1.0.0',
      documentation: '/openapi.json',
      health: '/health',
    });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/openapi.json', (_req, res) => {
    res.sendFile(fileURLToPath(new URL('../openapi.json', import.meta.url)));
  });

  app.use('/api/v1/meters', metersRouter(portalClient));
  app.use('/api/v1/transformers', transformersRouter(portalClient));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
