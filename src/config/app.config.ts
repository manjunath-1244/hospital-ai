import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().default(5432),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGINS: z.string().default('http://localhost:3001'),
  SEED_USER_PASSWORD: z.string().min(8).optional(),
  SEED_DEMO_DATA: z.string().default('true'),
  FHIR_SERVER_URL: z.string().default('http://localhost:8080/fhir'),
  ORTHANC_URL: z.string().default('http://localhost:8042'),
  ORTHANC_USERNAME: z.string().optional(),
  ORTHANC_PASSWORD: z.string().optional(),
  WAIT_ALERT_MINUTES: z.coerce.number().default(30),
});

export type AppConfig = z.infer<typeof schema>;

/** ConfigModule `validate`: fail fast at boot with a readable message instead of running half-configured. */
export function validateEnv(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return { ...raw, ...parsed.data };
}

export const corsOrigins = (): string[] =>
  (process.env.CORS_ORIGINS ?? 'http://localhost:3001')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
