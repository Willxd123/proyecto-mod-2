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
let app, base;

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
