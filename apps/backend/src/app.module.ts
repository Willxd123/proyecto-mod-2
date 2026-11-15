import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database/options';
import { AuditEvent, CatalogPlan, GoldenImageRecord, Tenant, TenantAlert, TenantBackup } from './database/entities';
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

import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { LifecycleController } from './lifecycle/lifecycle.controller';
import { LifecycleService } from './lifecycle/lifecycle.service';
import { MonitoringTargetsService } from './lifecycle/monitoring-targets.service';
import { MonitoringController } from './monitoring/monitoring.controller';
import { MonitoringService } from './monitoring/monitoring.service';
import { TunnelsService } from './monitoring/tunnels.service';

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
  imports: [TypeOrmModule.forRoot(databaseOptions()), TypeOrmModule.forFeature([CatalogPlan, GoldenImageRecord, Tenant, AuditEvent, TenantBackup, TenantAlert])],
  controllers: [SystemController, CatalogController, ImagesController, TenantsController, ArtifactsController, SecurityController, DemoCredentialsController, DemoProvisioningController, AuthController, AuditController, LifecycleController, MonitoringController],
  providers: [CatalogService, ImagesService, TenantsService, ArtifactsService, SecurityService, DemoCredentialsService, DemoProvisioningService,
    AuditService, AuthService, LifecycleService, MonitoringTargetsService, MonitoringService, TunnelsService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
