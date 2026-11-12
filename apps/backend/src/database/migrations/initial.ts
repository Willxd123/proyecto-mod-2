import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialCatalog1730000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE catalog_plans (
      slug varchar(40) PRIMARY KEY, name varchar(80) NOT NULL, description text NOT NULL,
      max_students integer NOT NULL CHECK (max_students > 0), roles jsonb NOT NULL,
      catalog_version varchar(40) NOT NULL, sort_order integer NOT NULL)`);
    await queryRunner.query(`CREATE TABLE tenants (
      slug varchar(63) PRIMARY KEY, name varchar(120) NOT NULL, admin_email varchar(254) NOT NULL,
      plan_slug varchar(40) NOT NULL REFERENCES catalog_plans(slug), environment varchar NOT NULL DEFAULT 'produccion',
      region varchar(40) NOT NULL, engine varchar(30) NOT NULL, status varchar NOT NULL DEFAULT 'PENDING',
      access_url varchar, resources jsonb NOT NULL DEFAULT '{}', deployment_metadata jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    await queryRunner.query(`CREATE TABLE tenant_alerts (
      id serial PRIMARY KEY, tenant_slug varchar(63) NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      title varchar(200) NOT NULL, severity varchar(30) NOT NULL, status varchar(30) NOT NULL, detected_at timestamptz NOT NULL)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE tenant_alerts');
    await queryRunner.query('DROP TABLE tenants');
    await queryRunner.query('DROP TABLE catalog_plans');
  }
}
