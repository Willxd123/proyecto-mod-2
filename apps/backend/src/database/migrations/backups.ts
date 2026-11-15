import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RF-19: respaldar y restaurar un tenant. Añade los estados BACKING_UP y RESTORING (operaciones en curso)
 * y la tabla tenant_backups, que registra cada respaldo (el archivo vive fuera de la base, en output/backups).
 */
export class TenantBackups1730000000004 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE tenants DROP CONSTRAINT tenants_status_check');
    await queryRunner.query(`ALTER TABLE tenants ADD CONSTRAINT tenants_status_check CHECK (status IN
      ('PENDING', 'PROVISIONING', 'ACTIVE', 'SUSPENDING', 'SUSPENDED', 'RESUMING', 'BACKING_UP', 'RESTORING', 'DELETING', 'DELETED', 'ERROR'))`);
    await queryRunner.query(`CREATE TABLE tenant_backups (
      id uuid PRIMARY KEY,
      tenant_slug varchar(63) NOT NULL REFERENCES tenants (slug),
      created_at timestamptz NOT NULL DEFAULT now(),
      actor varchar(60) NOT NULL,
      size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
      sha256 char(64) NOT NULL,
      simulated boolean NOT NULL DEFAULT false)`);
    await queryRunner.query('CREATE INDEX tenant_backups_tenant_idx ON tenant_backups (tenant_slug, created_at DESC)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE tenant_backups');
    await queryRunner.query(`UPDATE tenants SET status = 'ERROR' WHERE status IN ('BACKING_UP', 'RESTORING')`);
    await queryRunner.query('ALTER TABLE tenants DROP CONSTRAINT tenants_status_check');
    await queryRunner.query(`ALTER TABLE tenants ADD CONSTRAINT tenants_status_check CHECK (status IN
      ('PENDING', 'PROVISIONING', 'ACTIVE', 'SUSPENDING', 'SUSPENDED', 'RESUMING', 'DELETING', 'DELETED', 'ERROR'))`);
  }
}
