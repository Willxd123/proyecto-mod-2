import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthSession } from '@modulo2/contracts';
import { AuditService, cleanText } from '../audit/audit.service';

const SESSION_HOURS = 8;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 5;

/**
 * Acceso del administrador de la plataforma. Un único usuario definido en el entorno
 * (ADMIN_USER / ADMIN_PASSWORD), como acepta el docente; sin ADMIN_PASSWORD el acceso queda abierto en local.
 */
@Injectable()
export class AuthService {
  private readonly random = randomBytes(32).toString('hex');

  /** Secreto de firma estable entre reinicios: AUTH_SECRET o, si falta, derivado de la contraseña del administrador. */
  private get secret(): string {
    return process.env.AUTH_SECRET || (process.env.ADMIN_PASSWORD ? createHash('sha256').update('tcc-sesion|' + process.env.ADMIN_PASSWORD).digest('hex') : this.random);
  }
  private readonly failures = new Map<string, { count: number; until: number }>();

  constructor(private readonly audit: AuditService) {}

  /** El login es obligatorio solo cuando se configuró ADMIN_PASSWORD. */
  enabled(): boolean { return Boolean(process.env.ADMIN_PASSWORD); }

  private same(a: string, b: string): boolean {
    return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
  }

  private sign(payload: string): string { return createHmac('sha256', this.secret).update(payload).digest('base64url'); }

  /** Valida credenciales y emite un token firmado de 8 horas; bloquea 5 minutos tras 5 intentos fallidos. */
  async login(body: unknown, address: string): Promise<AuthSession> {
    const input = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
    const user = typeof input.user === 'string' ? input.user : '';
    const password = typeof input.password === 'string' ? input.password : '';
    const attempted = cleanText(user, 60) || 'desconocido';
    const state = this.failures.get(address);
    if (state && state.count >= MAX_FAILURES && state.until > Date.now()) {
      await this.audit.record({ actor: attempted, action: 'LOGIN', status: 'DENIED', message: 'Acceso bloqueado temporalmente por intentos fallidos.' });
      throw new UnauthorizedException('Demasiados intentos. Espera unos minutos.');
    }
    const expectedUser = process.env.ADMIN_USER || 'admin';
    if (!this.enabled() || !this.same(user, expectedUser) || !this.same(password, process.env.ADMIN_PASSWORD ?? '')) {
      const count = (state && state.until > Date.now() ? state.count : 0) + 1;
      this.failures.set(address, { count, until: Date.now() + LOCK_MINUTES * 60_000 });
      await this.audit.record({ actor: attempted, action: 'LOGIN', status: 'FAILED', message: 'Credenciales inválidas.' });
      throw new UnauthorizedException('Usuario o contraseña incorrectos.');
    }
    this.failures.delete(address);
    const expires = Date.now() + SESSION_HOURS * 3_600_000;
    const payload = Buffer.from(JSON.stringify({ u: expectedUser, e: expires })).toString('base64url');
    await this.audit.record({ actor: expectedUser, action: 'LOGIN', status: 'SUCCEEDED', message: 'Inicio de sesión del administrador.' });
    return { token: `${payload}.${this.sign(payload)}`, user: expectedUser, expires_at: new Date(expires).toISOString() };
  }

  /** Devuelve el usuario de un token válido y vigente, o null. */
  verify(token: string): string | null {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined || !this.same(signature, this.sign(payload))) return null;
    try {
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u?: unknown; e?: unknown };
      return typeof value.u === 'string' && typeof value.e === 'number' && value.e > Date.now() ? value.u : null;
    } catch {
      return null;
    }
  }
}
