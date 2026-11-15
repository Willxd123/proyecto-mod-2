import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from './auth.service';

@Component({
  selector: 'app-root', imports: [RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    @if (isLogin()) { <router-outlet /> } @else {
    <div class="app">
      <aside class="sidebar">
        <div>
          <a class="brand" routerLink="/planes">
            <span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3L4 20h3.5l1.8-4h5.4l1.8 4H20L12 3z"/></svg></span>
            <span class="brand-name">Tenant<small>Control Center</small></span>
          </a>
          <p class="nav-label">Plataforma</p>
          <nav aria-label="Navegación principal">
            <a routerLink="/tenants" routerLinkActive="active"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg><span>Inicio / Lista Tenants</span></a>
            <a routerLink="/crear" routerLinkActive="active"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 4v16m8-8H4"/></svg><span>Tenants (Crear)</span></a>
            <a routerLink="/planes" routerLinkActive="active"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><span>Planes y Golden AMIs</span></a>
            <a routerLink="/monitoreo" routerLinkActive="active"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><span>Monitoreo (Grafana)</span></a>
            <a routerLink="/auditoria" routerLinkActive="active"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg><span>Auditoría</span></a>
            <a routerLink="/seguridad" routerLinkActive="active"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 12l2 2 4-4m5.6-4A12 12 0 0112 2.9 12 12 0 013.4 6 12 12 0 003 9c0 5.6 3.8 10.3 9 12 5.2-1.7 9-6.4 9-12 0-1-.1-2-.4-3z"/></svg><span>Escáner &amp; Versiones</span></a>
          </nav>
          <p class="nav-label">Administración</p>
          <nav aria-label="Administración">
            <a class="admin" routerLink="/equipo" routerLinkActive="active"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-6.13a4 4 0 11-8 0 4 4 0 018 0zm6 2a3 3 0 11-6 0 3 3 0 016 0z"/></svg><span>Guía 6 Roles y RFs</span></a>
          </nav>
        </div>
        <div class="profile"><span class="avatar">{{ initials() }}</span><div><strong>{{ auth.user() ?? 'Administrador' }}</strong><span>Administrador de la plataforma</span>@if (auth.loginRequired()) { <button class="btn sm" (click)="auth.logout()">Cerrar sesión</button> }</div></div>
      </aside>
      <div class="content">
        <header class="topbar">
          <div class="crumbs"><a routerLink="/tenants">Tenants</a><span>/</span><strong>{{ title() }}</strong></div>
          <div class="topbar-right"><span class="pill ok">Control Center local → Aprovisionando en AWS</span><span class="avatar" [title]="auth.user() ?? ''">{{ initials() }}</span></div>
        </header>
        <main id="main-content"><router-outlet /></main>
      </div>
    </div>
    }
  `,
})
export class AppComponent {
  private readonly router = inject(Router);
  readonly auth = inject(AuthService);
  readonly isLogin = toSignal(this.router.events.pipe(filter(event => event instanceof NavigationEnd), startWith(null), map(() => this.router.url.startsWith('/login'))), { initialValue: false });
  /** Iniciales del usuario para el avatar. */
  initials() { return (this.auth.user() ?? 'AD').slice(0, 2).toUpperCase(); }
  readonly title = toSignal(this.router.events.pipe(filter(event => event instanceof NavigationEnd), startWith(null), map(() => {
    let route = this.router.routerState.snapshot.root;
    while (route.firstChild) route = route.firstChild;
    return (route.data['title'] as string | undefined) ?? 'Tenants';
  })), { initialValue: 'Tenants' });
}
