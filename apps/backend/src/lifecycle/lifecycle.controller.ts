import { Body, Controller, ForbiddenException, Get, Header, Headers, Param, Patch, Post, Req } from '@nestjs/common';
import type { ActorRequest } from '../auth/auth.guard';
import { LifecycleService } from './lifecycle.service';

const LOCAL_ADDRESSES = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const LOCAL_ORIGINS = ['http://127.0.0.1:4200', 'http://localhost:4200'];

@Controller('tenants')
export class LifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}

  /** Las operaciones que pueden tocar AWS solo se aceptan desde el panel local. */
  private requireLocal(request: ActorRequest, origin: string | undefined, marker: string | undefined): string {
    if (!LOCAL_ADDRESSES.includes(request.socket.remoteAddress ?? '') || !LOCAL_ORIGINS.includes(origin ?? '')
        || marker !== 'TenantControlCenter') {
      throw new ForbiddenException('Las operaciones de ciclo de vida solo admiten solicitudes del panel local.');
    }
    return request.actor ?? 'local';
  }

  /** Acciones permitidas y recursos que se verían afectados. */
  @Get(':slug/lifecycle') @Header('Cache-Control', 'no-store')
  async info(@Param('slug') slug: string) {
    return { data: await this.lifecycle.info(slug) };
  }

  /** Última operación de ciclo de vida del tenant (consulta periódica desde el panel). */
  @Get(':slug/lifecycle/operation') @Header('Cache-Control', 'no-store')
  async operation(@Param('slug') slug: string) {
    return { data: await this.lifecycle.operation(slug) };
  }

  @Post(':slug/suspend') @Header('Cache-Control', 'no-store')
  async suspend(@Req() request: ActorRequest, @Headers('origin') origin: string | undefined, @Headers('x-requested-with') marker: string | undefined,
                @Param('slug') slug: string, @Body() body: unknown) {
    return { data: await this.lifecycle.start(slug, 'suspend', this.requireLocal(request, origin, marker), body) };
  }

  @Post(':slug/resume') @Header('Cache-Control', 'no-store')
  async resume(@Req() request: ActorRequest, @Headers('origin') origin: string | undefined, @Headers('x-requested-with') marker: string | undefined,
               @Param('slug') slug: string, @Body() body: unknown) {
    return { data: await this.lifecycle.start(slug, 'resume', this.requireLocal(request, origin, marker), body) };
  }

  /** RF-19: respaldo de la base de datos del tenant (pg_dump) guardado en este equipo. */
  @Post(':slug/backup') @Header('Cache-Control', 'no-store')
  async backup(@Req() request: ActorRequest, @Headers('origin') origin: string | undefined, @Headers('x-requested-with') marker: string | undefined,
               @Param('slug') slug: string, @Body() body: unknown) {
    return { data: await this.lifecycle.start(slug, 'backup', this.requireLocal(request, origin, marker), body) };
  }

  /** RF-19: restaura un respaldo (reemplaza los datos actuales de la base del tenant). */
  @Post(':slug/restore') @Header('Cache-Control', 'no-store')
  async restore(@Req() request: ActorRequest, @Headers('origin') origin: string | undefined, @Headers('x-requested-with') marker: string | undefined,
                @Param('slug') slug: string, @Body() body: unknown) {
    return { data: await this.lifecycle.start(slug, 'restore', this.requireLocal(request, origin, marker), body) };
  }

  @Post(':slug/delete') @Header('Cache-Control', 'no-store')
  async remove(@Req() request: ActorRequest, @Headers('origin') origin: string | undefined, @Headers('x-requested-with') marker: string | undefined,
               @Param('slug') slug: string, @Body() body: unknown) {
    return { data: await this.lifecycle.start(slug, 'delete', this.requireLocal(request, origin, marker), body) };
  }

  /** Cambia el nombre comercial del tenant. */
  @Patch(':slug') @Header('Cache-Control', 'no-store')
  async rename(@Req() request: ActorRequest, @Param('slug') slug: string, @Body() body: unknown) {
    return { data: await this.lifecycle.rename(slug, body, request.actor ?? 'local') };
  }
}
