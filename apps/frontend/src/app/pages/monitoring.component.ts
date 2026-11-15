import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import type { MonitoringStatus, TenantAlertRecord, TenantSummary } from '@modulo2/contracts';
import { ApiService } from '../api.service';

@Component({
  template: `
    <section class="view">
      <div class="view-head">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h1>Monitoreo y alertas con Grafana</h1><span class="rf-badge">RF-25 a RF-29</span></div>
          <p>Salud y rendimiento de los 3 servidores de cada tenant, filtrables por tenant y entorno, y las alertas recientes con el tenant afectado y la hora de detección.</p>
        </div>
        @if (status(); as info) { <a class="btn primary" [href]="info.dashboard_url" target="_blank" rel="noopener">Abrir tablero de Grafana ↗</a> }
      </div>

      @if (error()) { <div class="notice err" role="alert">{{ error() }}</div> }
      @if (status(); as info) {
        <div class="cards">
          <div class="card mini"><span class="sub">Grafana</span><a class="link mono" [href]="info.grafana_url" target="_blank" rel="noopener">{{ info.grafana_url }}</a><span class="sub">Se levanta con Docker Compose (ver abajo).</span></div>
          <div class="card mini"><span class="sub">Prometheus</span><a class="link mono" [href]="info.prometheus_url" target="_blank" rel="noopener">{{ info.prometheus_url }}</a><span class="sub">Recolecta de los túneles SSH.</span></div>
          <div class="card mini"><span class="sub">Túneles hacia los tenants</span>
            <span class="pill plain" [class.ok]="info.tunnels_enabled" [class.warn]="!info.tunnels_enabled">{{ info.tunnels_enabled ? 'habilitados' : 'deshabilitados' }}</span>
            <span class="sub">{{ info.tunnels_enabled ? 'Un túnel SSH por servidor, por el bastión del tenant.' : 'Requiere la demo local real (DEMO_PROVISIONING_LOCAL=true, sin simulación).' }}</span></div>
          <div class="card mini"><span class="sub">Entrega de alertas al panel</span>
            <span class="pill plain" [class.ok]="info.webhook_configured" [class.err]="!info.webhook_configured">{{ info.webhook_configured ? 'webhook configurado' : 'falta WEBHOOK_TOKEN' }}</span>
            <span class="sub">Grafana → POST /api/monitoring/alerts con token.</span></div>
        </div>

        <div class="table-card"><div class="table-scroll"><table>
          <thead><tr><th>Túnel (tenant · servidor)</th><th>Puerto local</th><th>Estado</th><th>Reinicios</th></tr></thead>
          <tbody>
            @for (tunnel of info.tunnels; track tunnel.tenant_slug + tunnel.role) {
              <tr><td class="mono">{{ tunnel.tenant_slug }} · {{ tunnel.role }}</td><td class="mono">{{ tunnel.local_port }}</td>
                <td><span class="pill plain" [class.ok]="tunnel.status === 'up'" [class.warn]="tunnel.status === 'starting'" [class.err]="tunnel.status === 'down'">{{ tunnel.status }}</span></td><td>{{ tunnel.restarts }}</td></tr>
            } @empty { <tr><td colspan="4">No hay túneles abiertos: aparecen cuando un tenant está activo y los túneles están habilitados.</td></tr> }
          </tbody>
        </table></div></div>
      }

      <div class="toolbar" style="margin-top:20px">
        <div class="filters">
          <select aria-label="Filtrar alertas por tenant" (change)="tenant.set(val($event)); load()"><option value="">Todos los tenants</option>@for (slug of slugs(); track slug) { <option [value]="slug">{{ slug }}</option> }</select>
          <select aria-label="Filtrar alertas por estado" (change)="state.set(val($event)); load()"><option value="">Todos los estados</option><option value="FIRING">En curso</option><option value="RESOLVED">Resueltas</option></select>
        </div>
        <span>Alertas y eventos recientes (RF-29) · {{ alerts().length }}</span>
      </div>
      @if (!alerts().length) {
        <div class="card empty"><div class="empty-icon">◇</div><h2>Sin alertas</h2><p>Cuando Grafana detecte un servidor caído, la API sin responder, PostgreSQL caído o CPU, memoria o disco sobre el 85 %, aparecerá aquí con su tenant y la hora de detección.</p></div>
      } @else {
        <div class="table-card"><div class="table-scroll"><table>
          <thead><tr><th>Detectada</th><th>Tenant</th><th>Servidor</th><th>Severidad</th><th>Estado</th><th>Detalle</th></tr></thead>
          <tbody>
            @for (alert of alerts(); track alert.id) {
              <tr [class.bad]="alert.status === 'FIRING' && alert.severity === 'critical'">
                <td class="mono nowrap">{{ stamp(alert.detected_at) }}</td><td class="mono">{{ alert.tenant_slug }}</td><td>{{ alert.role ?? '—' }}</td>
                <td><span class="pill plain" [class.err]="alert.severity === 'critical'" [class.warn]="alert.severity === 'warning'" [class.neutral]="alert.severity === 'info'">{{ alert.severity }}</span></td>
                <td><span class="pill plain" [class.err]="alert.status === 'FIRING'" [class.ok]="alert.status === 'RESOLVED'">{{ alert.status === 'FIRING' ? 'EN CURSO' : 'RESUELTA' }}</span>
                  @if (alert.resolved_at) { <span class="sub">{{ stamp(alert.resolved_at) }}</span> }</td>
                <td><strong>{{ alert.title }}</strong>@if (alert.summary) { <span class="sub">{{ alert.summary }}</span> }</td>
              </tr>
            }
          </tbody>
        </table></div></div>
      }

      <div class="card" style="margin-top:20px;padding:16px">
        <h2 style="font-size:14px">Levantar Grafana y Prometheus</h2>
        <p class="sub">Desde la raíz del monorepo, con Docker Desktop abierto y el archivo <code>infrastructure/observability/.env</code> completo (ver <code>.env.example</code>):</p>
        <pre class="mono" style="margin:8px 0 0;font-size:12px;white-space:pre-wrap">docker compose --env-file infrastructure/observability/.env -f infrastructure/observability/compose.yaml up -d</pre>
      </div>
    </section>
  `,
  styles: [`
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:16px}
    .mini{padding:14px;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
    .sub{display:block;font-size:11px;color:var(--muted)}
    .nowrap{white-space:nowrap}
    tr.bad td{background:var(--err-bg)}
  `],
})
export class MonitoringComponent {
  private readonly api = inject(ApiService);
  readonly status = signal<MonitoringStatus | null>(null);
  readonly alerts = signal<TenantAlertRecord[]>([]);
  readonly tenants = signal<TenantSummary[]>([]);
  readonly error = signal('');
  readonly tenant = signal(''); readonly state = signal('');
  readonly slugs = computed(() => this.tenants().filter(item => item.status !== 'DELETED').map(item => item.slug));

  constructor() {
    this.api.tenants().subscribe({ next: r => this.tenants.set(r.data) });
    this.load();
    interval(10000).pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(() => this.load());
  }

  /** Consulta el estado del monitoreo y las alertas con los filtros actuales. */
  load() {
    this.api.monitoringStatus().subscribe({ next: r => { this.status.set(r.data); this.error.set(''); }, error: () => this.error.set('No se pudo consultar el estado del monitoreo.') });
    this.api.monitoringAlerts({ tenant: this.tenant(), status: this.state(), limit: 100 }).subscribe({ next: r => this.alerts.set(r.data) });
  }

  stamp(value: string) { return new Date(value).toLocaleString('es-BO', { hour12: false }); }
  val(event: Event) { return (event.target as HTMLSelectElement).value; }
}
