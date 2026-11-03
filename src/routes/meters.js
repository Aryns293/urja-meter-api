import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../async-route.js';
import { validate } from '../middleware/validate.js';

const searchQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).default(1),
});

const meterParamsSchema = z.object({
  meterId: z.string().regex(/^[A-Za-z0-9-]{1,32}$/),
});

export function metersRouter(portalClient) {
  const router = Router();

  router.get('/', validate(searchQuerySchema, 'query'), asyncRoute(async (req, res) => {
    const result = await portalClient.searchMeters(req.validated.query);
    res.json(result);
  }));

  router.get('/export', asyncRoute(async (_req, res) => {
    const result = await portalClient.exportMeters();
    res.json(result);
  }));

  router.get(
    '/:meterId/consumption',
    validate(meterParamsSchema, 'params'),
    asyncRoute(async (req, res) => {
      const result = await portalClient.getConsumption(req.validated.params.meterId);
      res.json(result);
    }),
  );

  router.get(
    '/:meterId',
    validate(meterParamsSchema, 'params'),
    asyncRoute(async (req, res) => {
      const result = await portalClient.getMeter(req.validated.params.meterId);
      res.json({ data: result });
    }),
  );

  return router;
}
