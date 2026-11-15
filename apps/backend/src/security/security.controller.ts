import { Body, Controller, ForbiddenException, Headers, Post, Req } from '@nestjs/common';
import type { ActorRequest } from '../auth/auth.guard';
import { AuditService } from '../audit/audit.service';
import { SecurityService } from './security.service';

@Controller('security')
export class SecurityController {
  constructor(private readonly security: SecurityService, private readonly audit: AuditService) {}

  @Post('scan')
  async scan(@Req() request: ActorRequest, @Headers('origin') origin: string | undefined,
             @Headers('x-requested-with') marker: string | undefined, @Body() body: unknown) {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
        || !['http://127.0.0.1:4200', 'http://localhost:4200'].includes(origin ?? '')
        || marker !== 'TenantControlCenter') {
      throw new ForbiddenException('El escaneo solo admite solicitudes del panel local.');
    }
    const data = await this.security.scan(body);
    const blocking = data.findings.filter(item => item.blocking ?? (item.category === 'secret' || item.severity === 'CRITICAL')).length;
    await this.audit.record({ actor: request.actor ?? 'local', action: 'SECURITY_SCAN', status: data.status === 'clean' ? 'SUCCEEDED' : 'FAILED',
      tenant_slug: data.tenant_slug,
      message: data.status === 'clean' ? `Escaneo de seguridad sin bloqueos (${data.findings.length} observaciones).` : `Escaneo de seguridad con ${blocking} hallazgo(s) bloqueante(s).`,
      detail: { observaciones: data.findings.length, bloqueantes: blocking } });
    return { data };
  }
}
