import { Body, Controller, ForbiddenException, Get, Header, Headers, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { ActorRequest } from '../auth/auth.guard';
import { AuditService } from '../audit/audit.service';
import { DemoCredentialsService } from './demo-credentials.service';

@Controller('demo-credentials')
export class DemoCredentialsController {
  constructor(private readonly credentials: DemoCredentialsService, private readonly audit: AuditService) {}

  private requireLocal(request: Request, marker: string | undefined) {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
        || marker !== 'TenantControlCenter') {
      throw new ForbiddenException('Solo se admite el panel local.');
    }
  }

  @Get('status')
  @Header('Cache-Control', 'no-store')
  status(@Req() request: Request, @Headers('x-requested-with') marker: string | undefined) {
    this.requireLocal(request, marker);
    return { data: { enabled: this.credentials.enabled() } };
  }

  @Post(':slug/reveal')
  @Header('Cache-Control', 'no-store')
  async reveal(@Req() request: ActorRequest, @Headers('origin') origin: string | undefined,
               @Headers('x-requested-with') marker: string | undefined,
               @Param('slug') slug: string, @Body() body: unknown) {
    this.requireLocal(request, marker);
    if (!['http://127.0.0.1:4200', 'http://localhost:4200'].includes(origin ?? '')) {
      throw new ForbiddenException('Solo se admite el panel local.');
    }
    const data = await this.credentials.reveal(slug, body);
    await this.audit.record({ actor: request.actor ?? 'local', action: 'CREDENTIALS_REVEAL', status: 'SUCCEEDED', tenant_slug: slug,
      message: 'Se consultó la contraseña inicial de demostración del administrador del tenant.' });
    return { data };
  }
}
