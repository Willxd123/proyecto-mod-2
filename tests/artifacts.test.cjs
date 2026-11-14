const { test } = require('node:test');
const assert = require('node:assert/strict');
require('module').createRequire(require('path').resolve('apps/backend/package.json'))('reflect-metadata');
const { ArtifactsService } = require('../apps/backend/dist/artifacts/artifacts.service');
const { ArtifactsController } = require('../apps/backend/dist/artifacts/artifacts.controller');

test('preparación exige activación explícita y host local', () => {
  const oldEnabled = process.env.ARTIFACT_PREPARATION_LOCAL;
  const oldHost = process.env.HOST;
  const service = new ArtifactsService();
  try {
    delete process.env.ARTIFACT_PREPARATION_LOCAL;
    delete process.env.HOST;
    assert.equal(service.enabled(), false);
    assert.throws(() => service.start({ backend: 'a'.repeat(40), frontend: 'b'.repeat(40) }));
    process.env.ARTIFACT_PREPARATION_LOCAL = 'true';
    process.env.HOST = '0.0.0.0';
    assert.equal(service.enabled(), false);
    process.env.HOST = '127.0.0.1';
    assert.equal(service.enabled(), true);
    assert.throws(() => service.start({ backend: 'main', frontend: 'b'.repeat(40) }));
    assert.throws(() => service.start({ backend: 'a'.repeat(40), frontend: 'b'.repeat(40), command: 'ignored' }));
  } finally {
    if (oldEnabled === undefined) delete process.env.ARTIFACT_PREPARATION_LOCAL; else process.env.ARTIFACT_PREPARATION_LOCAL = oldEnabled;
    if (oldHost === undefined) delete process.env.HOST; else process.env.HOST = oldHost;
  }
});

test('el controlador rechaza orígenes, marcadores y clientes no locales', () => {
  let calls = 0;
  const controller = new ArtifactsController({ start: () => { calls++; return {}; }, status: () => ({}) });
  const local = { socket: { remoteAddress: '127.0.0.1' } };
  const remote = { socket: { remoteAddress: '192.0.2.1' } };
  assert.throws(() => controller.prepare(local, 'https://example.com', 'TenantControlCenter', {}));
  assert.throws(() => controller.prepare(remote, 'http://localhost:4200', 'TenantControlCenter', {}));
  assert.throws(() => controller.prepare(local, 'http://localhost:4200', undefined, {}));
  assert.throws(() => controller.status(remote, 'TenantControlCenter'));
  assert.equal(calls, 0);
  controller.prepare(local, 'http://127.0.0.1:4200', 'TenantControlCenter', {});
  assert.equal(calls, 1);
});

test('el trabajo informa el resultado y rechaza concurrencia', async () => {
  const oldEnabled = process.env.ARTIFACT_PREPARATION_LOCAL;
  const oldHost = process.env.HOST;
  process.env.ARTIFACT_PREPARATION_LOCAL = 'true';
  process.env.HOST = '127.0.0.1';
  try {
    const service = new ArtifactsService();
    let finish;
    service.run = () => new Promise(resolve => { finish = resolve; });
    const revisions = { backend: 'a'.repeat(40), frontend: 'b'.repeat(40) };
    assert.equal(service.start(revisions).status, 'running');
    assert.throws(() => service.start(revisions));
    finish({ revisions, ready: true, release: 'c'.repeat(32) });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.status().status, 'succeeded');
    assert.deepEqual(service.status().result.revisions, revisions);
  } finally {
    if (oldEnabled === undefined) delete process.env.ARTIFACT_PREPARATION_LOCAL; else process.env.ARTIFACT_PREPARATION_LOCAL = oldEnabled;
    if (oldHost === undefined) delete process.env.HOST; else process.env.HOST = oldHost;
  }
});

test('escaneo local exige activación y no acepta rutas ni comandos', async () => {
  const { SecurityService } = require('../apps/backend/dist/security/security.service');
  const oldEnabled = process.env.SECURITY_SCAN_LOCAL;
  const oldHost = process.env.HOST;
  const service = new SecurityService();
  try {
    delete process.env.SECURITY_SCAN_LOCAL;
    await assert.rejects(() => service.scan({ tenant_slug: 'i3-test' }));
    process.env.SECURITY_SCAN_LOCAL = 'true';
    process.env.HOST = '0.0.0.0';
    await assert.rejects(() => service.scan({ tenant_slug: 'i3-test' }));
    process.env.HOST = '127.0.0.1';
    await assert.rejects(() => service.scan({ tenant_slug: '../otro' }));
    await assert.rejects(() => service.scan({ tenant_slug: 'i3-test', path: 'otro' }));
    let finish;
    service.run = () => new Promise(resolve => { finish = resolve; });
    const active = service.scan({ tenant_slug: 'i3-test' });
    await assert.rejects(() => service.scan({ tenant_slug: 'i3-test' }));
    finish({ status: 'clean' });
    assert.equal((await active).status, 'clean');
  } finally {
    if (oldEnabled === undefined) delete process.env.SECURITY_SCAN_LOCAL; else process.env.SECURITY_SCAN_LOCAL = oldEnabled;
    if (oldHost === undefined) delete process.env.HOST; else process.env.HOST = oldHost;
  }
});

test('controlador de escaneo rechaza origen y cliente ajenos', async () => {
  const { SecurityController } = require('../apps/backend/dist/security/security.controller');
  let calls = 0;
  const controller = new SecurityController({ scan: async () => { calls++; return {}; } });
  const local = { socket: { remoteAddress: '127.0.0.1' } };
  const remote = { socket: { remoteAddress: '192.0.2.1' } };
  await assert.rejects(() => controller.scan(remote, 'http://localhost:4200', 'TenantControlCenter', {}));
  await assert.rejects(() => controller.scan(local, 'https://example.com', 'TenantControlCenter', {}));
  await assert.rejects(() => controller.scan(local, 'http://localhost:4200', undefined, {}));
  assert.equal(calls, 0);
  await controller.scan(local, 'http://localhost:4200', 'TenantControlCenter', {});
  assert.equal(calls, 1);
});

test('servicio de escaneo ejecuta Trivy y no devuelve el valor detectado', async t => {
  const { spawnSync } = require('node:child_process');
  if (spawnSync('trivy', ['--version'], { stdio: 'ignore' }).status !== 0) {
    t.skip('Trivy no está instalado.');
    return;
  }
  const fs = require('node:fs');
  const path = require('node:path');
  const { randomUUID } = require('node:crypto');
  const { SecurityService } = require('../apps/backend/dist/security/security.service');
  const slug = 'i3-scan-' + randomUUID().replace(/-/g, '').slice(0, 24);
  const parent = path.resolve('output/handoff');
  const directory = path.join(parent, slug);
  const oldEnabled = process.env.SECURITY_SCAN_LOCAL;
  const oldHost = process.env.HOST;
  fs.mkdirSync(parent, { recursive: true });
  fs.mkdirSync(directory);
  try {
    const secret = 'AKIA' + '4WZ5PTQ1VXM9K3LY';
    fs.writeFileSync(path.join(directory, 'request.json'), JSON.stringify({ tenant_slug: slug, engine: 'cloudformation', token: secret }));
    for (const role of ['frontend', 'backend', 'database']) fs.writeFileSync(path.join(directory, role + '.yaml'), 'safe\n');
    process.env.SECURITY_SCAN_LOCAL = 'true';
    process.env.HOST = '127.0.0.1';
    const result = await new SecurityService().scan({ tenant_slug: slug });
    assert.equal(result.status, 'blocked');
    assert.ok(result.findings.length);
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.ok(result.scope.includes('infrastructure/cloudformation/tenant.yaml'));
  } finally {
    if (oldEnabled === undefined) delete process.env.SECURITY_SCAN_LOCAL; else process.env.SECURITY_SCAN_LOCAL = oldEnabled;
    if (oldHost === undefined) delete process.env.HOST; else process.env.HOST = oldHost;
    fs.rmSync(directory, { recursive: true });
  }
});

test('credenciales demo requieren activación, tenant activo y comprobación de inicio de sesión', async () => {
  const { DemoCredentialsService } = require('../apps/backend/dist/demo-credentials/demo-credentials.service');
  const oldEnabled = process.env.DEMO_PROVISIONING_LOCAL;
  const oldHost = process.env.HOST;
  let tenant = { slug: 'i3-test', status: 'ACTIVE', admin_email: 'admin@example.test', deployment_metadata: {} };
  const service = new DemoCredentialsService({ findOneBy: async () => tenant });
  service.readPassword = async () => 'password-sintetico-123';
  try {
    delete process.env.DEMO_PROVISIONING_LOCAL;
    await assert.rejects(() => service.reveal('i3-test', { confirm: 'i3-test' }));
    process.env.DEMO_PROVISIONING_LOCAL = 'true';
    process.env.HOST = '0.0.0.0';
    await assert.rejects(() => service.reveal('i3-test', { confirm: 'i3-test' }));
    process.env.HOST = '127.0.0.1';
    await assert.rejects(() => service.reveal('i3-test', { confirm: 'i3-test' }));
    tenant.deployment_metadata.demo_initial_credentials_verified = true;
    await assert.rejects(() => service.reveal('i3-test', { confirm: 'otro' }));
    await assert.rejects(() => service.reveal('i3-test', { confirm: 'i3-test', path: 'otro' }));
    tenant.status = 'PENDING';
    await assert.rejects(() => service.reveal('i3-test', { confirm: 'i3-test' }));
    tenant.status = 'ACTIVE';
    assert.deepEqual(await service.reveal('i3-test', { confirm: 'i3-test' }),
      { email: 'admin@example.test', password: 'password-sintetico-123' });
  } finally {
    if (oldEnabled === undefined) delete process.env.DEMO_PROVISIONING_LOCAL; else process.env.DEMO_PROVISIONING_LOCAL = oldEnabled;
    if (oldHost === undefined) delete process.env.HOST; else process.env.HOST = oldHost;
  }
});

test('consulta de credenciales demo rechaza orígenes y clientes ajenos', async () => {
  const { DemoCredentialsController } = require('../apps/backend/dist/demo-credentials/demo-credentials.controller');
  let calls = 0;
  const controller = new DemoCredentialsController({ reveal: async () => { calls++; return {}; } });
  const local = { socket: { remoteAddress: '127.0.0.1' } };
  const remote = { socket: { remoteAddress: '192.0.2.1' } };
  await assert.rejects(() => controller.reveal(remote, 'http://localhost:4200', 'TenantControlCenter', 'i3-test', {}));
  await assert.rejects(() => controller.reveal(local, 'https://example.com', 'TenantControlCenter', 'i3-test', {}));
  await assert.rejects(() => controller.reveal(local, 'http://localhost:4200', undefined, 'i3-test', {}));
  assert.equal(calls, 0);
  await controller.reveal(local, 'http://localhost:4200', 'TenantControlCenter', 'i3-test', {});
  assert.equal(calls, 1);
});

test('aprovisionamiento demo requiere activación local y confirmación exacta', async () => {
  const { DemoProvisioningService } = require('../apps/backend/dist/demo-provisioning/demo-provisioning.service');
  const oldEnabled = process.env.DEMO_PROVISIONING_LOCAL;
  const oldHost = process.env.HOST;
  let tenant = { slug: 'i3-test', status: 'PENDING', engine: 'pulumi' };
  const service = new DemoProvisioningService({ findOneBy: async () => tenant }, {}, {});
  try {
    delete process.env.DEMO_PROVISIONING_LOCAL;
    await assert.rejects(() => service.start('i3-test', { confirm: 'i3-test' }));
    process.env.DEMO_PROVISIONING_LOCAL = 'true';
    process.env.HOST = '0.0.0.0';
    await assert.rejects(() => service.start('i3-test', { confirm: 'i3-test' }));
    process.env.HOST = '127.0.0.1';
    await assert.rejects(() => service.start('i3-test', { confirm: 'otro' }));
    await assert.rejects(() => service.start('i3-test', { confirm: 'i3-test', engine: 'terraform' }));
    await assert.rejects(() => service.start('i3-test', { confirm: 'i3-test' }));
    tenant = { ...tenant, engine: 'terraform', status: 'ACTIVE' };
    await assert.rejects(() => service.start('i3-test', { confirm: 'i3-test' }));
  } finally {
    if (oldEnabled === undefined) delete process.env.DEMO_PROVISIONING_LOCAL; else process.env.DEMO_PROVISIONING_LOCAL = oldEnabled;
    if (oldHost === undefined) delete process.env.HOST; else process.env.HOST = oldHost;
  }
});

test('el diagnóstico demo acepta nombres de configuración en mayúsculas', async t => {
  const { EventEmitter } = require('node:events');
  const childProcess = require('node:child_process');
  const { DemoProvisioningService } = require('../apps/backend/dist/demo-provisioning/demo-provisioning.service');
  const oldEnabled = process.env.DEMO_PROVISIONING_LOCAL;
  const oldHost = process.env.HOST;
  process.env.DEMO_PROVISIONING_LOCAL = 'true';
  process.env.HOST = '127.0.0.1';
  try {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = { resume() {} };
    child.kill = () => {};
    t.mock.method(childProcess, 'spawn', () => {
      process.nextTick(() => {
        child.stdout.emit('data', Buffer.from(JSON.stringify({
          ready: false, missing: ['AWS_EXPECTED_ACCOUNT_ID'], supported_engines: [],
        })));
        child.emit('close', 0);
      });
      return child;
    });
    const capabilities = await new DemoProvisioningService({}, {}, {}).capabilities();
    assert.deepEqual(capabilities, {
      enabled: true, ready: false, missing: ['AWS_EXPECTED_ACCOUNT_ID'], supported_engines: [],
    });
  } finally {
    if (oldEnabled === undefined) delete process.env.DEMO_PROVISIONING_LOCAL; else process.env.DEMO_PROVISIONING_LOCAL = oldEnabled;
    if (oldHost === undefined) delete process.env.HOST; else process.env.HOST = oldHost;
  }
});

test('inicio local reclama el borrador atómicamente y construye la solicitud desde PostgreSQL', async () => {
  const { DemoProvisioningService } = require('../apps/backend/dist/demo-provisioning/demo-provisioning.service');
  const oldEnabled = process.env.DEMO_PROVISIONING_LOCAL;
  const oldHost = process.env.HOST;
  process.env.DEMO_PROVISIONING_LOCAL = 'true';
  process.env.HOST = '127.0.0.1';
  try {
    const tenant = {
      slug: 'i3-test', id: '00000000-0000-4000-8000-000000000001', name: 'Institución test',
      admin_email: 'admin@example.test', plan_slug: 'estandar', region: 'us-east-1', engine: 'terraform',
      status: 'PENDING', resources: {}, deployment_metadata: {},
    };
    const plan = {
      slug: 'estandar', name: 'Estándar', description: 'fixture', max_students: 100,
      backup_policy: 'manual', roles: {}, catalog_version: '1.0.0',
    };
    const images = ['frontend', 'backend', 'database'].map(role => ({
      role, provider: 'aws', region: 'us-east-1', ami_id: 'ami-' + 'a'.repeat(17),
      image_version: '1.0.0', packer_version: '1.14.3', built_at: new Date().toISOString(), source_revision: 'a'.repeat(40),
    }));
    let updateCount = 0;
    const repository = {
      findOneBy: async () => tenant,
      update: async (criteria, changes) => {
        updateCount++;
        assert.deepEqual(criteria, { slug: 'i3-test', status: 'PENDING' });
        tenant.status = 'PROVISIONING';
        tenant.resources = changes.resources;
        return { affected: 1 };
      },
    };
    const service = new DemoProvisioningService(repository, { findOneBy: async () => plan }, { list: async () => images });
    service.capabilities = async () => ({ enabled: true, ready: true, missing: [], supported_engines: ['terraform'] });
    let workerInput;
    service.runWorker = (_slug, input) => { workerInput = input; };
    const operation = await service.start('i3-test', { confirm: 'i3-test' });
    assert.equal(operation.status, 'RUNNING');
    assert.equal(tenant.status, 'PROVISIONING');
    assert.deepEqual(workerInput.tenant, {
      slug: 'i3-test', name: 'Institución test', email: 'admin@example.test', plan_slug: 'estandar',
      region: 'us-east-1', engine: 'terraform', request_id: tenant.id,
    });
    await assert.rejects(() => service.start('i3-test', { confirm: 'i3-test' }));
    assert.equal(updateCount, 1);
  } finally {
    if (oldEnabled === undefined) delete process.env.DEMO_PROVISIONING_LOCAL; else process.env.DEMO_PROVISIONING_LOCAL = oldEnabled;
    if (oldHost === undefined) delete process.env.HOST; else process.env.HOST = oldHost;
  }
});

test('el resultado estructurado final del worker llega a la persistencia', async t => {
  const { EventEmitter } = require('node:events');
  const childProcess = require('node:child_process');
  const { DemoProvisioningService } = require('../apps/backend/dist/demo-provisioning/demo-provisioning.service');
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = { resume() {} };
  child.stdin = new EventEmitter();
  child.stdin.end = () => {
    process.nextTick(() => {
      child.stdout.emit('data', Buffer.from(JSON.stringify({
        stage: 'result', status: 'succeeded', result: {}, metadata: {}, access_url: 'https://192.0.2.10',
      }) + '\n'));
      child.emit('close', 0);
    });
  };
  child.kill = () => {};
  t.mock.method(childProcess, 'spawn', () => child);
  const service = new DemoProvisioningService({}, {}, {});
  const operation = { operation_id: '00000000-0000-4000-8000-000000000001', tenant_slug: 'i3-test',
    status: 'RUNNING', stage: 'verify', events: [], result: null, access_url: null, error: null };
  const finished = new Promise(resolve => {
    service.finish = (...args) => { resolve(args); return Promise.resolve(); };
  });
  service.runWorker('i3-test', {}, operation);
  const [slug, , success, , outcome] = await finished;
  assert.equal(slug, 'i3-test');
  assert.equal(success, true);
  assert.equal(outcome.access_url, 'https://192.0.2.10');
});

test('el resultado fallido se persiste sin sobrescribir metadatos ni direcciones existentes', async () => {
  const { DemoProvisioningService } = require('../apps/backend/dist/demo-provisioning/demo-provisioning.service');
  const tenant = { slug: 'i3-test', status: 'PROVISIONING', resources: { previous: true }, deployment_metadata: { previous: true } };
  let update;
  const repository = {
    findOneBy: async () => tenant,
    query: async (sql, params) => { update = { sql, params }; return [[{ slug: tenant.slug }], 1]; },
  };
  const service = new DemoProvisioningService(repository, {}, {});
  const operation = { operation_id: '00000000-0000-4000-8000-000000000001', tenant_slug: tenant.slug,
    status: 'RUNNING', stage: 'provision', events: [], result: null, access_url: null, error: null };
  service.jobs.set(tenant.slug, operation);
  await service.finish(tenant.slug, operation, false, 'Falló Terraform.');
  assert.equal(update.params[0], 'ERROR');
  const resources = JSON.parse(update.params[1]);
  assert.equal(resources.previous, true);
  assert.equal(resources.demo_operation.error, 'Falló Terraform.');
  assert.deepEqual(update.params.slice(2, 7), [null, null, null, null, null]);
  assert.equal(update.params[7], tenant.slug);
  assert.equal(service.jobs.has(tenant.slug), false);
});

test('un fallo de persistencia sigue visible para el diagnóstico de la operación', async t => {
  const { DemoProvisioningService } = require('../apps/backend/dist/demo-provisioning/demo-provisioning.service');
  const tenant = { slug: 'i3-test', status: 'PROVISIONING', resources: {} };
  const service = new DemoProvisioningService({
    findOneBy: async () => tenant,
    query: async () => { throw new Error('database unavailable'); },
  }, {}, {});
  const operation = { operation_id: '00000000-0000-4000-8000-000000000001', tenant_slug: tenant.slug,
    status: 'RUNNING', stage: 'provision', events: [], result: null, access_url: null, error: null };
  service.jobs.set(tenant.slug, operation);
  t.mock.method(console, 'error', () => {});
  await service.finish(tenant.slug, operation, false, 'Falló Terraform.');
  assert.equal(service.jobs.get(tenant.slug).stage, 'persistence');
  assert.match(operation.error, /reconciliación manual/);
});

test('PostgreSQL guarda el resultado demo sin tocar tenants reales', { skip: process.env.DEMO_POSTGRES_TEST !== '1' }, async () => {
  const backendRequire = require('module').createRequire(require('path').resolve('apps/backend/package.json'));
  const { DataSource } = backendRequire('typeorm');
  const { databaseOptions } = require('../apps/backend/dist/database/options');
  const { DemoProvisioningService } = require('../apps/backend/dist/demo-provisioning/demo-provisioning.service');
  const db = new DataSource({ ...databaseOptions(), migrationsRun: false });
  await db.initialize();
  const runner = db.createQueryRunner();
  try {
    await runner.connect();
    await runner.query(`CREATE TEMP TABLE tenants (
      slug varchar PRIMARY KEY, status varchar NOT NULL, resources jsonb NOT NULL,
      access_url varchar, frontend_public_ip inet, backend_private_ip inet, db_private_ip inet,
      deployment_metadata jsonb NOT NULL
    )`);
    await runner.query(`INSERT INTO tenants (slug, status, resources, access_url, deployment_metadata)
      VALUES ('demo-fixture', 'PROVISIONING', '{"previous":true}', 'https://previous.example', '{"previous":true}')`);
    const tenant = { slug: 'demo-fixture', status: 'PROVISIONING', resources: { previous: true },
      deployment_metadata: { previous: true } };
    const service = new DemoProvisioningService({
      findOneBy: async () => tenant,
      query: (sql, params) => runner.query(sql, params),
    }, {}, {});
    const operation = { operation_id: '00000000-0000-4000-8000-000000000001', tenant_slug: tenant.slug,
      status: 'RUNNING', stage: 'provision', events: [], result: null, access_url: null, error: null };
    service.jobs.set(tenant.slug, operation);
    await service.finish(tenant.slug, operation, false, 'Falló Terraform.');
    const [saved] = await runner.query('SELECT status, resources, access_url, deployment_metadata FROM tenants WHERE slug = $1', [tenant.slug]);
    assert.equal(saved.status, 'ERROR');
    assert.equal(saved.resources.demo_operation.error, 'Falló Terraform.');
    assert.equal(saved.resources.previous, true);
    assert.equal(saved.access_url, 'https://previous.example');
    assert.equal(saved.deployment_metadata.previous, true);
    assert.equal(service.jobs.has(tenant.slug), false);

    await runner.query("UPDATE tenants SET status = 'PROVISIONING' WHERE slug = $1", [tenant.slug]);
    tenant.id = '00000000-0000-4000-8000-000000000002';
    tenant.engine = 'terraform';
    tenant.region = 'us-east-1';
    tenant.plan_slug = 'estandar';
    const roles = ['frontend', 'backend', 'database'];
    const imageId = 'ami-' + 'a'.repeat(17);
    const images = roles.map(role => ({ role, ami_id: imageId, provider: 'aws', region: tenant.region,
      image_version: '1.0.0', packer_version: '1.14.3', source_revision: 'a'.repeat(40),
      built_at: '2026-01-01T00:00:00.000Z' }));
    const nodes = Object.fromEntries(roles.map(role => [role, { image_id: imageId, instance_id: 'i-' + 'a'.repeat(17),
      private_ip: '10.0.0.10', public_ip: role === 'frontend' ? '192.0.2.10' : null }]));
    const result = { schema_version: 1, tenant_slug: tenant.slug, request_id: tenant.id, region: tenant.region,
      engine: tenant.engine, nodes, network: { vpc_id: 'vpc-abcd', subnet_ids: [], security_group_ids: [] },
      state_reference: { backend: 'local-workspace', key_or_stack: 'fixture' } };
    const metadata = { application_revision: 'a'.repeat(40) + ':' + 'b'.repeat(40),
      infrastructure_revision: 'c'.repeat(64), engine_version: 'Terraform v1.16.6',
      ansible_version: 'ansible [core 2.16.0]', images,
      plan_snapshot: { slug: tenant.plan_slug, roles: { frontend: {}, backend: {}, database: {} } },
      demo_initial_credentials_verified: true, demo_vault_reference: 'local-vault:demo-fixture',
      release_id: 'd'.repeat(32) };
    const successful = { ...operation, status: 'RUNNING', stage: 'verify', events: [], result: null, error: null };
    service.jobs.set(tenant.slug, successful);
    await service.finish(tenant.slug, successful, true, '', { result, metadata, access_url: 'https://192.0.2.10' });
    const [active] = await runner.query('SELECT status, access_url, deployment_metadata FROM tenants WHERE slug = $1', [tenant.slug]);
    assert.equal(active.status, 'ACTIVE');
    assert.equal(active.access_url, 'https://192.0.2.10');
    assert.equal(active.deployment_metadata.previous, true);
    assert.equal(active.deployment_metadata.demo_initial_credentials_verified, true);
    assert.equal(service.jobs.has(tenant.slug), false);
  } finally {
    await runner.release();
    await db.destroy();
  }
});

test('controlador de aprovisionamiento solo acepta el panel local', async () => {
  const { DemoProvisioningController } = require('../apps/backend/dist/demo-provisioning/demo-provisioning.controller');
  let calls = 0;
  const controller = new DemoProvisioningController({
    capabilities: async () => { calls++; return {}; },
    start: async () => { calls++; return {}; },
    operation: async () => { calls++; return {}; },
  });
  const local = { socket: { remoteAddress: '127.0.0.1' } };
  const remote = { socket: { remoteAddress: '192.0.2.1' } };
  await assert.rejects(() => controller.capabilities(remote, 'TenantControlCenter'));
  await assert.rejects(() => controller.capabilities(local, undefined));
  await assert.rejects(() => controller.start(local, 'https://example.com', 'TenantControlCenter', 'i3-test', {}));
  await assert.rejects(() => controller.operation(remote, 'TenantControlCenter', 'i3-test'));
  assert.equal(calls, 0);
  await controller.start(local, 'http://127.0.0.1:4200', 'TenantControlCenter', 'i3-test', {});
  assert.equal(calls, 1);
});

test('la lista solo anuncia credenciales verificadas sin exponer los metadatos', async () => {
  const { TenantsController } = require('../apps/backend/dist/tenants/tenants.controller');
  const repository = { find: async () => [
    { slug: 'i3-test', status: 'ACTIVE', deployment_metadata: { demo_initial_credentials_verified: true, internal: 'no-publicar' } },
    { slug: 'i3-other', status: 'PENDING', deployment_metadata: { demo_initial_credentials_verified: true } },
  ] };
  const result = await new TenantsController(repository, {}).list();
  assert.equal(result.data[0].demo_credentials_available, true);
  assert.equal(result.data[1].demo_credentials_available, false);
  assert.ok(!JSON.stringify(result).includes('no-publicar'));
  assert.ok(!('deployment_metadata' in result.data[0]));
});
