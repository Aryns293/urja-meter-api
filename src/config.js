import 'dotenv/config';
import { z } from 'zod';

const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PORTAL_BASE_URL: z.url().transform((value) => value.replace(/\/$/, '')),
  PORTAL_EMAIL: z.email(),
  PORTAL_PASSWORD: z.string().min(1),
  PORTAL_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10000),
});

export function loadConfig(env = process.env) {
  const result = configSchema.safeParse(env);

  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid configuration: ${fields}`);
  }

  return result.data;
}
