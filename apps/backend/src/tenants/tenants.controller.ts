import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../database/entities';

@Controller('tenants')
export class TenantsController {
  constructor(@InjectRepository(Tenant) private readonly repository: Repository<Tenant>) {}
  @Get() async list() {
    return { data: await this.repository.find({ select: ['slug', 'name', 'plan_slug', 'environment', 'region', 'engine', 'status', 'access_url'], order: { created_at: 'DESC' } }),
      meta: { creation_enabled: false, owner: 'integrantes-2-y-5' } };
  }
}
