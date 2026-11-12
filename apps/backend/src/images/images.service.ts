import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Repository } from 'typeorm';
import { SERVER_ROLES, type GoldenImage } from '@modulo2/contracts';
import { GoldenImageRecord } from '../database/entities';
import { REPO_ROOT } from '../paths';

const AMI = /^ami-[a-f0-9]{17}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

@Injectable()
export class ImagesService {
  constructor(@InjectRepository(GoldenImageRecord) private readonly repository: Repository<GoldenImageRecord>) {}

  /** Lee y valida el registro producido por Packer. Lanza ante cualquier dato inválido, sin modificar la BD. */
  private readRegistry(): GoldenImage[] {
    const local = resolve(REPO_ROOT, 'config/golden-images.local.json');
    const path = process.env.GOLDEN_IMAGES_PATH || (existsSync(local) ? local : resolve(REPO_ROOT, 'config/golden-images.json'));
    const registry = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(registry.images)) throw new Error('Invalid registry');
    const images = (registry.images as Partial<GoldenImage>[]).map(image => ({ ...image, provider: image.provider ?? 'aws' }) as GoldenImage);
    const keys = new Set<string>();
    for (const image of images) {
      const key = `${image.provider}/${image.region}/${image.role}`;
      if (!SERVER_ROLES.includes(image.role) || !['aws', 'azure'].includes(image.provider) || !image.region || !AMI.test(image.ami_id)
        || !SEMVER.test(image.image_version) || !SEMVER.test(image.packer_version) || !/^[a-f0-9]{7,40}$/.test(image.source_revision)
        || Number.isNaN(Date.parse(image.built_at)) || keys.has(key)) throw new Error('Invalid image');
      keys.add(key);
    }
    return images;
  }

  /** El registro de Packer es la fuente; golden_images lo refleja para consulta de los demás módulos (RF-09/RF-13). */
  async list(region?: string): Promise<GoldenImage[]> {
    const images = this.readRegistry();
    await this.repository.manager.transaction(async manager => {
      await manager.clear(GoldenImageRecord);
      if (images.length) await manager.insert(GoldenImageRecord, images.map(image => ({ ...image, built_at: new Date(image.built_at) })));
    });
    const rows = await this.repository.find({ where: region ? { region } : {}, order: { role: 'ASC', region: 'ASC' } });
    return rows.map(row => ({
      role: row.role as GoldenImage['role'], provider: row.provider as GoldenImage['provider'], region: row.region, ami_id: row.ami_id,
      image_version: row.image_version, packer_version: row.packer_version, built_at: row.built_at.toISOString(), source_revision: row.source_revision,
    }));
  }
}
