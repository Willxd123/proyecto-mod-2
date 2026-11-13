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
