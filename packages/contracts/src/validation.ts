/** Reglas compartidas por el formulario (Angular) y la API (Nest) para los datos del Paso 1 (RF-07). */

export const TENANT_SLUG_PATTERN = /^[a-z][a-z0-9-]{2,39}$/;
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_MAX_LENGTH = 254;

export type TenantField = 'tenant_slug' | 'admin_email' | 'institution_name' | 'plan_slug' | 'region' | 'engine';
export type TenantValidationCode = 'REQUIRED' | 'INVALID_TYPE' | 'SLUG_FORMAT' | 'SLUG_TAKEN' | 'EMAIL_FORMAT' | 'INVALID_VALUE';

/** Borrador del Paso 1 (RF-07, RF-08). Se guarda en tenants con status PENDING; no aprovisiona. */
export interface TenantDraftInput {
  institution_name: string; tenant_slug: string; admin_email: string;
  plan_slug: string; region: string; engine: string;
}
export interface TenantDraftCreated { id: string; tenant_slug: string; status: 'PENDING'; }

/** tfvars del tenant para el motor principal (variables.tf de infrastructure/terraform). Sin datos del operador ni secretos. */
export interface TenantTfvars {
  tenant_id: string; tenant_name: string; plan_type: string; region: string;
  frontend_ami_id: string; backend_ami_id: string; database_ami_id: string;
  plan_capacity: Record<'frontend' | 'backend' | 'database', { instance_type: string; disk_gib: number }>;
  engine: 'terraform' | 'opentofu'; request_id: string; key_pair_name: string;
}
export interface TenantTfvarsGenerated { tenant_id: string; path: string; tfvars: TenantTfvars; }

export interface TenantValidationError { field: TenantField; code: TenantValidationCode; message: string; }

export interface TenantValidationResult {
  valid: boolean;
  tenant_slug: string;
  admin_email: string;
  errors: TenantValidationError[];
}

/** Validación de formato (sin consultar la base). La API agrega SLUG_TAKEN. */
export function validateTenantFormat(slug: unknown, email: unknown): TenantValidationError[] {
  const errors: TenantValidationError[] = [];
  if (slug === undefined || slug === null || (typeof slug === 'string' && !slug.trim())) {
    errors.push({ field: 'tenant_slug', code: 'REQUIRED', message: 'El identificador del tenant es obligatorio.' });
  } else if (typeof slug !== 'string') {
    errors.push({ field: 'tenant_slug', code: 'INVALID_TYPE', message: 'El identificador del tenant debe ser texto.' });
  } else if (!TENANT_SLUG_PATTERN.test(slug.trim())) {
    errors.push({ field: 'tenant_slug', code: 'SLUG_FORMAT', message: 'El identificador debe tener de 3 a 40 caracteres: letras minúsculas, números o guiones, y comenzar con una letra.' });
  }
  if (email === undefined || email === null || (typeof email === 'string' && !email.trim())) {
    errors.push({ field: 'admin_email', code: 'REQUIRED', message: 'El correo del administrador es obligatorio.' });
  } else if (typeof email !== 'string') {
    errors.push({ field: 'admin_email', code: 'INVALID_TYPE', message: 'El correo del administrador debe ser texto.' });
  } else if (email.trim().length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email.trim())) {
    errors.push({ field: 'admin_email', code: 'EMAIL_FORMAT', message: 'Ingresa un correo válido, por ejemplo admin@institucion.edu.' });
  }
  return errors;
}
