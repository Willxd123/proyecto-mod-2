import { HttpClient, HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { catchError, map, of, tap } from 'rxjs';
import type { AuthSession } from '@modulo2/contracts';

const STORAGE_KEY = 'tcc.token';

/** Sesión del administrador de la plataforma. El token vive solo en sessionStorage (se pierde al cerrar la pestaña). */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  readonly user = signal<string | null>(null);
  readonly loginRequired = signal(true);

  token(): string | null { return sessionStorage.getItem(STORAGE_KEY); }

  /** Inicia sesión; guarda el token y el usuario. */
  login(user: string, password: string) {
    return this.http.post<{ data: AuthSession }>('/api/auth/login', { user, password }).pipe(
      tap(response => { sessionStorage.setItem(STORAGE_KEY, response.data.token); this.user.set(response.data.user); }));
  }

  /** Cierra la sesión local y vuelve a la pantalla de acceso. */
  logout(): void {
    sessionStorage.removeItem(STORAGE_KEY);
    this.user.set(null);
    void this.router.navigateByUrl('/login');
  }

  /** Consulta al servidor si hay sesión válida o si el login no es obligatorio. */
  check() {
    return this.http.get<{ data: { user: string; login_required: boolean } }>('/api/auth/me').pipe(
      tap(response => { this.user.set(response.data.user); this.loginRequired.set(response.data.login_required); }),
      map(() => true),
      catchError(() => of(false)));
  }
}

/** Añade el token a cada llamada a la API y cierra la sesión si el servidor responde 401. */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const authorized = token && request.url.startsWith('/api') && !request.url.endsWith('/auth/login')
    ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;
  return next(authorized).pipe(catchError((error: unknown) => {
    if (error instanceof HttpErrorResponse && error.status === 401 && !request.url.endsWith('/auth/login')) auth.logout();
    throw error;
  }));
};

/** Protege las páginas del panel: sin sesión válida redirige al login. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.check().pipe(map(ok => ok || router.createUrlTree(['/login'])));
};
