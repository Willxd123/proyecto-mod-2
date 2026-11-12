import { Component, computed, inject, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import type { GoldenImage, Plan, ServerRole } from '@modulo2/contracts';
import { ApiService } from '../api.service';

export const ROLES: { key: ServerRole; label: string }[] = [
  { key: 'frontend', label: 'Servidor Frontend' }, { key: 'backend', label: 'Servidor Backend' }, { key: 'database', label: 'Servidor Base de Datos' },
];

@Component({
  template: `
    <section class="view">
      <div class="view-head">
        <div>
          <h1>Catálogo de Planes y Golden Images de Packer</h1>
          <p>Especificación del Entregable 4 (RF-01, RF-02 y RF-09). Los planes son de consulta fija; las AMIs mostradas son las registradas tras construirlas con Packer.</p>
        </div>
        <div class="rf-badges"><span class="rf-badge">RF-01, RF-02, Entregable 4 · Integrante 1</span>@if (version()) { <span class="rf-badge">Catálogo v{{ version() }}</span> }</div>
      </div>

      @if (loading()) { <div class="notice info" role="status">Cargando catálogo e imágenes…</div> }
      @if (error()) { <div class="notice err" role="alert">{{ error() }} <button class="link" (click)="load()">Reintentar</button></div> }

      <div class="table-card"><div class="table-scroll"><table>
        <thead class="dark"><tr><th>Plan (RF-01)</th><th>Descripción</th><th>Cómputo asignado: 3 VMs (RF-02)</th><th>Base de datos</th><th>Límite estudiantes</th><th>Respaldo</th></tr></thead>
        <tbody>
          @for (plan of plans(); track plan.slug) {
            <tr [class.highlight]="plan.slug === selected()" (click)="selected.set(plan.slug)">
              <td><strong>{{ plan.name }}</strong></td>
              <td>{{ plan.description }}</td>
              <td class="mono">@for (role of roles; track role.key) { <span class="sub" style="font-size:11px;color:inherit;margin:0">{{ role.key }}: {{ plan.roles[role.key].instance_type }} ({{ plan.roles[role.key].vcpu }} vCPU, {{ plan.roles[role.key].ram_gib }} GiB + 2 GiB swap)</span> }</td>
              <td><strong>{{ plan.roles.database.disk_gib }} GiB</strong><span class="sub">EBS gp3 cifrado</span></td>
              <td>Hasta {{ plan.max_students }} estudiantes<span class="sub">Informativo; sin control de cuotas</span></td>
              <td>{{ plan.backup_policy }}</td>
            </tr>
          }
        </tbody>
      </table></div></div>

      @if (selectedPlan(); as plan) {
        <div class="card">
          <div class="card-head"><div><h2>Recursos del plan {{ plan.name }}</h2><p>Instancia, CPU, memoria y disco por servidor. El tamaño del disco debe ser igual o mayor que la raíz de 12 GiB de la AMI.</p></div><span class="rf-badge">RF-02</span></div>
          <div class="table-scroll"><table>
            <thead><tr><th>Servidor</th><th>Instancia AWS</th><th>vCPU</th><th>Memoria</th><th>Disco EBS</th></tr></thead>
            <tbody>@for (role of roles; track role.key) { <tr><td>{{ role.label }}</td><td><code>{{ plan.roles[role.key].instance_type }}</code></td><td>{{ plan.roles[role.key].vcpu }}</td><td>{{ plan.roles[role.key].ram_gib }} GiB</td><td>{{ plan.roles[role.key].disk_gib }} GiB</td></tr> }</tbody>
          </table></div>
        </div>
      }

      <div class="card">
        <div class="card-head"><div><h2>Golden Images (Packer + cloud-init)</h2><p>Las 3 máquinas de cada tenant se crean desde AMIs propias con dependencias preinstaladas; cloud-init configura swap de 2 GiB, zona horaria America/La_Paz, hostname del tenant y llaves SSH.</p></div><span class="rf-badge">RF-09, RF-13 · Integrante 1</span></div>
        @if (!loading() && !images().length) {
          <div class="notice warn">Aún no hay AMIs registradas. Aparecerán aquí cuando se construyan con Packer en AWS y se importe su manifiesto; no se muestran identificadores de ejemplo.</div>
        }
        <div class="grid cols-3" style="margin-top:12px">
          @for (role of roles; track role.key) {
            <div class="mini">
              <h3>{{ role.label }}</h3>
              @for (image of imagesFor(role.key); track image.region) {
                <span class="ami">{{ image.ami_id }}</span>
                <p>{{ image.region }} · v{{ image.image_version }} · Packer {{ image.packer_version }} · {{ image.source_revision }}</p>
              } @empty { <p><span class="pill warn plain">Construcción pendiente</span></p> }
              <p>{{ description[role.key] }}</p>
            </div>
          }
        </div>
      </div>
    </section>
  `,
})
export class PlansComponent {
  private readonly api = inject(ApiService);
  readonly roles = ROLES;
  readonly plans = signal<Plan[]>([]);
  readonly images = signal<GoldenImage[]>([]);
  readonly selected = signal('estandar');
  readonly loading = signal(true);
  readonly error = signal('');
  readonly version = computed(() => this.plans()[0]?.catalog_version ?? '');
  readonly selectedPlan = computed(() => this.plans().find(plan => plan.slug === this.selected()));
  readonly description: Record<ServerRole, string> = {
    frontend: 'Ubuntu 24.04 + Nginx + Node 22 + pnpm + node_exporter (systemd).',
    backend: 'Ubuntu 24.04 + Node 22 + pnpm + PM2 + Python/Gunicorn + Git + cliente PostgreSQL + xz-utils + node_exporter.',
    database: 'Ubuntu 24.04 + PostgreSQL 16 + herramientas de respaldo + OpenSSL + postgres_exporter.',
  };
  constructor() { this.load(); }
  imagesFor(role: ServerRole) { return this.images().filter(image => image.role === role); }
  load() {
    this.loading.set(true); this.error.set('');
    forkJoin({ plans: this.api.plans(), images: this.api.images() }).subscribe({
      next: ({ plans, images }) => { this.plans.set(plans.data); this.images.set(images.data); this.loading.set(false); },
      error: () => { this.error.set('No se pudo cargar el catálogo o el registro de imágenes. Verifica que la API y PostgreSQL estén disponibles.'); this.loading.set(false); },
    });
  }
}
