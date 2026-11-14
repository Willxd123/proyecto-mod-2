import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantAlert } from '../database/entities';

interface AlertmanagerPayload {
  alerts?: Array<{
    status: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    startsAt: string;
  }>;
}

@Injectable()
export class MonitoringService {
  constructor(
    @InjectRepository(TenantAlert)
    private readonly alertRepo: Repository<TenantAlert>,
  ) {}

  /** Configuración del servidor de observabilidad leída de variables de entorno.
   *  Nunca se exponen contraseñas; solo el usuario de Grafana para que el frontend
   *  pueda mostrar la información de acceso (RF-25). */
  getConfig() {
    return {
      data: {
        server:        process.env.OBS_SERVER_IP    ?? null,
        grafana_user:  process.env.GRAFANA_ADMIN_USER ?? 'admin',
        grafana_port:  Number(process.env.GRAFANA_PORT ?? 3000),
        prometheus_port: Number(process.env.PROMETHEUS_PORT ?? 9090),
        monitoring_enabled: !!(process.env.OBS_SERVER_IP),
      },
    };
  }

  /** Lista alertas almacenadas, opcionalmente filtradas por tenant (RF-28). */
  async listAlerts(tenant?: string) {
    const where = tenant ? { tenant_slug: tenant } : {};
    const alerts = await this.alertRepo.find({
      where,
      order: { detected_at: 'DESC' },
      take: 100,
    });
    return { data: alerts };
  }

  /** Recibe el payload de Alertmanager y persiste las alertas en tenant_alerts (RF-28). */
  async processAlertmanagerPayload(payload: unknown) {
    const body = payload as AlertmanagerPayload;
    const alerts = body?.alerts ?? [];
    const saved: TenantAlert[] = [];

    for (const alert of alerts) {
      const tenantSlug = alert.labels?.['tenant'];
      if (!tenantSlug) continue;   // ignorar alertas sin etiqueta tenant

      const entity = this.alertRepo.create({
        tenant_slug:  tenantSlug,
        title:        alert.annotations?.['summary'] ?? alert.labels?.['alertname'] ?? 'Alerta sin título',
        severity:     alert.labels?.['severity'] ?? 'unknown',
        status:       alert.status === 'resolved' ? 'RESOLVED' : 'FIRING',
        detected_at:  new Date(alert.startsAt),
      });

      saved.push(await this.alertRepo.save(entity));
    }

    return { data: { received: alerts.length, persisted: saved.length } };
  }
}
