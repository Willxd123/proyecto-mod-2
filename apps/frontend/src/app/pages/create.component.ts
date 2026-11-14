import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { EMAIL_PATTERN, TENANT_SLUG_PATTERN, type CreationReadiness, type DemoProvisioningCapabilities, type DemoProvisioningOperation, type GoldenImage, type IaCEngine, type Plan, type SecurityScanResult, type TenantDraftCreated, type TenantValidationError } from '@modulo2/contracts';
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
                <select aria-label="Motor de IaC" (change)="engine.set($any(val($event)))">@for (e of engines; track e.id) { <option [value]="e.id" [selected]="e.id === engine()" [disabled]="!engineSupported(e.id)">{{ e.label }}</option> }</select></div>
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
              <div class="card-head"><div><h2>Escáneres de seguridad y secretos expuestos (pre-deploy · 3 escáneres)</h2><p>Verifica antes de aprovisionar que no existan secretos ni errores CRITICAL en la solicitud y las plantillas IaC (Trivy + Checkov + cfn-lint).</p></div><span class="rf-badge">RF-11, RNF-Seguridad · Integrante 3</span></div>
              <div class="grid cols-3" style="margin-bottom:12px">
                <div class="mini"><h3>1. Trivy Secret Scanner</h3><p>Detecta llaves AWS, tokens y secretos expuestos (bloqueante).</p></div>
                <div class="mini"><h3>2. Checkov IaC &amp; Puerto 5432</h3><p>Valida políticas Cloud y que el puerto 5432 no esté abierto a 0.0.0.0/0.</p></div>
                <div class="mini"><h3>3. Trivy Config &amp; cfn-lint</h3><p>Analiza configuración IaC: detiene en CRITICAL y avisa en HIGH/MEDIUM/LOW.</p></div>
              </div>
              <div class="notice info">
                <div>
                  Los 3 escáneres se ejecutan automáticamente al iniciar el aprovisionamiento en el Paso 3 y también pueden consultarse desde la vista de Seguridad.
                  @if (savedDraft(); as draft) {
                    <div style="margin-top:8px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
                      <button class="btn sm primary" type="button" (click)="runPredeployScan()" [disabled]="predeployScanBusy()">
                        {{ predeployScanBusy() ? 'Analizando con 3 escáneres…' : 'Probar los 3 escáneres en este borrador' }}
                      </button>
                      <a class="link" [routerLink]="['/seguridad']" [queryParams]="{ tenant: draft.tenant_slug }">Abrir vista completa de escáneres →</a>
                    </div>
                  } @else {
                    <div style="margin-top:6px">Guarda el borrador abajo para probar los 3 escáneres desde aquí o <a class="link" [routerLink]="['/seguridad']" [queryParams]="slugValid() ? { tenant: slug().trim() } : {}">abrir la vista de escáneres →</a></div>
                  }
                </div>
              </div>
              @if (predeployScanError()) { <div class="notice err" style="margin-top:12px" role="alert">{{ predeployScanError() }}</div> }
              @if (predeployScanResult(); as scan) {
                <div class="notice" style="margin-top:12px" [class.err]="scan.status === 'blocked'" [class.ok]="scan.status === 'clean'" role="status">
                  <div>
                    <strong>{{ scan.status === 'blocked' ? 'Despliegue bloqueado por secretos o errores CRITICAL.' : 'Escaneo aprobado (0 errores CRITICAL y 0 secretos expuestos).' }}</strong>
                    @for (item of scan.scanners ?? []; track item.scanner) {
                      <p>• <strong>{{ item.label }}:</strong> {{ item.message }}</p>
                    }
                    @for (finding of scan.findings; track $index) {
                      <p class="mono">[{{ finding.blocking ? 'BLOQUEANTE' : 'ADVERTENCIA' }} · {{ finding.scanner ?? 'trivy' }} · {{ finding.severity }}] {{ finding.rule_id }} — {{ finding.message ?? '' }}</p>
                    }
                  </div>
                </div>
              }
            </div>
          }

          @if (step() === 3) {
            <div class="card">
              <div class="card-head"><div><h2>Aprovisionamiento en segundo plano</h2><p>El flujo demo local conecta escáner → motor IaC → Ansible → verificación HTTPS del administrador.</p></div>
                <div style="display:flex;gap:8px;align-items:center"><span class="rf-badge">RF-10, RF-11, RF-13 · Int. 4 y 5</span>
                  @if (demoCapabilitiesError()) { <span class="pill warn plain">No verificado</span> }
                  @else if (!demoCapabilities().enabled) { <span class="pill neutral plain">Demo deshabilitada</span> }
                  @else if (demoCapabilities().ready) { <span class="pill ok plain">Listo para {{ demoCapabilities().supported_engines.join(', ') }}</span> }
                  @else { <span class="pill warn plain">Falta configuración local</span> }
                </div></div>
              <div class="grid cols-4" style="margin-bottom:16px">
                <div class="mini"><small style="color:var(--faint)">Catálogo (RF-13)</small><br><b class="mono">v{{ selectedPlan()?.catalog_version ?? '—' }}</b></div>
                <div class="mini"><small style="color:var(--faint)">Golden AMIs (RF-13)</small><br><b class="mono">{{ packerVersion() }}</b></div>
                <div class="mini"><small style="color:var(--faint)">Motor IaC (RF-13)</small><br><b class="mono">{{ engine() }}</b></div>
                <div class="mini"><small style="color:var(--faint)">Configuración y verificación</small><br><b class="mono">Ansible + HTTPS</b></div>
              </div>
              <div class="console">
                @if (demoCapabilitiesError()) {
                  <div class="field-error" role="alert">{{ demoCapabilitiesError() }}</div>
                } @else if (demoCapabilities().enabled) {
                  <!-- <div class="notice warn">Modo local de demostración sin autenticación del operador. La confirmación puede crear recursos AWS con cargos. No se eliminan automáticamente si el flujo falla.</div> -->
                  @if (!demoCapabilities().ready) {
                    <div class="muted">Requisitos pendientes: {{ demoCapabilities().missing.join(', ') || 'no se pudo verificar la configuración local' }}.</div>
                  }
                  @if (demoOperation(); as operation) {
                    @for (event of operation.events; track event.occurred_at) {
                      <div>[{{ event.status }} · {{ event.stage }}] {{ event.message }}</div>
                    }
                    @if (operation.status === 'RUNNING') { <div role="status">Etapa actual: {{ operation.stage }}. No cierres el panel.</div> }
                    @if (operation.error) { <div class="field-error" role="alert">{{ operation.error }}</div> }
                    @if (operation.status === 'SUCCEEDED' && operation.access_url) {
                      <div class="notice ok" role="status">Login inicial verificado. <a class="link" [href]="operation.access_url" target="_blank" rel="noopener">Abrir asistencia →</a></div>
                      <div>Para consultar la contraseña inicial guardada en Vault, abre la lista de tenants.</div>
                    }
                    @if (operation.result) { <div class="muted">Infraestructura registrada para {{ operation.result.tenant_slug }} en {{ operation.result.region }}.</div> }
                  } @else if (operationError()) { <div class="field-error" role="alert">{{ operationError() }}</div> }
                } @else {
                  <div class="muted">La función de aprovisionamiento demo está deshabilitada por defecto. El diagnóstico no ejecuta escaneos, IaC ni Ansible.</div>
                }
                @if (savedDraft(); as saved) {
                  <div class="cmd">Borrador consultado: {{ saved.tenant_slug }}</div>
                  @if (!demoCapabilities().enabled) {
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
                  }
                } @else {
                  <div>Guarda primero el borrador para consultar sus requisitos.</div>
                }
              </div>
              <div class="actions" style="margin-top:16px;border:0;padding:0">
                @if (savedDraft(); as saved) {
                  <button class="btn primary" (click)="startDemo()" [disabled]="!demoCapabilities().enabled || !demoCapabilities().ready || !engineSupported(engine()) || !!demoOperation() || operationStarting() || saved.status !== 'PENDING'">
                    {{ demoOperation()?.status === 'RUNNING' ? 'Aprovisionando…' : 'Iniciar aprovisionamiento demo' }}
                  </button>
                }
                @if (demoCapabilities().enabled) { <button class="btn" (click)="refreshDemoCapabilities()" [disabled]="demoCapabilitiesLoading()">Actualizar requisitos</button> }
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
          @if (!demoCapabilities().enabled) { <div class="notice warn">La creación web está deshabilitada por defecto. La activación local de demostración no autentica al operador.</div> }
          @else { <div class="notice warn">La demostración usa la cuenta AWS configurada en este equipo y puede generar cargos.</div> }
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
  private demoTimer: ReturnType<typeof setTimeout> | undefined;
  readonly artifactBusy = signal(false);
  readonly artifactMessage = signal('');
  readonly artifactError = signal('');
  readonly predeployScanBusy = signal(false);
  readonly predeployScanError = signal('');
  readonly predeployScanResult = signal<SecurityScanResult | null>(null);
  runPredeployScan() {
    const draft = this.savedDraft();
    if (!draft || this.predeployScanBusy()) return;
    this.predeployScanBusy.set(true);
    this.predeployScanError.set('');
    this.predeployScanResult.set(null);
    this.api.securityScan(draft.tenant_slug).subscribe({
      next: ({ data }) => { this.predeployScanResult.set(data); this.predeployScanBusy.set(false); },
      error: (error: HttpErrorResponse) => {
        this.predeployScanBusy.set(false);
        this.predeployScanError.set(typeof error.error?.message === 'string' ? error.error.message : 'No se pudo ejecutar el escaneo local.');
      },
    });
  }
  ngOnDestroy() {
    if (this.artifactTimer) clearTimeout(this.artifactTimer);
    if (this.demoTimer) clearTimeout(this.demoTimer);
  }
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
  readonly demoCapabilities = signal<DemoProvisioningCapabilities>({ enabled: false, ready: false, missing: [], supported_engines: [] });
  readonly demoCapabilitiesLoading = signal(false); readonly demoCapabilitiesError = signal('');
  readonly demoOperation = signal<DemoProvisioningOperation | null>(null); readonly operationError = signal('');
  readonly operationStarting = signal(false);
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
  engineSupported(engine: IaCEngine): boolean {
    const capabilities = this.demoCapabilities();
    return !capabilities.enabled || !capabilities.ready
      || capabilities.supported_engines.includes(engine as 'terraform' | 'cloudformation');
  }
  refreshDemoCapabilities() {
    this.demoCapabilitiesLoading.set(true); this.demoCapabilitiesError.set('');
    this.api.demoProvisioningCapabilities().subscribe({
      next: ({ data }) => {
        this.demoCapabilities.set(data);
        this.demoCapabilitiesLoading.set(false);
        if (data.ready && !this.engineSupported(this.engine()) && !this.savedDraft()) {
          this.engine.set(data.supported_engines[0]);
        }
      },
      error: () => {
        this.demoCapabilitiesLoading.set(false);
        this.demoCapabilitiesError.set('No se pudieron comprobar los requisitos locales.');
      },
    });
  }
  startDemo() {
    const draft = this.savedDraft();
    if (!draft || !this.demoCapabilities().enabled || !this.demoCapabilities().ready) return;
    if (!window.confirm(`Se iniciará ${this.engine()} para ${draft.tenant_slug} en AWS. Puede generar cargos y no habrá borrado automático si falla. La demostración local no autentica al operador. ¿Confirmas el aprovisionamiento?`)) return;
    this.operationStarting.set(true); this.operationError.set('');
    this.api.startDemoProvisioning(draft.tenant_slug).subscribe({
      next: ({ data }) => {
        this.demoOperation.set(data); this.operationStarting.set(false); this.pollDemoOperation(draft.tenant_slug);
      },
      error: (error: HttpErrorResponse) => {
        this.operationStarting.set(false);
        this.operationError.set(typeof error.error?.message === 'string' ? error.error.message : 'No se pudo iniciar el aprovisionamiento demo.');
      },
    });
  }
  private pollDemoOperation(slug: string) {
    this.api.demoProvisioningOperation(slug).subscribe({
      next: ({ data }) => {
        this.demoOperation.set(data);
        if (data.status === 'RUNNING') this.demoTimer = setTimeout(() => this.pollDemoOperation(slug), 2000);
      },
      error: () => { this.operationError.set('No se pudo consultar la operación local. Verifica AWS antes de intentar cualquier otra acción.'); },
    });
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
    this.loading.set(true); this.error.set(''); this.refreshDemoCapabilities();
    forkJoin({ plans: this.api.plans(), images: this.api.images() }).subscribe({
      next: ({ plans, images }) => { this.plans.set(plans.data); this.images.set(images.data); if (!plans.data.some(plan => plan.slug === this.planSlug())) this.planSlug.set(plans.data[0]?.slug ?? ''); this.loading.set(false); },
      error: () => { this.error.set('No se pudo cargar el catálogo o las imágenes. Verifica que la API y PostgreSQL estén disponibles.'); this.loading.set(false); },
    });
  }
}
