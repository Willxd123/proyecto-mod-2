import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { EMAIL_PATTERN, TENANT_SLUG_PATTERN, type CreationReadiness, type GoldenImage, type IaCEngine, type Plan, type TenantDraftCreated, type TenantValidationError } from '@modulo2/contracts';
import { ApiService } from '../api.service';
import { ROLES } from './plans.component';

const REGIONS = [{ id: 'us-east-1', label: 'AWS us-east-1 (N. Virginia)' }, { id: 'sa-east-1', label: 'AWS sa-east-1 (São Paulo)' }];
const ENGINES: { id: IaCEngine; label: string }[] = [
  { id: 'terraform', label: 'Terraform (motor principal · Int. 2)' }, { id: 'opentofu', label: 'OpenTofu (motor principal · Int. 2)' },
  { id: 'pulumi', label: 'Pulumi (2.º motor · Int. 3)' }, { id: 'cloudformation', label: 'CloudFormation (2.º motor · Int. 3)' },
];

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
      @if (savedDraft(); as saved) {
        <div class="notice info" role="status">Borrador guardado en PostgreSQL: <strong class="mono">{{ saved.tenant_slug }}</strong> (estado {{ saved.status }}). Aún no se aprovisionan recursos.
          @if (tfvarsPath()) { tfvars para {{ engine() }}: <code>{{ tfvarsPath() }}</code>. }
          <a class="link" routerLink="/tenants">Ver en la lista de tenants →</a></div>
      }

      <div class="layout">
        <div class="stack">
          @if (step() === 1) {
            <div class="card">
              <div class="card-head"><div><h2>Datos de la institución</h2><p>Identifica al tenant y configura su primer entorno.</p></div><span class="rf-badge">RF-07 · Integrante 2</span></div>
              <div class="field-row" style="margin-top:0">
                <div class="c6"><label for="name">Nombre de la institución <span class="req">*</span></label>
                  <input id="name" type="text" placeholder="Ej. Universidad Unifranz / UPSA" [value]="name()" (input)="name.set(val($event))" [class.invalid]="touched() && !name().trim()"></div>
                <div class="c6"><label for="slug">Identificador del tenant <span class="req">*</span></label>
                  <div class="input-suffix"><input id="slug" type="text" [value]="slug()" (input)="slug.set(val($event)); resetValidation()" [class.invalid]="!!slugError()"><span>.escuelas.app</span></div>
                  @if (slugError()) { <p class="field-error" role="alert">{{ slugError() }}</p> }</div>
              </div>
              <div class="field-row">
                <div class="c6"><label for="email">Correo del administrador <span class="req">*</span></label>
                  <input id="email" type="email" [value]="email()" (input)="email.set(val($event)); resetValidation()" [class.invalid]="!!emailError()">
                  @if (emailError()) { <p class="field-error" role="alert">{{ emailError() }}</p> }</div>
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
              <div class="console">
                <div class="muted">Diagnóstico de solo lectura: no ejecuta escaneos, IaC, Ansible ni crea recursos.</div>
                @if (savedDraft(); as saved) {
                  <div class="cmd">Borrador consultado: {{ saved.tenant_slug }}</div>
                  @if (readiness(); as result) {
                    @for (check of result.checks; track check.code) {
                      <div>[{{ check.status === 'ready' ? 'LISTO' : 'BLOQUEADO' }}] {{ check.message }}</div>
                    }
                    <div class="muted">Etapas previstas; ninguna se ha ejecutado:</div>
                    @for (stage of result.pipeline; track stage.stage) {
                      <div>[NO INICIADO] {{ stage.description }}</div>
                    }
                  } @else if (readinessLoading()) {
                    <div>Consultando requisitos…</div>
                  } @else {
                    <div>No se pudo consultar el diagnóstico. Vuelve a intentarlo.</div>
                  }
                } @else {
                  <div>Guarda primero el borrador para consultar sus requisitos.</div>
                }
              </div>
              <div class="actions" style="margin-top:16px;border:0;padding:0">
                <button class="btn primary" disabled title="Disponible cuando el orquestador esté integrado">Iniciar aprovisionamiento en 2.º plano</button>
                @if (savedDraft(); as saved) { <button class="btn" (click)="loadReadiness(saved.tenant_slug)" [disabled]="readinessLoading()">Actualizar diagnóstico</button> }
                <a class="link" routerLink="/tenants">Ver en lista de tenants (RF-14) →</a>
              </div>
              <div class="notice info" style="margin-top:16px">
                Preparación local de paquetes de asistencia para demostración. No crea tenants ni autentica al operador.
                <button class="btn" type="button" (click)="inspectArtifacts()" [disabled]="artifactBusy()">Comprobar paquetes</button>
                @if (artifactMessage()) { <p role="status">{{ artifactMessage() }}</p> }
                @if (artifactError()) { <p class="field-error" role="alert">{{ artifactError() }}</p> }
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
          <button class="btn" (click)="saveDraft()" [disabled]="saving() || !!savedDraft()">{{ savedDraft() ? 'Borrador guardado' : saving() ? 'Guardando…' : 'Guardar borrador' }}</button>
          @if (step() < 3) { <button class="btn primary" (click)="next()" [disabled]="validating()">{{ validating() ? 'Validando…' : 'Continuar →' }}</button> }
        </div>
      </div>
    </section>
  `,
})
export class CreateComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private artifactTimer: ReturnType<typeof setTimeout> | undefined;
  readonly artifactBusy = signal(false);
  readonly artifactMessage = signal('');
  readonly artifactError = signal('');
  ngOnDestroy() { if (this.artifactTimer) clearTimeout(this.artifactTimer); }
  private artifactFailure(error: HttpErrorResponse) {
    this.artifactBusy.set(false);
    this.artifactError.set(typeof error.error?.message === 'string' ? error.error.message : 'No se pudo completar la preparación local.');
  }
  inspectArtifacts() {
    this.artifactBusy.set(true); this.artifactError.set(''); this.artifactMessage.set('Comprobando revisiones y paquetes…');
    this.api.artifactStatus().subscribe({
      next: ({ data }) => {
        if (data.status === 'running') {
          this.artifactMessage.set('Hay una preparación en curso…');
          this.pollArtifacts();
        } else {
          this.checkArtifactRevisions();
        }
      },
      error: (error: HttpErrorResponse) => this.artifactFailure(error),
    });
  }
  private checkArtifactRevisions() {
    this.api.inspectArtifacts().subscribe({
      next: ({ data }) => {
        if (data.ready) {
          this.artifactBusy.set(false);
          this.artifactMessage.set(`Paquetes verificados para backend ${data.revisions.backend} y frontend ${data.revisions.frontend}.`);
          return;
        }
        const approved = window.confirm(`No existen paquetes para estas revisiones de main:\nBackend: ${data.revisions.backend}\nFrontend: ${data.revisions.frontend}\n\n¿Deseas descargarlas y preparar los paquetes localmente?`);
        if (!approved) { this.artifactBusy.set(false); this.artifactMessage.set('Preparación cancelada.'); return; }
        this.artifactMessage.set('Preparando paquetes; esto puede tardar varios minutos…');
        this.api.prepareArtifacts(data.revisions).subscribe({
          next: () => this.pollArtifacts(),
          error: (error: HttpErrorResponse) => this.artifactFailure(error),
        });
      },
      error: (error: HttpErrorResponse) => this.artifactFailure(error),
    });
  }
  private pollArtifacts() {
    this.api.artifactStatus().subscribe({
      next: ({ data }) => {
        if (data.status === 'running') { this.artifactTimer = setTimeout(() => this.pollArtifacts(), 2000); return; }
        this.artifactBusy.set(false);
        if (data.status === 'succeeded' && data.result) {
          this.artifactMessage.set(`Paquetes preparados y verificados: ${data.result.release}.`);
        } else {
          this.artifactError.set(data.error || 'La preparación no terminó correctamente.');
        }
      },
      error: (error: HttpErrorResponse) => this.artifactFailure(error),
    });
  }
  readonly roles = ROLES; readonly regions = REGIONS; readonly engines = ENGINES;
  readonly step = signal(1); readonly touched = signal(false);
  readonly name = signal(''); readonly slug = signal(''); readonly email = signal('');
  readonly region = signal('us-east-1'); readonly engine = signal<IaCEngine>('terraform'); readonly planSlug = signal('estandar');
  readonly plans = signal<Plan[]>([]); readonly images = signal<GoldenImage[]>([]);
  readonly loading = signal(true); readonly error = signal('');
  readonly selectedPlan = computed(() => this.plans().find(plan => plan.slug === this.planSlug()));
  readonly slugValid = computed(() => TENANT_SLUG_PATTERN.test(this.slug().trim()));
  readonly emailValid = computed(() => EMAIL_PATTERN.test(this.email().trim()));
  // Paso 1 validado por POST /api/tenants/validate (identificador libre y formatos correctos).
  readonly validating = signal(false); readonly validated = signal(false);
  readonly serverErrors = signal<TenantValidationError[]>([]);
  readonly slugError = computed(() => this.serverErrors().find(e => e.field === 'tenant_slug')?.message
    ?? (this.touched() && !this.slugValid() ? '3 a 40 letras minúsculas, números o guiones; debe comenzar con letra.' : ''));
  readonly emailError = computed(() => this.serverErrors().find(e => e.field === 'admin_email')?.message
    ?? (this.touched() && !this.emailValid() ? 'Ingresa un correo válido, por ejemplo admin@institucion.edu.' : ''));
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
  /** Volver atrás es libre; avanzar más allá del Paso 1 exige la validación del servidor. */
  go(step: number) {
    if (step === 1 || this.validated()) this.step.set(step);
    else if (this.step() === 1) this.next(step);
  }
  resetValidation() { this.validated.set(false); this.serverErrors.set([]); }

  /** Guarda el borrador (status PENDING) con POST /api/tenants/drafts. El servidor vuelve a validar todo. */
  readonly saving = signal(false); readonly savedDraft = signal<TenantDraftCreated | null>(null); readonly tfvarsPath = signal('');
  readonly readiness = signal<CreationReadiness | null>(null); readonly readinessLoading = signal(false);
  loadReadiness(slug: string) {
    this.readiness.set(null); this.readinessLoading.set(true);
    this.api.creationReadiness(slug).subscribe({
      next: ({ data }) => { this.readiness.set(data); this.readinessLoading.set(false); },
      error: () => { this.readinessLoading.set(false); },
    });
  }
  saveDraft() {
    this.touched.set(true);
    if (!this.name().trim() || !this.slugValid() || !this.emailValid()) { this.step.set(1); return; }
    this.saving.set(true); this.error.set('');
    this.api.createDraft({ institution_name: this.name().trim(), tenant_slug: this.slug().trim(), admin_email: this.email().trim(),
      plan_slug: this.planSlug(), region: this.region(), engine: this.engine() }).subscribe({
      next: ({ data }) => {
        this.saving.set(false); this.savedDraft.set(data); this.loadReadiness(data.tenant_slug);
        // Motor principal (Terraform/OpenTofu): genera el tfvars del tenant para scripts/terraform_tenant.py.
        if (this.engine() === 'terraform' || this.engine() === 'opentofu') {
          this.api.generateTfvars(data.tenant_slug).subscribe({
            next: ({ data: generated }) => this.tfvarsPath.set(generated.path),
            error: (response: HttpErrorResponse) => this.error.set(`Borrador guardado, pero no se generó el tfvars: ${response.error?.message ?? 'API no disponible'}`),
          });
        }
      },
      error: (response: HttpErrorResponse) => {
        this.saving.set(false);
        const errors: TenantValidationError[] = response.status === 422 ? response.error?.errors ?? [] : [];
        this.serverErrors.set(errors);
        const others = errors.filter(e => e.field !== 'tenant_slug' && e.field !== 'admin_email').map(e => e.message);
        if (errors.some(e => e.field === 'tenant_slug' || e.field === 'admin_email' || e.field === 'institution_name')) this.step.set(1);
        this.error.set(errors.length ? (others.join(' ') || 'Revisa los campos marcados en el Paso 1.') : 'No se pudo guardar el borrador. Verifica que la API esté disponible.');
      },
    });
  }
  next(target = this.step() + 1) {
    this.touched.set(true);
    if (this.step() !== 1) { this.step.set(Math.min(3, target)); return; }
    if (!this.name().trim() || !this.slugValid() || !this.emailValid()) return;
    this.validating.set(true); this.error.set('');
    this.api.validateTenant({ tenant_slug: this.slug().trim(), admin_email: this.email().trim() }).subscribe({
      next: ({ data }) => {
        this.validating.set(false); this.serverErrors.set(data.errors); this.validated.set(data.valid);
        if (data.valid) this.step.set(Math.min(3, target));
      },
      error: () => { this.validating.set(false); this.error.set('No se pudo validar el tenant con el servidor. Verifica que la API esté disponible.'); },
    });
  }
  load() {
    this.loading.set(true); this.error.set('');
    forkJoin({ plans: this.api.plans(), images: this.api.images() }).subscribe({
      next: ({ plans, images }) => { this.plans.set(plans.data); this.images.set(images.data); if (!plans.data.some(plan => plan.slug === this.planSlug())) this.planSlug.set(plans.data[0]?.slug ?? ''); this.loading.set(false); },
      error: () => { this.error.set('No se pudo cargar el catálogo o las imágenes. Verifica que la API y PostgreSQL estén disponibles.'); this.loading.set(false); },
    });
  }
}
