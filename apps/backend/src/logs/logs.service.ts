import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import { Repository } from 'typeorm';
import { SERVER_ROLES, TENANT_SLUG_PATTERN, type LogSource, type ProvisioningResult, type ServerRole, type TenantLogs } from '@modulo2/contracts';
import { AuditService, cleanText } from '../audit/audit.service';
import { Tenant } from '../database/entities';

interface SourceDefinition { id: string; label: string; role: ServerRole; description: string; command: (slug: string, lines: number) => string }

/** Fuentes de log permitidas. El comando remoto sale siempre de esta lista: el cliente solo elige una por su identificador. */
const SOURCES: SourceDefinition[] = [
  { id: 'frontend-acceso', label: 'Frontend · Nginx (accesos)', role: 'frontend', description: 'Peticiones que recibe el tenant.',
    command: (_slug, n) => `sudo -n tail -n ${n} /var/log/nginx/access.log` },
  { id: 'frontend-errores', label: 'Frontend · Nginx (errores)', role: 'frontend', description: 'Errores del servidor web y del proxy hacia el backend.',
    command: (_slug, n) => `sudo -n tail -n ${n} /var/log/nginx/error.log` },
  { id: 'frontend-metricas', label: 'Frontend · exporter de métricas', role: 'frontend', description: 'Servicio que alimenta Grafana con las peticiones.',
    command: (slug, n) => `sudo -n journalctl -u campus-cloud-metrics-${slug}.service -n ${n} --no-pager -o short-iso` },
  { id: 'frontend-sistema', label: 'Frontend · sistema (avisos y errores)', role: 'frontend', description: 'Registro del sistema operativo, de nivel aviso o superior.',
    command: (_slug, n) => `sudo -n journalctl -p warning -n ${n} --no-pager -o short-iso` },
  { id: 'backend-aplicacion', label: 'Backend · aplicación de asistencia', role: 'backend', description: 'Salida del servicio de la aplicación (Gunicorn y Django).',
    command: (slug, n) => `sudo -n journalctl -u campus-cloud-${slug}.service -n ${n} --no-pager -o short-iso` },
  { id: 'backend-sistema', label: 'Backend · sistema (avisos y errores)', role: 'backend', description: 'Registro del sistema operativo, de nivel aviso o superior.',
    command: (_slug, n) => `sudo -n journalctl -p warning -n ${n} --no-pager -o short-iso` },
  { id: 'database-postgres', label: 'Base de datos · PostgreSQL', role: 'database', description: 'Registro del servidor PostgreSQL del tenant.',
    command: (_slug, n) => `sudo -n sh -c 'tail -n ${n} /var/log/postgresql/postgresql-16-main.log 2>/dev/null || journalctl -u "postgresql*" -n ${n} --no-pager -o short-iso'` },
  { id: 'database-sistema', label: 'Base de datos · sistema (avisos y errores)', role: 'database', description: 'Registro del sistema operativo, de nivel aviso o superior.',
    command: (_slug, n) => `sudo -n journalctl -p warning -n ${n} --no-pager -o short-iso` },
];

const SENSITIVE = /pass(word|wd)?\b|passw|secret|token|vault|authorization|credential|contrase|clave|private[_ -]?key|jwt|api[_-]?key|cookie|BEGIN [A-Z ]*KEY/i;
// Avisos que trae la imagen base de AWS y no indican ningún problema del tenant (hardware que una máquina virtual no tiene).
const RUIDO_SISTEMA = /i8042: Warning|Failed to populate \/etc with preset|regulatory\.db|openipmi\.service|OpenIPMI|faux_driver|Special user nobody configured/i;
const MAX_LINES = 500;
const MAX_BYTES = 400_000;
const LOCAL_ADDRESSES = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

/** Visor de logs de los tenants: lee por SSH (a través del bastión) el registro de cada servidor, sin instalar agentes. */
@Injectable()
export class LogsService {
  /** Reemplazable en pruebas para no abrir conexiones reales. */
  runner: (executable: string, args: string[]) => Promise<{ stdout: string; code: number }> = (executable, args) => new Promise(resolve => {
    execFile(executable, args, { timeout: 30_000, maxBuffer: MAX_BYTES * 2, windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
      resolve({ stdout: stdout ?? '', code: error ? (typeof error.code === 'number' ? error.code : 1) : 0 });
    });
  });

  constructor(@InjectRepository(Tenant) private readonly tenants: Repository<Tenant>, private readonly audit: AuditService) {}

  /** Disponible solo con la demo local real y la llave SSH de WSL (mismos requisitos que los túneles y los respaldos). */
  enabled(): boolean {
    return process.env.LIFECYCLE_SIMULATE !== 'true' && process.env.DEMO_PROVISIONING_LOCAL === 'true'
      && /^\/[\w./-]+$/.test(process.env.DEMO_SSH_PRIVATE_KEY_WSL_PATH ?? '')
      && (process.env.HOST === undefined || process.env.HOST === '127.0.0.1');
  }

  requireLocal(address: string | undefined): void {
    if (!LOCAL_ADDRESSES.includes(address ?? '')) throw new ForbiddenException('Los logs solo se consultan desde el panel local.');
  }

  list(): LogSource[] {
    return SOURCES.map(({ id, label, role, description }) => ({ id, label, role, description }));
  }

  private nodes(tenant: Tenant): ProvisioningResult['nodes'] {
    const result = tenant.resources?.provisioning_result as ProvisioningResult | undefined;
    if (!result?.nodes) throw new ConflictException('El tenant no tiene un resultado de aprovisionamiento confiable.');
    for (const role of SERVER_ROLES) {
      const node = result.nodes[role];
      if (!node || isIP(node.private_ip) !== 4 || (node.public_ip !== null && isIP(node.public_ip) !== 4)) throw new ConflictException('Las direcciones del tenant no son válidas.');
    }
    return result.nodes;
  }

  private command(role: ServerRole, nodes: ProvisioningResult['nodes'], remote: string): { executable: string; args: string[] } {
    const key = process.env.DEMO_SSH_PRIVATE_KEY_WSL_PATH as string;
    const frontend = nodes.frontend.public_ip;
    if (!frontend) throw new ConflictException('El frontend no tiene IP pública; el tenant debe estar en ejecución.');
    const target = role === 'frontend' ? frontend : nodes[role].private_ip;
    const args = ['ssh', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-i', key];
    if (role !== 'frontend') args.push('-o', `ProxyCommand=ssh -W %h:%p -q -o StrictHostKeyChecking=accept-new -i ${key} ubuntu@${frontend}`);
    args.push(`ubuntu@${target}`, remote);
    if (process.platform !== 'win32') return { executable: args[0], args: args.slice(1) };
    const distro = /^[A-Za-z0-9._-]{1,60}$/.test(process.env.WSL_DISTRO ?? '') ? ['-d', process.env.WSL_DISTRO as string] : [];
    return { executable: 'wsl.exe', args: [...distro, '--exec', ...args] };
  }

  /** Oculta las líneas con datos sensibles, acota el largo de cada línea y quita saltos o secuencias de control. */
  static clean(raw: string): string[] {
    return raw.split(/\r?\n/).filter(line => line.trim()).map(line => {
      const text = line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ').slice(0, 400);
      return SENSITIVE.test(text) ? '[línea omitida: puede contener datos sensibles]' : text;
    });
  }

  /** Últimas líneas de una fuente de log del tenant. Con initial=true queda constancia en la auditoría. */
  async fetch(slug: string, sourceId: string, requested: number, actor: string, initial: boolean): Promise<TenantLogs> {
    if (!this.enabled()) throw new ForbiddenException('La consulta de logs requiere la demo local real (DEMO_PROVISIONING_LOCAL=true, sin simulación).');
    if (!TENANT_SLUG_PATTERN.test(slug)) throw new NotFoundException('No existe el tenant solicitado.');
    const source = SOURCES.find(item => item.id === sourceId);
    if (!source) throw new BadRequestException('Fuente de log desconocida.');
    const lines = Math.min(Math.max(Math.trunc(requested) || 200, 10), MAX_LINES);
    const tenant = await this.tenants.findOneBy({ slug });
    if (!tenant) throw new NotFoundException('No existe el tenant solicitado.');
    if (tenant.status !== 'ACTIVE') throw new ConflictException(`El tenant está en estado ${tenant.status}; los logs requieren los servidores en ejecución.`);
    const { executable, args } = this.command(source.role, this.nodes(tenant), source.command(slug, lines));
    const { stdout, code } = await this.runner(executable, args);
    if (code !== 0 && !stdout.trim()) throw new ServiceUnavailableException('No se pudo leer el log del servidor; revisa que el tenant responda por SSH.');
    if (initial) {
      await this.audit.record({ actor, action: 'LOGS_VIEW', status: 'INFO', tenant_slug: slug, message: `Consulta de logs: ${cleanText(source.label, 80)}.`, detail: { fuente: source.id, lineas: lines } });
    }
    const cleaned = LogsService.clean(stdout.slice(-MAX_BYTES)).filter(line => !source.id.endsWith('-sistema') || !RUIDO_SISTEMA.test(line));
    return { tenant_slug: slug, source: source.id, label: source.label, fetched_at: new Date().toISOString(), lines: cleaned.slice(-lines), truncated: stdout.length >= MAX_BYTES };
  }
}
