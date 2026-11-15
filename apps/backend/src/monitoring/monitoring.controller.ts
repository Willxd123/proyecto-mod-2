import { Body, Controller, Get, Header, Headers, HttpCode, Post, Query } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';

@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoring: MonitoringService) {}

  /** Estado de Grafana, Prometheus y los túneles hacia los tenants. */
  @Get('status') @Header('Cache-Control', 'no-store')
  status() { return { data: this.monitoring.status() }; }

  /** Alertas y eventos recientes con su tenant y hora de detección (RF-29). */
  @Get('alerts') @Header('Cache-Control', 'no-store')
  async alerts(@Query('tenant') tenant?: string, @Query('status') status?: string, @Query('limit') limit?: string) {
    return { data: await this.monitoring.list({ tenant, status, limit: Number(limit) }) };
  }

  /** Webhook de Grafana (RF-28). No usa la sesión del panel: se autentica con el token compartido. */
  @Post('alerts') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async receive(@Headers('authorization') authorization: string | undefined, @Headers('x-webhook-token') webhookToken: string | undefined, @Body() body: unknown) {
    this.monitoring.checkToken(authorization, webhookToken);
    return { data: await this.monitoring.receive(body) };
  }
}
