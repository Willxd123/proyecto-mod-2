import { Controller, ForbiddenException, Get, Headers, Post, Req, Body } from '@nestjs/common';
import type { Request } from 'express';
import { ArtifactsService } from './artifacts.service';

@Controller('assistance-artifacts')
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  private requireLocal(request: Request, marker: string | undefined) {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')
        || marker !== 'TenantControlCenter') {
      throw new ForbiddenException('La preparación solo admite solicitudes del panel local.');
    }
  }

  @Get('inspect')
  async inspect(@Req() request: Request, @Headers('x-requested-with') marker: string | undefined) {
    this.requireLocal(request, marker);
    return { data: await this.artifacts.inspect() };
  }

  @Get('status')
  status(@Req() request: Request, @Headers('x-requested-with') marker: string | undefined) {
    this.requireLocal(request, marker);
    return { data: this.artifacts.status() };
  }

  @Post('prepare')
  prepare(@Req() request: Request, @Headers('origin') origin: string | undefined,
          @Headers('x-requested-with') marker: string | undefined, @Body() body: unknown) {
    this.requireLocal(request, marker);
    if (!['http://127.0.0.1:4200', 'http://localhost:4200'].includes(origin ?? '')) {
      throw new ForbiddenException('La preparación solo admite solicitudes del panel local.');
    }
    return { data: this.artifacts.start(body) };
  }
}
