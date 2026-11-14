import { Controller, Get, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database/options';
import { CatalogPlan, GoldenImageRecord, Tenant } from './database/entities';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { ImagesController } from './images/images.controller';
import { ImagesService } from './images/images.service';
import { TenantsController } from './tenants/tenants.controller';
import { TenantsService } from './tenants/tenants.service';
import { ArtifactsController } from './artifacts/artifacts.controller';
import { ArtifactsService } from './artifacts/artifacts.service';
import { SecurityController } from './security/security.controller';
import { SecurityService } from './security/security.service';
import { DemoCredentialsController } from './demo-credentials/demo-credentials.controller';
import { DemoCredentialsService } from './demo-credentials/demo-credentials.service';
import { DemoProvisioningController } from './demo-provisioning/demo-provisioning.controller';
import { DemoProvisioningService } from './demo-provisioning/demo-provisioning.service';

@Controller()
class SystemController {
  constructor(private readonly database: DataSource, private readonly provisioning: DemoProvisioningService) {}
  @Get('health') async health() { await this.database.query('SELECT 1'); return { status: 'ok', service: 'tenant-control-center', version: '0.1.0' }; }
  @Get('capabilities') capabilities() {
    const demoEnabled = this.provisioning.enabled();
    return { data: { catalog: true, image_registry: true, tenant_creation: demoEnabled, demo_provisioning_local: demoEnabled, security_scan: false, orchestration: false, monitoring: false } };
  }
}

@Module({
  imports: [TypeOrmModule.forRoot(databaseOptions()), TypeOrmModule.forFeature([CatalogPlan, GoldenImageRecord, Tenant])],
  controllers: [SystemController, CatalogController, ImagesController, TenantsController, ArtifactsController, SecurityController, DemoCredentialsController, DemoProvisioningController],
  providers: [CatalogService, ImagesService, TenantsService, ArtifactsService, SecurityService, DemoCredentialsService, DemoProvisioningService],
})
export class AppModule {}
