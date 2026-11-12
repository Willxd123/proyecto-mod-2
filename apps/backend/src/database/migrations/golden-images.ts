import type { MigrationInterface, QueryRunner } from 'typeorm';

/** RF-01/RF-02: columnas planas del plan (servidor de referencia = backend; disco = base de datos) y registro de Golden Images (RF-09/RF-13). */
export class GoldenImagesAndPlanColumns1730000000001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE catalog_plans
      ADD COLUMN instance_type varchar(30), ADD COLUMN vcpu integer, ADD COLUMN ram_gb integer,
      ADD COLUMN db_storage_gb integer, ADD COLUMN backup_policy text NOT NULL DEFAULT ''`);
    await queryRunner.query(`CREATE TABLE golden_images (
      id serial PRIMARY KEY,
      role varchar(20) NOT NULL CHECK (role IN ('frontend','backend','database')),
      cloud_provider varchar(10) NOT NULL DEFAULT 'aws' CHECK (cloud_provider IN ('aws','azure')),
      region varchar(40) NOT NULL,
      ami_id varchar(40) NOT NULL,
      packer_version varchar(20) NOT NULL,
      image_version varchar(20) NOT NULL,
      source_revision varchar(40) NOT NULL,
      created_at timestamptz NOT NULL,
      UNIQUE (cloud_provider, region, role))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE golden_images');
    await queryRunner.query(`ALTER TABLE catalog_plans DROP COLUMN instance_type, DROP COLUMN vcpu, DROP COLUMN ram_gb,
      DROP COLUMN db_storage_gb, DROP COLUMN backup_policy`);
  }
}
