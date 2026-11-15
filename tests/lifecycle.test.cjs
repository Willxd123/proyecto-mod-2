const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
// Pruebas locales de acceso, auditoría y ciclo de vida. No tocan AWS: el worker corre en modo explícito de simulación.
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'clave-solo-para-pruebas';
process.env.LIFECYCLE_SIMULATE = 'true';
process.env.DEMO_PROVISIONING_LOCAL = 'false';
delete process.env.HOST;
const backendRequire = require('node:module').createRequire(path.resolve('apps/backend/package.json'));
backendRequire('reflect-metadata');
const { NestFactory } = backendRequire('@nestjs/core');
const { DataSource } = backendRequire('typeorm');
const { AppModule } = require('../apps/backend/dist/app.module');
const { cleanDetail, cleanText } = require('../apps/backend/dist/audit/audit.service');

const SLUG = 'zz-prueba-ciclo';
const LOCAL = { Origin: 'http://127.0.0.1:4200', 'X-Requested-With': 'TenantControlCenter', 'Content-Type': 'application/json' };
let app, base, token;
const database = () => app.get(DataSource);
const api = (route, { method = 'GET', body, headers = {}, auth = true } = {}) => fetch(base + '/api' + route, {
  method, body: body === undefined ? undefined : JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(slug, wanted) {
  for (let i = 0; i < 60; i += 1) {
    const { data } = await (await api(`/tenants/${slug}/lifecycle/operation`)).json();
    if (data && data.status === wanted) return data;
    if (data && data.status === 'FAILED') assert.fail('La operación falló: ' + data.error);
    await sleep(500);
  }
  assert.fail('La operación no terminó a tiempo.');
}
const status = async () => (await database().query('SELECT status, access_url, frontend_public_ip FROM tenants WHERE slug = $1', [SLUG]))[0];

async function limpiar() {
  await database().query('DELETE FROM tenant_backups WHERE tenant_slug = $1', [SLUG]);
  await database().query('DELETE FROM audit_events WHERE tenant_slug = $1', [SLUG]);
  await database().query('DELETE FROM tenants WHERE slug = $1', [SLUG]);
  fs.rmSync(path.resolve('infrastructure/observability/prometheus/targets', `tenant-${SLUG}.json`), { force: true });
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
    network: { vpc_id: 'vpc-0abc123', subnet_ids: ['subnet-0abc1'], security_group_ids: ['sg-0abc1'] },
    state_reference: { backend: 'cloudformation', key_or_stack: 'i3-' + SLUG } };
  // Fila de prueba de la base local, identificada con prefijo zz y eliminada al terminar; no es un despliegue real.
  await database().query(`INSERT INTO tenants (slug, name, admin_email, plan_slug, region, engine, status, access_url, resources)
    VALUES ($1, 'Prueba ciclo de vida', 'prueba@example.edu', 'basico', 'us-east-1', 'cloudformation', 'ACTIVE', 'https://198.51.100.7', $2::jsonb)`,
  [SLUG, JSON.stringify({ provisioning_result: result })]);
});
after(async () => {
  if (app) { await limpiar(); await app.close(); }
});

test('la auditoría limpia texto y descarta claves sensibles', () => {
  assert.equal(cleanText('línea 1\nlínea 2\u0000', 50), 'línea 1 línea 2');
  assert.equal(cleanText('x'.repeat(500), 20).length, 20);
  assert.deepEqual(cleanDetail({ motor: 'terraform', password: 'x', api_token: 'y', ssh_key: 'z', n: 3, anidado: { a: 1 }, 'Mal-Nombre': 1 }), { motor: 'terraform', n: 3 });
});

test('acceso: exige sesión, bloquea tokens alterados y audita el login', async () => {
  assert.equal((await api('/health', { auth: false })).status, 200);
  assert.equal((await api('/tenants', { auth: false })).status, 401);
  assert.equal((await api('/auth/login', { method: 'POST', body: { user: 'admin', password: 'incorrecta' }, auth: false })).status, 401);
  const ok = await api('/auth/login', { method: 'POST', body: { user: 'admin', password: process.env.ADMIN_PASSWORD }, auth: false });
  assert.equal(ok.status, 200);
  token = (await ok.json()).data.token;
  assert.equal((await api('/tenants')).status, 200);
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ u: 'admin', e: Date.now() + 1e9 })).toString('base64url') + '.' + signature;
  assert.equal((await api('/tenants', { auth: false, headers: { Authorization: 'Bearer ' + forged } })).status, 401);
  assert.ok(payload);
  const log = await (await api('/audit?action=LOGIN&limit=10')).json();
  assert.ok(log.data.some(e => e.status === 'FAILED' && e.actor === 'admin'));
  assert.ok(log.data.some(e => e.status === 'SUCCEEDED' && e.actor === 'admin'));
});

test('ciclo de vida: rechaza solicitudes sin origen local, confirmación o estado válido', async () => {
  assert.equal((await api(`/tenants/${SLUG}/suspend`, { method: 'POST', body: { confirm: SLUG } })).status, 403);
  assert.equal((await api(`/tenants/${SLUG}/suspend`, { method: 'POST', body: { confirm: 'otro' }, headers: LOCAL })).status, 400);
  assert.equal((await api(`/tenants/${SLUG}/resume`, { method: 'POST', body: { confirm: SLUG }, headers: LOCAL })).status, 409);
  const info = (await (await api(`/tenants/${SLUG}/lifecycle`)).json()).data;
  assert.equal(info.simulated, true);
  assert.deepEqual(info.allowed_actions.sort(), ['backup', 'delete', 'suspend']);
  assert.equal(info.instances.length, 3);
  assert.ok(info.will_delete.some(line => line.includes('vpc-0abc123')));
});

test('suspender, reanudar y eliminar: estados, direcciones y auditoría completa', async () => {
  let response = await api(`/tenants/${SLUG}/suspend`, { method: 'POST', body: { confirm: SLUG }, headers: LOCAL });
  assert.equal(response.status, 201);
  assert.equal((await status()).status, 'SUSPENDING');
  // Una sola operación por tenant: la segunda solicitud se rechaza mientras la primera corre.
  assert.equal((await api(`/tenants/${SLUG}/delete`, { method: 'POST', body: { confirm: SLUG }, headers: LOCAL })).status, 409);
  const suspended = await waitFor(SLUG, 'SUCCEEDED');
  assert.equal(suspended.action, 'suspend');
  assert.equal(suspended.actor, 'admin');
  assert.equal(suspended.simulated, true);
  let row = await status();
  assert.equal(row.status, 'SUSPENDED');
  assert.equal(row.access_url, null);

  await sleep(300);
  response = await api(`/tenants/${SLUG}/resume`, { method: 'POST', body: { confirm: SLUG }, headers: LOCAL });
  assert.equal(response.status, 201);
  await sleep(500);
  for (let i = 0; i < 60 && (await status()).status === 'RESUMING'; i += 1) await sleep(500);
  row = await status();
  assert.equal(row.status, 'ACTIVE');
  assert.match(row.access_url, /^https:\/\/203\.0\.113\.\d+$/);
  assert.equal(row.frontend_public_ip, row.access_url.replace('https://', ''));
  const listed = (await (await api('/tenants')).json()).data.find(item => item.slug === SLUG);
  assert.equal(listed.simulated, true);
  assert.ok(!('resources' in listed));
  assert.ok(fs.existsSync(path.resolve('infrastructure/observability/prometheus/targets', `tenant-${SLUG}.json`)));

  response = await api(`/tenants/${SLUG}/delete`, { method: 'POST', body: { confirm: SLUG }, headers: LOCAL });
  assert.equal(response.status, 201);
  for (let i = 0; i < 60 && (await status()).status === 'DELETING'; i += 1) await sleep(500);
  assert.equal((await status()).status, 'DELETED');
  assert.equal(fs.existsSync(path.resolve('infrastructure/observability/prometheus/targets', `tenant-${SLUG}.json`)), false);

  const audit = await (await api(`/audit?tenant=${SLUG}&limit=200`)).json();
  const actions = new Set(audit.data.map(e => e.action));
  for (const action of ['SUSPEND', 'RESUME', 'DELETE', 'MONITORING_TARGETS']) assert.ok(actions.has(action), action);
  assert.ok(audit.data.filter(e => e.status === 'SUCCEEDED').length >= 3);
  assert.ok(audit.data.every(e => e.actor === 'admin' || e.actor === 'sistema'));
  assert.ok(audit.data.every(e => !/clave-solo-para-pruebas/.test(JSON.stringify(e))));
  const timeline = await (await api('/audit/operations/' + suspended.operation_id)).json();
  assert.equal(timeline.data[0].status, 'STARTED');
  assert.ok(timeline.data.some(e => e.stage === 'suspend'));
  assert.equal(timeline.data.at(-1).status, 'SUCCEEDED');
  // Un tenant eliminado no admite más operaciones.
  assert.equal((await api(`/tenants/${SLUG}/suspend`, { method: 'POST', body: { confirm: SLUG }, headers: LOCAL })).status, 409);
});

test('respaldar y restaurar (simulado): registra el respaldo, exige uno válido y audita ambas operaciones', async () => {
  await database().query("UPDATE tenants SET status = 'ACTIVE' WHERE slug = $1", [SLUG]);
  const waitNext = async previous => {
    for (let i = 0; i < 60; i += 1) {
      const { data } = await (await api(`/tenants/${SLUG}/lifecycle/operation`)).json();
      if (data && data.operation_id !== previous && ['SUCCEEDED', 'FAILED'].includes(data.status)) return data;
      await sleep(500);
    }
    assert.fail('La operación no terminó a tiempo.');
  };
  const before = (await (await api(`/tenants/${SLUG}/lifecycle`)).json()).data;
  assert.deepEqual(before.backups, []);
  assert.ok(before.allowed_actions.includes('backup'));
  assert.ok(!before.allowed_actions.includes('restore'), 'sin respaldos no se puede restaurar');
  assert.equal((await api(`/tenants/${SLUG}/restore`, { method: 'POST', body: { confirm: SLUG, backup_id: '11111111-2222-4333-8444-555555555555' }, headers: LOCAL })).status, 404);

  assert.equal((await api(`/tenants/${SLUG}/backup`, { method: 'POST', body: { confirm: SLUG }, headers: LOCAL })).status, 201);
  assert.equal((await status()).status, 'BACKING_UP');
  const backup = await waitNext(null);
  assert.equal(backup.action, 'backup');
  assert.equal(backup.status, 'SUCCEEDED');
  assert.equal((await status()).status, 'ACTIVE');
  const after = (await (await api(`/tenants/${SLUG}/lifecycle`)).json()).data;
  assert.equal(after.backups.length, 1);
  assert.equal(after.backups[0].simulated, true);
  assert.equal(after.backups[0].actor, 'admin');
  assert.ok(after.allowed_actions.includes('restore'));

  assert.equal((await api(`/tenants/${SLUG}/restore`, { method: 'POST', body: { confirm: SLUG }, headers: LOCAL })).status, 400);
  assert.equal((await api(`/tenants/${SLUG}/restore`, { method: 'POST', body: { confirm: SLUG, backup_id: '11111111-2222-4333-8444-555555555555' }, headers: LOCAL })).status, 404);
  assert.equal((await api(`/tenants/${SLUG}/restore`, { method: 'POST', body: { confirm: SLUG, backup_id: after.backups[0].backup_id }, headers: LOCAL })).status, 201);
  assert.equal((await status()).status, 'RESTORING');
  const restored = await waitNext(backup.operation_id);
  assert.equal(restored.action, 'restore');
  assert.equal(restored.status, 'SUCCEEDED');
  assert.equal((await status()).status, 'ACTIVE');

  const audit = await (await api(`/audit?tenant=${SLUG}&limit=200`)).json();
  const actions = new Set(audit.data.map(e => e.action));
  assert.ok(actions.has('BACKUP') && actions.has('RESTORE'));
});

test('renombrar audita el valor anterior y el nuevo', async () => {
  await database().query(`UPDATE tenants SET status = 'ACTIVE' WHERE slug = $1`, [SLUG]);
  assert.equal((await api(`/tenants/${SLUG}`, { method: 'PATCH', body: { name: '' } })).status, 400);
  const response = await api(`/tenants/${SLUG}`, { method: 'PATCH', body: { name: 'Instituto Renombrado' } });
  assert.equal(response.status, 200);
  assert.equal((await database().query('SELECT name FROM tenants WHERE slug = $1', [SLUG]))[0].name, 'Instituto Renombrado');
  const audit = await (await api(`/audit?tenant=${SLUG}&action=RENAME`)).json();
  assert.equal(audit.data[0].detail.nuevo, 'Instituto Renombrado');
  assert.equal(audit.data[0].detail.anterior, 'Prueba ciclo de vida');
});
