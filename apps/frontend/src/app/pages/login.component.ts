import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../auth.service';

@Component({
  imports: [FormsModule],
  template: `
    <main class="login">
      <form class="card login-card" (ngSubmit)="submit()" aria-labelledby="login-title">
        <div class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3L4 20h3.5l1.8-4h5.4l1.8 4H20L12 3z"/></svg></div>
        <h1 id="login-title">Tenant Control Center</h1>
        <p class="sub">Acceso del administrador de la plataforma</p>
        @if (error()) { <div class="notice err" role="alert">{{ error() }}</div> }
        <label for="user">Usuario</label>
        <input id="user" name="user" autocomplete="username" [(ngModel)]="user" required autofocus>
        <label for="password">Contraseña</label>
        <input id="password" name="password" type="password" autocomplete="current-password" [(ngModel)]="password" required>
        <button class="btn primary" type="submit" [disabled]="busy() || !user || !password">{{ busy() ? 'Ingresando…' : 'Ingresar' }}</button>
        <p class="sub">Cada acción queda registrada en la auditoría con este usuario.</p>
      </form>
    </main>
  `,
  styles: [`
    .login{min-height:100vh;display:grid;place-items:center;background:var(--bg)}
    .login-card{width:360px;padding:28px;display:flex;flex-direction:column;gap:10px}
    .login-card h1{font-size:20px}
    .login-card label{font-size:12px;font-weight:600;color:var(--muted);margin-top:6px}
    .login-card input{padding:9px 10px;border:1px solid var(--border-strong);border-radius:8px}
    .login-card .btn{margin-top:12px;justify-content:center}
    .sub{font-size:12px;color:var(--muted)}
  `],
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  user = ''; password = '';
  readonly busy = signal(false); readonly error = signal('');

  /** Envía las credenciales y entra al panel si son correctas. */
  submit() {
    this.busy.set(true); this.error.set('');
    this.auth.login(this.user, this.password).subscribe({
      next: () => { this.busy.set(false); void this.router.navigateByUrl('/tenants'); },
      error: (failure: { error?: { message?: string } }) => { this.busy.set(false); this.error.set(failure.error?.message ?? 'No se pudo iniciar sesión.'); },
    });
  }
}
