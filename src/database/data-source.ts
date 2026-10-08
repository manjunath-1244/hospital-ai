import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './typeorm.config';

/** Entry point for the TypeORM CLI only (see the `migration:*` npm scripts). The API does not import this file. */
export default new DataSource({
  ...buildDataSourceOptions((key) => process.env[key]),
  migrationsRun: false,
});
