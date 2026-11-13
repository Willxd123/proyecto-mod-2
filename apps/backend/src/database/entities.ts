import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import type { Plan } from '@modulo2/contracts';

@Entity('catalog_plans')
export class CatalogPlan {
  @PrimaryColumn({ type: 'varchar', length: 40 }) slug!: string;
  @Column({ type: 'varchar', length: 80 }) name!: string;
  @Column('text') description!: string;
  @Column('integer') max_students!: number;
  @Column({ type: 'varchar', length: 30, nullable: true }) instance_type!: string | null;
  @Column({ type: 'integer', nullable: true }) vcpu!: number | null;
  @Column({ type: 'integer', nullable: true }) ram_gb!: number | null;
  @Column({ type: 'integer', nullable: true }) db_storage_gb!: number | null;
  @Column('text') backup_policy!: string;
  @Column('jsonb') roles!: Plan['roles'];
  @Column({ type: 'varchar', length: 40 }) catalog_version!: string;
  @Column('integer') sort_order!: number;
}

@Entity('tenants')
export class Tenant {
  @PrimaryColumn({ type: 'varchar', length: 63 }) slug!: string;
  @Column({ type: 'varchar', length: 120 }) name!: string;
  @Column({ type: 'varchar', length: 254 }) admin_email!: string;
  @Column({ type: 'varchar', length: 40 }) plan_slug!: string;
  @Column({ type: 'varchar', default: 'produccion' }) environment!: string;
  @Column({ type: 'varchar', length: 40 }) region!: string;
  @Column({ type: 'varchar', length: 30 }) engine!: string;
  @Column({ type: 'varchar', default: 'PENDING' }) status!: string;
  @Column({ type: 'varchar', nullable: true }) access_url!: string | null;
  @Column({ type: 'jsonb', default: {} }) resources!: Record<string, unknown>;
  @Column({ type: 'jsonb', default: {} }) deployment_metadata!: Record<string, unknown>;
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' }) created_at!: Date;
  // Integrante 2: identificador UUID (lo genera PostgreSQL) e IPs que completa el motor tras el apply.
  @Column({ type: 'uuid', unique: true, insert: false, update: false, default: () => 'gen_random_uuid()' }) id!: string;
  @Column({ type: 'inet', nullable: true }) frontend_public_ip!: string | null;
  @Column({ type: 'inet', nullable: true }) backend_private_ip!: string | null;
  @Column({ type: 'inet', nullable: true }) db_private_ip!: string | null;
}

@Entity('tenant_alerts')
export class TenantAlert {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ type: 'varchar', length: 63 }) tenant_slug!: string;
  @Column({ type: 'varchar', length: 200 }) title!: string;
  @Column({ type: 'varchar', length: 30 }) severity!: string;
  @Column({ type: 'varchar', length: 30 }) status!: string;
  @Column('timestamptz') detected_at!: Date;
}

@Entity('golden_images')
export class GoldenImageRecord {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ type: 'varchar', length: 20 }) role!: string;
  @Column({ type: 'varchar', length: 10, name: 'cloud_provider', default: 'aws' }) provider!: string;
  @Column({ type: 'varchar', length: 40 }) region!: string;
  @Column({ type: 'varchar', length: 40 }) ami_id!: string;
  @Column({ type: 'varchar', length: 20 }) packer_version!: string;
  @Column({ type: 'varchar', length: 20 }) image_version!: string;
  @Column({ type: 'varchar', length: 40 }) source_revision!: string;
  @Column({ type: 'timestamptz', name: 'created_at' }) built_at!: Date;
}
