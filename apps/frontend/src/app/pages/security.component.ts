import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TENANT_SLUG_PATTERN, type SecurityScanFinding, type SecurityScannerSummary, type SecurityScanResult } from '@modulo2/contracts';
import { ApiService } from '../api.service';

const DEFAULT_SCANNERS: Array<{ id: string; title: string; role: string; policy: string }> = [
  {
    id: 'trivy',
    title: '1. Trivy Secret Scanner',
    role: 'Detector de credenciales, llaves AWS (AKIA…), llaves privadas SSH y tokens en solicitud y plantillas.',
    policy: 'Bloqueante ante cualquier secreto expuesto.',
  },
  {
    id: 'checkov',
    title: '2. Checkov IaC & Regla Puerto 5432',
    role: 'Análisis estático de políticas Cloud (Terraform y CloudFormation) y aislamiento del puerto 5432 de PostgreSQL.',
    policy: 'Bloquea en CRITICAL (ej. 5432 abierto a 0.0.0.0/0); muestra HIGH/MEDIUM/LOW como advertencias.',
  },
  {
    id: 'cfn-lint',
    title: '3. Trivy Config & cfn-lint',
    role: 'Validación de configuraciones inseguras IaC (misconfig) y estructura de plantillas CloudFormation/Terraform.',
    policy: 'Bloquea únicamente en CRITICAL; reporta HIGH/MEDIUM/LOW como advertencias informativas.',
  },
];

@Component({
  template: `
    <section class="view">
      <div class="view-head">
        <div>
          <h1>Escáneres de seguridad Pre-Deploy (Trivy + Checkov + cfn-lint)</h1>
          <p>Ejecuta los 3 escáneres sobre el paquete local y las plantillas IaC del tenant sin exponer valores sensibles. Detiene el despliegue únicamente ante secretos o errores CRITICAL y muestra advertencias informativas para hallazgos HIGH, MEDIUM y LOW.</p>
        </div>
        <div class="rf-badges">
          <span class="rf-badge">RF-11 · RNF-Seguridad</span>
          <span class="rf-badge">Integrante 3</span>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <h2>Motores de análisis integrados (3 escáneres)</h2>
            <p>Política activa: bloquea únicamente secretos expuestos y hallazgos CRITICAL; las observaciones HIGH, MEDIUM y LOW se informan en pantalla sin detener la creación.</p>
          </div>
        </div>
        <div class="grid cols-3">
          @for (item of catalogScanners; track item.id) {
            <div class="mini">
              <h3>{{ item.title }}</h3>
              <p>{{ item.role }}</p>
              <p style="margin-top:6px"><span class="tag">{{ item.policy }}</span></p>
            </div>
          }
        </div>
      </div>

      <div class="card">
        <div class="notice warn">Solo uso local y activación explícita. No aprovisiona recursos ni sustituye la autorización del operador.
          Si el tenant ya fue guardado como borrador, el sistema prepara y analiza su paquete local automáticamente.</div>
        <div style="margin-top:14px">
          <label for="scan-slug">Identificador del tenant</label>
          <input id="scan-slug" type="text" [value]="slug()" (input)="slug.set(value($event)); result.set(null)" [disabled]="busy()" placeholder="i3-instituto-demo">
        </div>
        <div class="actions" style="margin-top:16px">
          <span>Analiza <code>request.json</code>, los 3 <code>cloud-init</code> y las plantillas de infraestructura del motor elegido.</span>
          <div>
            <button class="btn primary" type="button" (click)="scan()" [disabled]="busy() || !valid()">
              {{ busy() ? 'Ejecutando 3 escáneres…' : 'Analizar paquete local (3 escáneres)' }}</button>
          </div>
        </div>

        @if (error()) { <div class="notice err" style="margin-top:16px" role="alert">{{ error() }}</div> }

        @if (result(); as scan) {
          <div class="notice" style="margin-top:16px" [class.err]="scan.status === 'blocked'" [class.ok]="scan.status === 'clean'" role="status">
            <div>
              <strong>
                @if (scan.status === 'blocked') {
                  Despliegue bloqueado: se detectaron secretos expuestos o errores CRITICAL ({{ blockingFindings().length }} bloqueante(s)).
                } @else if (warningFindings().length > 0) {
                  Paquete aprobado con {{ warningFindings().length }} advertencia(s) informativa(s) (0 secretos y 0 errores CRITICAL; no detiene la creación).
                } @else {
                  Sin hallazgos de seguridad en los 3 escáneres. Paquete limpio para desplegar.
                }
              </strong>
              <p style="margin-top:4px">Tenant: <strong class="mono">{{ scan.tenant_slug }}</strong> · Huella SHA-256: <span class="mono">{{ scan.content_sha256 }}</span></p>
              <p>Archivos analizados ({{ scan.scope.length }}): <code>{{ scan.scope.join(', ') }}</code></p>
            </div>
          </div>

          @if (scannerSummaries().length > 0) {
            <div style="margin-top:16px">
              <h3 style="font-size:13px;margin-bottom:10px">Resultado por escáner</h3>
              <div class="grid cols-3">
                @for (item of scannerSummaries(); track item.scanner) {
                  <div class="mini">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
                      <h3>{{ item.label }}</h3>
                      <span class="pill plain" [class.ok]="item.status === 'clean'" [class.warn]="item.status === 'warning'" [class.err]="item.status === 'blocked'">
                        {{ item.status === 'blocked' ? 'BLOQUEADO' : item.status === 'warning' ? 'ADVERTENCIAS' : 'LIMPIO' }}
                      </span>
                    </div>
                    <p style="margin-top:6px">{{ item.message }}</p>
                    <p class="mono" style="margin-top:6px">Bloqueantes (CRITICAL/Secretos): {{ item.blocking_count }} · Advertencias (HIGH/MEDIUM/LOW): {{ item.warning_count }}</p>
                  </div>
                }
              </div>
            </div>
          }

          @if (blockingFindings().length > 0) {
            <div style="margin-top:16px">
              <h3 style="font-size:13px;color:var(--err);margin-bottom:8px">Errores críticos y secretos que detienen el despliegue ({{ blockingFindings().length }})</h3>
              <div class="table-card">
                <div class="table-scroll">
                  <table>
                    <thead>
                      <tr><th>Escáner</th><th>Regla</th><th>Severidad</th><th>Acción</th><th>Detalle</th></tr>
                    </thead>
                    <tbody>
                      @for (finding of blockingFindings(); track $index) {
                        <tr>
                          <td><span class="tag">{{ finding.scanner ?? 'trivy' }}</span></td>
                          <td><strong class="mono">{{ finding.rule_id }}</strong></td>
                          <td><span class="pill err plain">{{ finding.severity }}</span></td>
                          <td><strong>Bloquea creación</strong></td>
                          <td>{{ finding.message ?? 'Secreto expuesto o error crítico de configuración IaC.' }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          }

          @if (warningFindings().length > 0) {
            <div style="margin-top:16px">
              <h3 style="font-size:13px;color:var(--warn);margin-bottom:8px">Advertencias informativas de configuración IaC — No detienen el despliegue ({{ warningFindings().length }})</h3>
              <div class="table-card">
                <div class="table-scroll">
                  <table>
                    <thead>
                      <tr><th>Escáner</th><th>Regla</th><th>Severidad</th><th>Acción</th><th>Mensaje informativo</th></tr>
                    </thead>
                    <tbody>
                      @for (finding of warningFindings(); track $index) {
                        <tr>
                          <td><span class="tag">{{ finding.scanner ?? 'iac' }}</span></td>
                          <td><strong class="mono">{{ finding.rule_id }}</strong></td>
                          <td><span class="pill warn plain">{{ finding.severity }}</span></td>
                          <td>Informativo (continúa)</td>
                          <td>{{ finding.message ?? 'Observación de configuración IaC no bloqueante.' }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          }
        }
      </div>
    </section>
  `,
})
export class SecurityComponent {
  private readonly api = inject(ApiService);
  readonly catalogScanners = DEFAULT_SCANNERS;
  readonly slug = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly result = signal<SecurityScanResult | null>(null);
  readonly scannerSummaries = computed<SecurityScannerSummary[]>(() => this.result()?.scanners ?? []);
  readonly blockingFindings = computed<SecurityScanFinding[]>(() =>
    (this.result()?.findings ?? []).filter(f => f.blocking ?? (f.category === 'secret' || f.severity === 'CRITICAL')),
  );
  readonly warningFindings = computed<SecurityScanFinding[]>(() =>
    (this.result()?.findings ?? []).filter(f => !(f.blocking ?? (f.category === 'secret' || f.severity === 'CRITICAL'))),
  );

  constructor() {
    const requested = inject(ActivatedRoute).snapshot.queryParamMap.get('tenant');
    if (requested && TENANT_SLUG_PATTERN.test(requested)) {
      this.slug.set(requested);
    }
  }

  value(event: Event) { return (event.target as HTMLInputElement).value; }
  valid() { return TENANT_SLUG_PATTERN.test(this.slug().trim()); }
  scan() {
    if (!this.valid() || this.busy()) return;
    const target = this.slug().trim();
    this.slug.set(target);
    this.busy.set(true);
    this.error.set('');
    this.result.set(null);
    this.api.securityScan(target).subscribe({
      next: response => { this.result.set(response.data); this.busy.set(false); },
      error: (error: HttpErrorResponse) => {
        this.error.set(typeof error.error?.message === 'string' ? error.error.message : 'No se pudo ejecutar el escaneo.');
        this.busy.set(false);
      },
    });
  }
}
