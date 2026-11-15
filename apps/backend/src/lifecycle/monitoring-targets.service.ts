import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { SERVER_ROLES, type ServerRole } from '@modulo2/contracts';
import { AuditService } from '../audit/audit.service';
import { REPO_ROOT } from '../paths';

export type TargetNodes = Record<ServerRole, { public_ip: string | null; private_ip: string }>;

/**
 * Registra o retira los targets de Prometheus de un tenant con scripts/update_monitoring_targets.py.
 * Solo escribe el archivo de targets; no comprueba conectividad ni toca AWS.
 */
@Injectable()
export class MonitoringTargetsService {
  constructor(private readonly audit: AuditService) {}

  /** Con nodes registra las tres direcciones del tenant; con null retira sus targets. */
  async sync(slug: string, environment: string, nodes: TargetNodes | null, actor: string, operationId: string | null): Promise<void> {
    const args = ['scripts/update_monitoring_targets.py', '--tenant', slug, '--environment', environment];
    if (nodes) {
      args.push('--frontend', nodes.frontend.public_ip ?? nodes.frontend.private_ip,
        '--backend', nodes.backend.private_ip, '--database', nodes.database.private_ip);
    } else {
      args.push('--remove');
    }
    const ok = await new Promise<boolean>(resolve => {
      const child = spawn(process.platform === 'win32' ? 'python' : 'python3', args, { cwd: REPO_ROOT, windowsHide: true });
      child.stdout.resume();
      child.stderr.resume();
      child.on('error', () => resolve(false));
      child.on('close', code => resolve(code === 0));
    });
    await this.audit.record({
      actor, action: 'MONITORING_TARGETS', status: ok ? 'INFO' : 'FAILED', tenant_slug: slug, operation_id: operationId,
      stage: 'monitoring',
      message: ok ? (nodes ? 'Targets de monitoreo registrados.' : 'Targets de monitoreo retirados.') : 'No se pudieron actualizar los targets de monitoreo.',
      detail: { roles: nodes ? SERVER_ROLES.join(',') : 'ninguno' },
    });
  }
}
