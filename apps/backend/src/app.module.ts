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

@Controller()
class SystemController {
  constructor(private readonly database: DataSource) {}
  @Get('health') async health() { await this.database.query('SELECT 1'); return { status: 'ok', service: 'tenant-control-center', version: '0.1.0' }; }
  @Get('capabilities') capabilities() { return { data: { catalog: true, image_registry: true, tenant_creation: false, security_scan: false, orchestration: false, monitoring: false } }; }
}

@Module({
  imports: [TypeOrmModule.forRoot(databaseOptions()), TypeOrmModule.forFeature([CatalogPlan, GoldenImageRecord, Tenant])],
  controllers: [SystemController, CatalogController, ImagesController, TenantsController], providers: [CatalogService, ImagesService, TenantsService],
})
export class AppModule {}
