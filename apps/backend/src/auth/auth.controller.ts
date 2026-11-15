import { Body, Controller, Get, Header, HttpCode, Post, Req } from '@nestjs/common';
import { ActorRequest } from './auth.guard';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Inicia sesión con el administrador definido en el entorno. */
  @Post('login') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async login(@Req() request: ActorRequest, @Body() body: unknown) {
    return { data: await this.auth.login(body, request.socket.remoteAddress ?? 'desconocido') };
  }

  /** Indica si el login es obligatorio y quién es el usuario actual. */
  @Get('me') @Header('Cache-Control', 'no-store')
  me(@Req() request: ActorRequest) {
    return { data: { user: request.actor ?? 'local', login_required: this.auth.enabled() } };
  }
}
