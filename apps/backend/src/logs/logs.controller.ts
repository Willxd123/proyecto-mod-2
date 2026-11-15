import { Controller, Get, Header, Param, Query, Req } from '@nestjs/common';
import type { ActorRequest } from '../auth/auth.guard';
import { LogsService } from './logs.service';

@Controller('tenants')
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  /** Fuentes de log disponibles y si la consulta está habilitada en este equipo. */
  @Get('logs/sources') @Header('Cache-Control', 'no-store')
  sources() { return { data: { enabled: this.logs.enabled(), sources: this.logs.list() } }; }

  /** Últimas líneas de una fuente de log de un tenant (frontend, backend o base de datos). */
  @Get(':slug/logs') @Header('Cache-Control', 'no-store')
  async fetch(@Req() request: ActorRequest, @Param('slug') slug: string, @Query('source') source = '', @Query('lines') lines = '200', @Query('initial') initial?: string) {
    this.logs.requireLocal(request.socket.remoteAddress);
    return { data: await this.logs.fetch(slug, source, Number(lines), request.actor ?? 'local', initial === 'true') };
  }
}
