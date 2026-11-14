import { Body, Controller, Get, HttpCode, Optional, Param, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../database/entities';
import { TenantsService } from './tenants.service';
import { DemoProvisioningService } from '../demo-provisioning/demo-provisioning.service';

@Controller('tenants')
export class TenantsController {
  constructor(@InjectRepository(Tenant) private readonly repository: Repository<Tenant>, private readonly tenants: TenantsService,
              @Optional() private readonly demoProvisioning?: DemoProvisioningService) {}

  @Get() async list() {
    const tenants = await this.repository.find({ select: ['slug', 'name', 'plan_slug', 'environment', 'region', 'engine', 'status', 'access_url', 'deployment_metadata'], order: { created_at: 'DESC' } });
    return { data: tenants.map(({ deployment_metadata, ...tenant }) => ({
      ...tenant, demo_credentials_available: tenant.status === 'ACTIVE' && deployment_metadata.demo_initial_credentials_verified === true,
    })),
      meta: { creation_enabled: this.demoProvisioning?.enabled() ?? false, owner: 'integrantes-2-y-5' } };
  }

  /**
   * Integrante 2 (RF-07): valida identificador y correo. 200 con valid=true/false y un error por campo;
   * 400 solo si el cuerpo no es un objeto JSON.
   */
  @Post('validate') @HttpCode(200)
  async validate(@Body() body: unknown) {
    return { data: await this.tenants.validate(body) };
  }

  /**
   * Integrante 2: guarda el borrador del Paso 1 con status PENDING. No aprovisiona (creation_enabled sigue en false).
   * 201 con el id; 422 con un error por campo; 400 si el cuerpo no es un objeto JSON.
   */
  @Post('drafts') @HttpCode(201)
  async createDraft(@Body() body: unknown) {
    return { data: await this.tenants.createDraft(body) };
  }

  @Get(':slug/creation-readiness')
  async creationReadiness(@Param('slug') slug: string) {
    return { data: await this.tenants.creationReadiness(slug) };
  }

  /**
   * Integrante 2: genera output/tenants/<slug>/terraform.tfvars.json para Terraform/OpenTofu.
   * 404 si no existe, 409 si ya no es borrador (PENDING), 422 si el motor es de otro integrante o faltan AMIs.
   */
  @Post(':slug/tfvars') @HttpCode(200)
  async generateTfvars(@Param('slug') slug: string) {
    return { data: await this.tenants.generateTfvars(slug) };
  }
}
