import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { TunnelsService, type TargetNodes } from '../monitoring/tunnels.service';

export type { TargetNodes };

/**
 * Registra o retira el monitoreo de un tenant: abre o cierra sus túneles SSH y los targets de Prometheus.
 * Con los túneles deshabilitados (simulación o sin demo local) solo deja constancia en la auditoría.
 */
@Injectable()
export class MonitoringTargetsService {
  constructor(private readonly audit: AuditService, private readonly tunnels: TunnelsService) {}

  /** Con nodes abre el monitoreo del tenant; con null lo retira. */
  async sync(slug: string, environment: string, nodes: TargetNodes | null, actor: string, operationId: string | null): Promise<void> {
    let ok = true;
    let message: string;
    if (!this.tunnels.enabled()) {
      message = nodes ? 'Monitoreo local deshabilitado en este equipo: no se abrieron túneles ni targets.' : 'Monitoreo local deshabilitado: no había túneles que cerrar.';
    } else {
      try {
        if (nodes) await this.tunnels.ensure(slug, environment, nodes); else await this.tunnels.close(slug);
        message = nodes ? 'Túneles SSH y targets de Prometheus registrados (node_exporter, PostgreSQL y sonda HTTPS).' : 'Túneles y targets de monitoreo retirados.';
      } catch {
        ok = false;
        message = 'No se pudo actualizar el monitoreo del tenant.';
      }
    }
    await this.audit.record({ actor, action: 'MONITORING_TARGETS', status: ok ? 'INFO' : 'FAILED', tenant_slug: slug, operation_id: operationId, stage: 'monitoring', message,
      detail: { activo: nodes ? true : false, habilitado: this.tunnels.enabled() } });
  }
}
