import { BadRequestException, ConflictException, ForbiddenException, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Repository } from 'typeorm';
import {
  TENANT_SLUG_PATTERN,
  type SecurityScanFinding,
  type SecurityScannerId,
  type SecurityScannerSummary,
  type SecurityScanResult,
} from '@modulo2/contracts';
import { Tenant } from '../database/entities';
import { REPO_ROOT } from '../paths';

const SCANNER_IDS = new Set<SecurityScannerId>(['trivy', 'checkov', 'cfn-lint']);
const CATEGORIES = new Set(['secret', 'misconfig', 'lint']);
const SEVERITIES = new Set(['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

@Injectable()
export class SecurityService {
  private running = false;

  constructor(@Optional() @InjectRepository(Tenant) private readonly tenants?: Repository<Tenant>) {}

  enabled(): boolean {
    return process.env.SECURITY_SCAN_LOCAL === 'true'
      && (process.env.HOST === undefined || process.env.HOST === '127.0.0.1');
  }

  async scan(body: unknown): Promise<SecurityScanResult> {
    if (!this.enabled()) throw new ForbiddenException('Escaneo local deshabilitado.');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Solicitud inválida.');
    const input = body as Record<string, unknown>;
    if (Object.keys(input).join(',') !== 'tenant_slug' || typeof input.tenant_slug !== 'string'
        || !TENANT_SLUG_PATTERN.test(input.tenant_slug)) throw new BadRequestException('Identificador de tenant inválido.');
    if (this.running) throw new ConflictException('Ya hay un escaneo en curso.');
    this.running = true;
    try {
      await this.ensureHandoff(input.tenant_slug);
      return await this.run(input.tenant_slug);
    } finally {
      this.running = false;
    }
  }

  private async ensureHandoff(slug: string): Promise<void> {
    const requestFile = resolve(REPO_ROOT, 'output/handoff', slug, 'request.json');
    if (existsSync(requestFile) || !this.tenants) return;
    const tenant = await this.tenants.findOneBy({ slug });
    if (!tenant) return;
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const keyName = process.env.SSH_KEY_PAIR_NAME || 'practico7-asistencia';
      const args = [
        'scripts/prepare_handoff.py',
        '--tenant', tenant.slug,
        '--name', tenant.name,
        '--email', tenant.admin_email,
        '--plan', tenant.plan_slug,
        '--region', tenant.region,
        '--engine', tenant.engine,
        '--key-name', keyName,
        '--registry', 'config/golden-images.json',
        '--request-id', tenant.id,
      ];
      const child = spawn(process.platform === 'win32' ? 'python' : 'python3', args,
        { cwd: REPO_ROOT, windowsHide: true });
      child.stdout.resume();
      child.stderr.resume();
      child.on('error', () => rejectPromise(new ServiceUnavailableException('No se pudo preparar el paquete local del tenant.')));
      child.on('close', code => {
        if (code === 0 || existsSync(requestFile)) resolvePromise();
        else rejectPromise(new ServiceUnavailableException('No se pudo generar el paquete local del tenant para escanear.'));
      });
    });
  }

  private run(slug: string): Promise<SecurityScanResult> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(process.platform === 'win32' ? 'python' : 'python3',
        ['scripts/security_scan.py', '--tenant', slug], { cwd: REPO_ROOT, windowsHide: true });
      let output = '';
      let failed = false;
      child.stdout.on('data', (data: Buffer) => {
        output += data.toString();
        if (output.length > 65536 && !failed) {
          failed = true;
          child.kill();
          rejectPromise(new ServiceUnavailableException('El escáner devolvió una respuesta demasiado grande.'));
        }
      });
      child.stderr.resume();
      child.on('error', () => {
        if (!failed) {
          failed = true;
          rejectPromise(new ServiceUnavailableException('No se pudo iniciar el escáner local.'));
        }
      });
      child.on('close', code => {
        if (failed) return;
        if (code !== 0 && code !== 1) {
          rejectPromise(new ServiceUnavailableException('El escaneo falló. Verifique Trivy y el paquete local del tenant.'));
          return;
        }
        try {
          const value: unknown = JSON.parse(output);
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
          const result = value as SecurityScanResult;
          if (result.schema_version !== 1 || result.tenant_slug !== slug || result.scanner !== 'trivy'
              || typeof result.content_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(result.content_sha256)
              || !['clean', 'blocked'].includes(result.status) || !Array.isArray(result.findings)
              || !Array.isArray(result.scope) || result.scope.slice(0, 4).join(',') !== 'request.json,frontend.yaml,backend.yaml,database.yaml'
              || result.scope.length < 5 || result.scope.some(name => typeof name !== 'string'
                || !/^[A-Za-z0-9_./-]{1,200}$/.test(name) || name.includes('..'))
              || result.findings.some(f => !f || typeof f.rule_id !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(f.rule_id)
                || !SEVERITIES.has(f.severity)
                || (f.scanner !== undefined && !SCANNER_IDS.has(f.scanner))
                || (f.category !== undefined && !CATEGORIES.has(f.category))
                || (f.blocking !== undefined && typeof f.blocking !== 'boolean')
                || (f.message !== undefined && (typeof f.message !== 'string' || f.message.length > 240 || /[\u0000-\u001f]/.test(f.message))))) {
            throw new Error();
          }
          const blockingCount = result.findings.filter(
            f => f.blocking ?? (f.category === 'secret' || f.severity === 'CRITICAL'),
          ).length;
          if ((result.status === 'clean' && blockingCount !== 0)
              || (result.status === 'blocked' && blockingCount === 0)
              || (code === 0) !== (result.status === 'clean')) {
            throw new Error();
          }
          let scanners: SecurityScannerSummary[] | undefined;
          if (result.scanners !== undefined) {
            if (!Array.isArray(result.scanners) || result.scanners.length > 6
                || result.scanners.some(s => !s || !SCANNER_IDS.has(s.scanner)
                  || typeof s.label !== 'string' || s.label.length > 120 || /[\u0000-\u001f]/.test(s.label)
                  || !['clean', 'warning', 'blocked'].includes(s.status)
                  || typeof s.blocking_count !== 'number' || s.blocking_count < 0
                  || typeof s.warning_count !== 'number' || s.warning_count < 0
                  || typeof s.message !== 'string' || s.message.length > 240 || /[\u0000-\u001f]/.test(s.message))) {
              throw new Error();
            }
            scanners = result.scanners.map(s => ({
              scanner: s.scanner,
              label: s.label,
              status: s.status,
              blocking_count: s.blocking_count,
              warning_count: s.warning_count,
              message: s.message,
            }));
          }
          const findings: SecurityScanFinding[] = result.findings.map(f => ({
            rule_id: f.rule_id,
            severity: f.severity,
            ...(f.scanner ? { scanner: f.scanner } : {}),
            ...(f.category ? { category: f.category } : {}),
            ...(f.blocking !== undefined ? { blocking: f.blocking } : {}),
            ...(f.message ? { message: f.message } : {}),
          }));
          resolvePromise({
            schema_version: 1,
            tenant_slug: slug,
            scanner: 'trivy',
            ...(scanners ? { scanners } : {}),
            scope: result.scope,
            content_sha256: result.content_sha256,
            status: result.status,
            findings,
          });
        } catch {
          rejectPromise(new ServiceUnavailableException('El escáner devolvió un resultado inválido.'));
        }
      });
    });
  }
}
