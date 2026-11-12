import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Integrante 2 (RF-07, RF-08): completa la tabla tenants con los campos de la guía sin romper lo existente.
 * Solo agrega columnas y restricciones; no renombra ni borra. Equivalencias con la guía:
 * tenant_slug → slug (PK, referenciada por tenant_alerts), institution_name → name,
 * plan_id → plan_slug (FK a catalog_plans), iac_engine → engine.
 * PENDING es el borrador guardado desde el Paso 1; el orquestador (integrante 5) lo lleva a PROVISIONING/ACTIVE.
 */
export class TenantProvisioningFields1730000000002 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tenants
      ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
      ADD COLUMN frontend_public_ip inet,
      ADD COLUMN backend_private_ip inet,
      ADD COLUMN db_private_ip inet`);
    await queryRunner.query('ALTER TABLE tenants ADD CONSTRAINT tenants_id_unique UNIQUE (id)');
    await queryRunner.query(`ALTER TABLE tenants ADD CONSTRAINT tenants_status_check
      CHECK (status IN ('PENDING', 'PROVISIONING', 'ACTIVE', 'SUSPENDED', 'ERROR'))`);
    await queryRunner.query(`ALTER TABLE tenants ADD CONSTRAINT tenants_engine_check
      CHECK (engine IN ('terraform', 'opentofu', 'pulumi', 'cloudformation'))`);
    await queryRunner.query(`ALTER TABLE tenants ADD CONSTRAINT tenants_slug_format_check
      CHECK (slug ~ '^[a-z][a-z0-9-]{2,39}$')`);
    await queryRunner.query(`ALTER TABLE tenants ADD CONSTRAINT tenants_environment_check
      CHECK (environment = 'produccion')`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tenants
      DROP CONSTRAINT tenants_environment_check, DROP CONSTRAINT tenants_slug_format_check,
      DROP CONSTRAINT tenants_engine_check, DROP CONSTRAINT tenants_status_check, DROP CONSTRAINT tenants_id_unique`);
    await queryRunner.query(`ALTER TABLE tenants
      DROP COLUMN db_private_ip, DROP COLUMN backend_private_ip, DROP COLUMN frontend_public_ip, DROP COLUMN id`);
  }
}
