import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { interval } from 'rxjs';
import type { LogSource, TenantLogs, TenantSummary } from '@modulo2/contracts';
import { ApiService } from '../api.service';
import { LogConsoleComponent, type LogLine } from './log-console.component';

const ROLES: Record<string, string> = { frontend: 'Frontend', backend: 'Backend', database: 'Base de datos' };

@Component({
  imports: [LogConsoleComponent],
  template: `
    <section class="view">
      <div class="view-head">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h1>Logs de los tenants</h1><span class="rf-badge">RF-11 · RF-26</span></div>
          <p>Registro real de cada servidor del tenant: accesos y errores de Nginx en el frontend, la aplicación de asistencia en el backend y PostgreSQL en la base de datos. Se leen por SSH en el momento, sin instalar agentes. Las líneas con contraseñas, claves o tokens se ocultan.</p>
        </div>
      </div>

      @if (!enabled()) { <div class="notice warn" role="status">La consulta de logs requiere la demo local real (<code>DEMO_PROVISIONING_LOCAL=true</code>, sin simulación) y la llave SSH de WSL configurada.</div> }
      @if (error()) { <div class="notice err" role="alert">{{ error() }}</div> }

      <div class="toolbar">
        <div class="filters">
          <select aria-label="Tenant" (change)="slug.set(val($event)); load(true)">
            <option value="">Elige un tenant activo…</option>
            @for (item of active(); track item.slug) { <option [value]="item.slug" [selected]="item.slug === slug()">{{ item.name }} · {{ item.slug }}</option> }
          </select>
          <input type="search" aria-label="Filtrar líneas" placeholder="Filtrar texto (por ejemplo 500, ERROR, login)…" [value]="query()" (input)="query.set(val($event))">
          <select aria-label="Líneas" (change)="lines.set(+val($event)); load(true)"><option value="100">100 líneas</option><option value="200" selected>200 líneas</option><option value="500">500 líneas</option></select>
        </div>
        <span class="auto"><label><input type="checkbox" [checked]="auto()" (change)="auto.set(checked($event))"> actualizar cada 5 s</label>
          <button class="btn sm" (click)="load(true)" [disabled]="!slug() || loading()">Actualizar</button></span>
      </div>

      <div class="source-tabs" role="tablist" aria-label="Fuente de log">
        @for (group of groups(); track group.role) {
          <div class="group"><span class="group-title">{{ group.title }}</span>
            @for (item of group.items; track item.id) { <button type="button" role="tab" class="btn sm" [class.primary]="item.id === source()" [attr.aria-selected]="item.id === source()" [title]="item.description" (click)="source.set(item.id); load(true)">{{ short(item) }}</button> }
          </div>
        }
      </div>

      @if (!slug()) {
        <div class="card empty"><div class="empty-icon">▤</div><h2>Elige un tenant</h2><p>Solo los tenants activos tienen servidores en ejecución. Después elige el servidor y el log que quieres ver.</p></div>
      } @else {
        <div class="card" style="padding:12px">
          <div class="meta">{{ current()?.label ?? '' }} <span class="sub">{{ current()?.description }}</span>
            @if (data(); as d) { <span class="sub">· consultado {{ stamp(d.fetched_at) }} · {{ filtered().length }} de {{ d.lines.length }} líneas{{ d.truncated ? ' (recortado)' : '' }}</span> }
          </div>
          <app-log-console [lines]="shown()" [showTime]="false" [showStage]="false" [name]="slug() + '-' + source()" />
        </div>
      }
    </section>
  `,
  styles: [`
    .auto{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--muted)}
    .source-tabs{display:flex;flex-wrap:wrap;gap:16px;margin:12px 0}
    .group{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .group-title{font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
    .meta{font-size:13px;font-weight:600;margin-bottom:8px}
    .sub{font-size:11px;font-weight:400;color:var(--muted);margin-left:6px}
  `],
})
export class LogsComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  readonly sources = signal<LogSource[]>([]);
  readonly enabled = signal(true);
  readonly tenants = signal<TenantSummary[]>([]);
  readonly slug = signal(''); readonly source = signal('backend-aplicacion'); readonly lines = signal(200);
  readonly query = signal(''); readonly auto = signal(true);
  readonly data = signal<TenantLogs | null>(null);
  readonly loading = signal(false); readonly error = signal('');
  readonly active = computed(() => this.tenants().filter(item => item.status === 'ACTIVE'));
  readonly current = computed(() => this.sources().find(item => item.id === this.source()));
  readonly groups = computed(() => Object.keys(ROLES).map(role => ({ role, title: ROLES[role], items: this.sources().filter(item => item.role === role) })).filter(group => group.items.length));
  readonly filtered = computed(() => {
    const query = this.query().trim().toLowerCase();
    const lines = this.data()?.lines ?? [];
    return query ? lines.filter(line => line.toLowerCase().includes(query)) : lines;
  });
  readonly shown = computed<LogLine[]>(() => {
    const at = this.data()?.fetched_at ?? new Date().toISOString();
    return this.filtered().map(message => ({ occurred_at: at, stage: null, status: '', message }));
  });

  constructor() {
    // Desde Grafana se puede abrir con ?tenant=<id>&source=<fuente>.
    const wanted = this.route.snapshot.queryParamMap;
    if (wanted.get('source')) this.source.set(wanted.get('source') as string);
    this.api.tenants().subscribe({ next: r => { this.tenants.set(r.data); const slug = wanted.get('tenant'); if (slug && r.data.some(item => item.slug === slug && item.status === 'ACTIVE')) { this.slug.set(slug); this.load(true); } } });
    this.api.logSources().subscribe({ next: r => { this.sources.set(r.data.sources); this.enabled.set(r.data.enabled); }, error: () => this.error.set('No se pudo consultar las fuentes de log.') });
    interval(5000).pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(() => { if (this.auto() && this.slug() && !this.loading()) this.load(false); });
  }

  /** Lee el log del tenant y la fuente elegidos; la primera lectura tras un cambio queda en la auditoría. */
  load(initial: boolean) {
    if (!this.slug() || !this.enabled()) return;
    this.loading.set(true);
    this.api.tenantLogs(this.slug(), this.source(), this.lines(), initial).subscribe({
      next: r => { this.data.set(r.data); this.error.set(''); this.loading.set(false); },
      error: (failure: { error?: { message?: string } }) => { this.error.set(failure.error?.message ?? 'No se pudo leer el log del servidor.'); this.loading.set(false); },
    });
  }

  short(item: LogSource) { return item.label.split('·')[1]?.trim() ?? item.label; }
  stamp(value: string) { return new Date(value).toLocaleTimeString('es-BO', { hour12: false }); }
  val(event: Event) { return (event.target as HTMLInputElement | HTMLSelectElement).value; }
  checked(event: Event) { return (event.target as HTMLInputElement).checked; }
}
