const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
// Pruebas del visor de logs: el lanzador de SSH es falso, no se abre ninguna conexión real.
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'clave-solo-para-pruebas';
process.env.LIFECYCLE_SIMULATE = 'false';
process.env.DEMO_PROVISIONING_LOCAL = 'false';
delete process.env.HOST;
const backendRequire = require('node:module').createRequire(path.resolve('apps/backend/package.json'));
backendRequire('reflect-metadata');
const { NestFactory } = backendRequire('@nestjs/core');
const { DataSource } = backendRequire('typeorm');
const { AppModule } = require('../apps/backend/dist/app.module');
const { LogsService } = require('../apps/backend/dist/logs/logs.service');

const SLUG = 'zz-prueba-logs';
let app, base, token, service;
const database = () => app.get(DataSource);
const api = (route) => fetch(base + '/api' + route, { headers: { Authorization: 'Bearer ' + token } });
async function limpiar() {
  await database().query('DELETE FROM audit_events WHERE tenant_slug = $1', [SLUG]);
  await database().query('DELETE FROM tenants WHERE slug = $1', [SLUG]);
}
function activar() {
  const previo = { demo: process.env.DEMO_PROVISIONING_LOCAL, key: process.env.DEMO_SSH_PRIVATE_KEY_WSL_PATH };
  process.env.DEMO_PROVISIONING_LOCAL = 'true';
  process.env.DEMO_SSH_PRIVATE_KEY_WSL_PATH = '/home/prueba/.ssh/llave.pem';
  return () => {
    for (const [name, value] of [['DEMO_PROVISIONING_LOCAL', previo.demo], ['DEMO_SSH_PRIVATE_KEY_WSL_PATH', previo.key]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  };
}

before(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  service = app.get(LogsService);
  await limpiar();
  const result = { schema_version: 1, request_id: 'req', tenant_slug: SLUG, engine: 'cloudformation', region: 'us-east-1',
    nodes: { frontend: { instance_id: 'i-0123456789abcdef0', image_id: 'ami-0123456789abcdef0', private_ip: '10.0.1.10', public_ip: '198.51.100.7' },
      backend: { instance_id: 'i-0123456789abcdef1', image_id: 'ami-0123456789abcdef0', private_ip: '10.0.1.11', public_ip: null },
      database: { instance_id: 'i-0123456789abcdef2', image_id: 'ami-0123456789abcdef0', private_ip: '10.0.2.12', public_ip: null } },
    network: { vpc_id: 'vpc-0abc123', subnet_ids: ['subnet-0abc1'], security_group_ids: ['sg-0abc1'] }, state_reference: { backend: 'cloudformation', key_or_stack: 'x' } };
  // Fila de prueba de la base local (prefijo zz): se elimina al terminar y no es un despliegue real.
  await database().query(`INSERT INTO tenants (slug, name, admin_email, plan_slug, region, engine, status, access_url, resources)
    VALUES ($1, 'Prueba de logs', 'prueba@example.edu', 'basico', 'us-east-1', 'cloudformation', 'ACTIVE', 'https://198.51.100.7', $2::jsonb)`, [SLUG, JSON.stringify({ provisioning_result: result })]);
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'admin', password: process.env.ADMIN_PASSWORD }) });
  token = (await login.json()).data.token;
});
after(async () => { if (app) { await limpiar(); await app.close(); } });

test('lista las fuentes de log de los tres servidores y avisa si la consulta está deshabilitada', async () => {
  const data = (await (await api('/tenants/logs/sources')).json()).data;
  assert.equal(data.enabled, false);
  const roles = new Set(data.sources.map(item => item.role));
  assert.deepEqual([...roles].sort(), ['backend', 'database', 'frontend']);
  assert.ok(data.sources.some(item => item.id === 'backend-aplicacion'));
  assert.equal((await api(`/tenants/${SLUG}/logs?source=backend-aplicacion`)).status, 403, 'deshabilitado fuera de la demo local real');
});

test('lee el log del servidor correcto por el bastión, con un comando de la lista y sin datos sensibles', async () => {
  const restaurar = activar();
  const llamadas = [];
  service.runner = async (executable, args) => {
    llamadas.push({ executable, line: args.join(' ') });
    return { code: 0, stdout: ['2026-11-15T10:00:00+0000 gunicorn: GET /api/health 200', '2026-11-15T10:00:01+0000 login password=abc123', 'ERROR algo falló\x1b[31m', '', 'Bearer-token-eyJ'].join('\n') };
  };
  try {
    let response = await api(`/tenants/${SLUG}/logs?source=backend-aplicacion&lines=50&initial=true`);
    assert.equal(response.status, 200);
    const data = (await response.json()).data;
    assert.equal(data.source, 'backend-aplicacion');
    assert.equal(data.lines.length, 4);
    assert.equal(data.lines[0], '2026-11-15T10:00:00+0000 gunicorn: GET /api/health 200');
    assert.match(data.lines[1], /línea omitida/);
    assert.equal(data.lines[2], 'ERROR algo falló');
    assert.match(data.lines[3], /línea omitida/);
    assert.equal(llamadas.length, 1);
    const line = llamadas[0].line;
    assert.match(line, /ProxyCommand=ssh -W %h:%p .* ubuntu@198\.51\.100\.7 ubuntu@10\.0\.1\.11 sudo -n journalctl -u campus-cloud-zz-prueba-logs\.service -n 50 --no-pager -o short-iso$/);

    await api(`/tenants/${SLUG}/logs?source=frontend-errores&lines=9999`);
    assert.match(llamadas[1].line, /ubuntu@198\.51\.100\.7 sudo -n tail -n 500 \/var\/log\/nginx\/error\.log$/);
    assert.ok(!llamadas[1].line.includes('ProxyCommand'), 'el frontend se conecta directo');
    await api(`/tenants/${SLUG}/logs?source=database-postgres&lines=1`);
    assert.match(llamadas[2].line, /ubuntu@10\.0\.2\.12 sudo -n sh -c 'tail -n 10 \/var\/log\/postgresql/);

    const audit = await (await api(`/audit?tenant=${SLUG}&action=LOGS_VIEW`)).json();
    assert.equal(audit.data.length, 1, 'solo la consulta inicial queda en la auditoría');
    assert.equal(audit.data[0].actor, 'admin');
  } finally { restaurar(); }
});

test('rechaza fuentes desconocidas, tenants que no están activos y errores de SSH sin salida', async () => {
  const restaurar = activar();
  service.runner = async () => ({ code: 255, stdout: '' });
  try {
    assert.equal((await api(`/tenants/${SLUG}/logs?source=rm-rf`)).status, 400);
    assert.equal((await api(`/tenants/${SLUG}/logs?source=backend-aplicacion`)).status, 503);
    assert.equal((await api('/tenants/no-existe-x/logs?source=backend-aplicacion')).status, 404);
    await database().query("UPDATE tenants SET status = 'SUSPENDED' WHERE slug = $1", [SLUG]);
    assert.equal((await api(`/tenants/${SLUG}/logs?source=backend-aplicacion`)).status, 409);
  } finally { restaurar(); }
});
