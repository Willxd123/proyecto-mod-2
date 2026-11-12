import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { ApiList, GoldenImage, Plan, TenantSummary } from '@modulo2/contracts';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  plans() { return this.http.get<ApiList<Plan>>('/api/plans'); }
  images() { return this.http.get<ApiList<GoldenImage>>('/api/golden-images'); }
  tenants() { return this.http.get<ApiList<TenantSummary>>('/api/tenants'); }
}
