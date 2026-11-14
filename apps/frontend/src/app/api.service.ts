import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { ApiList, GoldenImage, Plan, TenantSummary } from '@modulo2/contracts';

interface MonitoringConfig {
  server:             string | null;
  grafana_user:       string;
  grafana_port:       number;
  prometheus_port:    number;
  monitoring_enabled: boolean;
}

interface TenantAlert {
  id:          number;
  tenant_slug: string;
  title:       string;
  severity:    string;
  status:      string;
  detected_at: string;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  plans()            { return this.http.get<ApiList<Plan>>('/api/plans'); }
  images()           { return this.http.get<ApiList<GoldenImage>>('/api/golden-images'); }
  tenants()          { return this.http.get<ApiList<TenantSummary>>('/api/tenants'); }
  monitoringConfig() { return this.http.get<{ data: MonitoringConfig }>('/api/monitoring/config'); }
  monitoringAlerts() { return this.http.get<{ data: TenantAlert[] }>('/api/monitoring/alerts'); }
}
