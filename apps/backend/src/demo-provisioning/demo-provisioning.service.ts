import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Repository } from 'typeorm';
import {
  SERVER_ROLES, TENANT_SLUG_PATTERN,
  type DemoProvisioningCapabilities, type DemoProvisioningOperation, type DeploymentMetadata,
  type OperationEvent, type ProvisioningResult,
} from '@modulo2/contracts';
import { CatalogPlan, Tenant } from '../database/entities';
import { ImagesService } from '../images/images.service';
import { REPO_ROOT } from '../paths';

type WorkerEvent = { stage: string; message: string; status: 'running' | 'succeeded' | 'failed' };

const ENGINES = ['terraform', 'cloudformation'] as const;
const WORKER_STAGES = new Set(['prepare', 'scan', 'preflight', 'provision', 'configure', 'verify', 'complete', 'failed', 'result']);

@Injectable()
export class DemoProvisioningService {
  private readonly jobs = new Map<string, DemoProvisioningOperation>();
  private readonly children = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
    @InjectRepository(CatalogPlan) private readonly plans: Repository<CatalogPlan>,
    private readonly images: ImagesService,
  ) {}

  enabled(): boolean {
    return process.env.DEMO_PROVISIONING_LOCAL === 'true'
      && (process.env.HOST === undefined || process.env.HOST === '127.0.0.1');
  }

  async capabilities(): Promise<DemoProvisioningCapabilities> {
    if (!this.enabled()) return { enabled: false, ready: false, missing: [], supported_engines: [] };
    const result = await this.workerCheck();
    return { enabled: true, ready: result.ready, missing: result.missing, supported_engines: result.supported_engines };
  }

  async start(slug: string, body: unknown): Promise<DemoProvisioningOperation> {
    if (!this.enabled()) throw new ForbiddenException('Aprovisionamiento demo local deshabilitado.');
    if (!TENANT_SLUG_PATTERN.test(slug) || !body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).join(',') !== 'confirm' || (body as { confirm?: unknown }).confirm !== slug) {
      throw new BadRequestException('Confirma el identificador exacto del tenant.');
    }

    const tenant = await this.tenants.findOneBy({ slug });
    if (!tenant) throw new NotFoundException('No existe el tenant solicitado.');
    if (tenant.status !== 'PENDING') throw new ConflictException('Solo se puede aprovisionar un borrador PENDING.');
    if (!ENGINES.includes(tenant.engine as typeof ENGINES[number])) {
      throw new ConflictException('El modo demo solo admite Terraform o CloudFormation.');
    }

    const capabilities = await this.capabilities();
    if (!capabilities.ready || !capabilities.supported_engines.includes(tenant.engine as typeof ENGINES[number])) {
      throw new ServiceUnavailableException('La configuración local no está lista para el motor seleccionado.');
    }

    const [plan, images] = await Promise.all([
      this.plans.findOneBy({ slug: tenant.plan_slug }),
      this.images.list(tenant.region),
    ]);
    if (!plan) throw new ServiceUnavailableException('No se encontró el snapshot del plan en PostgreSQL.');
    const selectedImages = images.filter(image => image.provider === 'aws' && image.region === tenant.region);
    if (SERVER_ROLES.some(role => !selectedImages.some(image => image.role === role))) {
      throw new ConflictException('Faltan Golden AMIs registradas para la región del tenant.');
    }

    const operationId = randomUUID();
    const operation: DemoProvisioningOperation = {
      operation_id: operationId, tenant_slug: slug, status: 'RUNNING', stage: 'queued',
      events: [], result: null, access_url: null, error: null,
    };
    const resources = { ...tenant.resources, demo_operation: operation };
    const updated = await this.tenants.update({ slug, status: 'PENDING' }, { status: 'PROVISIONING', resources });
    if (updated.affected !== 1) throw new ConflictException('El tenant cambió de estado; no se inició el aprovisionamiento.');
    this.jobs.set(slug, operation);

    this.runWorker(slug, {
      tenant: {
        slug, name: tenant.name, email: tenant.admin_email, plan_slug: tenant.plan_slug, region: tenant.region,
        engine: tenant.engine, request_id: tenant.id,
      },
      plan: {
        slug: plan.slug, name: plan.name, description: plan.description, max_students: plan.max_students,
        backup_policy: plan.backup_policy, roles: plan.roles, catalog_version: plan.catalog_version,
      },
      images: selectedImages,
    }, operation);
    return operation;
  }

  async operation(slug: string): Promise<DemoProvisioningOperation> {
    if (!this.enabled()) throw new ForbiddenException('Aprovisionamiento demo local deshabilitado.');
    if (!TENANT_SLUG_PATTERN.test(slug)) throw new NotFoundException('No existe el tenant solicitado.');
    const active = this.jobs.get(slug);
    if (active) return active;
    const tenant = await this.tenants.findOneBy({ slug });
    if (!tenant) throw new NotFoundException('No existe el tenant solicitado.');
    const saved = this.sanitizeOperation(tenant.resources?.demo_operation, slug);
    if (!saved) throw new NotFoundException('No hay una operación de demostración para este tenant.');
    if (saved.status === 'RUNNING') {
      return {
        ...saved, status: 'FAILED', stage: 'reconciliation',
        error: 'La API se reinició durante el trabajo. Inspecciona AWS antes de cualquier reintento.',
        events: [...saved.events, this.event(saved, 'reconciliation', 'La API se reinició; verifica el estado de AWS manualmente.', 'FAILED')],
      };
    }
    return saved;
  }

  private sanitizeOperation(value: unknown, slug: string): DemoProvisioningOperation | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const operation = value as DemoProvisioningOperation;
    if (Object.keys(value).sort().join(',') !== 'access_url,error,events,operation_id,result,stage,status,tenant_slug'
        || operation.tenant_slug !== slug || !/^[0-9a-f-]{36}$/.test(operation.operation_id)
        || !['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'].includes(operation.status)
        || typeof operation.stage !== 'string' || !/^[a-z_-]{1,40}$/.test(operation.stage)
        || !Array.isArray(operation.events) || operation.events.length > 40
        || (operation.error !== null && (typeof operation.error !== 'string' || operation.error.length > 240
          || /[\u0000-\u001f]/.test(operation.error)))) return null;
    if (operation.result !== null && !this.validResult(operation.result, slug)) return null;
    if (operation.access_url !== null
        && (typeof operation.access_url !== 'string' || !operation.result
          || operation.access_url !== `https://${operation.result.nodes.frontend.public_ip}`)) return null;
    for (const event of operation.events) {
      if (!event || event.schema_version !== 1 || event.operation_id !== operation.operation_id
          || event.tenant_slug !== slug || event.operation_type !== 'CREATE'
          || !['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'].includes(event.status)
          || typeof event.stage !== 'string' || !/^[a-z_-]{1,40}$/.test(event.stage)
          || typeof event.message !== 'string' || event.message.length > 240 || /[\u0000-\u001f]/.test(event.message)
          || Number.isNaN(Date.parse(event.occurred_at))) return null;
    }
    return operation;
  }

  private workerCheck(): Promise<DemoProvisioningCapabilities> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.platform === 'win32' ? 'python' : 'python3', ['scripts/demo_worker.py', '--check'],
        { cwd: REPO_ROOT, windowsHide: true });
      let output = '';
      let settled = false;
      const timeout = setTimeout(() => {
        child.kill();
        finish(new ServiceUnavailableException('La comprobación local excedió el tiempo permitido.'));
      }, 30000);
      const finish = (error?: Error, value?: DemoProvisioningCapabilities) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error); else resolve(value!);
      };
      child.stdout.on('data', (data: Buffer) => {
        output += data.toString('utf8');
        if (output.length > 16384) {
          child.kill();
          finish(new ServiceUnavailableException('La comprobación local devolvió una respuesta demasiado grande.'));
        }
      });
      child.stderr.resume();
      child.on('error', () => finish(new ServiceUnavailableException('No se pudo iniciar el comprobador local.')));
      child.on('close', code => {
        if (settled) return;
        try {
          const value: unknown = JSON.parse(output);
          if (code !== 0 || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
          const result = value as DemoProvisioningCapabilities;
          if (typeof result.ready !== 'boolean' || !Array.isArray(result.missing) || !Array.isArray(result.supported_engines)
              || result.missing.some(item => typeof item !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(item))
              || result.supported_engines.some(engine => !ENGINES.includes(engine))) throw new Error();
          finish(undefined, result);
        } catch {
          finish(new ServiceUnavailableException('El comprobador local devolvió un resultado inválido.'));
        }
      });
    });
  }

  private runWorker(slug: string, source: Record<string, unknown>, operation: DemoProvisioningOperation): void {
    const child = spawn(process.platform === 'win32' ? 'python' : 'python3', ['scripts/demo_worker.py'],
      { cwd: REPO_ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.children.set(slug, child);
    let output = '';
    let buffer = '';
    let finalSeen = false;
    let outcome: Record<string, unknown> | undefined;
    let failed = false;
    const fail = (message: string) => {
      if (failed) return;
      failed = true;
      child.kill();
      void this.finish(slug, operation, false, message);
    };
    const timeout = setTimeout(() => fail('La operación excedió el límite de tiempo. Inspecciona AWS antes de reintentar.'), 90 * 60 * 1000);
    child.stderr.resume();
    const consume = (line: string) => {
      if (!line) return;
      try {
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        const event = value as WorkerEvent;
        if (!WORKER_STAGES.has(event.stage) || !['running', 'succeeded', 'failed'].includes(event.status)) throw new Error();
        if (event.stage === 'result') {
          if (event.status !== 'succeeded'
              || Object.keys(value).sort().join(',') !== 'access_url,metadata,result,stage,status') throw new Error();
          finalSeen = true;
          outcome = value as Record<string, unknown>;
          return;
        }
        if (typeof event.message !== 'string' || event.message.length > 240
            || /[\u0000-\u001f]/.test(event.message)) throw new Error();
        operation.stage = event.stage;
        operation.events.push(this.event(operation, event.stage, event.message,
          event.status === 'failed' ? 'FAILED' : event.status === 'succeeded' ? 'SUCCEEDED' : 'RUNNING'));
        if (operation.events.length > 40) operation.events.splice(0, operation.events.length - 40);
        if (event.status === 'failed') fail(event.message);
      } catch {
        fail('El proceso local devolvió un evento inválido; se detuvo sin exponer su salida.');
      }
    };

    child.stdout.on('data', (data: Buffer) => {
      output += data.toString('utf8');
      if (output.length > 65536) {
        fail('La salida estructurada excedió el límite permitido.');
        return;
      }
      buffer += data.toString('utf8');
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      lines.forEach(consume);
    });
    child.on('error', () => fail('No se pudo iniciar el worker local.'));
    child.on('close', code => {
      clearTimeout(timeout);
      this.children.delete(slug);
      if (failed) return;
      if (buffer) consume(buffer);
      if (!failed && finalSeen && code === 0 && outcome) {
        void this.finish(slug, operation, true, '', outcome);
      } else if (!failed) {
        void this.finish(slug, operation, false,
          'El worker no completó la verificación. Inspecciona AWS antes de cualquier reintento.');
      }
    });
    child.stdin.on('error', () => fail('No se pudo enviar la solicitud validada al worker local.'));
    child.stdin.end(JSON.stringify(source));
  }

  private event(operation: DemoProvisioningOperation, stage: string, message: string,
    status: OperationEvent['status']): OperationEvent {
    return {
      schema_version: 1, operation_id: operation.operation_id, tenant_slug: operation.tenant_slug,
      operation_type: 'CREATE', status, stage, occurred_at: new Date().toISOString(), message,
    };
  }

  private validResult(value: unknown, slug: string): value is ProvisioningResult {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const result = value as ProvisioningResult;
    if (Object.keys(value).sort().join(',') !== 'engine,network,nodes,region,request_id,schema_version,state_reference,tenant_slug') return false;
    if (result.schema_version !== 1 || result.tenant_slug !== slug || !ENGINES.includes(result.engine as typeof ENGINES[number])
        || !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(result.region)
        || typeof result.request_id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(result.request_id)) return false;
    if (!result.nodes || Object.keys(result.nodes).sort().join(',') !== [...SERVER_ROLES].sort().join(',')
        || !result.network || !result.state_reference) return false;
    for (const role of SERVER_ROLES) {
      const node = result.nodes[role];
      if (!node || Object.keys(node).sort().join(',') !== 'image_id,instance_id,private_ip,public_ip'
          || !/^i-[a-f0-9]{8,17}$/.test(node.instance_id) || !/^ami-[a-f0-9]{17}$/.test(node.image_id)
          || isIP(node.private_ip) !== 4 || (node.public_ip !== null && isIP(node.public_ip) !== 4)) return false;
    }
    if (Object.keys(result.network).sort().join(',') !== 'security_group_ids,subnet_ids,vpc_id'
        || Object.keys(result.state_reference).sort().join(',') !== 'backend,key_or_stack'
        || !Array.isArray(result.network.subnet_ids) || !Array.isArray(result.network.security_group_ids)) return false;
    return /^vpc-[a-f0-9]+$/.test(result.network.vpc_id)
      && result.network.subnet_ids.length <= 10 && result.network.security_group_ids.length <= 10
      && result.network.subnet_ids.every(id => /^subnet-[a-f0-9]+$/.test(id))
      && result.network.security_group_ids.every(id => /^sg-[a-f0-9]+$/.test(id))
      && ['local-workspace', 'cloudformation'].includes(result.state_reference.backend)
      && typeof result.state_reference.key_or_stack === 'string'
      && result.state_reference.key_or_stack.length <= 300 && !/[\u0000-\u001f]/.test(result.state_reference.key_or_stack);
  }

  private partialResult(slug: string): ProvisioningResult | null {
    if (!TENANT_SLUG_PATTERN.test(slug)) return null;
    const root = resolve(REPO_ROOT, 'output/demo');
    const directory = resolve(REPO_ROOT, 'output/demo', slug);
    const path = resolve(directory, 'provisioning-result.json');
    try {
      if (lstatSync(root).isSymbolicLink() || lstatSync(directory).isSymbolicLink()
          || lstatSync(path).isSymbolicLink() || lstatSync(path).size > 1024 * 1024) return null;
      const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
      return this.validResult(value, slug) ? value : null;
    } catch {
      return null;
    }
  }

  private async finish(slug: string, operation: DemoProvisioningOperation, success: boolean,
    message: string, outcome?: Record<string, unknown>): Promise<void> {
    if (operation.status !== 'RUNNING') return;
    let tenant: Tenant | null;
    try {
      tenant = await this.tenants.findOneBy({ slug });
    } catch {
      operation.status = 'FAILED';
      operation.error = 'No se pudo consultar el estado del tenant; requiere reconciliación manual.';
      this.jobs.delete(slug);
      this.children.delete(slug);
      console.error('No se pudo consultar el estado de una operación demo; requiere revisión manual.');
      return;
    }
    if (!tenant || tenant.status !== 'PROVISIONING') {
      operation.status = 'FAILED';
      operation.error = 'El estado del tenant cambió durante la operación; revisa AWS manualmente.';
      this.jobs.delete(slug);
      this.children.delete(slug);
      return;
    }

    let result: ProvisioningResult | null = null;
    let accessUrl: string | null = null;
    let metadata: DeploymentMetadata & Record<string, unknown> | undefined;
    if (success) {
      if (!outcome || !this.validResult(outcome.result, slug) || typeof outcome.access_url !== 'string'
          || outcome.access_url !== `https://${outcome.result.nodes.frontend.public_ip}`
          || outcome.result.request_id !== tenant.id || outcome.result.engine !== tenant.engine
          || outcome.result.region !== tenant.region
          || !outcome.metadata || typeof outcome.metadata !== 'object' || Array.isArray(outcome.metadata)) {
        success = false;
        message = 'El worker devolvió un resultado de aprovisionamiento inválido.';
      } else {
        result = outcome.result;
        accessUrl = outcome.access_url;
        const candidate = outcome.metadata as Record<string, unknown>;
        const expectedMetadataKeys = [
          'ansible_version', 'application_revision', 'demo_initial_credentials_verified', 'demo_vault_reference',
          'engine_version', 'images', 'infrastructure_revision', 'plan_snapshot', 'release_id',
        ].sort().join(',');
        metadata = candidate as DeploymentMetadata & Record<string, unknown>;
        const snapshot = candidate.plan_snapshot as Record<string, unknown> | undefined;
        const snapshotRoles = snapshot?.roles as Record<string, Record<string, unknown>> | undefined;
        const imageRecords = candidate.images as Array<Record<string, unknown>> | undefined;
        const imageByRole = new Map((imageRecords ?? []).map(image => [image.role, image]));
        if (Object.keys(candidate).sort().join(',') !== expectedMetadataKeys
            || typeof candidate.application_revision !== 'string'
            || !/^[a-f0-9]{40}:[a-f0-9]{40}$/.test(candidate.application_revision)
            || typeof candidate.infrastructure_revision !== 'string' || !/^[a-f0-9]{64}$/.test(candidate.infrastructure_revision)
            || (tenant.engine === 'terraform'
              ? typeof candidate.engine_version !== 'string' || !/^Terraform v\d+\.\d+\.\d+$/.test(candidate.engine_version)
              : candidate.engine_version !== 'AWS CloudFormation service API')
            || typeof candidate.ansible_version !== 'string' || !/^ansible \[core \d+\.\d+(?:\.\d+)?\]$/.test(candidate.ansible_version)
            || !Array.isArray(candidate.images) || candidate.images.length !== SERVER_ROLES.length
            || !snapshot || snapshot.slug !== tenant.plan_slug
            || !snapshotRoles || Object.keys(snapshotRoles).sort().join(',') !== [...SERVER_ROLES].sort().join(',')
            || candidate.demo_vault_reference !== `local-vault:${slug}`
            || typeof candidate.release_id !== 'string' || !/^[a-f0-9]{32}$/.test(candidate.release_id)
            || candidate.demo_initial_credentials_verified !== true) {
          success = false;
          message = 'El worker no verificó el acceso inicial del administrador.';
          result = null;
          accessUrl = null;
          metadata = undefined;
        } else {
          for (const role of SERVER_ROLES) {
            const image = imageByRole.get(role);
            if (!image || Object.keys(image).sort().join(',') !== 'ami_id,built_at,image_version,packer_version,provider,region,role,source_revision'
                || image.role !== role || image.provider !== 'aws' || image.region !== tenant.region
                || image.ami_id !== result.nodes[role].image_id) {
              success = false;
              message = 'Las imágenes registradas no coinciden con los recursos aprovisionados.';
              result = null;
              accessUrl = null;
              metadata = undefined;
              break;
            }
          }
        }
      }
    }
    if (!success) {
      result = this.partialResult(slug);
      if (result && (result.request_id !== tenant.id || result.engine !== tenant.engine || result.region !== tenant.region)) {
        result = null;
      }
    }

    operation.status = success ? 'SUCCEEDED' : 'FAILED';
    operation.stage = success ? 'complete' : operation.stage;
    operation.result = result;
    operation.access_url = accessUrl;
    operation.error = success ? null : message;
    if (success) operation.events.push(this.event(operation, 'complete', 'Tenant configurado y login HTTPS verificado.', 'SUCCEEDED'));
    else operation.events.push(this.event(operation, 'failed', message, 'FAILED'));
    if (operation.events.length > 40) operation.events.splice(0, operation.events.length - 40);
    try {
      const resources = {
        ...tenant.resources, demo_operation: operation,
        ...(result ? { provisioning_result: result } : {}),
      };
      const savedMetadata = success && metadata
        ? JSON.stringify({ ...tenant.deployment_metadata, ...metadata })
        : null;
      const updated: unknown = await this.tenants.query(
        `UPDATE tenants SET status = $1::varchar, resources = $2::jsonb,
          access_url = CASE WHEN $1::varchar = 'ACTIVE' THEN $3 ELSE access_url END,
          frontend_public_ip = CASE WHEN $1::varchar = 'ACTIVE' THEN $4::inet ELSE frontend_public_ip END,
          backend_private_ip = CASE WHEN $1::varchar = 'ACTIVE' THEN $5::inet ELSE backend_private_ip END,
          db_private_ip = CASE WHEN $1::varchar = 'ACTIVE' THEN $6::inet ELSE db_private_ip END,
          deployment_metadata = COALESCE($7::jsonb, deployment_metadata)
          WHERE slug = $8 AND status = 'PROVISIONING' RETURNING slug`,
        [success ? 'ACTIVE' : 'ERROR', JSON.stringify(resources), accessUrl,
          success && result ? result.nodes.frontend.public_ip : null,
          success && result ? result.nodes.backend.private_ip : null,
          success && result ? result.nodes.database.private_ip : null, savedMetadata, slug],
      );
      if (!Array.isArray(updated) || updated.length !== 2 || updated[1] !== 1) {
        throw new Error('Tenant status changed before operation completion.');
      }
      this.jobs.delete(slug);
    } catch {
      operation.status = 'FAILED';
      operation.stage = 'persistence';
      operation.error = 'No se pudo guardar el estado del tenant; requiere reconciliación manual antes de reintentar.';
      operation.events.push(this.event(operation, 'persistence', operation.error, 'FAILED'));
      console.error('No se pudo persistir el resultado de una operación demo; requiere revisión manual.');
    } finally {
      this.children.delete(slug);
    }
  }
}
