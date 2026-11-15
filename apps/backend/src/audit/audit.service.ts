import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AuditAction, AuditEventRecord, AuditList, AuditStatus } from '@modulo2/contracts';
import { AuditEvent } from '../database/entities';

export interface AuditInput {
  actor: string; action: AuditAction; status: AuditStatus; message: string;
  tenant_slug?: string | null; operation_id?: string | null; stage?: string | null; detail?: Record<string, unknown>;
}
export interface AuditFilters { tenant?: string; action?: string; status?: string; actor?: string; from?: string; to?: string; limit?: number; offset?: number; }

const SENSITIVE = /pass|secret|token|key|credential|vault/i;
const CONTROL = /[\u0000-\u001f\u007f]+/g;

/** Texto de una sola línea y de longitud acotada; evita inyectar saltos de línea en el registro. */
export function cleanText(value: unknown, max: number): string {
  return String(value ?? '').replace(CONTROL, ' ').trim().slice(0, max);
}

/** Deja solo valores simples con claves seguras: nunca se guardan secretos en la auditoría. */
export function cleanDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail ?? {}).slice(0, 20)) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key) || SENSITIVE.test(key)) continue;
    if (typeof value === 'string') result[key] = cleanText(value, 120);
    else if (typeof value === 'number' || typeof value === 'boolean' || value === null) result[key] = value;
  }
  return result;
}

/** RF-20: registro de solo inserción de quién inició cada operación, cuándo y con qué resultado. */
@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditEvent) private readonly events: Repository<AuditEvent>) {}

  /** Registra un evento. Un fallo de auditoría nunca interrumpe la operación original. */
  async record(input: AuditInput): Promise<void> {
    try {
      await this.events.save(this.events.create({
        actor: cleanText(input.actor, 60) || 'desconocido', action: input.action, status: input.status,
        tenant_slug: input.tenant_slug ?? null, operation_id: input.operation_id ?? null,
        stage: input.stage ? cleanText(input.stage, 40) : null, message: cleanText(input.message, 240) || '(sin mensaje)',
        detail: cleanDetail(input.detail),
      }));
    } catch {
      console.error('No se pudo registrar un evento de auditoría.');
    }
  }

  private toRecord(row: AuditEvent): AuditEventRecord {
    return {
      id: String(row.id), occurred_at: new Date(row.occurred_at).toISOString(), actor: row.actor, action: row.action as AuditAction,
      status: row.status as AuditStatus, tenant_slug: row.tenant_slug, operation_id: row.operation_id, stage: row.stage,
      message: row.message, detail: row.detail ?? {},
    };
  }

  /** Lista paginada con filtros; los valores siempre viajan como parámetros. */
  async list(filters: AuditFilters): Promise<AuditList> {
    const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Math.trunc(filters.offset ?? 0) || 0, 0);
    const query = this.events.createQueryBuilder('e');
    if (filters.tenant) query.andWhere('e.tenant_slug = :tenant', { tenant: filters.tenant });
    if (filters.action) query.andWhere('e.action = :action', { action: filters.action });
    if (filters.status) query.andWhere('e.status = :status', { status: filters.status });
    if (filters.actor) query.andWhere('e.actor = :actor', { actor: filters.actor });
    if (filters.from && !Number.isNaN(Date.parse(filters.from))) query.andWhere('e.occurred_at >= :from', { from: new Date(filters.from) });
    if (filters.to && !Number.isNaN(Date.parse(filters.to))) query.andWhere('e.occurred_at <= :to', { to: new Date(filters.to) });
    const [rows, total] = await query.orderBy('e.occurred_at', 'DESC').addOrderBy('e.id', 'DESC').take(limit).skip(offset).getManyAndCount();
    return { data: rows.map(row => this.toRecord(row)), meta: { total, limit, offset } };
  }

  /** Línea de tiempo completa de una operación, en orden cronológico. */
  async operation(operationId: string): Promise<AuditEventRecord[]> {
    if (!/^[0-9a-f-]{36}$/.test(operationId)) return [];
    const rows = await this.events.find({ where: { operation_id: operationId }, order: { occurred_at: 'ASC', id: 'ASC' } });
    return rows.map(row => this.toRecord(row));
  }

  /** Última operación (por identificador) de un tenant para las acciones indicadas. */
  async latestOperationId(slug: string, actions: string[]): Promise<string | null> {
    const row = await this.events.createQueryBuilder('e').select('e.operation_id', 'operation_id')
      .where('e.tenant_slug = :slug AND e.operation_id IS NOT NULL AND e.action IN (:...actions)', { slug, actions })
      .orderBy('e.occurred_at', 'DESC').addOrderBy('e.id', 'DESC').limit(1).getRawOne<{ operation_id: string }>();
    return row?.operation_id ?? null;
  }
}
