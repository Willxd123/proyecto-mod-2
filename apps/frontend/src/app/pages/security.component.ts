import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { TENANT_SLUG_PATTERN, type SecurityScanResult } from '@modulo2/contracts';
import { ApiService } from '../api.service';

@Component({
  template: `
    <section class="view">
      <div class="view-head"><div><h1>Escáner de seguridad</h1>
        <p>Analiza el paquete local de un tenant con Trivy sin mostrar valores sensibles.</p></div>
        <span class="rf-badge">RF-11 · Integrante 3</span></div>
      <div class="card">
        <div class="notice warn">Solo uso local y activación explícita. No aprovisiona recursos ni sustituye la autorización del operador.
          El paquete debe haberse preparado previamente; el escaneo no garantiza detectar todos los secretos.</div>
        <label for="scan-slug">Identificador del tenant</label>
        <input id="scan-slug" [value]="slug()" (input)="slug.set(value($event)); result.set(null)" [disabled]="busy()" placeholder="i3-instituto-demo">
        <div class="actions">
          <button class="btn primary" type="button" (click)="scan()" [disabled]="busy() || !valid()">
            {{ busy() ? 'Analizando…' : 'Analizar paquete local' }}</button>
        </div>
        @if (error()) { <div class="notice err" role="alert">{{ error() }}</div> }
        @if (result(); as scan) {
          <div class="notice" [class.warn]="scan.status === 'blocked'" [class.info]="scan.status === 'clean'" role="status">
            {{ scan.status === 'blocked' ? 'Hallazgos: no desplegar.' : 'Sin hallazgos del escáner en este paquete.' }}
            <p>Tenant: {{ scan.tenant_slug }}</p><p>Archivos: {{ scan.scope.join(', ') }}</p><p>Huella: <span class="mono">{{ scan.content_sha256 }}</span></p>
            @for (finding of scan.findings; track $index) { <p>{{ finding.rule_id }} · {{ finding.severity }}</p> }
          </div>
        }
      </div>
    </section>
  `,
})
export class SecurityComponent {
  private readonly api = inject(ApiService);
  readonly slug = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly result = signal<SecurityScanResult | null>(null);
  value(event: Event) { return (event.target as HTMLInputElement).value; }
  valid() { return TENANT_SLUG_PATTERN.test(this.slug()); }
  scan() {
    if (!this.valid() || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.result.set(null);
    this.api.securityScan(this.slug()).subscribe({
      next: response => { this.result.set(response.data); this.busy.set(false); },
      error: (error: HttpErrorResponse) => {
        this.error.set(typeof error.error?.message === 'string' ? error.error.message : 'No se pudo ejecutar el escaneo.');
        this.busy.set(false);
      },
    });
  }
}
