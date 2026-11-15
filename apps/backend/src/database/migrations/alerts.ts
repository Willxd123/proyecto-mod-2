import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RF-28 y RF-29: las alertas que Grafana entrega al panel. Se amplía tenant_alerts con la huella de la alerta
 * (para actualizar la misma fila cuando se resuelve), el rol del servidor, un resumen y la hora de resolución.
 */
export class TenantAlertsFromGrafana1730000000005 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tenant_alerts
      ADD COLUMN fingerprint varchar(80),
      ADD COLUMN role varchar(20),
      ADD COLUMN summary varchar(300),
      ADD COLUMN resolved_at timestamptz`);
    await queryRunner.query('CREATE UNIQUE INDEX tenant_alerts_fingerprint_idx ON tenant_alerts (fingerprint) WHERE fingerprint IS NOT NULL');
    await queryRunner.query('CREATE INDEX tenant_alerts_recent_idx ON tenant_alerts (detected_at DESC)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX tenant_alerts_recent_idx');
    await queryRunner.query('DROP INDEX tenant_alerts_fingerprint_idx');
    await queryRunner.query('ALTER TABLE tenant_alerts DROP COLUMN resolved_at, DROP COLUMN summary, DROP COLUMN role, DROP COLUMN fingerprint');
  }
}
