const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
// Pruebas del monitoreo: webhook de Grafana, alertas y túneles SSH (con un lanzador falso: no se abre ninguna conexión real).
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'clave-solo-para-pruebas';
process.env.WEBHOOK_TOKEN = 'token-de-prueba-del-webhook';
process.env.LIFECYCLE_SIMULATE = 'false';
process.env.DEMO_PROVISIONING_LOCAL = 'false';
delete process.env.HOST;
const backendRequire = require('node:module').createRequire(path.resolve('apps/backend/package.json'));
backendRequire('reflect-metadata');
const { NestFactory } = backendRequire('@nestjs/core');
const { DataSource } = backendRequire('typeorm');
const { AppModule } = require('../apps/backend/dist/app.module');
const { TunnelsService } = require('../apps/backend/dist/monitoring/tunnels.service');

const SLUG = 'zz-prueba-monitor';
const TARGETS = ['targets', 'targets-postgres', 'targets-http'].map(dir => path.resolve('infrastructure/observability/prometheus', dir, `tenant-${SLUG}.json`));
let app, base, token;
const database = () => app.get(DataSource);
const api = (route, { method = 'GET', body, headers = {}, session = true } = {}) => fetch(base + '/api' + route, {
  method, body: body === undefined ? undefined : JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', ...(session && token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
});
const alerta = (extra = {}) => ({ status: 'firing', fingerprint: 'abc123def456', startsAt: '2026-11-15T10:00:00Z', endsAt: '0001-01-01T00:00:00Z',
  labels: { alertname: 'Servidor del tenant sin respuesta', tenant: SLUG, role: 'backend', severity: 'critical' },
  annotations: { summary: 'Servidor backend del tenant ' + SLUG + ' sin respuesta' }, ...extra });
const webhook = (alerts, headers) => api('/monitoring/alerts', { method: 'POST', body: { receiver: 'Tenant Control Center', alerts }, headers, session: false });

async function limpiar() {
  await database().query('DELETE FROM tenant_alerts WHERE tenant_slug = $1', [SLUG]);
  await database().query('DELETE FROM tenants WHERE slug = $1', [SLUG]);
  for (const file of TARGETS) fs.rmSync(file, { force: true });
}

before(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  await limpiar();
  const result = { schema_version: 1, request_id: 'req', tenant_slug: SLUG, engine: 'cloudformation', region: 'us-east-1',
    nodes: { frontend: { instance_id: 'i-0123456789abcdef0', image_id: 'ami-0123456789abcdef0', private_ip: '10.0.1.10', public_ip: '198.51.100.7' },
      backend: { instance_id: 'i-0123456789abcdef1', image_id: 'ami-0123456789abcdef0', private_ip: '10.0.1.11', public_ip: null },
      database: { instance_id: 'i-0123456789abcdef2', image_id: 'ami-0123456789abcdef0', private_ip: '10.0.2.12', public_ip: null } },
    network: { vpc_id: 'vpc-0abc123', subnet_ids: ['subnet-0abc1'], security_group_ids: ['sg-0abc1'] }, state_reference: { backend: 'cloudformation', key_or_stack: 'x' } };
  // Fila de prueba de la base local (prefijo zz): se elimina al terminar y no es un despliegue real.
  await database().query(`INSERT INTO tenants (slug, name, admin_email, plan_slug, region, engine, status, access_url, resources)
    VALUES ($1, 'Prueba monitoreo', 'prueba@example.edu', 'basico', 'us-east-1', 'cloudformation', 'ACTIVE', 'https://198.51.100.7', $2::jsonb)`, [SLUG, JSON.stringify({ provisioning_result: result })]);
  const login = await api('/auth/login', { method: 'POST', body: { user: 'admin', password: process.env.ADMIN_PASSWORD }, session: false });
  token = (await login.json()).data.token;
});
after(async () => { if (app) { await limpiar(); await app.close(); } });

test('el webhook exige el token compartido y no acepta la sesión del panel como sustituto', async () => {
  assert.equal((await webhook([alerta()])).status, 401);
  assert.equal((await webhook([alerta()], { Authorization: 'Bearer otro-token' })).status, 401);
  assert.equal((await api('/monitoring/alerts', { method: 'POST', body: { alerts: [alerta()] }, session: true })).status, 401);
  assert.equal((await api('/monitoring/alerts', { session: false })).status, 401, 'consultar alertas sí exige sesión');
});

test('una alerta disparada se guarda con su tenant y hora, y al resolverse actualiza la misma fila', async () => {
  const bearer = { Authorization: 'Bearer ' + process.env.WEBHOOK_TOKEN };
  let response = await webhook([alerta(), alerta({ fingerprint: 'zzz999', labels: { alertname: 'x', tenant: 'no-existe', severity: 'critical' } }), { basura: true }], bearer);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { received: 3, stored: 1, ignored: 2 });
  let list = (await (await api(`/monitoring/alerts?tenant=${SLUG}`)).json()).data;
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'FIRING');
  assert.equal(list[0].tenant_slug, SLUG);
  assert.equal(list[0].role, 'backend');
  assert.equal(list[0].severity, 'critical');
  assert.equal(list[0].detected_at, '2026-11-15T10:00:00.000Z');
  assert.equal(list[0].resolved_at, null);

  response = await webhook([alerta({ status: 'resolved', endsAt: '2026-11-15T10:07:00Z' })], { 'X-Webhook-Token': process.env.WEBHOOK_TOKEN });
  assert.equal(response.status, 200);
  list = (await (await api(`/monitoring/alerts?tenant=${SLUG}`)).json()).data;
  assert.equal(list.length, 1, 'se actualiza la misma alerta');
  assert.equal(list[0].status, 'RESOLVED');
  assert.equal(list[0].resolved_at, '2026-11-15T10:07:00.000Z');
  assert.equal((await (await api(`/monitoring/alerts?tenant=${SLUG}&status=FIRING`)).json()).data.length, 0);

  await webhook([alerta({ startsAt: '2026-11-15T11:00:00Z' })], bearer);
  list = (await (await api(`/monitoring/alerts?tenant=${SLUG}`)).json()).data;
  assert.equal(list[0].status, 'FIRING');
  assert.equal(list[0].resolved_at, null);
});

test('estado: enlaces a Grafana y túneles deshabilitados fuera de la demo local', async () => {
  const data = (await (await api('/monitoring/status')).json()).data;
  assert.match(data.dashboard_url, /^http:\/\/localhost:\d+\/d\/tenant-health$/);
  assert.equal(data.tunnels_enabled, false);
  assert.equal(data.webhook_configured, true);
});

test('túneles: cuatro conexiones por tenant a través del bastión, targets con etiquetas y cierre limpio', async () => {
  const service = app.get(TunnelsService);
  const calls = [];
  const killed = [];
  service.spawner = (executable, args) => {
    calls.push({ executable, args });
    const listeners = {};
    return { on: (event, fn) => { listeners[event] = fn; }, kill: () => { killed.push(args.join(' ')); } };
  };
  const previous = { demo: process.env.DEMO_PROVISIONING_LOCAL, key: process.env.DEMO_SSH_PRIVATE_KEY_WSL_PATH };
  process.env.DEMO_PROVISIONING_LOCAL = 'true';
  process.env.DEMO_SSH_PRIVATE_KEY_WSL_PATH = '/home/prueba/.ssh/llave.pem';
  try {
    assert.equal(service.enabled(), true);
    const nodes = { frontend: { public_ip: '198.51.100.7', private_ip: '10.0.1.10' }, backend: { public_ip: null, private_ip: '10.0.1.11' }, database: { public_ip: null, private_ip: '10.0.2.12' } };
    await service.ensure(SLUG, 'produccion', nodes);
    assert.equal(calls.length, 4);
    const joined = calls.map(call => call.args.join(' '));
    const ports = joined.map(line => Number(line.match(/-L 0\.0\.0\.0:(\d+):127\.0\.0\.1:(\d+)/)[1]));
    assert.deepEqual(ports, [ports[0], ports[0] + 1, ports[0] + 2, ports[0] + 3]);
    assert.ok(ports[0] >= 19100);
    assert.match(joined[0], /ubuntu@198\.51\.100\.7$/);
    assert.ok(!joined[0].includes('ProxyCommand'), 'el frontend se conecta directo');
    assert.match(joined[1], /ProxyCommand=ssh -W %h:%p .* ubuntu@198\.51\.100\.7 ubuntu@10\.0\.1\.11$/);
    assert.match(joined[2], /ubuntu@10\.0\.2\.12$/);
    assert.match(joined[3], /:127\.0\.0\.1:9187 .* ubuntu@10\.0\.2\.12$/, 'postgres_exporter por el servidor de base de datos');
    assert.ok(joined.every(line => line.includes('StrictHostKeyChecking=accept-new') && line.includes('BatchMode=yes')));

    const [nodesFile, postgresFile, httpFile] = TARGETS.map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
    assert.deepEqual(nodesFile.map(group => group.labels.role), ['frontend', 'backend', 'database']);
    assert.deepEqual(nodesFile[0].labels, { tenant: SLUG, environment: 'produccion', role: 'frontend', scope: 'tenant' });
    assert.equal(nodesFile[1].targets[0], `host.docker.internal:${ports[1]}`);
    assert.equal(postgresFile[0].targets[0], `host.docker.internal:${ports[3]}`);
    assert.deepEqual(httpFile[0].targets, ['https://198.51.100.7/api/health']);
    assert.deepEqual(service.status().map(item => item.status), ['starting', 'starting', 'starting', 'starting']);

    // Reabrir reutiliza el mismo bloque de puertos y no deja procesos duplicados.
    await service.ensure(SLUG, 'produccion', nodes);
    assert.equal(killed.length, 4);
    const again = calls.slice(4).map(call => Number(call.args.join(' ').match(/-L 0\.0\.0\.0:(\d+):/)[1]));
    assert.deepEqual(again, ports);

    await service.close(SLUG);
    assert.equal(service.status().length, 0);
    for (const file of TARGETS) assert.equal(fs.existsSync(file), false);
  } finally {
    for (const [name, value] of [['DEMO_PROVISIONING_LOCAL', previous.demo], ['DEMO_SSH_PRIVATE_KEY_WSL_PATH', previous.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
