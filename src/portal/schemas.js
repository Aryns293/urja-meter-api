import { z } from 'zod';

const pagination = {
  page: z.number().int().nonnegative(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
};

const numericString = z.string()
  .regex(/^-?(?:\d+(?:\.\d+)?|\.\d+)$/)
  .refine((value) => Number.isFinite(Number(value)));

export const searchResponseSchema = z.object({
  data: z.array(z.object({
    meterId: z.string(),
    serialNo: z.string(),
    make: z.string(),
    phaseType: z.string(),
    installStatus: z.string(),
    dtCode: z.string(),
  })),
  ...pagination,
});

export const svelteDataResponseSchema = z.object({
  nodes: z.array(z.unknown()),
});

export const meterDetailSchema = z.object({
  detail: z.object({
    data: z.array(z.object({
      parameterName: z.string(),
      parameterValue: z.string(),
    })),
  }),
  hierarchy: z.record(z.string(), z.string()),
});

export const geoResponseSchema = z.object({
  data: z.object({
    latitude: numericString,
    longitude: numericString,
  }),
});

export const energyResponseSchema = z.object({
  data: z.array(z.object({
    timestamp: z.string(),
    kwh: numericString,
    kvah: numericString,
    voltR: numericString,
  })),
});

export const transformerResponseSchema = z.object({
  data: z.array(z.object({
    code: z.string(),
    name: z.string(),
    feederCode: z.string(),
    capacityKva: z.number(),
  })),
  ...pagination,
});

export const keysResponseSchema = z.object({
  data: z.object({ signingSecret: z.string().min(1) }),
});

const hierarchyNodeSchema = z.object({
  code: z.string(),
  name: z.string(),
});

export const exportResponseSchema = z.object({
  data: z.array(z.object({
    build: z.string(),
    meterId: z.string(),
    serialNo: z.string(),
    make: z.string(),
    phaseType: z.string(),
    installStatus: z.string(),
    installType: z.string(),
    dtCode: z.string(),
    geo: z.object({ lat: z.number(), lng: z.number() }),
    hierarchy: z.object({
      zone: hierarchyNodeSchema,
      circle: hierarchyNodeSchema,
      division: hierarchyNodeSchema,
      subdivision: hierarchyNodeSchema,
      substation: hierarchyNodeSchema,
      feeder: hierarchyNodeSchema,
      dt: hierarchyNodeSchema,
    }),
  })),
  total: z.number().int().nonnegative(),
});
