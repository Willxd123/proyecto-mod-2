import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type { MonitoringStatus, TenantAlertRecord, ApiList, AuditList, AuditEventRecord, LifecycleAction, LifecycleOperation, TenantLifecycleInfo, AssistanceArtifactInspection, AssistanceArtifactJob, CreationReadiness, DemoProvisioningCapabilities, DemoProvisioningOperation, GoldenImage, Plan, SecurityScanResult, TenantDraftCreated, TenantDraftInput, TenantSummary, TenantTfvarsGenerated, TenantValidationResult } from '@modulo2/contracts';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  plans() { return this.http.get<ApiList<Plan>>('/api/plans'); }
  images() { return this.http.get<ApiList<GoldenImage>>('/api/golden-images'); }
  tenants() { return this.http.get<ApiList<TenantSummary>>('/api/tenants'); }
  validateTenant(body: { tenant_slug: string; admin_email: string }) { return this.http.post<{ data: TenantValidationResult }>('/api/tenants/validate', body); }
  createDraft(body: TenantDraftInput) { return this.http.post<{ data: TenantDraftCreated }>('/api/tenants/drafts', body); }
  generateTfvars(slug: string) { return this.http.post<{ data: TenantTfvarsGenerated }>(`/api/tenants/${encodeURIComponent(slug)}/tfvars`, {}); }
  creationReadiness(slug: string) { return this.http.get<{ data: CreationReadiness }>(`/api/tenants/${encodeURIComponent(slug)}/creation-readiness`); }
  securityScan(slug: string) { return this.http.post<{ data: SecurityScanResult }>('/api/security/scan', { tenant_slug: slug }, { headers: { 'X-Requested-With': 'TenantControlCenter' } }); }
  demoCredentialsStatus() { return this.http.get<{ data: { enabled: boolean } }>('/api/demo-credentials/status', { headers: { 'X-Requested-With': 'TenantControlCenter' } }); }
  demoProvisioningCapabilities() { return this.http.get<{ data: DemoProvisioningCapabilities }>('/api/demo-provisioning/capabilities', { headers: { 'X-Requested-With': 'TenantControlCenter' } }); }
  startDemoProvisioning(slug: string) {
    return this.http.post<{ data: DemoProvisioningOperation }>(`/api/demo-provisioning/${encodeURIComponent(slug)}/start`,
      { confirm: slug }, { headers: { 'X-Requested-With': 'TenantControlCenter' } });
  }
  demoProvisioningOperation(slug: string) {
    return this.http.get<{ data: DemoProvisioningOperation }>(`/api/demo-provisioning/operations/${encodeURIComponent(slug)}`,
      { headers: { 'X-Requested-With': 'TenantControlCenter' } });
  }
  revealDemoCredentials(slug: string) {
    return this.http.post<{ data: { email: string; password: string } }>(`/api/demo-credentials/${encodeURIComponent(slug)}/reveal`,
      { confirm: slug }, { headers: { 'X-Requested-With': 'TenantControlCenter' } });
  }
  audit(filters: { tenant?: string; action?: string; status?: string; limit?: number; offset?: number }) {
    const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '' && value !== undefined)) as Record<string, string | number>;
    return this.http.get<AuditList>('/api/audit', { params });
  }
  auditOperation(id: string) { return this.http.get<{ data: AuditEventRecord[] }>(`/api/audit/operations/${encodeURIComponent(id)}`); }
  lifecycleInfo(slug: string) { return this.http.get<{ data: TenantLifecycleInfo }>(`/api/tenants/${encodeURIComponent(slug)}/lifecycle`); }
  lifecycleOperation(slug: string) { return this.http.get<{ data: LifecycleOperation | null }>(`/api/tenants/${encodeURIComponent(slug)}/lifecycle/operation`); }
  lifecycleAction(action: LifecycleAction, slug: string) {
    return this.http.post<{ data: LifecycleOperation }>(`/api/tenants/${encodeURIComponent(slug)}/${action}`, { confirm: slug }, { headers: { 'X-Requested-With': 'TenantControlCenter' } });
  }
  monitoringStatus() { return this.http.get<{ data: MonitoringStatus }>('/api/monitoring/status'); }
  monitoringAlerts(filters: { tenant?: string; status?: string; limit?: number }) {
    const params = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '' && value !== undefined)) as Record<string, string | number>;
    return this.http.get<{ data: TenantAlertRecord[] }>('/api/monitoring/alerts', { params });
  }
  restoreBackup(slug: string, backupId: string) {
    return this.http.post<{ data: LifecycleOperation }>(`/api/tenants/${encodeURIComponent(slug)}/restore`, { confirm: slug, backup_id: backupId }, { headers: { 'X-Requested-With': 'TenantControlCenter' } });
  }
  renameTenant(slug: string, name: string) { return this.http.patch<{ data: { slug: string; name: string } }>(`/api/tenants/${encodeURIComponent(slug)}`, { name }); }
  inspectArtifacts() { return this.http.get<{ data: AssistanceArtifactInspection }>('/api/assistance-artifacts/inspect', { headers: { 'X-Requested-With': 'TenantControlCenter' } }); }
  artifactStatus() { return this.http.get<{ data: AssistanceArtifactJob }>('/api/assistance-artifacts/status', { headers: { 'X-Requested-With': 'TenantControlCenter' } }); }
  prepareArtifacts(revisions: AssistanceArtifactInspection['revisions']) {
    return this.http.post<{ data: AssistanceArtifactJob }>('/api/assistance-artifacts/prepare', revisions, { headers: { 'X-Requested-With': 'TenantControlCenter' } });
  }
}
