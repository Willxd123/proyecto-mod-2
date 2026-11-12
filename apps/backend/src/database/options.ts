import { config } from 'dotenv';
import { resolve } from 'node:path';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { BACKEND_ROOT } from '../paths';
import { CatalogPlan, GoldenImageRecord, Tenant, TenantAlert } from './entities';
import { InitialCatalog1730000000000 } from './migrations/initial';
import { GoldenImagesAndPlanColumns1730000000001 } from './migrations/golden-images';
import { TenantProvisioningFields1730000000002 } from './migrations/tenant-provisioning';

config({ path: resolve(BACKEND_ROOT, '.env') });

export function databaseOptions(): TypeOrmModuleOptions {
  const password = process.env.DATABASE_PASSWORD;
  if (!password) throw new Error('Defina DATABASE_PASSWORD en apps/backend/.env.');
  const port = Number(process.env.DATABASE_PORT ?? 5432);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DATABASE_PORT inválido.');
  return {
    type: 'postgres', host: process.env.DATABASE_HOST ?? 'localhost', port,
    username: process.env.DATABASE_USER ?? 'postgres', password,
    database: process.env.DATABASE_NAME ?? 'proyecto_modulo_2',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
    entities: [CatalogPlan, GoldenImageRecord, Tenant, TenantAlert], migrations: [InitialCatalog1730000000000, GoldenImagesAndPlanColumns1730000000001, TenantProvisioningFields1730000000002],
    migrationsRun: true, synchronize: false, logging: false, retryAttempts: 1,
  };
}
