import { Body, Controller, ForbiddenException, Get, Header, Headers, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DemoProvisioningService } from './demo-provisioning.service';

@Controller('demo-provisioning')
export class DemoProvisioningController {
  constructor(private readonly provisioning: DemoProvisioningService) {}

  private requireLocal(request: Request, marker: string | undefined) {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
        || marker !== 'TenantControlCenter') {
      throw new ForbiddenException('El aprovisionamiento demo solo admite solicitudes del panel local.');
    }
  }

  @Get('capabilities')
  @Header('Cache-Control', 'no-store')
  async capabilities(@Req() request: Request, @Headers('x-requested-with') marker: string | undefined) {
    this.requireLocal(request, marker);
    return { data: await this.provisioning.capabilities() };
  }

  @Get('operations/:slug')
  @Header('Cache-Control', 'no-store')
  async operation(@Req() request: Request, @Headers('x-requested-with') marker: string | undefined,
                  @Param('slug') slug: string) {
    this.requireLocal(request, marker);
    return { data: await this.provisioning.operation(slug) };
  }

  @Post(':slug/start')
  @Header('Cache-Control', 'no-store')
  async start(@Req() request: Request, @Headers('origin') origin: string | undefined,
              @Headers('x-requested-with') marker: string | undefined,
              @Param('slug') slug: string, @Body() body: unknown) {
    this.requireLocal(request, marker);
    if (!['http://127.0.0.1:4200', 'http://localhost:4200'].includes(origin ?? '')) {
      throw new ForbiddenException('El aprovisionamiento demo solo admite solicitudes del panel local.');
    }
    return { data: await this.provisioning.start(slug, body) };
  }
}
