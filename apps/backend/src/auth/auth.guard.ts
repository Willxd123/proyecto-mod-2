import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';

export type ActorRequest = Request & { actor?: string };
const PUBLIC_PATHS = ['/api/health', '/api/auth/login'];

/** Exige sesión en toda la API salvo health y login; deja el actor en la solicitud para la auditoría. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ActorRequest>();
    if (!this.auth.enabled()) { request.actor = 'local'; return true; }
    if (request.method === 'OPTIONS' || PUBLIC_PATHS.includes(request.path)) return true;
    const header = request.headers.authorization ?? '';
    const user = header.startsWith('Bearer ') ? this.auth.verify(header.slice(7)) : null;
    if (!user) throw new UnauthorizedException('Inicia sesión para continuar.');
    request.actor = user;
    return true;
  }
}
