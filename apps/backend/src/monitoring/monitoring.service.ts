import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { timingSafeEqual } from 'node:crypto';
import { Repository } from 'typeorm';
import { TENANT_SLUG_PATTERN, type MonitoringStatus, type TenantAlertRecord } from '@modulo2/contracts';
import { cleanText } from '../audit/audit.service';
import { Tenant, TenantAlert } from '../database/entities';
import { TunnelsService } from './tunnels.service';

const SEVERITIES = ['critical', 'warning', 'info'];

/** RF-28 y RF-29: recibe las alertas de Grafana, las guarda con su tenant y hora y las expone al panel. */
@Injectable()
export class MonitoringService {
  constructor(@InjectRepository(TenantAlert) private readonly alerts: Repository<TenantAlert>, @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
              private readonly tunnels: TunnelsService) {}

  /** El webhook se autentica con el token compartido (Authorization: Bearer o X-Webhook-Token); sin token configurado, no acepta nada. */
  checkToken(header: string | undefined, webhookHeader: string | undefined): void {
    const expected = process.env.WEBHOOK_TOKEN ?? '';
    const given = (header?.startsWith('Bearer ') ? header.slice(7) : webhookHeader) ?? '';
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException('Token de webhook inválido.');
  }

  /**
   * Procesa el cuerpo del webhook de Grafana. Cada alerta se identifica por su huella: al dispararse se crea la fila
   * y al resolverse se actualiza. Se ignoran las alertas sin un tenant existente del panel.
   */
  async receive(body: unknown): Promise<{ received: number; stored: number; ignored: number }> {
    const list = (body && typeof body === 'object' && Array.isArray((body as { alerts?: unknown }).alerts)) ? (body as { alerts: unknown[] }).alerts.slice(0, 50) : [];
    let stored = 0;
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const labels = (item.labels ?? {}) as Record<string, unknown>;
      const annotations = (item.annotations ?? {}) as Record<string, unknown>;
      const slug = typeof labels.tenant === 'string' ? labels.tenant : '';
      const fingerprint = typeof item.fingerprint === 'string' && /^[A-Za-z0-9_-]{4,80}$/.test(item.fingerprint) ? item.fingerprint : '';
      if (!TENANT_SLUG_PATTERN.test(slug) || !fingerprint || !(await this.tenants.existsBy({ slug }))) continue;
      const resolved = item.status === 'resolved';
      const severity = SEVERITIES.includes(String(labels.severity)) ? String(labels.severity) : 'warning';
      const startsAt = typeof item.startsAt === 'string' && !Number.isNaN(Date.parse(item.startsAt)) && Date.parse(item.startsAt) > 0 ? new Date(item.startsAt) : new Date();
      const endsAt = typeof item.endsAt === 'string' && Date.parse(item.endsAt) > Date.parse('2000-01-01') ? new Date(item.endsAt) : new Date();
      const values = {
        tenant_slug: slug, title: cleanText(labels.alertname ?? 'Alerta', 200), severity, status: resolved ? 'RESOLVED' : 'FIRING',
        role: typeof labels.role === 'string' ? cleanText(labels.role, 20) : null, summary: cleanText(annotations.summary ?? annotations.description ?? '', 300) || null,
      };
      const existing = await this.alerts.findOneBy({ fingerprint });
      if (existing) {
        await this.alerts.update({ id: existing.id }, { ...values, resolved_at: resolved ? endsAt : null, ...(resolved ? {} : { detected_at: startsAt }) });
      } else {
        await this.alerts.insert({ ...values, fingerprint, detected_at: startsAt, resolved_at: resolved ? endsAt : null });
      }
      stored += 1;
    }
    return { received: list.length, stored, ignored: list.length - stored };
  }

  /** Alertas y eventos recientes (RF-29), con filtros por tenant y estado. */
  async list(filters: { tenant?: string; status?: string; limit?: number }): Promise<TenantAlertRecord[]> {
    const query = this.alerts.createQueryBuilder('a');
    if (filters.tenant && TENANT_SLUG_PATTERN.test(filters.tenant)) query.andWhere('a.tenant_slug = :tenant', { tenant: filters.tenant });
    if (filters.status === 'FIRING' || filters.status === 'RESOLVED') query.andWhere('a.status = :status', { status: filters.status });
    const rows = await query.orderBy('a.detected_at', 'DESC').take(Math.min(Math.max(Math.trunc(filters.limit ?? 50) || 50, 1), 200)).getMany();
    return rows.map(row => ({
      id: row.id, tenant_slug: row.tenant_slug, title: row.title, severity: row.severity, status: row.status as 'FIRING' | 'RESOLVED', role: row.role,
      summary: row.summary, detected_at: new Date(row.detected_at).toISOString(), resolved_at: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
    }));
  }

  /** Enlaces a Grafana y Prometheus y estado de los túneles hacia los tenants. */
  status(): MonitoringStatus {
    const grafana = `http://localhost:${/^\d{2,5}$/.test(process.env.GRAFANA_PORT ?? '') ? process.env.GRAFANA_PORT : '3002'}`;
    return {
      grafana_url: grafana, dashboard_url: `${grafana}/d/tenant-health`, prometheus_url: 'http://localhost:9090',
      tunnels_enabled: this.tunnels.enabled(), webhook_configured: Boolean(process.env.WEBHOOK_TOKEN), tunnels: this.tunnels.status(),
    };
  }
}
