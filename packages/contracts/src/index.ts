export type ServerRole = 'frontend' | 'backend' | 'database';
export const SERVER_ROLES: ServerRole[] = ['frontend', 'backend', 'database'];
export interface RoleCapacity { instance_type: string; vcpu: number; ram_gib: number; disk_gib: number; }
export interface Plan { slug: string; name: string; description: string; max_students: number; backup_policy: string; roles: Record<ServerRole, RoleCapacity>; catalog_version: string; }
export type CloudProvider = 'aws' | 'azure';
export interface GoldenImage { role: ServerRole; provider: CloudProvider; region: string; ami_id: string; image_version: string; packer_version: string; built_at: string; source_revision: string; }
export interface ApiList<T> { data: T[]; meta?: Record<string, unknown>; }
/** Estados de la tabla tenants (CHECK tenants_status_check). PENDING = borrador guardado desde el Paso 1. */
export type TenantStatus = 'PENDING' | 'PROVISIONING' | 'ACTIVE' | 'SUSPENDING' | 'SUSPENDED' | 'RESUMING' | 'BACKING_UP' | 'RESTORING' | 'DELETING' | 'DELETED' | 'ERROR';
export const TENANT_STATUSES: TenantStatus[] = ['PENDING', 'PROVISIONING', 'ACTIVE', 'SUSPENDING', 'SUSPENDED', 'RESUMING', 'BACKING_UP', 'RESTORING', 'DELETING', 'DELETED', 'ERROR'];
export interface TenantSummary { slug: string; name: string; plan_slug: string; environment: string; region: string; engine: string; status: string; access_url: string | null; demo_credentials_available?: boolean; admin_email?: string; created_at?: string; simulated?: boolean; }
export interface DeploymentMetadata { application_revision: string; infrastructure_revision: string; engine_version: string; ansible_version: string; images: GoldenImage[]; plan_snapshot: Plan; }
export type IaCEngine = 'terraform' | 'opentofu' | 'pulumi' | 'cloudformation';
export type OperationType = 'CREATE' | 'UPDATE' | 'SUSPEND' | 'RESUME' | 'DESTROY';
export type OperationStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
export interface DeploymentRequest {
  schema_version: 1; request_id: string; tenant_slug: string; institution_name: string; admin_email: string;
  provider: 'aws'; region: string; environment: 'produccion'; engine: IaCEngine; key_pair_name: string;
  deployable: boolean; generated_at: string; plan_snapshot: Plan;
  images: Partial<Record<ServerRole, GoldenImage>>; user_data: Record<ServerRole, string>;
}
export interface ProvisionedNode { instance_id: string; image_id: string; private_ip: string; public_ip: string | null; }
export interface ProvisioningResult {
  schema_version: 1; request_id: string; tenant_slug: string; engine: IaCEngine; region: string;
  nodes: Record<ServerRole, ProvisionedNode>;
  network: { vpc_id: string; subnet_ids: string[]; security_group_ids: string[] };
  state_reference: { backend: string; key_or_stack: string };
}
export interface OperationEvent {
  schema_version: 1; operation_id: string; tenant_slug: string; operation_type: OperationType;
  status: OperationStatus; stage: string; occurred_at: string; message: string;
}
export interface DemoProvisioningCapabilities {
  enabled: boolean; ready: boolean; missing: string[]; supported_engines: Array<'terraform' | 'opentofu' | 'pulumi' | 'cloudformation'>;
}
export interface DemoProvisioningOperation {
  operation_id: string; tenant_slug: string; status: OperationStatus; stage: string;
  events: OperationEvent[]; result: ProvisioningResult | null; access_url: string | null; error: string | null;
}
export interface CreationReadiness {
  tenant_slug: string;
  tenant_status: string;
  can_start: false;
  checks: Array<{ code: string; status: 'ready' | 'blocked'; message: string }>;
  pipeline: Array<{ stage: string; description: string; status: 'not_started' }>;
}
export interface AssistanceArtifactInspection {
  revisions: { backend: string; frontend: string };
  ready: boolean;
  release: string;
}
export interface AssistanceArtifactJob {
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  result: AssistanceArtifactInspection | null;
  error: string | null;
}
export type SecurityScannerId = 'trivy' | 'checkov' | 'cfn-lint';
export type SecurityFindingSeverity = 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export interface SecurityScanFinding {
  rule_id: string;
  severity: SecurityFindingSeverity;
  scanner?: SecurityScannerId;
  category?: 'secret' | 'misconfig' | 'lint';
  blocking?: boolean;
  message?: string;
}
export interface SecurityScannerSummary {
  scanner: SecurityScannerId;
  label: string;
  status: 'clean' | 'warning' | 'blocked';
  blocking_count: number;
  warning_count: number;
  message: string;
}
export interface SecurityScanResult {
  schema_version: 1;
  tenant_slug: string;
  scanner: 'trivy';
  scanners?: SecurityScannerSummary[];
  scope: string[];
  content_sha256: string;
  status: 'clean' | 'blocked';
  findings: SecurityScanFinding[];
}

/** Integración 5: ciclo de vida y auditoría (RF-14 a RF-18, RF-20). */
export type LifecycleAction = 'suspend' | 'resume' | 'delete' | 'backup' | 'restore';
export interface LogSource { id: string; label: string; role: ServerRole; description: string; }
export interface TenantLogs { tenant_slug: string; source: string; label: string; fetched_at: string; lines: string[]; truncated: boolean; }
export type AuditAction = 'LOGIN' | 'DRAFT_CREATE' | 'SECURITY_SCAN' | 'CREATE' | 'SUSPEND' | 'RESUME' | 'DELETE' | 'BACKUP' | 'RESTORE' | 'RENAME'
  | 'CREDENTIALS_REVEAL' | 'MONITORING_TARGETS' | 'LOGS_VIEW';
export type AuditStatus = 'STARTED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'DENIED' | 'INFO';
export interface AuditEventRecord {
  id: string; occurred_at: string; actor: string; action: AuditAction; status: AuditStatus; tenant_slug: string | null;
  operation_id: string | null; stage: string | null; message: string; detail: Record<string, unknown>;
}
export interface AuditList { data: AuditEventRecord[]; meta: { total: number; limit: number; offset: number }; }
export interface BackupRecord { backup_id: string; tenant_slug: string; created_at: string; actor: string; size_bytes: number; sha256: string; simulated: boolean; }
export interface TenantLifecycleInfo {
  backups: BackupRecord[];
  tenant_slug: string; name: string; status: string; engine: string; region: string; enabled: boolean; simulated: boolean;
  allowed_actions: LifecycleAction[];
  instances: Array<{ role: ServerRole; instance_id: string; private_ip: string; public_ip: string | null }>;
  network: { vpc_id: string; subnet_ids: string[]; security_group_ids: string[] } | null;
  state_reference: { backend: string; key_or_stack: string } | null;
  will_delete: string[];
}
export interface LifecycleOperation {
  operation_id: string; tenant_slug: string; action: LifecycleAction | 'create'; status: OperationStatus; stage: string;
  actor: string; simulated: boolean; started_at: string; events: AuditEventRecord[]; error: string | null;
}
export interface TenantAlertRecord { id: number; tenant_slug: string; title: string; severity: string; status: 'FIRING' | 'RESOLVED'; role: string | null; summary: string | null; detected_at: string; resolved_at: string | null; }
export interface MonitoringTunnel { tenant_slug: string; role: string; local_port: number; status: 'starting' | 'up' | 'down'; restarts: number; }
export interface MonitoringStatus { grafana_url: string; dashboard_url: string; prometheus_url: string; tunnels_enabled: boolean; webhook_configured: boolean; tunnels: MonitoringTunnel[]; }
export interface AuthSession { token: string; user: string; expires_at: string; }

export * from './validation';
