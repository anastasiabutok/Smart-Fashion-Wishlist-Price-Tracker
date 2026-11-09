import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, createStore } from '../src/db.js';
import { createApp } from '../src/server.js';
import { productLinks } from '../extension/collect.js';

test('productLinks keeps only product pages of the same shop, without duplicates or tracking', () => {
  const hrefs = [
    '/tory-burch-eleanor-slim-shoulder-bag-t0751h0s6-g11.html?utm=1',
    'https://www.zalando.cz/tory-burch-eleanor-slim-shoulder-bag-t0751h0s6-g11.html',
    '/damske-tasky/', '/wishlist/', 'https://evil.example/x-t0751h0s6-g11.html', 'mailto:a@b.c',
  ];
  assert.deepEqual(productLinks(hrefs, 'https://www.zalando.cz/wishlist/'), ['https://www.zalando.cz/tory-burch-eleanor-slim-shoulder-bag-t0751h0s6-g11.html']);
  assert.deepEqual(productLinks(['/p/x-1'], 'https://answear.cz/wishlist'), ['https://answear.cz/p/x-1']);
  assert.deepEqual(productLinks(['/a'], 'https://unknown-shop.example/'), []);
});

test('POST /api/import adds products, skips ones already saved, reports failures', async () => {
  const good = '<meta property="og:title" content="Acme COAT - Plášť - black - Shop.cz"><meta name="twitter:data1" content="1 000 Kč">';
  const fetchFn = async (u) => (String(u).includes('bad') ? new Response('', { status: 404 }) : new Response(good, { status: 200 }));
  const server = http.createServer(createApp(createStore(openDb(':memory:')), { uploadDir: mkdtempSync(join(tmpdir(), 'imp-')), fetchFn, importDelayMs: 0 }));
  await new Promise((r) => server.listen(0, r));
  const call = (profile, urls) => fetch(`http://127.0.0.1:${server.address().port}/api/import`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-profile': profile }, body: JSON.stringify({ urls }) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  const urls = ['https://8.8.8.8/a', 'https://8.8.8.8/bad'];
  const first = await call('nasta', urls);
  assert.deepEqual(first.json.results.map((r) => r.status), ['added', 'failed']);
  const again = await call('nasta', urls);
  assert.equal(again.json.results[0].status, 'already in your list');
  const other = await call('mom', ['https://8.8.8.8/a']);
  assert.equal(other.json.results[0].status, 'added'); // another profile has its own list
  assert.equal((await call('nasta', [])).status, 400);
  server.close();
});

const page = '<meta property="og:title" content="Acme COAT - Plášť - black - Shop.cz"><meta name="twitter:data1" content="1 000 Kč">';
async function startImport(fetchFn, importDelayMs) {
  const server = http.createServer(createApp(createStore(openDb(':memory:')), { uploadDir: mkdtempSync(join(tmpdir(), 'imp-')), fetchFn, importDelayMs }));
  await new Promise((r) => server.listen(0, r));
  const send = (urls) => fetch(`http://127.0.0.1:${server.address().port}/api/import`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-profile': 'nasta' }, body: JSON.stringify({ urls }) }).then((r) => r.json());
  return { server, send };
}

test('import stops at the first "too many requests" and can continue later', async () => {
  let asked = 0;
  let limited = true;
  const { server, send } = await startImport(async (u) => {
    asked += 1;
    return limited && String(u).includes('/b') ? new Response('', { status: 429 }) : new Response(page, { status: 200 });
  }, 0);
  const urls = ['https://8.8.8.8/a', 'https://8.8.8.8/b', 'https://8.8.8.8/c', 'https://8.8.8.8/d'];
  const first = await send(urls);
  assert.equal(first.rate_limited, true);
  assert.deepEqual(first.results.map((r) => r.status), ['added', 'not tried', 'not tried', 'not tried']);
  assert.equal(asked, 2); // the shop is not asked again after it said stop
  limited = false;
  const second = await send(urls);
  assert.equal(second.rate_limited, false);
  assert.deepEqual(second.results.map((r) => r.status), ['already in your list', 'added', 'added', 'added']);
  server.close();
});

test('import waits between shop pages, but not for links it already has', async () => {
  const { server, send } = await startImport(async () => new Response(page, { status: 200 }), 60);
  const urls = ['https://8.8.8.8/a', 'https://8.8.8.8/b'];
  let start = Date.now();
  await send(urls);
  assert.ok(Date.now() - start >= 60);
  start = Date.now();
  await send(urls);
  assert.ok(Date.now() - start < 60);
  server.close();
});
