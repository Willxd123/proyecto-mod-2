import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import {
  SERVER_ROLES, TENANT_SLUG_PATTERN,
  type AuditAction, type AuditEventRecord, type BackupRecord, type LifecycleAction, type LifecycleOperation, type OperationStatus,
  type ProvisioningResult, type TenantLifecycleInfo,
} from '@modulo2/contracts';
import { AuditService, cleanText } from '../audit/audit.service';
import { Tenant, TenantBackup } from '../database/entities';
import { REPO_ROOT } from '../paths';
import { MonitoringTargetsService, type TargetNodes } from './monitoring-targets.service';

interface Rule { from: string[]; busy: string; done: string; audit: AuditAction; verb: string }
/** Transiciones permitidas: cada operación mueve el tenant de un estado estable a uno ocupado y luego a otro estable. */
const RULES: Record<LifecycleAction, Rule> = {
  suspend: { from: ['ACTIVE'], busy: 'SUSPENDING', done: 'SUSPENDED', audit: 'SUSPEND', verb: 'Suspender' },
  resume: { from: ['SUSPENDED', 'ERROR'], busy: 'RESUMING', done: 'ACTIVE', audit: 'RESUME', verb: 'Reanudar' },
  delete: { from: ['ACTIVE', 'SUSPENDED', 'ERROR'], busy: 'DELETING', done: 'DELETED', audit: 'DELETE', verb: 'Eliminar' },
  backup: { from: ['ACTIVE'], busy: 'BACKING_UP', done: 'ACTIVE', audit: 'BACKUP', verb: 'Respaldar' },
  restore: { from: ['ACTIVE'], busy: 'RESTORING', done: 'ACTIVE', audit: 'RESTORE', verb: 'Restaurar' },
};
const LIFECYCLE_AUDIT: AuditAction[] = ['SUSPEND', 'RESUME', 'DELETE', 'BACKUP', 'RESTORE'];
/** La consulta de operación también muestra la creación del tenant. */
const OPERATION_AUDIT: AuditAction[] = [...LIFECYCLE_AUDIT, 'CREATE'];
const ENGINES = ['terraform', 'opentofu', 'pulumi', 'cloudformation'];
const WORKER_STAGES = new Set(['preflight', 'suspend', 'resume', 'destroy', 'backup', 'restore', 'provision', 'configure', 'verify', 'complete', 'failed', 'result']);
const TIMEOUT_MS = 60 * 60 * 1000;

type WorkerNodes = TargetNodes;
interface BackupOutcome { backup_id: string; size_bytes: number; sha256: string }
type WorkerResult = WorkerNodes | { backup: BackupOutcome } | Record<string, never>;
interface WorkerEvent { stage: string; message?: string; status: 'running' | 'succeeded' | 'failed'; safe?: boolean; nodes?: unknown; backup?: unknown }

/** Integración 5 (RF-15 a RF-18): suspender, reanudar, eliminar y renombrar tenants, con auditoría y una sola operación por tenant. */
@Injectable()
export class LifecycleService implements OnModuleInit, OnApplicationShutdown {
  private readonly children = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(@InjectRepository(Tenant) private readonly tenants: Repository<Tenant>, @InjectRepository(TenantBackup) private readonly backups: Repository<TenantBackup>,
              private readonly audit: AuditService, private readonly targets: MonitoringTargetsService) {}

  /** Modo explícito de simulación: no toca AWS y todo mensaje se marca como simulado. */
  simulated(): boolean { return process.env.LIFECYCLE_SIMULATE === 'true'; }

  /** Habilitado con el opt-in local de la demo o con la simulación; siempre solo en loopback. */
  enabled(): boolean {
    return (this.simulated() || process.env.DEMO_PROVISIONING_LOCAL === 'true')
      && (process.env.HOST === undefined || process.env.HOST === '127.0.0.1');
  }

  /** Tras un reinicio no se puede saber cómo terminó una operación en curso: se marca ERROR y se audita. */
  async onModuleInit(): Promise<void> {
    const stuck = await this.tenants.query(`SELECT slug FROM tenants WHERE status IN ('SUSPENDING', 'RESUMING', 'BACKING_UP', 'RESTORING', 'DELETING')`) as Array<{ slug: string }>;
    for (const { slug } of stuck) {
      const operationId = await this.audit.latestOperationId(slug, LIFECYCLE_AUDIT);
      await this.tenants.update({ slug }, { status: 'ERROR' });
      await this.audit.record({
        actor: 'sistema', action: await this.lastAction(operationId), status: 'FAILED', tenant_slug: slug,
        operation_id: operationId, stage: 'reconciliation',
        message: 'La API se reinició durante la operación. Inspecciona AWS antes de reintentar.',
      });
    }
  }

  private async lastAction(operationId: string | null): Promise<AuditAction> {
    const events = operationId ? await this.audit.operation(operationId) : [];
    return (events[0]?.action as AuditAction | undefined) ?? 'DELETE';
  }

  onApplicationShutdown(): void { for (const child of this.children.values()) child.kill(); }

  private slugOrThrow(slug: string): void {
    if (!TENANT_SLUG_PATTERN.test(slug)) throw new NotFoundException('No existe el tenant solicitado.');
  }

  /** Lee y valida el ProvisioningResult guardado al crear el tenant; null si falta o no es confiable. */
  private readResult(tenant: Tenant): ProvisioningResult | null {
    const value = tenant.resources?.provisioning_result as ProvisioningResult | undefined;
    if (!value || typeof value !== 'object' || value.tenant_slug !== tenant.slug || !value.nodes || !value.network) return null;
    for (const role of SERVER_ROLES) {
      const node = value.nodes[role];
      if (!node || !/^i-[a-f0-9]{8,17}$/.test(node.instance_id) || isIP(node.private_ip) !== 4
          || (node.public_ip !== null && isIP(node.public_ip) !== 4)) return null;
    }
    return value;
  }

  /** Datos para el panel: acciones permitidas y, antes de eliminar, la lista de lo que se borrará. */
  async info(slug: string): Promise<TenantLifecycleInfo> {
    this.slugOrThrow(slug);
    const tenant = await this.tenants.findOneBy({ slug });
    if (!tenant) throw new NotFoundException('No existe el tenant solicitado.');
    const result = this.readResult(tenant);
    const enabled = this.enabled();
    const backups = await this.listBackups(slug);
    const allowed = (Object.keys(RULES) as LifecycleAction[]).filter(action => enabled && ENGINES.includes(tenant.engine)
      && RULES[action].from.includes(tenant.status) && (action === 'delete' || result !== null) && (action !== 'restore' || backups.length > 0));
    const instances = result ? SERVER_ROLES.map(role => ({ role, instance_id: result.nodes[role].instance_id,
      private_ip: result.nodes[role].private_ip, public_ip: result.nodes[role].public_ip })) : [];
    const willDelete = result ? [
      `3 instancias EC2: ${instances.map(item => `${item.role} (${item.instance_id})`).join(', ')}.`,
      'Los discos EBS de esas instancias, incluida la base de datos PostgreSQL del tenant y todos sus datos (estudiantes, cursos y asistencia).',
      `La red del tenant: VPC ${result.network.vpc_id}, ${result.network.subnet_ids.length} subred(es) y ${result.network.security_group_ids.length} grupo(s) de seguridad.`,
      `El estado del motor ${tenant.engine === 'cloudformation' ? 'CloudFormation (stack del tenant)' : tenant.engine === 'pulumi' ? 'Pulumi (stack del tenant)' : `${tenant.engine === 'opentofu' ? 'OpenTofu' : 'Terraform'} (workspace del tenant)`}: ${result.state_reference.key_or_stack}.`,
      'Los targets de monitoreo del tenant. El registro del tenant se conserva con estado DELETED para la auditoría. Los respaldos guardados en este equipo no se borran.',
    ] : ['No hay un resultado de aprovisionamiento guardado: el motor eliminará solo lo que tenga registrado a nombre de este tenant, y fallará si no hay nada.'];
    return {
      tenant_slug: tenant.slug, name: tenant.name, status: tenant.status, engine: tenant.engine, region: tenant.region,
      enabled, simulated: this.simulated(), allowed_actions: allowed, instances, network: result?.network ?? null,
      state_reference: result?.state_reference ?? null, will_delete: willDelete, backups,
    };
  }

  /** Respaldos registrados del tenant, del más reciente al más antiguo. */
  private async listBackups(slug: string): Promise<BackupRecord[]> {
    const rows = await this.backups.find({ where: { tenant_slug: slug }, order: { created_at: 'DESC' }, take: 50 });
    return rows.map(row => ({ backup_id: row.id, tenant_slug: row.tenant_slug, created_at: new Date(row.created_at).toISOString(), actor: row.actor,
      size_bytes: Number(row.size_bytes), sha256: row.sha256, simulated: row.simulated }));
  }

  /** Cambia el nombre comercial (RF-15). No toca AWS. */
  async rename(slug: string, body: unknown, actor: string): Promise<{ slug: string; name: string }> {
    this.slugOrThrow(slug);
    const input = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
    const name = typeof input.name === 'string' ? cleanText(input.name, 121) : '';
    if (!name || name.length > 120) throw new BadRequestException('El nombre debe tener entre 1 y 120 caracteres.');
    const tenant = await this.tenants.findOneBy({ slug });
    if (!tenant || tenant.status === 'DELETED') throw new NotFoundException('No existe el tenant solicitado.');
    if (tenant.name === name) throw new ConflictException('El nombre es el mismo que el actual.');
    await this.tenants.update({ slug }, { name });
    await this.audit.record({ actor, action: 'RENAME', status: 'SUCCEEDED', tenant_slug: slug, message: 'Nombre del tenant actualizado.',
      detail: { anterior: tenant.name, nuevo: name } });
    return { slug, name };
  }

  /** Inicia suspender, reanudar o eliminar: transición atómica de estado, auditoría y worker en segundo plano. */
  async start(slug: string, action: LifecycleAction, actor: string, body: unknown): Promise<LifecycleOperation> {
    const rule = RULES[action];
    const simulatedNow = this.simulated();
    if (!rule) throw new NotFoundException('Acción desconocida.');
    if (!this.enabled()) throw new ForbiddenException('Las operaciones de ciclo de vida están deshabilitadas en este equipo.');
    this.slugOrThrow(slug);
    const expectedKeys = action === 'restore' ? 'backup_id,confirm' : 'confirm';
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== expectedKeys
        || (body as { confirm?: unknown }).confirm !== slug) throw new BadRequestException('Confirma el identificador exacto del tenant.');
    const backupId = action === 'restore' ? (body as { backup_id?: unknown }).backup_id : undefined;
    if (action === 'restore' && (typeof backupId !== 'string' || !/^[0-9a-f-]{36}$/.test(backupId))) throw new BadRequestException('Elige un respaldo válido.');
    const tenant = await this.tenants.findOneBy({ slug });
    if (!tenant) throw new NotFoundException('No existe el tenant solicitado.');
    if (!ENGINES.includes(tenant.engine)) throw new ConflictException('Solo se administran tenants creados con Terraform, OpenTofu, Pulumi o CloudFormation.');
    if (!rule.from.includes(tenant.status)) {
      throw new ConflictException(`No se puede ${rule.verb.toLowerCase()} un tenant en estado ${tenant.status}.`);
    }
    const result = this.readResult(tenant);
    if (action !== 'delete' && !result) throw new ConflictException('El tenant no tiene un resultado de aprovisionamiento confiable.');

    let backup: { backup_id: string; sha256: string | null } | null = null;
    if (action === 'restore') {
      const saved = await this.backups.findOneBy({ id: backupId as string, tenant_slug: slug });
      if (!saved) throw new NotFoundException('El respaldo no existe para este tenant.');
      if (saved.simulated !== simulatedNow) throw new ConflictException('Ese respaldo fue simulado y no sirve para una restauración real (o al revés).');
      backup = { backup_id: saved.id, sha256: saved.sha256 };
    } else if (action === 'backup') {
      backup = { backup_id: randomUUID(), sha256: null };
    }

    // La condición sobre el estado previo hace de bloqueo: solo una operación mutante por tenant, también entre procesos.
    const claimed = await this.tenants.createQueryBuilder().update(Tenant).set({ status: rule.busy })
      .where('slug = :slug AND status IN (:...from)', { slug, from: rule.from }).execute();
    if (claimed.affected !== 1) throw new ConflictException('Otra operación cambió el estado del tenant; no se inició esta.');

    const operationId = randomUUID();
    const simulated = simulatedNow;
    await this.audit.record({
      actor, action: rule.audit, status: 'STARTED', tenant_slug: slug, operation_id: operationId, stage: 'queued',
      message: `${simulated ? '[SIMULADO] ' : ''}${rule.verb} tenant solicitado desde el panel.`,
      detail: { estado_previo: tenant.status, motor: tenant.engine, simulated: simulated },
    });
    this.run(tenant, action, actor, operationId, result, simulated, backup);
    return (await this.operation(slug))!;
  }

  /** Última operación de ciclo de vida del tenant, reconstruida desde la auditoría (sobrevive a reinicios). */
  async operation(slug: string): Promise<LifecycleOperation | null> {
    this.slugOrThrow(slug);
    const id = await this.audit.latestOperationId(slug, OPERATION_AUDIT);
    if (!id) return null;
    const events = (await this.audit.operation(id)).filter(event => OPERATION_AUDIT.includes(event.action));
    if (!events.length) return null;
    const first = events[0];
    const last = events[events.length - 1];
    const terminal = [...events].reverse().find(event => event.status === 'SUCCEEDED' || event.status === 'FAILED');
    const status: OperationStatus = terminal ? (terminal.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED') : 'RUNNING';
    const action = first.action === 'CREATE' ? 'create' : (Object.keys(RULES) as LifecycleAction[]).find(key => RULES[key].audit === first.action) ?? 'suspend';
    return {
      operation_id: id, tenant_slug: slug, action, status, stage: last.stage ?? 'queued', actor: first.actor,
      simulated: first.detail.simulated === true, started_at: first.occurred_at, events,
      error: status === 'FAILED' ? (terminal?.message ?? null) : null,
    };
  }

  private run(tenant: Tenant, action: LifecycleAction, actor: string, operationId: string, result: ProvisioningResult | null, simulated: boolean,
              backup: { backup_id: string; sha256: string | null } | null): void {
    const rule = RULES[action];
    const slug = tenant.slug;
    let queue: Promise<void> = Promise.resolve();
    const log = (status: AuditEventRecord['status'], stage: string, message: string): void => {
      queue = queue.then(() => this.audit.record({ actor, action: rule.audit, status, tenant_slug: slug, operation_id: operationId, stage, message,
        detail: { simulated } }));
    };
    const child = spawn(process.platform === 'win32' ? 'python' : 'python3', ['scripts/lifecycle_worker.py'],
      { cwd: REPO_ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.children.set(slug, child);
    let buffer = '';
    let outcome: WorkerEvent | undefined;
    let failure: { message: string; safe: boolean } | undefined;
    const fail = (message: string, safe = false): void => {
      if (failure) return;
      failure = { message, safe };
      child.kill();
    };
    const timer = setTimeout(() => fail('La operación excedió el límite de tiempo. Inspecciona AWS antes de reintentar.'), TIMEOUT_MS);
    child.stderr.resume();
    const consume = (line: string): void => {
      if (!line.trim() || failure) return;
      try {
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        const event = value as WorkerEvent;
        if (!WORKER_STAGES.has(event.stage) || !['running', 'succeeded', 'failed'].includes(event.status)) throw new Error();
        if (event.stage === 'result') { outcome = event; return; }
        if (typeof event.message !== 'string' || event.message.length > 240 || /[\u0000-\u001f]/.test(event.message)) throw new Error();
        if (event.status === 'failed') { fail(event.message, event.safe === true); return; }
        log('RUNNING', event.stage, event.message);
      } catch {
        fail('El proceso local devolvió un evento inválido; se detuvo sin exponer su salida.');
      }
    };
    child.stdout.on('data', (data: Buffer) => {
      buffer += data.toString('utf8');
      if (buffer.length > 65536) { fail('La salida del worker excedió el límite permitido.'); return; }
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      lines.forEach(consume);
    });
    child.on('error', () => fail('No se pudo iniciar el worker local.', true));
    child.on('close', code => {
      clearTimeout(timer);
      this.children.delete(slug);
      if (buffer) consume(buffer);
      const done = !failure && code === 0 && outcome ? this.validOutcome(action, outcome, backup) : undefined;
      const problem = failure ?? (done === undefined ? { message: 'El worker no completó la operación. Inspecciona AWS antes de reintentar.', safe: false } : undefined);
      void queue.then(() => this.finish(tenant, action, actor, operationId, result, simulated, problem, done ?? null));
    });
    child.stdin.on('error', () => fail('No se pudo enviar la solicitud al worker local.', true));
    child.stdin.end(JSON.stringify({
      action, simulate: simulated,
      tenant: { slug, region: tenant.region, engine: tenant.engine, request_id: tenant.id, plan_slug: tenant.plan_slug }, result, backup,
    }));
  }

  /** Para reanudar exige las tres direcciones nuevas; para el resto basta el resultado exitoso. */
  private validOutcome(action: LifecycleAction, event: WorkerEvent, expected: { backup_id: string } | null): WorkerResult | undefined {
    if (event.status !== 'succeeded') return undefined;
    if (action === 'backup') {
      const value = event.backup as Partial<BackupOutcome> | undefined;
      if (!expected || !value || value.backup_id !== expected.backup_id || !Number.isSafeInteger(value.size_bytes) || (value.size_bytes as number) < 0
          || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) return undefined;
      const checked: BackupOutcome = { backup_id: expected.backup_id, size_bytes: value.size_bytes as number, sha256: value.sha256 };
      return { backup: checked } as WorkerResult;
    }
    if (action !== 'resume') return {};
    const nodes = event.nodes as Record<string, { public_ip?: unknown; private_ip?: unknown }> | undefined;
    if (!nodes || typeof nodes !== 'object') return undefined;
    const clean = {} as Record<string, { public_ip: string | null; private_ip: string }>;
    for (const role of SERVER_ROLES) {
      const node = nodes[role];
      if (!node || typeof node.private_ip !== 'string' || isIP(node.private_ip) !== 4
          || (node.public_ip !== null && (typeof node.public_ip !== 'string' || isIP(node.public_ip) !== 4))) return undefined;
      clean[role] = { public_ip: node.public_ip as string | null, private_ip: node.private_ip };
    }
    return clean as WorkerNodes;
  }

  private async finish(tenant: Tenant, action: LifecycleAction, actor: string, operationId: string, result: ProvisioningResult | null,
    simulated: boolean, problem: { message: string; safe: boolean } | undefined, outcome: WorkerResult | null): Promise<void> {
    const nodes = outcome;
    const rule = RULES[action];
    const slug = tenant.slug;
    const fresh = await this.tenants.findOneBy({ slug });
    const base = fresh?.resources ?? tenant.resources ?? {};
    try {
      if (problem) {
        // Un fallo anterior a cualquier cambio en AWS devuelve el tenant a su estado previo; si pudo cambiar algo, queda en ERROR.
        const status = problem.safe ? tenant.status : 'ERROR';
        await this.tenants.update({ slug, status: rule.busy }, { status, resources: { ...base, lifecycle_error: { action, at: new Date().toISOString() } } });
        await this.audit.record({ actor, action: rule.audit, status: 'FAILED', tenant_slug: slug, operation_id: operationId, stage: 'failed',
          message: `${problem.message}${problem.safe ? ' El tenant conserva su estado anterior.' : ' Revisa AWS antes de reintentar.'}`,
          detail: { simulated, estado_resultante: status } });
        return;
      }
      const stamp = new Date().toISOString();
      if (action === 'backup' || action === 'restore') {
        // El tenant sigue activo y conserva URL y direcciones: solo vuelve a su estado estable.
        if (action === 'backup' && outcome && 'backup' in outcome) {
          await this.backups.insert({ id: outcome.backup.backup_id, tenant_slug: slug, actor, size_bytes: String(outcome.backup.size_bytes), sha256: outcome.backup.sha256, simulated });
        }
        await this.tenants.query('UPDATE tenants SET status = $1, resources = $2::jsonb WHERE slug = $3 AND status = $4',
          [rule.done, JSON.stringify({ ...base, lifecycle: { last: action, at: stamp, simulated } }), slug, rule.busy]);
      } else if (action === 'resume' && nodes && 'frontend' in nodes && result) {
        const resumed = nodes as WorkerNodes;
        const updatedResult = { ...result, nodes: Object.fromEntries(SERVER_ROLES.map(role => [role,
          { ...result.nodes[role], private_ip: resumed[role].private_ip, public_ip: resumed[role].public_ip }])) };
        const url = resumed.frontend.public_ip ? `https://${resumed.frontend.public_ip}` : null;
        await this.tenants.query(
          `UPDATE tenants SET status = $1, resources = $2::jsonb, access_url = $3, frontend_public_ip = $4::inet,
             backend_private_ip = $5::inet, db_private_ip = $6::inet WHERE slug = $7 AND status = $8`,
          [rule.done, JSON.stringify({ ...base, provisioning_result: updatedResult, lifecycle: { last: 'resume', at: stamp, simulated } }), url,
            resumed.frontend.public_ip, resumed.backend.private_ip, resumed.database.private_ip, slug, rule.busy]);
        await this.targets.sync(slug, tenant.environment, resumed, actor, operationId);
      } else {
        // Suspender libera la IP pública y eliminar borra la infraestructura: se limpian URL y direcciones.
        await this.tenants.query(
          `UPDATE tenants SET status = $1, resources = $2::jsonb, access_url = NULL, frontend_public_ip = NULL WHERE slug = $3 AND status = $4`,
          [rule.done, JSON.stringify({ ...base, lifecycle: { last: action, at: stamp, simulated } }), slug, rule.busy]);
        await this.targets.sync(slug, tenant.environment, null, actor, operationId);
      }
      await this.audit.record({ actor, action: rule.audit, status: 'SUCCEEDED', tenant_slug: slug, operation_id: operationId, stage: 'complete',
        message: `${simulated ? '[SIMULADO] ' : ''}${rule.verb} completado; el tenant quedó en ${rule.done}.`, detail: { simulated, estado_resultante: rule.done } });
    } catch {
      await this.tenants.update({ slug, status: rule.busy }, { status: 'ERROR' });
      await this.audit.record({ actor, action: rule.audit, status: 'FAILED', tenant_slug: slug, operation_id: operationId, stage: 'persistence',
        message: 'No se pudo guardar el resultado; requiere reconciliación manual antes de reintentar.', detail: { simulated } });
    }
  }
}
