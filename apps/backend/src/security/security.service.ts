import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { TENANT_SLUG_PATTERN, type SecurityScanResult } from '@modulo2/contracts';
import { REPO_ROOT } from '../paths';

@Injectable()
export class SecurityService {
  private running = false;

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
      return await this.run(input.tenant_slug);
    } finally {
      this.running = false;
    }
  }

  private run(slug: string): Promise<SecurityScanResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.platform === 'win32' ? 'python' : 'python3',
        ['scripts/security_scan.py', '--tenant', slug], { cwd: REPO_ROOT, windowsHide: true });
      let output = '';
      let failed = false;
      child.stdout.on('data', (data: Buffer) => {
        output += data.toString();
        if (output.length > 65536 && !failed) {
          failed = true;
          child.kill();
          reject(new ServiceUnavailableException('El escáner devolvió una respuesta demasiado grande.'));
        }
      });
      child.stderr.resume();
      child.on('error', () => {
        if (!failed) {
          failed = true;
          reject(new ServiceUnavailableException('No se pudo iniciar el escáner local.'));
        }
      });
      child.on('close', code => {
        if (failed) return;
        if (code !== 0 && code !== 1) {
          reject(new ServiceUnavailableException('El escaneo falló. Verifique Trivy y el paquete local del tenant.'));
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
                || !['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(f.severity))
              || (result.status === 'clean' && result.findings.length !== 0)
              || (result.status === 'blocked' && result.findings.length === 0)
              || (code === 0) !== (result.status === 'clean')) throw new Error();
          resolve({
            schema_version: 1, tenant_slug: slug, scanner: 'trivy',
            scope: result.scope, content_sha256: result.content_sha256, status: result.status,
            findings: result.findings.map(f => ({ rule_id: f.rule_id, severity: f.severity })),
          });
        } catch {
          reject(new ServiceUnavailableException('El escáner devolvió un resultado inválido.'));
        }
      });
    });
  }
}
