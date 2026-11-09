import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePrice, parseProductHtml, isPrivateIp, extractFromUrl, shopFromHost } from '../src/extract.js';

test('parsePrice handles Czech and English formats', () => {
  assert.equal(parsePrice('12 660,00 Kč'), 12660);
  assert.equal(parsePrice('12 660,00 Kč'), 12660);
  assert.equal(parsePrice('1,299.50'), 1299.5);
  assert.equal(parsePrice('1.299,50 €'), 1299.5);
  assert.equal(parsePrice('990'), 990);
  assert.equal(parsePrice('abc'), null);
  assert.equal(parsePrice(null), null);
});

test('reads a Zalando-style page (og/twitter tags, no JSON-LD)', () => {
  const r = parseProductHtml(readFileSync(new URL('./fixtures/zalando-bag.html', import.meta.url), 'utf8'), 'https://www.zalando.cz/x.html');
  assert.equal(r.name, 'ELEANOR SLIM SHOULDER BAG');
  assert.equal(r.brand, 'Tory Burch');
  assert.equal(r.color, 'albarossa');
  assert.equal(r.price, 12660);
  assert.equal(r.currency, 'CZK');
  assert.equal(r.image_url, 'https://img01.ztat.net/article/x.jpg?imwidth=800&filter=packshot');
});

test('reads JSON-LD Product data', () => {
  const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Coat","brand":{"name":"Acme"},"color":"black","image":["/a.jpg"],"offers":{"price":"2490.00","priceCurrency":"CZK"}}</script>`;
  const r = parseProductHtml(html, 'https://shop.example/p/1');
  assert.deepEqual([r.name, r.brand, r.color, r.price, r.currency, r.image_url], ['Coat', 'Acme', 'black', 2490, 'CZK', 'https://shop.example/a.jpg']);
});

test('an empty page gives empty fields, not an error', () => {
  const r = parseProductHtml('<html></html>');
  assert.equal(r.name, null);
  assert.equal(r.price, null);
});

test('private addresses are refused', async () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '172.16.0.1', '::1', 'fd00::1']) assert.ok(isPrivateIp(ip), ip);
  assert.ok(!isPrivateIp('8.8.8.8'));
  await assert.rejects(extractFromUrl('http://127.0.0.1:3000/'), /not allowed/);
  await assert.rejects(extractFromUrl('file:///etc/passwd'), /http/);
  await assert.rejects(extractFromUrl('nonsense'), /link/);
});

test('shop names from host', () => {
  assert.equal(shopFromHost('www.zalando.cz'), 'Zalando');
  assert.equal(shopFromHost('answear.cz'), 'Answear');
  assert.equal(shopFromHost('www.aboutyou.cz'), 'AboutYou');
  assert.equal(shopFromHost('example.com'), null);
});
