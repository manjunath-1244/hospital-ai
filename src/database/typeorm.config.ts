import { extname, join } from 'path';
import type { DataSourceOptions } from 'typeorm';
import { ALL_ENTITIES } from './entities';

type PostgresOptions = Extract<DataSourceOptions, { type: 'postgres' }>;

/** Reads one setting; implemented by Nest's ConfigService in the app and by process.env in the migration CLI. */
export type SettingReader = (key: string) => string | undefined;

const required = (get: SettingReader, key: string): string => {
  const v = get(key);
  if (v === undefined || v === '')
    throw new Error(`Missing database setting ${key}`);
  return v;
};

/**
 * The ONE place that defines how we connect to PostgreSQL. Used by the running API (`app.module.ts`) and by the
 * migration CLI (`data-source.ts`), so they can never drift apart.
 *
 * The schema is changed ONLY by migrations (`src/database/migrations`): `synchronize` is always off.
 */
export function buildDataSourceOptions(get: SettingReader): PostgresOptions {
  // When compiled (dist) only .js migrations exist; under ts-node only .ts ones. Matching the running extension
  // also avoids picking up .d.ts declaration files.
  const ext = extname(__filename);
  return {
    type: 'postgres',
    host: required(get, 'DB_HOST'),
    port: Number(required(get, 'DB_PORT')),
    username: required(get, 'DB_USER'),
    password: required(get, 'DB_PASSWORD'),
    database: required(get, 'DB_NAME'),
    entities: ALL_ENTITIES,
    migrations: [join(__dirname, 'migrations', `*${ext}`)],
    migrationsRun: get('DB_MIGRATIONS_RUN') !== 'false', // apply pending migrations at start
    synchronize: false,
  };
}
