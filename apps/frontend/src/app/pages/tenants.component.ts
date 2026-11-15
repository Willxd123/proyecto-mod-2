import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { interval } from 'rxjs';
import type { LifecycleAction, LifecycleOperation, TenantLifecycleInfo, TenantSummary } from '@modulo2/contracts';
import { ApiService } from '../api.service';
import { LogConsoleComponent } from './log-console.component';

type Dialog = { kind: LifecycleAction | 'rename' | 'log' | 'create'; slug: string } | null;
const BUSY = ['PROVISIONING', 'SUSPENDING', 'RESUMING', 'BACKING_UP', 'RESTORING', 'DELETING'];
const TITLES: Record<string, string> = { create: 'Iniciar aprovisionamiento', backup: 'Respaldar tenant', restore: 'Restaurar tenant', suspend: 'Suspender tenant', resume: 'Reanudar tenant', delete: 'Eliminar tenant', rename: 'Actualizar nombre', log: 'Operación del tenant' };

@Component({
  imports: [RouterLink, FormsModule, LogConsoleComponent],
  template: `
    <section class="view">
      <div class="view-head">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h1>Lista y ciclo de vida de tenants</h1><span class="rf-badge">RF-14 a RF-18</span></div>
          <p>Consulta tenants por nombre, estado, plan y entorno. Suspende, reanuda o elimina una institución con confirmación; cada acción queda en la <a class="link" routerLink="/auditoria">auditoría</a>.</p>
        </div>
        <a class="btn primary" routerLink="/crear">+ Crear nuevo tenant (RF-07)</a>
      </div>

      <div class="toolbar">
        <div class="filters">
          <input type="search" aria-label="Buscar tenant" placeholder="Buscar por nombre o identificador (RF-14)…" [value]="query()" (input)="query.set(val($event))">
          <select aria-label="Filtrar por estado" (change)="status.set(val($event))"><option value="">Todos los estados</option>@for (s of statuses(); track s) { <option [value]="s">{{ s }}</option> }</select>
          <select aria-label="Filtrar por plan" (change)="plan.set(val($event))"><option value="">Todos los planes</option>@for (p of plans(); track p) { <option [value]="p">{{ p }}</option> }</select>
          <select aria-label="Filtrar por entorno" (change)="environment.set(val($event))"><option value="">Todos los entornos</option>@for (e of environments(); track e) { <option [value]="e">{{ e }}</option> }</select>
          <label class="check"><input type="checkbox" [checked]="showDeleted()" (change)="showDeleted.set(checked($event))"> Mostrar eliminados</label>
        </div>
        <span>{{ filtered().length }} de {{ tenants().length }} tenants</span>
      </div>

      @if (loading()) { <div class="notice info" role="status">Consultando instituciones…</div> }
      @if (error()) { <div class="notice err" role="alert">{{ error() }}</div> }
      @if (credentialError()) { <div class="notice err" role="alert">{{ credentialError() }}</div> }
      @if (credentials(); as access) {
        <div class="notice warn" role="status">Credenciales locales de demostración para <strong>{{ access.slug }}</strong>:
          <div>Usuario: {{ access.email }}</div><div>Contraseña: {{ access.password }}</div>
          <button type="button" class="btn sm" (click)="credentials.set(null)">Ocultar</button>
          <p>Esta consulta queda registrada en la auditoría. No compartas la pantalla ni guardes la contraseña en logs.</p>
        </div>
      }
      @if (!loading() && !error() && !tenants().length) {
        <div class="card empty"><div class="empty-icon">▦</div><h2>Tu primera institución empieza aquí</h2><p>Aún no hay tenants registrados.</p><a class="btn primary" routerLink="/crear">Crear tenant →</a></div>
      }
      @if (tenants().length) {
        <div class="table-card"><div class="table-scroll"><table>
          <thead><tr><th>Institución / Tenant (RF-14)</th><th>URL / IP pública (RF-21)</th><th>Plan (RF-02)</th><th>Motor IaC (RF-08)</th><th>Estado (RF-16/17)</th><th style="text-align:right">Acciones (RF-15 a RF-18)</th></tr></thead>
          <tbody>
            @for (tenant of filtered(); track tenant.slug) {
              <tr>
                <td><strong>{{ tenant.name }}</strong><span class="sub mono">ID: {{ tenant.slug }}</span></td>
                <td>@if (tenant.access_url && tenant.simulated) { <span class="mono">{{ tenant.access_url }}</span> <span class="pill warn plain" title="Dirección inventada por la simulación; no existe en AWS">simulado</span> } @else if (tenant.access_url) { <a class="mono link" [href]="tenant.access_url" target="_blank" rel="noopener">{{ tenant.access_url }} ↗</a> } @else { <span class="sub">{{ tenant.status === 'SUSPENDED' ? 'Suspendido: sin IP pública' : 'Sin URL todavía' }}</span> }<span class="sub">Entorno: {{ tenant.environment }}</span></td>
                <td><strong>{{ tenant.plan_slug }}</strong></td>
                <td><span class="tag">{{ tenant.engine }}</span><span class="sub">{{ tenant.region }}</span></td>
                <td><span class="pill plain" [class.ok]="tenant.status === 'ACTIVE'" [class.err]="tenant.status === 'ERROR'" [class.neutral]="tenant.status === 'SUSPENDED' || tenant.status === 'DELETED' || tenant.status === 'PENDING'" [class.warn]="isBusy(tenant.status)">{{ tenant.status }}</span></td>
                <td class="row-actions">
                  @if (demoEnabled() && tenant.demo_credentials_available) { <button class="btn sm" (click)="reveal(tenant.slug)" [disabled]="credentialLoading()">Ver credenciales demo</button> }
                  @if (isBusy(tenant.status)) { <button class="btn sm" (click)="open('log', tenant)">Ver operación</button> }
                  @if (tenant.status === 'PENDING') { <button class="btn sm primary" (click)="open('create', tenant)">Iniciar aprovisionamiento</button> }
                  @if (tenant.status !== 'DELETED') { <button class="btn sm" (click)="open('rename', tenant)">Actualizar nombre</button> }
                  @if (tenant.status === 'ACTIVE') { <button class="btn sm" (click)="open('backup', tenant)">Respaldar</button> <button class="btn sm" (click)="open('restore', tenant)">Restaurar</button> <button class="btn sm" (click)="open('suspend', tenant)">Suspender</button> }
                  @if (tenant.status === 'SUSPENDED') { <button class="btn sm" (click)="open('resume', tenant)">Reanudar</button> }
                  @if (['ACTIVE', 'SUSPENDED', 'ERROR'].includes(tenant.status)) { <button class="btn sm danger" (click)="open('delete', tenant)">Eliminar</button> }
                </td>
              </tr>
            } @empty { <tr><td colspan="6">Ningún tenant coincide con el filtro.</td></tr> }
          </tbody>
        </table></div></div>
      }
    </section>

    @if (dialog(); as current) {
      <div class="modal-back" (click)="close()">
        <div class="modal" role="dialog" aria-modal="true" [attr.aria-label]="titles[current.kind]" (click)="$event.stopPropagation()">
          <h2>{{ titles[current.kind] }} · <span class="mono">{{ current.slug }}</span></h2>
          @if (actionError()) { <div class="notice err" role="alert">{{ actionError() }}</div> }

          @if (current.kind === 'create') {
            <div class="notice warn"><div><strong>Esto crea recursos reales en AWS y genera cargos.</strong> Se ejecutan los 3 escáneres, el motor del tenant, Ansible y la verificación HTTPS. Tarda varios minutos y puedes seguirlo aquí.</div></div>
            <label for="create-slug" class="lbl">Escribe <span class="mono">{{ current.slug }}</span> para confirmar</label>
            <input id="create-slug" class="text mono" [(ngModel)]="confirmText" autocomplete="off">
            <div class="modal-actions"><button class="btn" (click)="close()">Cancelar</button>
              <button class="btn primary" [disabled]="working() || confirmText !== current.slug" (click)="startCreate(current.slug)">{{ working() ? 'Enviando…' : 'Iniciar aprovisionamiento' }}</button></div>
          }

          @if (current.kind === 'rename') {
            <label for="new-name" class="lbl">Nuevo nombre de la institución</label>
            <input id="new-name" class="text" [(ngModel)]="newName" maxlength="120">
            <div class="modal-actions"><button class="btn" (click)="close()">Cancelar</button>
              <button class="btn primary" [disabled]="!newName.trim() || working()" (click)="rename(current.slug)">Guardar</button></div>
          }

          @if (current.kind === 'suspend' || current.kind === 'resume' || current.kind === 'delete' || current.kind === 'backup' || current.kind === 'restore') {
            @if (info(); as data) {
              @if (data.simulated) { <div class="notice warn">Modo simulación: no se toca AWS y los eventos se marcan como [SIMULADO].</div> }
              @if (!data.enabled) { <div class="notice warn">Las operaciones están deshabilitadas en este equipo (requiere <code>DEMO_PROVISIONING_LOCAL=true</code> con el panel en local).</div> }
              @if (current.kind === 'suspend') {
                <p>Se detendrán las 3 instancias del tenant para dejar de generar cómputo. <strong>Los discos y los datos se conservan.</strong> Se libera la IP pública: al reanudar cambiará y se actualizarán la URL y el monitoreo.</p>
              }
              @if (current.kind === 'resume') {
                <p>Se iniciarán las 3 instancias detenidas y se comprobará que el frontend responda. La IP pública cambiará y se actualizarán la URL y el monitoreo.</p>
              }
              @if (current.kind === 'backup') {
                <p>Se hace una copia de la base de datos PostgreSQL del tenant con <code>pg_dump</code> (estudiantes, cursos y asistencia) y se guarda <strong>en este equipo</strong>, en <code>output/backups</code>. El tenant sigue disponible mientras tanto. Los respaldos contienen datos reales: no los compartas ni los subas a Git.</p>
                @if (data.backups.length) { <p class="sub">Respaldos existentes: {{ data.backups.length }}. El último es del {{ stamp(data.backups[0].created_at) }}.</p> }
              }
              @if (current.kind === 'restore') {
                <div class="notice err"><div><strong>Reemplaza todos los datos actuales del tenant</strong> por los del respaldo elegido. Lo que se haya registrado después se pierde. El backend se detiene unos instantes; la restauración es atómica: si falla, no cambia nada.</div></div>
                <label for="backup-select" class="lbl">Respaldo a restaurar</label>
                <select id="backup-select" class="text" [(ngModel)]="selectedBackup">@for (item of data.backups; track item.backup_id) { <option [value]="item.backup_id">{{ stamp(item.created_at) }} · {{ size(item.size_bytes) }} · por {{ item.actor }}{{ item.simulated ? ' · simulado' : '' }}</option> }</select>
                <label for="confirm-restore" class="lbl">Escribe <span class="mono">{{ current.slug }}</span> para confirmar</label>
                <input id="confirm-restore" class="text mono" [(ngModel)]="confirmText" autocomplete="off">
              }
              @if (current.kind === 'delete') {
                <div class="notice err"><div><strong>Esta acción no se puede deshacer.</strong> Se eliminará:</div></div>
                <ul class="impact">@for (line of data.will_delete; track line) { <li>{{ line }}</li> }</ul>
                <label for="confirm-slug" class="lbl">Escribe <span class="mono">{{ current.slug }}</span> para confirmar</label>
                <input id="confirm-slug" class="text mono" [(ngModel)]="confirmText" autocomplete="off">
              }
              <div class="modal-actions"><button class="btn" (click)="close()">Cancelar</button>
                <button class="btn" [class.danger]="current.kind === 'delete' || current.kind === 'restore'" [class.primary]="current.kind !== 'delete' && current.kind !== 'restore'"
                  [disabled]="working() || !data.allowed_actions.includes(current.kind) || ((current.kind === 'delete' || current.kind === 'restore') && confirmText !== current.slug) || (current.kind === 'restore' && !selectedBackup)"
                  (click)="run(current.kind, current.slug)">{{ working() ? 'Enviando…' : titles[current.kind] }}</button></div>
              @if (!data.allowed_actions.includes(current.kind) && data.enabled) { <p class="sub">No disponible para un tenant en estado {{ data.status }}.</p> }
            } @else { <div class="notice info">Consultando recursos del tenant…</div> }
          }

          @if (current.kind === 'log') {
            @if (operation(); as op) {
              <p><span class="pill plain" [class.ok]="op.status === 'SUCCEEDED'" [class.err]="op.status === 'FAILED'" [class.warn]="op.status === 'RUNNING'">{{ op.status }}</span>
                {{ op.action }} · iniciada por <strong>{{ op.actor }}</strong> {{ op.simulated ? '(simulada)' : '' }}</p>
              <app-log-console [lines]="op.events" [running]="op.status === 'RUNNING'" [name]="op.tenant_slug + '-' + op.action" />
              @if (op.error) { <div class="notice err" role="alert">{{ op.error }}</div> }
            } @else { <div class="notice info">Sin operaciones registradas para este tenant.</div> }
            <div class="modal-actions"><button class="btn" (click)="close()">Cerrar</button></div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
    .check input{width:auto;margin:0}
    .modal p{font-size:13px;line-height:1.6}
    .row-actions{text-align:right;white-space:nowrap}
    .row-actions .btn{margin-left:4px}
    .btn.danger{color:var(--err);border-color:var(--err-line)}
    .btn.danger:hover:not(:disabled){background:var(--err-bg)}
    .modal-back{position:fixed;inset:0;background:rgb(15 23 42/.55);display:grid;place-items:center;z-index:50}
    .modal{background:#fff;border-radius:12px;width:min(820px,94vw);max-height:88vh;overflow:auto;padding:22px;display:flex;flex-direction:column;gap:12px}
    .modal h2{font-size:16px}
    .modal .lbl{font-size:12px;font-weight:600;color:var(--muted)}
    .modal .text{padding:9px 10px;border:1px solid var(--border-strong);border-radius:8px}
    .modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
    .impact{margin:0;padding-left:18px;font-size:12px;line-height:1.7}
    .events{margin:0;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:6px;font-size:12px}
    .events li.bad{color:var(--err)}
    .sub{font-size:11px;color:var(--muted)}
  `],
})
export class TenantsComponent {
  private readonly api = inject(ApiService);
  readonly titles = TITLES;
  readonly tenants = signal<TenantSummary[]>([]); readonly loading = signal(true); readonly error = signal('');
  readonly demoEnabled = signal(false);
  readonly credentialLoading = signal(false);
  readonly credentialError = signal('');
  readonly credentials = signal<{ slug: string; email: string; password: string } | null>(null);
  readonly query = signal(''); readonly status = signal(''); readonly plan = signal(''); readonly environment = signal('');
  readonly showDeleted = signal(false);
  readonly dialog = signal<Dialog>(null);
  readonly info = signal<TenantLifecycleInfo | null>(null);
  readonly operation = signal<LifecycleOperation | null>(null);
  readonly working = signal(false);
  readonly actionError = signal('');
  confirmText = ''; newName = ''; selectedBackup = '';
  readonly statuses = computed(() => [...new Set(this.tenants().map(tenant => tenant.status))]);
  readonly plans = computed(() => [...new Set(this.tenants().map(tenant => tenant.plan_slug))]);
  readonly environments = computed(() => [...new Set(this.tenants().map(tenant => tenant.environment))]);
  readonly filtered = computed(() => {
    const query = this.query().trim().toLowerCase();
    return this.tenants().filter(tenant => (!query || tenant.name.toLowerCase().includes(query) || tenant.slug.includes(query))
      && (!this.status() || tenant.status === this.status()) && (!this.plan() || tenant.plan_slug === this.plan())
      && (!this.environment() || tenant.environment === this.environment())
      && (this.showDeleted() || this.status() === 'DELETED' || tenant.status !== 'DELETED'));
  });

  constructor() {
    this.load();
    this.api.demoCredentialsStatus().subscribe({ next: r => this.demoEnabled.set(r.data.enabled), error: () => this.credentialError.set('No se pudo consultar el estado de credenciales demo.') });
    // Mientras haya operaciones en curso se refresca la lista y, si está abierto, el registro de la operación.
    interval(3000).pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(() => {
      if (this.tenants().some(tenant => BUSY.includes(tenant.status))) this.load(true);
      const current = this.dialog();
      if (current?.kind === 'log') this.loadOperation(current.slug);
    });
  }

  /** Consulta la lista de tenants; en las actualizaciones periódicas no muestra el aviso de carga. */
  load(silent = false) {
    if (!silent) this.loading.set(true);
    this.api.tenants().subscribe({ next: r => { this.tenants.set(r.data); this.loading.set(false); this.error.set(''); },
      error: () => { this.error.set('No se pudo consultar la lista de tenants.'); this.loading.set(false); } });
  }

  isBusy(status: string) { return BUSY.includes(status); }

  /** Abre el cuadro de una acción; para las que afectan recursos consulta antes qué se verá afectado. */
  open(kind: NonNullable<Dialog>['kind'], tenant: TenantSummary) {
    this.actionError.set(''); this.confirmText = ''; this.newName = tenant.name; this.info.set(null); this.operation.set(null);
    this.dialog.set({ kind, slug: tenant.slug });
    if (kind === 'log') this.loadOperation(tenant.slug);
    else if (kind !== 'rename') this.api.lifecycleInfo(tenant.slug).subscribe({ next: r => { this.info.set(r.data); this.selectedBackup = r.data.backups[0]?.backup_id ?? ''; }, error: () => this.actionError.set('No se pudo consultar el tenant.') });
  }

  close() { this.dialog.set(null); }

  loadOperation(slug: string) { this.api.lifecycleOperation(slug).subscribe({ next: r => this.operation.set(r.data) }); }

  /** Envía la acción confirmada y pasa al registro en vivo de la operación. */
  run(kind: LifecycleAction, slug: string) {
    this.working.set(true); this.actionError.set('');
    (kind === 'restore' ? this.api.restoreBackup(slug, this.selectedBackup) : this.api.lifecycleAction(kind, slug)).subscribe({
      next: r => { this.working.set(false); this.operation.set(r.data); this.dialog.set({ kind: 'log', slug }); this.load(true); },
      error: (failure: { error?: { message?: string } }) => { this.working.set(false); this.actionError.set(failure.error?.message ?? 'No se pudo iniciar la operación.'); },
    });
  }

  /** Inicia la creación de un borrador PENDING y pasa al registro en vivo de la operación. */
  startCreate(slug: string) {
    this.working.set(true); this.actionError.set('');
    this.api.startDemoProvisioning(slug).subscribe({
      next: () => { this.working.set(false); this.dialog.set({ kind: 'log', slug }); this.operation.set(null); this.load(true); setTimeout(() => this.loadOperation(slug), 800); },
      error: (failure: { error?: { message?: string } }) => { this.working.set(false); this.actionError.set(failure.error?.message ?? 'No se pudo iniciar el aprovisionamiento.'); },
    });
  }

  rename(slug: string) {
    this.working.set(true); this.actionError.set('');
    this.api.renameTenant(slug, this.newName.trim()).subscribe({
      next: () => { this.working.set(false); this.close(); this.load(true); },
      error: (failure: { error?: { message?: string } }) => { this.working.set(false); this.actionError.set(failure.error?.message ?? 'No se pudo actualizar el nombre.'); },
    });
  }

  stamp(value: string) { return new Date(value).toLocaleString('es-BO', { hour12: false }); }
  size(bytes: number) { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }

  time(value: string) { return new Date(value).toLocaleTimeString('es-BO', { hour12: false }); }

  reveal(slug: string) {
    this.credentials.set(null);
    this.credentialError.set('');
    if (!window.confirm(`Se mostrará la contraseña inicial de ${slug} en esta pantalla local. ¿Continuar?`)) return;
    this.credentialLoading.set(true);
    this.api.revealDemoCredentials(slug).subscribe({
      next: r => { this.credentials.set({ slug, ...r.data }); this.credentialLoading.set(false); },
      error: () => { this.credentialError.set('No se pudieron consultar las credenciales locales.'); this.credentialLoading.set(false); },
    });
  }
  val(event: Event) { return (event.target as HTMLInputElement | HTMLSelectElement).value; }
  checked(event: Event) { return (event.target as HTMLInputElement).checked; }
}
