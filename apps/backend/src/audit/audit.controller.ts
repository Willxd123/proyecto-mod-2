import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Lista el registro de auditoría con filtros por tenant, acción, estado, actor y fechas. */
  @Get() @Header('Cache-Control', 'no-store')
  list(@Query('tenant') tenant?: string, @Query('action') action?: string, @Query('status') status?: string,
       @Query('actor') actor?: string, @Query('from') from?: string, @Query('to') to?: string,
       @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.audit.list({ tenant, action, status, actor, from, to, limit: Number(limit), offset: Number(offset) });
  }

  /** Línea de tiempo de una operación concreta. */
  @Get('operations/:id') @Header('Cache-Control', 'no-store')
  async operation(@Param('id') id: string) {
    return { data: await this.audit.operation(id) };
  }
}
