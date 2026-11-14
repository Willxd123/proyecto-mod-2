import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantAlert } from '../database/entities';
import { MonitoringController } from './monitoring.controller';
import { MonitoringService } from './monitoring.service';

@Module({
  imports: [TypeOrmModule.forFeature([TenantAlert])],
  controllers: [MonitoringController],
  providers: [MonitoringService],
})
export class MonitoringModule {}
