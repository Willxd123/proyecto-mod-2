import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import type { GoldenImage, IaCEngine, Plan } from '@modulo2/contracts';
import { ApiService } from '../api.service';
import { ROLES } from './plans.component';

const REGIONS = [{ id: 'us-east-1', label: 'AWS us-east-1 (N. Virginia)' }, { id: 'sa-east-1', label: 'AWS sa-east-1 (São Paulo)' }];
const ENGINES: { id: IaCEngine; label: string }[] = [
  { id: 'terraform', label: 'Terraform (motor principal · Int. 2)' }, { id: 'opentofu', label: 'OpenTofu (motor principal · Int. 2)' },
  { id: 'pulumi', label: 'Pulumi (2.º motor · Int. 3)' }, { id: 'cloudformation', label: 'CloudFormation (2.º motor · Int. 3)' },
];
const SLUG = /^[a-z][a-z0-9-]{2,39}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Component({
  imports: [RouterLink],
  template: `
    <section class="view">
      <div class="view-head">
        <div><h1>Crear tenant</h1><p>Configura una nueva institución y prepara su entorno de registro de asistencia.</p></div>
        <div class="rf-badges"><span class="rf-badge">RF-01 a RF-03</span><span class="rf-badge">RF-07 a RF-11</span><span class="rf-badge">RF-13</span></div>
      </div>

      <div>
        <div class="step-label">PASO {{ step() }} DE 3</div>
        <div class="steps">
          <button class="step" [class.current]="step() === 1" [class.done]="step() > 1" (click)="go(1)"><i>1</i><span>Datos y plan (RF-03, RF-07, RF-08)</span></button><span class="step-line"></span>
          <button class="step" [class.current]="step() === 2" [class.done]="step() > 2" (click)="go(2)"><i>2</i><span>Imágenes Packer y escáner (RF-09, RNF-Seguridad)</span></button><span class="step-line"></span>
          <button class="step" [class.current]="step() === 3" (click)="go(3)"><i>3</i><span>Revisión y logs en vivo (RF-10, RF-11, RF-13)</span></button>
        </div>
      </div>

      @if (error()) { <div class="notice err" role="alert">{{ error() }} <button class="link" (click)="load()">Reintentar</button></div> }

      <div class="layout">
        <div class="stack">
          @if (step() === 1) {
            <div class="card">
              <div class="card-head"><div><h2>Datos de la institución</h2><p>Identifica al tenant y configura su primer entorno.</p></div><span class="rf-badge">RF-07 · Integrante 2</span></div>
              <div class="field-row" style="margin-top:0">
                <div class="c6"><label for="name">Nombre de la institución <span class="req">*</span></label>
                  <input id="name" type="text" placeholder="Ej. Universidad Unifranz / UPSA" [value]="name()" (input)="name.set(val($event))" [class.invalid]="touched() && !name().trim()"></div>
                <div class="c6"><label for="slug">Identificador del tenant <span class="req">*</span></label>
                  <div class="input-suffix"><input id="slug" type="text" [value]="slug()" (input)="slug.set(val($event))" [class.invalid]="touched() && !slugValid()"><span>.escuelas.app</span></div>
                  @if (touched() && !slugValid()) { <p class="field-error">3 a 40 letras minúsculas, números o guiones; debe comenzar con letra.</p> }</div>
              </div>
              <div class="field-row">
                <div class="c6"><label for="email">Correo del administrador</label>
                  <input id="email" type="email" [value]="email()" (input)="email.set(val($event))" [class.invalid]="touched() && !emailValid()">
                  @if (touched() && !emailValid()) { <p class="field-error">Ingresa un correo válido.</p> }</div>
                <div class="c3"><label for="region">Región de despliegue</label>
                  <select id="region" (change)="region.set(val($event))">@for (r of regions; track r.id) { <option [value]="r.id" [selected]="r.id === region()">{{ r.label }}</option> }</select></div>
                <div class="c3"><label for="env">Entorno</label><select id="env"><option selected>Producción</option></select></div>
              </div>
            </div>

            <div class="card">
              <div class="card-head"><div><h2>Selecciona un plan</h2><p>El plan define la capacidad de cómputo, el tamaño de base de datos y los límites iniciales del tenant.</p></div><span class="rf-badge">RF-01, RF-02, RF-03 · Int. 1 y 2</span></div>
              @if (loading()) { <div class="notice info" role="status">Cargando planes…</div> }
              <div class="plan-options">
                @for (plan of plans(); track plan.slug) {
                  <button type="button" class="plan-option" [class.selected]="plan.slug === planSlug()" [attr.aria-pressed]="plan.slug === planSlug()" (click)="planSlug.set(plan.slug)">
                    <header><strong>{{ plan.name }}</strong>@if (plan.slug === planSlug()) { <span class="chip">Seleccionado</span> }</header>
                    <p>{{ plan.description }}</p>
                    <ul>
                      <li>Hasta {{ plan.max_students }} estudiantes</li>
                      <li>Base de datos: {{ plan.roles.database.disk_gib }} GiB</li>
                      <li>Frontend {{ plan.roles.frontend.instance_type }} · Backend {{ plan.roles.backend.instance_type }} · BD {{ plan.roles.database.instance_type }}</li>
                      <li>Red y Security Group aislados</li>
                    </ul>
                  </button>
                }
              </div>
            </div>

            <div class="engine-card">
              <div>
                <div style="display:flex;align-items:center;gap:8px"><h2 style="font-size:16px">Motor de infraestructura</h2><span class="rf-badge">RF-08 · Int. 2 y 3</span></div>
                <p style="font-size:12px;color:var(--muted);margin-top:2px">Elige la herramienta que aprovisionará los recursos de este tenant.</p>
                <div class="ok-line">✔ Base de datos aislada por institución (RNF-Aislamiento)</div>
              </div>
              <div class="engine-select"><small>Motor de IaC</small>
                <select aria-label="Motor de IaC" (change)="engine.set($any(val($event)))">@for (e of engines; track e.id) { <option [value]="e.id" [selected]="e.id === engine()">{{ e.label }}</option> }</select></div>
            </div>
          }

          @if (step() === 2) {
            <div class="card">
              <div class="card-head"><div><h2>Imágenes preconfiguradas con Packer (Golden Images) + cloud-init</h2><p>Las 3 máquinas virtuales se crean a partir de AMIs propias con dependencias preinstaladas.</p></div><span class="rf-badge">RF-09, RF-13 · Integrante 1</span></div>
              <div class="grid cols-3">
                @for (role of roles; track role.key) {
                  <div class="mini">
                    <h3>{{ role.label }}</h3>
                    @if (imageFor(role.key); as image) { <span class="ami">{{ image.ami_id }}</span><p>{{ image.region }} · v{{ image.image_version }} · Packer {{ image.packer_version }}</p> }
                    @else { <p><span class="pill warn plain">AMI pendiente en {{ region() }}</span></p> }
                  </div>
                }
              </div>
              @if (!imagesReady()) { <div class="notice warn" style="margin-top:16px">Faltan AMIs reales para esta región; sin ellas la solicitud no es desplegable (<code>deployable=false</code>).</div> }
              <div class="notice info" style="margin-top:12px">cloud-init (primer arranque): swap de 2 GiB, zona horaria America/La_Paz, hostname <code>{{ slugOrPlaceholder() }}-&lt;rol&gt;</code> y llaves SSH públicas.</div>
            </div>
            <div class="card">
              <div class="card-head"><div><h2>Escáner de seguridad y secretos expuestos (pre-deploy)</h2><p>Verifica antes de aprovisionar que no existan credenciales ni llaves en los archivos de infraestructura.</p></div><span class="rf-badge">RF-11, RNF-Seguridad · Integrante 3</span></div>
              <pre class="terminal" style="color:#94a3b8">[PENDIENTE] El escáner lo implementa el Integrante 3. Todavía no se ejecuta ningún análisis desde esta pantalla.</pre>
            </div>
          }

          @if (step() === 3) {
            <div class="card">
              <div class="card-head"><div><h2>Consola de aprovisionamiento en segundo plano</h2><p>Muestra el log real de la ejecución (escáner → motor IaC → cloud-init → Ansible → Grafana) cuando el orquestador esté integrado.</p></div>
                <div style="display:flex;gap:8px;align-items:center"><span class="rf-badge">RF-10, RF-11, RF-13 · Int. 4 y 5</span><span class="pill neutral plain">No disponible</span></div></div>
              <div class="grid cols-4" style="margin-bottom:16px">
                <div class="mini"><small style="color:var(--faint)">Catálogo (RF-13)</small><br><b class="mono">v{{ selectedPlan()?.catalog_version ?? '—' }}</b></div>
                <div class="mini"><small style="color:var(--faint)">Golden AMIs (RF-13)</small><br><b class="mono">{{ packerVersion() }}</b></div>
                <div class="mini"><small style="color:var(--faint)">Motor IaC (RF-13)</small><br><b class="mono">{{ engine() }}</b></div>
                <div class="mini"><small style="color:var(--faint)">Config. y monitoreo</small><br><b class="mono">Ansible + Grafana</b></div>
              </div>
              <div class="console"><div class="muted"># El orquestador (Integrante 5) todavía no está conectado; no se simula ninguna ejecución.</div><div class="cmd">$ tenant={{ slugOrPlaceholder() }} plan={{ planSlug() }} engine={{ engine() }} region={{ region() }}</div></div>
              <div class="actions" style="margin-top:16px;border:0;padding:0">
                <button class="btn primary" disabled title="Disponible cuando el orquestador esté integrado">Iniciar aprovisionamiento en 2.º plano</button>
                <a class="link" routerLink="/tenants">Ver en lista de tenants (RF-14) →</a>
              </div>
            </div>
          }
        </div>

        <aside class="summary" aria-label="Resumen del tenant">
          <div class="card-head" style="margin:0"><div><h2>Resumen del tenant</h2><p>Se aprovisionará al confirmar.</p></div><span class="rf-badge">RF-03</span></div>
          <div class="summary-box"><small>Institución</small><strong>{{ name().trim() || 'Nueva institución' }}</strong><span>{{ slugOrPlaceholder() }}.escuelas.app</span></div>
          <div class="summary-line rule"><span>Plan seleccionado</span><b>{{ selectedPlan()?.name ?? '—' }}</b></div>
          <div><h3>Recursos incluidos (RF-09)</h3>
            <ul class="dot-list">
              <li>Frontend y API backend (Golden AMIs Packer)</li>
              <li>Base de datos aislada ({{ selectedPlan()?.roles?.database?.disk_gib ?? '—' }} GiB)</li>
              <li>Configuración automática con cloud-init y Ansible</li>
              <li class="pending">Monitoreo en Grafana (RF-25) · pendiente</li>
            </ul></div>
          <div><h3>Aislamiento y seguridad</h3><div class="notice info">Los datos de este tenant quedan separados de otras instituciones en su propia BD y Security Group.</div></div>
          <div><h3>Entorno y región</h3>
            <div class="summary-line"><span>Producción</span><b>{{ region() }}</b></div>
            <div class="summary-line" style="margin-top:4px"><span>Motor de IaC (RF-08)</span><b style="color:var(--blue)">{{ engine() }}</b></div></div>
          <div class="notice warn">La creación aún no está habilitada en el backend: este asistente valida los datos y muestra la configuración, pero no aprovisiona recursos.</div>
        </aside>
      </div>

      <div class="actions">
        <span>Los recursos se crean según el plan seleccionado.</span>
        <div>
          <a class="btn" routerLink="/tenants">Cancelar</a>
          @if (step() > 1) { <button class="btn" (click)="go(step() - 1)">← Atrás</button> }
          @if (step() < 3) { <button class="btn primary" (click)="next()">Continuar →</button> }
        </div>
      </div>
    </section>
  `,
})
export class CreateComponent {
  private readonly api = inject(ApiService);
  readonly roles = ROLES; readonly regions = REGIONS; readonly engines = ENGINES;
  readonly step = signal(1); readonly touched = signal(false);
  readonly name = signal(''); readonly slug = signal(''); readonly email = signal('');
  readonly region = signal('us-east-1'); readonly engine = signal<IaCEngine>('terraform'); readonly planSlug = signal('estandar');
  readonly plans = signal<Plan[]>([]); readonly images = signal<GoldenImage[]>([]);
  readonly loading = signal(true); readonly error = signal('');
  readonly selectedPlan = computed(() => this.plans().find(plan => plan.slug === this.planSlug()));
  readonly slugValid = computed(() => SLUG.test(this.slug()));
  readonly emailValid = computed(() => !this.email() || EMAIL.test(this.email()));
  readonly slugOrPlaceholder = computed(() => this.slugValid() ? this.slug() : (this.slug().trim() || 'nuevo-tenant'));
  readonly regionImages = computed(() => this.images().filter(image => image.region === this.region()));
  readonly imagesReady = computed(() => ROLES.every(role => this.regionImages().some(image => image.role === role.key)));
  readonly packerVersion = computed(() => this.regionImages()[0] ? 'Packer ' + this.regionImages()[0].packer_version : 'Sin AMIs');

  constructor() {
    const requested = inject(ActivatedRoute).snapshot.queryParamMap.get('plan');
    if (requested) this.planSlug.set(requested);
    this.load();
  }
  val(event: Event) { return (event.target as HTMLInputElement | HTMLSelectElement).value; }
  imageFor(role: string) { return this.regionImages().find(image => image.role === role); }
  go(step: number) { this.step.set(step); }
  next() {
    this.touched.set(true);
    if (this.step() === 1 && (!this.name().trim() || !this.slugValid() || !this.emailValid())) return;
    this.step.update(step => Math.min(3, step + 1));
  }
  load() {
    this.loading.set(true); this.error.set('');
    forkJoin({ plans: this.api.plans(), images: this.api.images() }).subscribe({
      next: ({ plans, images }) => { this.plans.set(plans.data); this.images.set(images.data); if (!plans.data.some(plan => plan.slug === this.planSlug())) this.planSlug.set(plans.data[0]?.slug ?? ''); this.loading.set(false); },
      error: () => { this.error.set('No se pudo cargar el catálogo o las imágenes. Verifica que la API y PostgreSQL estén disponibles.'); this.loading.set(false); },
    });
  }
}
