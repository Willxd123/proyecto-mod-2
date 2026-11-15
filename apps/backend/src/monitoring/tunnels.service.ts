import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { Repository } from 'typeorm';
import { SERVER_ROLES, type MonitoringTunnel, type ProvisioningResult, type ServerRole } from '@modulo2/contracts';
import { Tenant } from '../database/entities';
import { REPO_ROOT } from '../paths';

export type TargetNodes = Record<ServerRole, { public_ip: string | null; private_ip: string }>;
type TunnelRole = ServerRole | 'postgres';

interface TunnelState { slug: string; role: TunnelRole; port: number; remote: number; status: 'starting' | 'up' | 'down'; restarts: number;
  child?: ChildProcess; timer?: NodeJS.Timeout; wanted: boolean; command: { executable: string; args: string[] } }

const BASE_PORT = 19100;
const SLOT = 10;
const OBSERVABILITY = resolve(REPO_ROOT, 'infrastructure/observability/prometheus');

/**
 * Conecta Prometheus con los servidores de cada tenant sin abrir puertos en AWS: mantiene un túnel SSH por servidor
 * (por el bastión, con la llave local) hacia su node_exporter y, en la base de datos, hacia el postgres_exporter.
 * También escribe los archivos de targets que lee Prometheus. Solo funciona con la demo local habilitada.
 */
@Injectable()
export class TunnelsService implements OnModuleInit, OnApplicationShutdown {
  private readonly tunnels = new Map<string, TunnelState>();
  /** Reemplazable en pruebas para no lanzar procesos reales. */
  spawner: (executable: string, args: string[]) => ChildProcess = (executable, args) =>
    spawn(executable, args, { stdio: 'ignore', windowsHide: true });

  constructor(@InjectRepository(Tenant) private readonly tenants: Repository<Tenant>) {}

  /** Activo solo con la demo local real: nunca en simulación ni sin la llave SSH de WSL. */
  enabled(): boolean {
    return process.env.MONITORING_TUNNELS !== 'false' && process.env.LIFECYCLE_SIMULATE !== 'true'
      && process.env.DEMO_PROVISIONING_LOCAL === 'true' && /^\/[\w./-]+$/.test(process.env.DEMO_SSH_PRIVATE_KEY_WSL_PATH ?? '')
      && (process.env.HOST === undefined || process.env.HOST === '127.0.0.1');
  }

  /** Al arrancar la API, restablece los túneles de los tenants que ya estaban activos. */
  async onModuleInit(): Promise<void> {
    if (!this.enabled()) return;
    void this.reconcile().catch(() => console.error('No se pudieron restablecer los túneles de monitoreo.'));
  }

  private async reconcile(): Promise<void> {
    const rows = await this.tenants.find({ where: { status: 'ACTIVE' } });
    for (const tenant of rows) {
      const result = tenant.resources?.provisioning_result as ProvisioningResult | undefined;
      if (result?.nodes) await this.ensure(tenant.slug, tenant.environment, result.nodes);
    }
  }

  onApplicationShutdown(): void {
    for (const tunnel of this.tunnels.values()) { tunnel.wanted = false; if (tunnel.timer) clearTimeout(tunnel.timer); tunnel.child?.kill(); }
  }

  /** Puerto base del tenant: se reutiliza el ya asignado o se toma el primer bloque libre. */
  private async basePort(slug: string): Promise<number> {
    const rows = await this.tenants.query(`SELECT slug, (resources->'monitoring'->>'base_port')::int AS base FROM tenants WHERE resources->'monitoring'->>'base_port' IS NOT NULL`) as Array<{ slug: string; base: number }>;
    const own = rows.find(row => row.slug === slug);
    if (own) return own.base;
    const used = new Set(rows.map(row => row.base));
    let base = BASE_PORT;
    while (used.has(base)) base += SLOT;
    await this.tenants.query(`UPDATE tenants SET resources = jsonb_set(coalesce(resources, '{}'::jsonb), '{monitoring}', $1::jsonb) WHERE slug = $2`,
      [JSON.stringify({ base_port: base }), slug]);
    return base;
  }

  private command(role: TunnelRole, port: number, nodes: TargetNodes): { executable: string; args: string[] } {
    const key = process.env.DEMO_SSH_PRIVATE_KEY_WSL_PATH as string;
    const frontend = nodes.frontend.public_ip;
    const serverRole: ServerRole = role === 'postgres' ? 'database' : role;
    const target = serverRole === 'frontend' ? frontend : nodes[serverRole].private_ip;
    if (!frontend || isIP(frontend) !== 4 || !target || isIP(target) !== 4) throw new Error('Direcciones inválidas para el túnel.');
    const remote = role === 'postgres' ? 9187 : 9100;
    const args = ['ssh', '-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
      '-o', 'StrictHostKeyChecking=accept-new', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-i', key,
      '-L', `0.0.0.0:${port}:127.0.0.1:${remote}`];
    if (serverRole !== 'frontend') args.push('-o', `ProxyCommand=ssh -W %h:%p -q -o StrictHostKeyChecking=accept-new -i ${key} ubuntu@${frontend}`);
    args.push(`ubuntu@${target}`);
    if (process.platform !== 'win32') return { executable: args[0], args: args.slice(1) };
    const distro = /^[A-Za-z0-9._-]{1,60}$/.test(process.env.WSL_DISTRO ?? '') ? ['-d', process.env.WSL_DISTRO as string] : [];
    return { executable: 'wsl.exe', args: [...distro, '--exec', ...args] };
  }

  /** Abre (o reabre) los cuatro túneles del tenant y registra sus targets en Prometheus. */
  async ensure(slug: string, environment: string, nodes: TargetNodes): Promise<void> {
    if (!this.enabled()) return;
    await this.close(slug, false);
    const base = await this.basePort(slug);
    const roles: TunnelRole[] = [...SERVER_ROLES, 'postgres'];
    roles.forEach((role, index) => {
      const port = base + index;
      const state: TunnelState = { slug, role, port, remote: role === 'postgres' ? 9187 : 9100, status: 'starting', restarts: 0, wanted: true, command: this.command(role, port, nodes) };
      this.tunnels.set(`${slug}:${role}`, state);
      this.launch(state);
    });
    this.writeTargets(slug, environment, nodes, base);
  }

  private launch(state: TunnelState): void {
    if (!state.wanted) return;
    state.status = 'starting';
    const child = this.spawner(state.command.executable, state.command.args);
    state.child = child;
    const confirmed = setTimeout(() => { if (state.child === child && state.wanted) state.status = 'up'; }, 4000);
    child.on('error', () => undefined);
    child.on('exit', () => {
      clearTimeout(confirmed);
      if (state.child !== child) return;
      state.status = 'down';
      if (!state.wanted) return;
      state.restarts += 1;
      state.timer = setTimeout(() => this.launch(state), Math.min(5000 * state.restarts, 60000));
    });
  }

  /** Cierra los túneles del tenant y retira sus targets (al suspender o eliminar). */
  async close(slug: string, removeTargets = true): Promise<void> {
    for (const [key, tunnel] of [...this.tunnels]) {
      if (tunnel.slug !== slug) continue;
      tunnel.wanted = false;
      if (tunnel.timer) clearTimeout(tunnel.timer);
      tunnel.child?.kill();
      this.tunnels.delete(key);
    }
    if (removeTargets) this.removeTargets(slug);
  }

  private writeTargets(slug: string, environment: string, nodes: TargetNodes, base: number): void {
    const host = /^[A-Za-z0-9.-]{1,80}$/.test(process.env.MONITORING_TARGET_HOST ?? '') ? process.env.MONITORING_TARGET_HOST as string : 'host.docker.internal';
    const labels = (role: string) => ({ tenant: slug, environment, role, scope: 'tenant' });
    const files: Record<string, unknown> = {
      targets: SERVER_ROLES.map((role, index) => ({ targets: [`${host}:${base + index}`], labels: labels(role) })),
      'targets-postgres': [{ targets: [`${host}:${base + 3}`], labels: labels('database') }],
      'targets-http': [{ targets: [`https://${nodes.frontend.public_ip}/api/health`], labels: labels('app') }],
    };
    for (const [directory, content] of Object.entries(files)) {
      const folder = resolve(OBSERVABILITY, directory);
      mkdirSync(folder, { recursive: true });
      const target = resolve(folder, `tenant-${slug}.json`);
      writeFileSync(`${target}.tmp`, JSON.stringify(content, null, 2) + '\n', 'utf8');
      renameSync(`${target}.tmp`, target);
    }
  }

  private removeTargets(slug: string): void {
    for (const directory of ['targets', 'targets-postgres', 'targets-http']) rmSync(resolve(OBSERVABILITY, directory, `tenant-${slug}.json`), { force: true });
  }

  /** Estado actual de los túneles para el panel. */
  status(): MonitoringTunnel[] {
    return [...this.tunnels.values()].map(tunnel => ({ tenant_slug: tunnel.slug, role: tunnel.role, local_port: tunnel.port, status: tunnel.status, restarts: tunnel.restarts }));
  }
}
