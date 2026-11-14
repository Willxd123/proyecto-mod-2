import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { spawn } from 'node:child_process';
import { Repository } from 'typeorm';
import { TENANT_SLUG_PATTERN } from '@modulo2/contracts';
import { Tenant } from '../database/entities';
import { REPO_ROOT } from '../paths';

@Injectable()
export class DemoCredentialsService {
  constructor(@InjectRepository(Tenant) private readonly tenants: Repository<Tenant>) {}

  enabled(): boolean {
    return process.env.DEMO_PROVISIONING_LOCAL === 'true'
      && (process.env.HOST === undefined || process.env.HOST === '127.0.0.1');
  }

  async reveal(slug: string, body: unknown): Promise<{ email: string; password: string }> {
    if (!this.enabled()) throw new ForbiddenException('Demostración local deshabilitada.');
    if (!TENANT_SLUG_PATTERN.test(slug) || !body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).join(',') !== 'confirm' || (body as { confirm?: unknown }).confirm !== slug) {
      throw new BadRequestException('Confirma el identificador exacto del tenant.');
    }
    const tenant = await this.tenants.findOneBy({ slug });
    if (!tenant || tenant.status !== 'ACTIVE' || tenant.deployment_metadata.demo_initial_credentials_verified !== true) {
      throw new NotFoundException('No hay credenciales iniciales verificadas para este tenant.');
    }
    const password = await this.readPassword(slug);
    return { email: tenant.admin_email, password };
  }

  private readPassword(slug: string): Promise<string> {
    const windows = process.platform === 'win32';
    const binary = windows ? 'wsl.exe' : 'python3';
    const args = windows
      ? ['--exec', 'python3', 'scripts/demo_vault.py', 'reveal', '--tenant', slug]
      : ['scripts/demo_vault.py', 'reveal', '--tenant', slug];
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, { cwd: REPO_ROOT, windowsHide: true });
      let output = '';
      let settled = false;
      const fail = () => {
        if (!settled) {
          settled = true;
          reject(new ServiceUnavailableException('No se pudieron consultar las credenciales locales cifradas.'));
        }
      };
      child.stdout.on('data', (data: Buffer) => {
        output += data.toString('utf8');
        if (output.length > 1024) { child.kill(); fail(); }
      });
      child.stderr.resume();
      child.on('error', fail);
      child.on('close', code => {
        if (settled) return;
        if (code !== 0) { fail(); return; }
        try {
          const value: unknown = JSON.parse(output);
          if (!value || typeof value !== 'object' || Array.isArray(value)
              || Object.keys(value).join(',') !== 'password'
              || typeof (value as { password?: unknown }).password !== 'string') throw new Error();
          const password = (value as { password: string }).password;
          if (!/^[A-Za-z0-9_-]{12,256}$/.test(password)) throw new Error();
          settled = true;
          resolve(password);
        } catch {
          fail();
        }
      });
    });
  }
}
