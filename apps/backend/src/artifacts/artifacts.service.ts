import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { spawn } from 'node:child_process';
import type { AssistanceArtifactInspection, AssistanceArtifactJob } from '@modulo2/contracts';
import { REPO_ROOT } from '../paths';

const REVISION = /^[a-f0-9]{40}$/;
const RELEASE = /^[a-f0-9]{32}$/;

@Injectable()
export class ArtifactsService {
  private job: AssistanceArtifactJob = { status: 'idle', result: null, error: null };
  private checking = false;

  enabled(): boolean {
    return process.env.ARTIFACT_PREPARATION_LOCAL === 'true'
      && (process.env.HOST === undefined || process.env.HOST === '127.0.0.1');
  }

  private requireEnabled(): void {
    if (!this.enabled()) throw new ForbiddenException('Preparación local deshabilitada.');
  }

  private run(args: string[]): Promise<AssistanceArtifactInspection> {
    const windows = process.platform === 'win32';
    const executable = windows ? 'wsl.exe' : 'python3';
    const argv = windows
      ? ['--exec', 'python3', 'scripts/prepare_assistance_artifacts.py', ...args]
      : ['scripts/prepare_assistance_artifacts.py', ...args];
    return new Promise((resolve, reject) => {
      const child = spawn(executable, argv, { cwd: REPO_ROOT, windowsHide: true });
      let output = '';
      let errors = '';
      let settled = false;
      child.stdout.on('data', (data: Buffer) => { output = (output + data.toString()).slice(-8192); });
      child.stderr.on('data', (data: Buffer) => { errors = (errors + data.toString()).slice(-4096); });
      child.on('error', () => {
        if (settled) return;
        settled = true;
        reject(new Error('No se pudo iniciar el preparador Linux o WSL.'));
      });
      child.on('close', code => {
        if (settled) return;
        settled = true;
        if (code !== 0) {
          const last = errors.trim().split('\n').pop() ?? '';
          reject(new Error(last.startsWith('ERROR: ') ? last.slice(7) : 'Falló el preparador; revise el entorno local.'));
          return;
        }
        try {
          const value: unknown = JSON.parse(output);
          if (!value || typeof value !== 'object') throw new Error('Formato inválido.');
          const result = value as AssistanceArtifactInspection;
          if (!result.revisions || !REVISION.test(result.revisions.backend) || !REVISION.test(result.revisions.frontend)
              || !RELEASE.test(result.release) || typeof result.ready !== 'boolean') throw new Error('Formato inválido.');
          resolve(result);
        } catch {
          reject(new Error('El preparador devolvió un resultado inválido.'));
        }
      });
    });
  }

  async inspect(): Promise<AssistanceArtifactInspection> {
    this.requireEnabled();
    if (this.checking || this.job.status === 'running') throw new ConflictException('Ya hay una comprobación o preparación en curso.');
    this.checking = true;
    try {
      return await this.run(['inspect']);
    } catch (error) {
      throw new ServiceUnavailableException(error instanceof Error ? error.message : 'Falló la comprobación.');
    } finally {
      this.checking = false;
    }
  }

  start(body: unknown): AssistanceArtifactJob {
    this.requireEnabled();
    if (this.checking || this.job.status === 'running') throw new ConflictException('Ya hay una comprobación o preparación en curso.');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Revisiones inválidas.');
    const input = body as Record<string, unknown>;
    if (Object.keys(input).sort().join(',') !== 'backend,frontend'
        || typeof input.backend !== 'string' || !REVISION.test(input.backend)
        || typeof input.frontend !== 'string' || !REVISION.test(input.frontend)) {
      throw new BadRequestException('Revisiones inválidas.');
    }
    this.job = { status: 'running', result: null, error: null };
    void this.run(['prepare', '--backend', input.backend, '--frontend', input.frontend]).then(
      result => { this.job = { status: 'succeeded', result, error: null }; },
      error => { this.job = { status: 'failed', result: null, error: error instanceof Error ? error.message : 'Falló la preparación.' }; },
    );
    return this.job;
  }

  status(): AssistanceArtifactJob {
    this.requireEnabled();
    return this.job;
  }
}
