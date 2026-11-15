import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { AuditEventRecord } from '@modulo2/contracts';
import { ApiService } from '../api.service';

const ACTIONS: Record<string, string> = {
  LOGIN: 'Inicio de sesión', DRAFT_CREATE: 'Borrador de tenant', SECURITY_SCAN: 'Escaneo de seguridad', CREATE: 'Creación de tenant',
  SUSPEND: 'Suspensión', RESUME: 'Reanudación', BACKUP: 'Respaldo', RESTORE: 'Restauración', DELETE: 'Eliminación', RENAME: 'Cambio de nombre',
  CREDENTIALS_REVEAL: 'Consulta de credenciales', MONITORING_TARGETS: 'Targets de monitoreo', LOGS_VIEW: 'Consulta de logs',
};
const STATUSES = ['STARTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DENIED', 'INFO'];
const PAGE = 25;

@Component({
  imports: [RouterLink],
  template: `
    <section class="view">
      <div class="view-head">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h1>Auditoría de operaciones</h1><span class="rf-badge">RF-20</span></div>
          <p>Quién inició cada operación, cuándo se realizó y cuál fue su resultado. El registro es de solo inserción y no guarda contraseñas ni secretos. Ver también <a class="link" routerLink="/tenants">tenants</a>.</p>
        </div>
        <button class="btn" (click)="load()">Actualizar</button>
      </div>

      <div class="toolbar">
        <div class="filters">
          <input type="search" aria-label="Filtrar por tenant" placeholder="Tenant (identificador exacto)…" [value]="tenant()" (input)="tenant.set(val($event)); offset.set(0); load()">
          <select aria-label="Filtrar por acción" (change)="action.set(val($event)); offset.set(0); load()"><option value="">Todas las acciones</option>@for (key of actionKeys; track key) { <option [value]="key">{{ label(key) }}</option> }</select>
          <select aria-label="Filtrar por resultado" (change)="status.set(val($event)); offset.set(0); load()"><option value="">Todos los resultados</option>@for (s of statuses; track s) { <option [value]="s">{{ s }}</option> }</select>
        </div>
        <span>{{ total() }} eventos</span>
      </div>

      @if (error()) { <div class="notice err" role="alert">{{ error() }}</div> }
      @if (!loading() && !events().length && !error()) {
        <div class="card empty"><div class="empty-icon">▤</div><h2>Sin eventos</h2><p>No hay eventos que coincidan con el filtro.</p></div>
      }
      @if (events().length) {
        <div class="table-card"><div class="table-scroll"><table>
          <thead><tr><th>Fecha y hora</th><th>Quién</th><th>Acción</th><th>Tenant</th><th>Resultado</th><th>Detalle</th></tr></thead>
          <tbody>
            @for (event of events(); track event.id) {
              <tr [class.bad]="event.status === 'FAILED' || event.status === 'DENIED'">
                <td class="mono nowrap">{{ stamp(event.occurred_at) }}</td>
                <td><strong>{{ event.actor }}</strong></td>
                <td>{{ label(event.action) }}@if (event.stage) { <span class="sub mono">{{ event.stage }}</span> }</td>
                <td class="mono">{{ event.tenant_slug ?? '—' }}</td>
                <td><span class="pill plain" [class.ok]="event.status === 'SUCCEEDED'" [class.err]="event.status === 'FAILED' || event.status === 'DENIED'" [class.warn]="event.status === 'STARTED' || event.status === 'RUNNING'" [class.neutral]="event.status === 'INFO'">{{ event.status }}</span></td>
                <td>{{ event.message }}
                  @if (event.operation_id) { <button class="btn sm" (click)="toggle(event.operation_id)">{{ opened() === event.operation_id ? 'Ocultar operación' : 'Ver operación' }}</button> }
                  @if (opened() === event.operation_id) {
                    <ol class="events">@for (step of timeline(); track step.id) { <li [class.bad]="step.status === 'FAILED'"><span class="mono">{{ stamp(step.occurred_at) }}</span> · {{ label(step.action) }} · <span class="tag">{{ step.stage ?? step.status }}</span> {{ step.message }}</li> }</ol>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table></div></div>
        <div class="pager">
          <button class="btn sm" [disabled]="offset() === 0" (click)="page(-1)">← Anteriores</button>
          <span>{{ from() }}–{{ to() }} de {{ total() }}</span>
          <button class="btn sm" [disabled]="to() >= total()" (click)="page(1)">Siguientes →</button>
        </div>
      }
    </section>
  `,
  styles: [`
    .nowrap{white-space:nowrap}
    tr.bad td{background:var(--err-bg)}
    .events{margin:8px 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;font-size:11px}
    .events li.bad{color:var(--err)}
    .pager{display:flex;align-items:center;justify-content:flex-end;gap:12px;font-size:12px;color:var(--muted);margin-top:12px}
    .sub{display:block;font-size:10px;color:var(--muted)}
  `],
})
export class AuditComponent {
  private readonly api = inject(ApiService);
  readonly actionKeys = Object.keys(ACTIONS);
  readonly statuses = STATUSES;
  readonly events = signal<AuditEventRecord[]>([]); readonly total = signal(0); readonly offset = signal(0);
  readonly loading = signal(true); readonly error = signal('');
  readonly tenant = signal(''); readonly action = signal(''); readonly status = signal('');
  readonly opened = signal<string | null>(null); readonly timeline = signal<AuditEventRecord[]>([]);
  readonly from = computed(() => (this.total() ? this.offset() + 1 : 0));
  readonly to = computed(() => Math.min(this.offset() + PAGE, this.total()));

  constructor() { this.load(); }

  /** Consulta el registro con los filtros y la página actuales. */
  load() {
    this.loading.set(true);
    this.api.audit({ tenant: this.tenant().trim(), action: this.action(), status: this.status(), limit: PAGE, offset: this.offset() }).subscribe({
      next: r => { this.events.set(r.data); this.total.set(r.meta.total); this.loading.set(false); this.error.set(''); },
      error: () => { this.error.set('No se pudo consultar la auditoría.'); this.loading.set(false); },
    });
  }

  page(step: number) { this.offset.set(Math.max(0, this.offset() + step * PAGE)); this.load(); }

  /** Muestra u oculta la línea de tiempo completa de una operación. */
  toggle(operationId: string) {
    if (this.opened() === operationId) { this.opened.set(null); return; }
    this.opened.set(operationId); this.timeline.set([]);
    this.api.auditOperation(operationId).subscribe({ next: r => this.timeline.set(r.data) });
  }

  label(key: string) { return ACTIONS[key] ?? key; }
  stamp(value: string) { return new Date(value).toLocaleString('es-BO', { hour12: false }); }
  val(event: Event) { return (event.target as HTMLInputElement | HTMLSelectElement).value; }
}
