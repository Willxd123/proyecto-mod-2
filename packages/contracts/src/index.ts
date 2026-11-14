export type ServerRole = 'frontend' | 'backend' | 'database';
export const SERVER_ROLES: ServerRole[] = ['frontend', 'backend', 'database'];
export interface RoleCapacity { instance_type: string; vcpu: number; ram_gib: number; disk_gib: number; }
export interface Plan { slug: string; name: string; description: string; max_students: number; backup_policy: string; roles: Record<ServerRole, RoleCapacity>; catalog_version: string; }
export type CloudProvider = 'aws' | 'azure';
export interface GoldenImage { role: ServerRole; provider: CloudProvider; region: string; ami_id: string; image_version: string; packer_version: string; built_at: string; source_revision: string; }
export interface ApiList<T> { data: T[]; meta?: Record<string, unknown>; }
/** Estados de la tabla tenants (CHECK tenants_status_check). PENDING = borrador guardado desde el Paso 1. */
export type TenantStatus = 'PENDING' | 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'ERROR';
export const TENANT_STATUSES: TenantStatus[] = ['PENDING', 'PROVISIONING', 'ACTIVE', 'SUSPENDED', 'ERROR'];
export interface TenantSummary { slug: string; name: string; plan_slug: string; environment: string; region: string; engine: string; status: string; access_url: string | null; demo_credentials_available?: boolean; }
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
  enabled: boolean; ready: boolean; missing: string[]; supported_engines: Array<'terraform' | 'cloudformation'>;
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
export interface SecurityScanResult {
  schema_version: 1;
  tenant_slug: string;
  scanner: 'trivy';
  scope: string[];
  content_sha256: string;
  status: 'clean' | 'blocked';
  findings: Array<{ rule_id: string; severity: 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }>;
}
export * from './validation';
