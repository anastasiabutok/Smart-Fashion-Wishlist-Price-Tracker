import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, createStore } from '../src/db.js';
import { createApp } from '../src/server.js';

async function start() {
  const uploadDir = mkdtempSync(join(tmpdir(), 'pt-uploads-'));
  const server = http.createServer(createApp(createStore(openDb(':memory:')), { uploadDir }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, profile, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-profile': profile },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  return { server, call };
}

test('item check flow: shops sorted by final price after code, gated shop unchecked', async () => {
  const { server, call } = await start();
  await call('POST', '/api/codes', 'nasta', { code: '22PRORADOST', shop: 'Zalando', type: 'percent', value: 22, min_order: 1499 });
  const created = await call('POST', '/api/items', 'nasta', {
    name: 'Marianne sweater', brand: 'STAUD', color: 'black', target_price: 5000,
    sources: [
      { shop: 'Zalando', price: 6138, url: 'https://example.test/z' },
      { shop: 'Answear', price: 5500 },
      { shop: 'Zalando Lounge' },
    ],
  });
  assert.equal(created.status, 201);
  const shops = created.json.sources.map((s) => s.shop);
  assert.deepEqual(shops, ['Zalando', 'Answear', 'Zalando Lounge']); // 4787.64 < 5500
  assert.equal(created.json.sources[0].final, 4787.64);
  assert.equal(created.json.sources[2].shop_type, 'gated');
  assert.equal(created.json.sources[2].age, 'not checked yet');
  assert.equal(created.json.at_target, true);
  server.close();
});

test('setting a price on a gated shop records history and ranks it', async () => {
  const { server, call } = await start();
  const created = await call('POST', '/api/items', 'nasta', {
    name: 'Coat', sources: [{ shop: 'Zalando', price: 16000 }, { shop: 'BestSecret' }],
  });
  const lounge = created.json.sources.find((s) => s.shop === 'BestSecret');
  assert.equal((await call('PUT', `/api/sources/${lounge.id}`, 'nasta', { price: 12000 })).status, 200);
  const detail = await call('GET', `/api/items/${created.json.id}`, 'nasta');
  assert.equal(detail.json.sources[0].shop, 'BestSecret');
  assert.equal(detail.json.history.length, 2);
  server.close();
});

test('profiles are isolated', async () => {
  const { server, call } = await start();
  const created = await call('POST', '/api/items', 'nasta', { name: 'Sweater', sources: [{ shop: 'Zalando', price: 1000 }] });
  const sid = created.json.sources[0].id;
  assert.equal((await call('GET', '/api/items', 'mama')).json.length, 0);
  assert.equal((await call('GET', `/api/items/${created.json.id}`, 'mama')).status, 404);
  assert.equal((await call('PUT', `/api/sources/${sid}`, 'mama', { price: 1 })).status, 404);
  server.close();
});

test('missing profile header is rejected', async () => {
  const { server, call } = await start();
  assert.equal((await call('GET', '/api/items', '')).status, 400);
  server.close();
});

// Smallest valid-looking PNG header + padding; the server only checks the first bytes.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

test('photo upload: stored, served back, replaced; fake images and other profiles rejected', async () => {
  const { server, call } = await start();
  const base = `http://127.0.0.1:${server.address().port}`;
  const created = await call('POST', '/api/items', 'nasta', { name: 'Sweater', sources: [{ shop: 'Zalando', price: 1000 }] });
  const post = (profile, body) => fetch(`${base}/api/items/${created.json.id}/photo`, { method: 'POST', headers: { 'x-profile': profile }, body });

  const bad = await post('nasta', Buffer.from('<script>alert(1)</script>'));
  assert.equal(bad.status, 400);
  assert.equal((await post('mama', PNG)).status, 404);

  const ok = await post('nasta', PNG);
  assert.equal(ok.status, 200);
  const url = (await ok.json()).image_url;
  assert.match(url, /^\/uploads\/[a-f0-9]{32}\.png$/);
  const served = await fetch(base + url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');

  const second = await (await post('nasta', PNG)).json();
  assert.notEqual(second.image_url, url);
  assert.equal((await fetch(base + url)).status, 404); // old file removed

  assert.equal((await fetch(`${base}/uploads/..%2f..%2fetc%2fpasswd`)).status, 404);
  server.close();
});

test('too large photo is rejected', async () => {
  const { server, call } = await start();
  const base = `http://127.0.0.1:${server.address().port}`;
  const created = await call('POST', '/api/items', 'nasta', { name: 'Coat' });
  const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 10)]);
  const res = await fetch(`${base}/api/items/${created.json.id}/photo`, { method: 'POST', headers: { 'x-profile': 'nasta' }, body: big }).catch(() => null);
  // Either a clean 413, or the server cut the connection mid-upload; both mean it was refused.
  assert.ok(res === null || res.status === 413);
  server.close();
});
