import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { ApiList, GoldenImage, Plan, TenantDraftCreated, TenantDraftInput, TenantSummary, TenantTfvarsGenerated, TenantValidationResult } from '@modulo2/contracts';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  plans() { return this.http.get<ApiList<Plan>>('/api/plans'); }
  images() { return this.http.get<ApiList<GoldenImage>>('/api/golden-images'); }
  tenants() { return this.http.get<ApiList<TenantSummary>>('/api/tenants'); }
  validateTenant(body: { tenant_slug: string; admin_email: string }) { return this.http.post<{ data: TenantValidationResult }>('/api/tenants/validate', body); }
  createDraft(body: TenantDraftInput) { return this.http.post<{ data: TenantDraftCreated }>('/api/tenants/drafts', body); }
  generateTfvars(slug: string) { return this.http.post<{ data: TenantTfvarsGenerated }>(`/api/tenants/${encodeURIComponent(slug)}/tfvars`, {}); }
}
