import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Integración 5: estados del ciclo de vida y registro de auditoría.
 * Amplía la restricción de status (suspender, reanudar, eliminar) y crea audit_events,
 * una tabla de solo inserción con quién hizo qué, cuándo y con qué resultado.
 */
export class LifecycleAndAudit1730000000003 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE tenants DROP CONSTRAINT tenants_status_check');
    await queryRunner.query(`ALTER TABLE tenants ADD CONSTRAINT tenants_status_check CHECK (status IN
      ('PENDING', 'PROVISIONING', 'ACTIVE', 'SUSPENDING', 'SUSPENDED', 'RESUMING', 'DELETING', 'DELETED', 'ERROR'))`);
    await queryRunner.query(`CREATE TABLE audit_events (
      id bigserial PRIMARY KEY,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      actor varchar(60) NOT NULL,
      action varchar(40) NOT NULL,
      status varchar(20) NOT NULL,
      tenant_slug varchar(63),
      operation_id uuid,
      stage varchar(40),
      message varchar(240) NOT NULL,
      detail jsonb NOT NULL DEFAULT '{}'::jsonb)`);
    await queryRunner.query('CREATE INDEX audit_events_tenant_idx ON audit_events (tenant_slug, occurred_at DESC)');
    await queryRunner.query('CREATE INDEX audit_events_operation_idx ON audit_events (operation_id)');
    await queryRunner.query('CREATE INDEX audit_events_time_idx ON audit_events (occurred_at DESC)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE audit_events');
    await queryRunner.query(`UPDATE tenants SET status = 'ERROR' WHERE status IN ('SUSPENDING', 'RESUMING', 'DELETING', 'DELETED')`);
    await queryRunner.query('ALTER TABLE tenants DROP CONSTRAINT tenants_status_check');
    await queryRunner.query(`ALTER TABLE tenants ADD CONSTRAINT tenants_status_check
      CHECK (status IN ('PENDING', 'PROVISIONING', 'ACTIVE', 'SUSPENDED', 'ERROR'))`);
  }
}
