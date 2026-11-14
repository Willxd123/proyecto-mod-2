import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ApiService } from '../api.service';

interface MonitoringConfig {
  server:              string | null;
  grafana_user:        string;
  grafana_port:        number;
  prometheus_port:     number;
  monitoring_enabled:  boolean;
}

interface TenantAlert {
  id:           number;
  tenant_slug:  string;
  title:        string;
  severity:     string;
  status:       string;
  detected_at:  string;
}

@Component({
  imports: [DatePipe],
  template: `
    <section class="view">
      <div class="view-head">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <h1>Monitoreo</h1>
            <span class="rf-badge">RF-25 a RF-29 · Integrante 6</span>
          </div>
          <p>Prometheus recoge las métricas del node exporter de cada tenant activo. Grafana las muestra por tenant.</p>
        </div>
      </div>

      @if (loadingConfig()) {
        <div class="notice info" role="status">Consultando configuración del servidor…</div>
      }
      @if (errorConfig()) {
        <div class="notice err" role="alert">{{ errorConfig() }}</div>
      }

      @if (!loadingConfig() && !errorConfig()) {
        <div class="card" style="margin-bottom:16px">
          <div class="card-head">
            <h2>Servidor de observabilidad</h2>
          </div>

          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px">
            @if (config()?.monitoring_enabled && config()?.server) {
              <a
                class="btn primary"
                [href]="grafanaUrl()"
                target="_blank"
                rel="noopener noreferrer"
              >Abrir Grafana ↗</a>
              <a
                class="btn"
                [href]="prometheusUrl()"
                target="_blank"
                rel="noopener noreferrer"
              >Ver objetivos en Prometheus ↗</a>
            } @else {
              <span class="pill warn plain">Servidor de observabilidad no configurado</span>
            }
          </div>

          <table style="width:100%;border-collapse:collapse">
            <tbody>
              <tr style="border-bottom:1px solid var(--border,#e5e7eb)">
                <td style="padding:8px 12px;color:var(--muted,#6b7280);width:180px">Servidor</td>
                <td style="padding:8px 12px">
                  @if (config()?.server) {
                    <span class="mono">{{ config()!.server }}</span>
                  } @else {
                    <span class="sub">No configurado — definir <code>OBS_SERVER_IP</code> en el backend</span>
                  }
                </td>
              </tr>
              <tr style="border-bottom:1px solid var(--border,#e5e7eb)">
                <td style="padding:8px 12px;color:var(--muted,#6b7280)">Usuario Grafana</td>
                <td style="padding:8px 12px"><span class="mono">{{ config()?.grafana_user ?? '—' }}</span></td>
              </tr>
              <tr style="border-bottom:1px solid var(--border,#e5e7eb)">
                <td style="padding:8px 12px;color:var(--muted,#6b7280)">Puerto Grafana</td>
                <td style="padding:8px 12px"><span class="mono">{{ config()?.grafana_port ?? '—' }}</span></td>
              </tr>
              <tr>
                <td style="padding:8px 12px;color:var(--muted,#6b7280)">Tenants monitoreados</td>
                <td style="padding:8px 12px">
                  @if (tenantsMonitoreados()) {
                    <span class="pill ok">{{ tenantsMonitoreados() }}</span>
                  } @else {
                    <span class="sub">ninguno</span>
                  }
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Alertas activas (RF-28) -->
        <div class="card">
          <div class="card-head">
            <h2>Alertas recientes</h2>
            <span class="rf-badge">RF-28</span>
          </div>

          @if (loadingAlerts()) {
            <div class="notice info" role="status">Cargando alertas…</div>
          }
          @if (errorAlerts()) {
            <div class="notice err" role="alert">{{ errorAlerts() }}</div>
          }
          @if (!loadingAlerts() && !errorAlerts() && !alerts().length) {
            <div class="notice info">Sin alertas registradas.</div>
          }
          @if (alerts().length) {
            <div class="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Tenant</th>
                    <th>Alerta</th>
                    <th>Severidad</th>
                    <th>Estado</th>
                    <th>Detectada</th>
                  </tr>
                </thead>
                <tbody>
                  @for (alert of alerts(); track alert.id) {
                    <tr>
                      <td><span class="mono">{{ alert.tenant_slug }}</span></td>
                      <td>{{ alert.title }}</td>
                      <td>
                        <span
                          class="pill plain"
                          [class.ok]="alert.severity === 'info'"
                          [class.warn]="alert.severity === 'warning'"
                          [class.err]="alert.severity === 'critical'"
                        >{{ alert.severity }}</span>
                      </td>
                      <td>
                        <span
                          class="pill plain"
                          [class.ok]="alert.status === 'RESOLVED'"
                          [class.warn]="alert.status === 'FIRING'"
                        >{{ alert.status }}</span>
                      </td>
                      <td><span class="mono sub">{{ alert.detected_at | date:'dd/MM/yyyy HH:mm' }}</span></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>

        <!-- Instrucciones de integración para el integrante 5 -->
        <div class="card" style="margin-top:16px">
          <div class="card-head"><h2>Integración con tenants (Integrante 5)</h2></div>
          <p style="font-size:0.85rem;color:var(--muted,#6b7280);margin:0 0 8px">
            Al crear o suspender un tenant, ejecutar en el servidor de observabilidad:
          </p>
          <pre style="background:var(--code-bg,#f3f4f6);padding:12px;border-radius:6px;font-size:0.8rem;overflow:auto"># Registrar
python3 scripts/update_monitoring_targets.py add \\
  --tenant &lt;slug&gt; --env produccion \\
  --node-ip &lt;ip-frontend&gt;,&lt;ip-backend&gt;,&lt;ip-database&gt; \\
  --db-ip &lt;ip-database&gt;

# Retirar
python3 scripts/update_monitoring_targets.py remove --tenant &lt;slug&gt;</pre>
        </div>
      }
    </section>
  `,
})
export class MonitoringComponent {
  private readonly api = inject(ApiService);

  readonly config         = signal<MonitoringConfig | null>(null);
  readonly loadingConfig  = signal(true);
  readonly errorConfig    = signal('');
  readonly alerts         = signal<TenantAlert[]>([]);
  readonly loadingAlerts  = signal(true);
  readonly errorAlerts    = signal('');

  readonly grafanaUrl = computed(() => {
    const c = this.config();
    return c?.server ? `http://${c.server}:${c.grafana_port}` : '#';
  });

  readonly prometheusUrl = computed(() => {
    const c = this.config();
    return c?.server ? `http://${c.server}:${c.prometheus_port}/targets` : '#';
  });

  readonly tenantsMonitoreados = computed(() => {
    const slugs = [...new Set(this.alerts().map(a => a.tenant_slug))];
    return slugs.length ? slugs.join(', ') : null;
  });

  constructor() {
    this.api.monitoringConfig().subscribe({
      next: r  => { this.config.set(r.data); this.loadingConfig.set(false); },
      error: () => { this.errorConfig.set('No se pudo obtener la configuración del servidor de observabilidad.'); this.loadingConfig.set(false); },
    });

    this.api.monitoringAlerts().subscribe({
      next: r  => { this.alerts.set(r.data); this.loadingAlerts.set(false); },
      error: () => { this.errorAlerts.set('No se pudieron cargar las alertas.'); this.loadingAlerts.set(false); },
    });
  }
}
