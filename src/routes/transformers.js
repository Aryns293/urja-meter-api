import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute } from '../async-route.js';
import { validate } from '../middleware/validate.js';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
});

export function transformersRouter(portalClient) {
  const router = Router();

  router.get('/', validate(querySchema, 'query'), asyncRoute(async (req, res) => {
    const result = await portalClient.getTransformers(req.validated.query);
    res.json(result);
  }));

  return router;
}
