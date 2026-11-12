import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Repository } from 'typeorm';
import { SERVER_ROLES, type Plan } from '@modulo2/contracts';
import { CatalogPlan } from '../database/entities';
import { REPO_ROOT } from '../paths';

@Injectable()
export class CatalogService implements OnModuleInit {
  constructor(@InjectRepository(CatalogPlan) private readonly repository: Repository<CatalogPlan>) {}

  async onModuleInit(): Promise<void> {
    const source = JSON.parse(readFileSync(resolve(REPO_ROOT, 'config/plans.json'), 'utf8'));
    const plans = source.plans as Plan[];
    if (new Set(plans.map(p => p.slug)).size !== plans.length) throw new Error('Planes duplicados.');
    for (const plan of plans) {
      if (!Number.isInteger(plan.max_students) || plan.max_students <= 0 || Object.keys(plan.roles).length !== 3 || !plan.backup_policy) throw new Error('Plan inválido.');
      for (const role of SERVER_ROLES) {
        const capacity = plan.roles[role];
        if (!capacity || !Number.isInteger(capacity.disk_gib) || capacity.disk_gib < 12 || capacity.vcpu <= 0 || capacity.ram_gib <= 0) throw new Error('Capacidad inválida o disco menor que la AMI base de 12 GiB.');
      }
    }
    await this.repository.manager.transaction(async manager => {
      for (const [sort_order, plan] of plans.entries()) {
        const { backend, database } = plan.roles;
        await manager.upsert(CatalogPlan, { ...plan, catalog_version: source.catalog_version, sort_order,
          instance_type: backend.instance_type, vcpu: backend.vcpu, ram_gb: backend.ram_gib, db_storage_gb: database.disk_gib }, ['slug']);
      }
    });
  }

  async all(): Promise<Plan[]> {
    const items = await this.repository.find({ order: { sort_order: 'ASC' } });
    return items.map(({ sort_order, instance_type, vcpu, ram_gb, db_storage_gb, ...plan }) => plan);
  }

  async one(slug: string): Promise<Plan | null> {
    return (await this.all()).find(p => p.slug === slug) ?? null;
  }
}
