import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { TenantSummary } from '@modulo2/contracts';
import { ApiService } from '../api.service';

@Component({
  imports: [RouterLink],
  template: `
    <section class="view">
      <div class="view-head">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h1>Lista y ciclo de vida de tenants</h1><span class="rf-badge">RF-14 a RF-18 · Integrante 5</span></div>
          <p>Consulta tenants por nombre, estado y plan (RF-14). Las acciones de ciclo de vida (actualizar nombre, suspender, reanudar y eliminar con confirmación) las integra el orquestador.</p>
        </div>
        <a class="btn primary" routerLink="/crear">+ Crear nuevo tenant (RF-07)</a>
      </div>

      <div class="toolbar">
        <div class="filters">
          <input type="search" aria-label="Buscar tenant" placeholder="Buscar por nombre o identificador (RF-14)…" [value]="query()" (input)="query.set(val($event))">
          <select aria-label="Filtrar por estado" (change)="status.set(val($event))"><option value="">Todos los estados</option>@for (s of statuses(); track s) { <option [value]="s">{{ s }}</option> }</select>
        </div>
        <span>Cada tenant recibirá su propia IP pública como URL de acceso (<strong>RF-21</strong>).</span>
      </div>

      @if (loading()) { <div class="notice info" role="status">Consultando instituciones…</div> }
      @if (error()) { <div class="notice err" role="alert">{{ error() }}</div> }
      @if (!loading() && !error() && !tenants().length) {
        <div class="card empty"><div class="empty-icon">▦</div><h2>Tu primera institución empieza aquí</h2><p>Aún no hay tenants registrados. Explora los planes mientras se integra el flujo de creación.</p><a class="btn primary" routerLink="/planes">Explorar planes →</a></div>
      }
      @if (tenants().length) {
        <div class="table-card"><div class="table-scroll"><table>
          <thead><tr><th>Institución / Tenant (RF-14)</th><th>URL / IP pública (RF-21)</th><th>Plan (RF-02)</th><th>Motor IaC (RF-08)</th><th>Estado (RF-16/17)</th><th style="text-align:right">Acciones (RF-15 a RF-18)</th></tr></thead>
          <tbody>
            @for (tenant of filtered(); track tenant.slug) {
              <tr>
                <td><strong>{{ tenant.name }}</strong><span class="sub mono">ID: {{ tenant.slug }}</span></td>
                <td>@if (tenant.access_url) { <a class="mono link" [href]="tenant.access_url" target="_blank" rel="noopener">{{ tenant.access_url }} ↗</a> } @else { <span class="sub">Sin URL todavía</span> }<span class="sub">Entorno: {{ tenant.environment }}</span></td>
                <td><strong>{{ tenant.plan_slug }}</strong></td>
                <td><span class="tag">{{ tenant.engine }}</span><span class="sub">{{ tenant.region }}</span></td>
                <td><span class="pill plain" [class.ok]="tenant.status === 'ACTIVE'" [class.warn]="tenant.status !== 'ACTIVE'">{{ tenant.status }}</span></td>
                <td style="text-align:right;white-space:nowrap"><button class="btn sm" disabled title="Disponible con el orquestador (Integrante 5)">Actualizar nombre</button> <button class="btn sm" disabled title="Disponible con el orquestador (Integrante 5)">Suspender</button></td>
              </tr>
            } @empty { <tr><td colspan="6">Ningún tenant coincide con el filtro.</td></tr> }
          </tbody>
        </table></div></div>
      }
    </section>
  `,
})
export class TenantsComponent {
  readonly tenants = signal<TenantSummary[]>([]); readonly loading = signal(true); readonly error = signal('');
  readonly query = signal(''); readonly status = signal('');
  readonly statuses = computed(() => [...new Set(this.tenants().map(tenant => tenant.status))]);
  readonly filtered = computed(() => {
    const query = this.query().trim().toLowerCase();
    return this.tenants().filter(tenant => (!query || tenant.name.toLowerCase().includes(query) || tenant.slug.includes(query)) && (!this.status() || tenant.status === this.status()));
  });
  constructor() { inject(ApiService).tenants().subscribe({ next: r => { this.tenants.set(r.data); this.loading.set(false); }, error: () => { this.error.set('No se pudo consultar la lista de tenants.'); this.loading.set(false); } }); }
  val(event: Event) { return (event.target as HTMLInputElement | HTMLSelectElement).value; }
}
