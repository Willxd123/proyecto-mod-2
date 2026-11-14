import { Body, Controller, ForbiddenException, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SecurityService } from './security.service';

@Controller('security')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Post('scan')
  async scan(@Req() request: Request, @Headers('origin') origin: string | undefined,
             @Headers('x-requested-with') marker: string | undefined, @Body() body: unknown) {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
        || !['http://127.0.0.1:4200', 'http://localhost:4200'].includes(origin ?? '')
        || marker !== 'TenantControlCenter') {
      throw new ForbiddenException('El escaneo solo admite solicitudes del panel local.');
    }
    return { data: await this.security.scan(body) };
  }
}
