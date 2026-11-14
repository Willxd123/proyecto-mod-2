import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { MonitoringService } from './monitoring.service';

/**
 * RF-25 a RF-29 — Endpoints de observabilidad
 *
 * GET  /api/monitoring/config  → configuración del servidor (IP, usuario Grafana, tenants monitoreados)
 * GET  /api/monitoring/alerts  → alertas activas/historial, filtrables por tenant
 * POST /api/monitoring/alerts  → webhook de Alertmanager (recepción autenticada con token)
 */
@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get('config')
  config() {
    return this.monitoring.getConfig();
  }

  @Get('alerts')
  listAlerts(@Query('tenant') tenant?: string) {
    return this.monitoring.listAlerts(tenant);
  }

  @Post('alerts')
  async receiveAlert(
    @Headers('x-webhook-token') token: string,
    @Body() payload: unknown,
  ) {
    const expected = process.env.WEBHOOK_TOKEN ?? '';
    if (!expected || token !== expected) {
      throw new UnauthorizedException('Token de webhook inválido.');
    }
    return this.monitoring.processAlertmanagerPayload(payload);
  }
}
