import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import {
  SERVER_ROLES, TENANT_SLUG_PATTERN, validateTenantFormat,
  type TenantDraftCreated, type TenantTfvars, type TenantTfvarsGenerated, type TenantValidationError, type TenantValidationResult,
} from '@modulo2/contracts';
import { CatalogPlan, Tenant } from '../database/entities';
import { ImagesService } from '../images/images.service';
import { REPO_ROOT } from '../paths';

const ENGINES = ['terraform', 'opentofu', 'pulumi', 'cloudformation'];
const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;

/** Integrante 2: validación autoritativa del Paso 1 (RF-07, RF-08) y guardado del borrador. No ejecuta comandos. */
@Injectable()
export class TenantsService {
  constructor(@InjectRepository(Tenant) private readonly repository: Repository<Tenant>, private readonly images: ImagesService) {}

  private body(body: unknown): Record<string, unknown> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('El cuerpo debe ser un objeto JSON.');
    }
    return body as Record<string, unknown>;
  }

  /** El EntityManager opcional permite probar dentro de una transacción revertida. */
  async validate(body: unknown, manager: EntityManager = this.repository.manager): Promise<TenantValidationResult> {
    const { tenant_slug, admin_email } = this.body(body);
    const errors = validateTenantFormat(tenant_slug, admin_email);
    const slug = typeof tenant_slug === 'string' ? tenant_slug.trim() : '';
    const email = typeof admin_email === 'string' ? admin_email.trim() : '';

    // Solo se consulta la base si el formato es correcto (consulta parametrizada).
    if (!errors.some(error => error.field === 'tenant_slug') && await manager.existsBy(Tenant, { slug })) {
      errors.push({ field: 'tenant_slug', code: 'SLUG_TAKEN', message: `Ya existe un tenant con el identificador "${slug}". Elige otro.` });
    }
    return { valid: errors.length === 0, tenant_slug: slug, admin_email: email, errors };
  }

  /**
   * Guarda el borrador del Paso 1 en tenants con status PENDING (valor por defecto del modelo).
   * No crea recursos: el orquestador (integrante 5) lo llevará a PROVISIONING / ACTIVE / ERROR.
   */
  async createDraft(body: unknown, manager: EntityManager = this.repository.manager): Promise<TenantDraftCreated> {
    const input = this.body(body);
    const result = await this.validate(input, manager);
    const errors: TenantValidationError[] = [...result.errors];
    const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

    const name = text(input.institution_name);
    if (!name) errors.push({ field: 'institution_name', code: 'REQUIRED', message: 'El nombre de la institución es obligatorio.' });
    else if (name.length > 120) errors.push({ field: 'institution_name', code: 'INVALID_VALUE', message: 'El nombre de la institución admite como máximo 120 caracteres.' });

    const plan = text(input.plan_slug);
    if (!plan || !(await manager.existsBy(CatalogPlan, { slug: plan }))) {
      errors.push({ field: 'plan_slug', code: plan ? 'INVALID_VALUE' : 'REQUIRED', message: 'Selecciona un plan del catálogo (Básico, Estándar o Avanzado).' });
    }
    const engine = text(input.engine);
    if (!ENGINES.includes(engine)) {
      errors.push({ field: 'engine', code: engine ? 'INVALID_VALUE' : 'REQUIRED', message: 'Selecciona un motor: Terraform, OpenTofu, Pulumi o CloudFormation.' });
    }
    const region = text(input.region);
    if (!REGION.test(region) || region.length > 40) {
      errors.push({ field: 'region', code: region ? 'INVALID_VALUE' : 'REQUIRED', message: 'Selecciona una región de AWS válida, por ejemplo us-east-1.' });
    }
    if (errors.length) throw new UnprocessableEntityException({ message: 'El borrador tiene datos inválidos.', errors });

    try {
      await manager.insert(Tenant, { slug: result.tenant_slug, name, admin_email: result.admin_email, plan_slug: plan, region, engine, status: 'PENDING' });
    } catch (error) {
      // Dos solicitudes simultáneas con el mismo identificador: la clave primaria decide.
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === '23505') {
        throw new UnprocessableEntityException({ message: 'El borrador tiene datos inválidos.',
          errors: [{ field: 'tenant_slug', code: 'SLUG_TAKEN', message: `Ya existe un tenant con el identificador "${result.tenant_slug}". Elige otro.` }] });
      }
      throw error;
    }
    const saved = await manager.findOneByOrFail(Tenant, { slug: result.tenant_slug });
    return { id: saved.id, tenant_slug: saved.slug, status: 'PENDING' };
  }

  /**
   * Generador del tfvars del tenant (guía del integrante 2): tenant_id, tenant_name, plan_type, region,
   * los 3 AMI IDs de Packer y la capacidad del plan copiada del catálogo. Escribe
   * output/tenants/<tenant_id>/terraform.tfvars.json (ignorado por Git). No incluye cuenta, IP SSH ni claves:
   * esos datos los agrega el operador al ejecutar scripts/terraform_tenant.py.
   */
  async generateTfvars(slug: string, manager: EntityManager = this.repository.manager,
    outputRoot = process.env.TENANT_OUTPUT_DIR || resolve(REPO_ROOT, 'output/tenants')): Promise<TenantTfvarsGenerated> {
    if (!TENANT_SLUG_PATTERN.test(slug)) throw new NotFoundException('No existe un tenant con ese identificador.');
    const tenant = await manager.findOneBy(Tenant, { slug });
    if (!tenant) throw new NotFoundException(`No existe un tenant con el identificador "${slug}".`);
    if (tenant.status !== 'PENDING') {
      throw new ConflictException(`El tenant "${slug}" está en estado ${tenant.status}; su tfvars no se regenera para no alterar recursos existentes.`);
    }
    if (tenant.engine !== 'terraform' && tenant.engine !== 'opentofu') {
      throw new UnprocessableEntityException(`El tenant usa ${tenant.engine}; el tfvars es para el motor principal (Terraform/OpenTofu). Pulumi/CloudFormation son del integrante 3.`);
    }
    const plan = await manager.findOneByOrFail(CatalogPlan, { slug: tenant.plan_slug });
    const images = await this.images.list(tenant.region);
    const ami = Object.fromEntries(images.map(image => [image.role, image.ami_id])) as Record<string, string | undefined>;
    const missing = SERVER_ROLES.filter(role => !ami[role]);
    if (missing.length) {
      throw new UnprocessableEntityException(`Faltan Golden AMIs en ${tenant.region} para: ${missing.join(', ')}. Sin las tres imágenes el tenant no es desplegable.`);
    }

    const tfvars: TenantTfvars = {
      tenant_id: tenant.slug, tenant_name: tenant.name, plan_type: tenant.plan_slug, region: tenant.region,
      frontend_ami_id: ami.frontend!, backend_ami_id: ami.backend!, database_ami_id: ami.database!,
      plan_capacity: Object.fromEntries(SERVER_ROLES.map(role => [role,
        { instance_type: plan.roles[role].instance_type, disk_gib: plan.roles[role].disk_gib }])) as TenantTfvars['plan_capacity'],
      engine: tenant.engine, request_id: tenant.id, key_pair_name: process.env.SSH_KEY_PAIR_NAME || 'practico7-asistencia',
    };
    const directory = resolve(outputRoot, tenant.slug);
    mkdirSync(directory, { recursive: true });
    const file = resolve(directory, 'terraform.tfvars.json');
    writeFileSync(file, JSON.stringify(tfvars, null, 2) + '\n', 'utf8');
    return { tenant_id: tenant.slug, path: relative(REPO_ROOT, file).replace(/\\/g, '/'), tfvars };
  }
}
