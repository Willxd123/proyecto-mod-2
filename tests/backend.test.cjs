const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
// Las pruebas se ejecutan desde la raíz con pnpm test, que compila primero.
const backendRequire = require('node:module').createRequire(path.resolve('apps/backend/package.json'));
backendRequire('reflect-metadata');
const { NestFactory } = backendRequire('@nestjs/core');
const { DataSource } = backendRequire('typeorm');
const { AppModule } = require('../apps/backend/dist/app.module');
const { CatalogService } = require('../apps/backend/dist/catalog/catalog.service');
const { ImagesService } = require('../apps/backend/dist/images/images.service');
const { TenantsService } = require('../apps/backend/dist/tenants/tenants.service');
let app, base;
const database = () => app.get(DataSource);
const countTenants = async () => (await database().query('SELECT count(*)::int AS n FROM tenants'))[0].n;

before(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
after(async () => { if (app) await app.close(); });

test('catálogo PostgreSQL repetible y consistente con su fuente', async () => {
  const service = app.get(CatalogService);
  await service.onModuleInit();
  const response = await fetch(base + '/api/plans');
  assert.equal(response.status, 200);
  const body = await response.json();
  const source = JSON.parse(fs.readFileSync(path.resolve('config/plans.json'), 'utf8'));
  assert.equal(body.meta.quota_enforcement, false);
  assert.equal(body.data.length, source.plans.length);
  assert.deepEqual(body.data, source.plans.map(plan => ({ ...plan, catalog_version: source.catalog_version })));
  const columns = await app.get(DataSource).query('SELECT slug, instance_type, vcpu, ram_gb, db_storage_gb, max_students, backup_policy FROM catalog_plans ORDER BY sort_order');
  assert.deepEqual(columns, source.plans.map(plan => ({ slug: plan.slug, instance_type: plan.roles.backend.instance_type, vcpu: plan.roles.backend.vcpu,
    ram_gb: plan.roles.backend.ram_gib, db_storage_gb: plan.roles.database.disk_gib, max_students: plan.max_students, backup_policy: plan.backup_policy })));
  const tables = await app.get(DataSource).query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
  for (const table of ['catalog_plans', 'golden_images', 'tenants', 'tenant_alerts']) assert.ok(tables.some(row => row.table_name === table));
});

test('tenants: campos del integrante 2 y restricciones (transacción revertida, no deja filas)', async () => {
  const database = app.get(DataSource);
  const columns = await database.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'tenants'");
  const types = Object.fromEntries(columns.map(row => [row.column_name, row.data_type]));
  assert.equal(types.id, 'uuid');
  for (const column of ['frontend_public_ip', 'backend_private_ip', 'db_private_ip']) assert.equal(types[column], 'inet');
  const runner = database.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const insert = (slug, status, engine) => runner.query(
      `INSERT INTO tenants (slug, name, admin_email, plan_slug, region, engine, status) VALUES ($1, 'Prueba', 'admin@example.edu', 'basico', 'us-east-1', $2, $3) RETURNING id, status, environment`,
      [slug, engine, status]);
    const [row] = await insert('i2-prueba-migracion', 'PENDING', 'terraform');
    assert.match(row.id, /^[0-9a-f-]{36}$/);
    assert.equal(row.environment, 'produccion');
    for (const [slug, status, engine] of [['i2-otro', 'INVENTADO', 'terraform'], ['i2-otro', 'PENDING', 'ansible'], ['Mal_Slug', 'PENDING', 'terraform']]) {
      await runner.query('SAVEPOINT intento');
      await assert.rejects(() => insert(slug, status, engine));
      await runner.query('ROLLBACK TO SAVEPOINT intento');
    }
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
  assert.equal((await database.query("SELECT count(*)::int AS n FROM tenants WHERE slug LIKE 'i2-%'"))[0].n, 0);
});

test('POST /api/tenants/validate: casos válidos e inválidos', async () => {
  const before = await countTenants();
  const validate = async body => {
    const response = await fetch(base + '/api/tenants/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const codes = result => result.body.data.errors.map(error => `${error.field}:${error.code}`);

  const ok = await validate({ tenant_slug: 'i2-instituto-demo', admin_email: ' admin@demo.edu ' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.valid, true);
  assert.deepEqual(ok.body.data.errors, []);
  assert.equal(ok.body.data.admin_email, 'admin@demo.edu');

  const cases = [
    [{ tenant_slug: 'ab', admin_email: 'a@b.edu' }, ['tenant_slug:SLUG_FORMAT']],
    [{ tenant_slug: 'Instituto_Demo', admin_email: 'a@b.edu' }, ['tenant_slug:SLUG_FORMAT']],
    [{ tenant_slug: '1instituto', admin_email: 'a@b.edu' }, ['tenant_slug:SLUG_FORMAT']],
    [{ tenant_slug: 'a'.repeat(41), admin_email: 'a@b.edu' }, ['tenant_slug:SLUG_FORMAT']],
    [{ tenant_slug: "x'; DROP TABLE tenants; --", admin_email: 'a@b.edu' }, ['tenant_slug:SLUG_FORMAT']],
    [{ tenant_slug: 'i2-demo', admin_email: 'sin-arroba.edu' }, ['admin_email:EMAIL_FORMAT']],
    [{ tenant_slug: 'i2-demo', admin_email: 'a b@demo.edu' }, ['admin_email:EMAIL_FORMAT']],
    [{ tenant_slug: 'i2-demo', admin_email: `${'a'.repeat(250)}@demo.edu` }, ['admin_email:EMAIL_FORMAT']],
    [{}, ['tenant_slug:REQUIRED', 'admin_email:REQUIRED']],
    [{ tenant_slug: '  ', admin_email: '' }, ['tenant_slug:REQUIRED', 'admin_email:REQUIRED']],
    [{ tenant_slug: 123, admin_email: ['a@b.edu'] }, ['tenant_slug:INVALID_TYPE', 'admin_email:INVALID_TYPE']],
  ];
  for (const [body, expected] of cases) {
    const result = await validate(body);
    assert.equal(result.status, 200, JSON.stringify(body));
    assert.equal(result.body.data.valid, false, JSON.stringify(body));
    assert.deepEqual(codes(result), expected, JSON.stringify(body));
    assert.ok(result.body.data.errors.every(error => error.message.length > 10));
  }

  for (const raw of ['[]', '"texto"', 'null']) {
    const response = await fetch(base + '/api/tenants/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw });
    assert.equal(response.status, 400, raw);
  }
  assert.equal(await countTenants(), before, 'validar no debe escribir en tenants');
});

test('POST /api/tenants/validate: detecta slug repetido (transacción revertida)', async () => {
  const runner = database().createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`INSERT INTO tenants (slug, name, admin_email, plan_slug, region, engine) VALUES ('i2-repetido', 'Prueba', 'a@b.edu', 'basico', 'us-east-1', 'terraform')`);
    const service = app.get(TenantsService);
    const taken = await service.validate({ tenant_slug: 'i2-repetido', admin_email: 'otro@demo.edu' }, runner.manager);
    assert.equal(taken.valid, false);
    assert.deepEqual(taken.errors.map(error => error.code), ['SLUG_TAKEN']);
    assert.match(taken.errors[0].message, /i2-repetido/);
    assert.equal((await service.validate({ tenant_slug: 'i2-libre', admin_email: 'otro@demo.edu' }, runner.manager)).valid, true);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
  assert.equal((await database().query("SELECT count(*)::int AS n FROM tenants WHERE slug = 'i2-repetido'"))[0].n, 0);
});

const draft = (changes = {}) => ({ institution_name: 'Instituto Demo', tenant_slug: 'i2-borrador', admin_email: 'admin@demo.edu',
  plan_slug: 'basico', region: 'us-east-1', engine: 'terraform', ...changes });

test('borrador del Paso 1: se guarda con status PENDING y sin datos de infraestructura (transacción revertida)', async () => {
  const runner = database().createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const service = app.get(TenantsService);
    const created = await service.createDraft(draft({ institution_name: '  Instituto Demo  ' }), runner.manager);
    assert.match(created.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual({ slug: created.tenant_slug, status: created.status }, { slug: 'i2-borrador', status: 'PENDING' });
    const [row] = await runner.query("SELECT name, plan_slug, engine, environment, status, access_url, frontend_public_ip, db_private_ip FROM tenants WHERE slug = 'i2-borrador'");
    assert.deepEqual(row, { name: 'Instituto Demo', plan_slug: 'basico', engine: 'terraform', environment: 'produccion', status: 'PENDING',
      access_url: null, frontend_public_ip: null, db_private_ip: null });
    await assert.rejects(() => service.createDraft(draft(), runner.manager), error => error.getStatus() === 422
      && error.getResponse().errors.some(item => item.code === 'SLUG_TAKEN'));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
  assert.equal((await database().query("SELECT count(*)::int AS n FROM tenants WHERE slug = 'i2-borrador'"))[0].n, 0);
});

test('POST /api/tenants/drafts: rechaza datos inválidos con 422 por campo y no escribe', async () => {
  const before = await countTenants();
  const post = async body => {
    const response = await fetch(base + '/api/tenants/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const cases = [
    [draft({ institution_name: '' }), 'institution_name:REQUIRED'],
    [draft({ institution_name: 'x'.repeat(121) }), 'institution_name:INVALID_VALUE'],
    [draft({ tenant_slug: 'Mal Slug' }), 'tenant_slug:SLUG_FORMAT'],
    [draft({ admin_email: 'admin' }), 'admin_email:EMAIL_FORMAT'],
    [draft({ plan_slug: 'premium' }), 'plan_slug:INVALID_VALUE'],
    [draft({ engine: 'ansible' }), 'engine:INVALID_VALUE'],
    [draft({ region: 'marte-1' }), 'region:INVALID_VALUE'],
  ];
  for (const [body, expected] of cases) {
    const result = await post(body);
    assert.equal(result.status, 422, expected);
    assert.deepEqual(result.body.errors.map(error => `${error.field}:${error.code}`), [expected]);
  }
  assert.equal((await fetch(base + '/api/tenants/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' })).status, 400);
  assert.equal(await countTenants(), before, 'los rechazos no deben escribir');
});

test('generador de tfvars: variables de la guía, capacidad del plan y AMIs reales (transacción revertida, carpeta temporal)', async () => {
  const runner = database().createQueryRunner();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'modulo2-tfvars-'));
  await runner.connect();
  await runner.startTransaction();
  try {
    const service = app.get(TenantsService);
    const created = await service.createDraft(draft({ tenant_slug: 'i2-tfvars', plan_slug: 'estandar', engine: 'opentofu' }), runner.manager);
    const result = await service.generateTfvars('i2-tfvars', runner.manager, temporary);
    const written = JSON.parse(fs.readFileSync(path.join(temporary, 'i2-tfvars', 'terraform.tfvars.json'), 'utf8'));
    assert.deepEqual(written, result.tfvars);
    const registry = JSON.parse(fs.readFileSync(path.resolve('config/golden-images.json'), 'utf8')).images;
    const plan = JSON.parse(fs.readFileSync(path.resolve('config/plans.json'), 'utf8')).plans.find(item => item.slug === 'estandar');
    assert.deepEqual(written, {
      tenant_id: 'i2-tfvars', tenant_name: 'Instituto Demo', plan_type: 'estandar', region: 'us-east-1',
      frontend_ami_id: registry.find(i => i.role === 'frontend').ami_id, backend_ami_id: registry.find(i => i.role === 'backend').ami_id,
      database_ami_id: registry.find(i => i.role === 'database').ami_id,
      plan_capacity: Object.fromEntries(['frontend', 'backend', 'database'].map(role => [role, { instance_type: plan.roles[role].instance_type, disk_gib: plan.roles[role].disk_gib }])),
      engine: 'opentofu', request_id: created.id, key_pair_name: process.env.SSH_KEY_PAIR_NAME || 'practico7-asistencia',
    });
    const text = JSON.stringify(written);
    for (const forbidden of ['expected_account_id', 'ssh_ingress_cidrs', 'ssh_private_key_path', 'admin_email', 'PRIVATE KEY']) assert.ok(!text.includes(forbidden), forbidden);

    await assert.rejects(() => service.generateTfvars('i2-no-existe', runner.manager, temporary), error => error.getStatus() === 404);
    await service.createDraft(draft({ tenant_slug: 'i2-pulumi', engine: 'pulumi' }), runner.manager);
    await assert.rejects(() => service.generateTfvars('i2-pulumi', runner.manager, temporary), error => error.getStatus() === 422);
    await runner.query("UPDATE tenants SET status = 'ACTIVE' WHERE slug = 'i2-tfvars'");
    await assert.rejects(() => service.generateTfvars('i2-tfvars', runner.manager, temporary), error => error.getStatus() === 409);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  assert.equal((await database().query("SELECT count(*)::int AS n FROM tenants WHERE slug LIKE 'i2-%'"))[0].n, 0);
  const missing = await fetch(base + '/api/tenants/i2-no-existe/tfvars', { method: 'POST' });
  assert.equal(missing.status, 404);
});

test('rutas de consulta funcionan y no habilitan creación ficticia', async () => {
  assert.equal((await fetch(base + '/api/health')).status, 200);
  assert.equal((await fetch(base + '/api/plans/no-existe')).status, 404);
  assert.equal((await fetch(base + '/api/tenants', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
  const capabilities = await (await fetch(base + '/api/capabilities')).json();
  assert.equal(capabilities.data.tenant_creation, false);
  const tenants = await (await fetch(base + '/api/tenants')).json();
  assert.ok(Array.isArray(tenants.data));
  assert.equal(tenants.meta.creation_enabled, false);
});

test('registro de AMIs: se refleja en golden_images, filtra por región y falla sin exponer contenido', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'modulo2-images-'));
  const previous = process.env.GOLDEN_IMAGES_PATH;
  const registry = path.join(temporary, 'registry.json');
  const image = { role: 'frontend', region: 'us-east-1', ami_id: 'ami-0123456789abcdef0', image_version: '0.1.0', packer_version: '1.14.3',
    source_revision: 'abcdef0', built_at: '2026-01-01T00:00:00+00:00' };
  const service = app.get(ImagesService);
  try {
    process.env.GOLDEN_IMAGES_PATH = registry;
    fs.writeFileSync(registry, JSON.stringify({ images: [image] }));
    const listed = await service.list('us-east-1');
    assert.equal(listed.length, 1);
    assert.equal(listed[0].provider, 'aws');
    const rows = await app.get(DataSource).query('SELECT cloud_provider, ami_id FROM golden_images');
    assert.deepEqual(rows, [{ cloud_provider: 'aws', ami_id: image.ami_id }]);
    assert.equal((await service.list('us-west-2')).length, 0);
    fs.writeFileSync(registry, JSON.stringify({ images: [image, image] }));
    await assert.rejects(() => service.list());
    fs.writeFileSync(registry, 'invalid');
    const response = await fetch(base + '/api/golden-images');
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes(temporary));
  } finally {
    if (previous === undefined) delete process.env.GOLDEN_IMAGES_PATH; else process.env.GOLDEN_IMAGES_PATH = previous;
    fs.rmSync(temporary, { recursive: true, force: true });
    await service.list(); // restaura golden_images desde el registro real
  }
});
