import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parsePrice, parseProductHtml, isPrivateIp, extractFromUrl, shopFromHost, matchProduct } from '../src/extract.js';

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

test('Answear-style title: colour split off, logo image ignored', () => {
  const html = '<meta property="og:title" content="Tory Burch kabelka přes rameno dámská kožená Bunny Knot, barva hnědá | ANSWEAR.cz"><meta property="og:image" content="https://cdn.x/logo_share.ans.png">';
  const r = parseProductHtml(html, 'https://answear.cz/p/x');
  assert.equal(r.color, 'hnědá');
  assert.equal(r.name, 'Tory Burch kabelka přes rameno dámská kožená Bunny Knot');
  assert.equal(r.image_url, null);
});

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('reads a real Answear page: JSON-LD photo, colour from title, clean name and brand, sizes', () => {
  const r = parseProductHtml(fixture('answear-bag.html'), 'https://answear.cz/p/x');
  assert.equal(r.name, 'Kabelka přes rameno dámská kožená Bunny Knot');
  assert.equal(r.brand, 'Tory Burch');
  assert.equal(r.color, 'hnědá');
  assert.equal(r.price, 13990);
  assert.equal(r.currency, 'CZK');
  assert.equal(r.image_url, 'https://img2.ans-media.com/i/700x1050/AW26-TODYPW-89X_F1.avif?v=1791476378');
  assert.equal(r.sizes, 'One Size');
});

test('reads a real Zalando page: tag fields stay correct and sizes come from the ProductGroup', () => {
  const r = parseProductHtml(fixture('zalando-product-group.html'), 'https://www.zalando.cz/x.html');
  assert.equal(r.name, 'ELEANOR SLIM SHOULDER BAG');
  assert.equal(r.brand, 'Tory Burch');
  assert.equal(r.color, 'albarossa');
  assert.equal(r.price, 12660);
  assert.match(r.image_url, /imwidth=800/);
  assert.equal(r.sizes, 'One Size');
});

test('sizes: sold-out variants are left out, duplicates merged, none means null', () => {
  const page = (ld) => `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
  const variant = (size, availability) => ({ '@type': 'Product', size, offers: { availability: `https://schema.org/${availability}` } });
  const group = (...hasVariant) => page({ '@type': 'ProductGroup', hasVariant });
  assert.equal(parseProductHtml(group(variant('S', 'InStock'), variant('M', 'OutOfStock'), variant('L', 'InStock'), variant('L', 'InStock'))).sizes, 'S, L');
  assert.equal(parseProductHtml(group(variant('S', 'OutOfStock'))).sizes, null);
  assert.equal(parseProductHtml(page({ '@type': 'Product', name: 'Coat', size: ['36', '38'] })).sizes, '36, 38');
  assert.equal(parseProductHtml(page({ '@type': 'Product', name: 'Coat' })).sizes, null);
});

test('a JSON-LD brand with no name in the page does not crash', () => {
  const html = '<script type="application/ld+json">{"@type":"Product","brand":{"name":"Acme"}}</script>';
  assert.equal(parseProductHtml(html).brand, 'Acme');
});

test('reads a real Shopbop page: brand, colour and price from the ProductGroup', () => {
  const r = parseProductHtml(fixture('shopbop-bag.html'), 'https://www.shopbop.com/x.htm');
  assert.equal(r.name, 'Eleanor Slim Shoulder Bag');
  assert.equal(r.brand, 'Tory Burch');
  assert.equal(r.color, 'Warm White');
  assert.equal(r.price, 550);
  assert.equal(r.currency, 'USD');
});

test('a price in another currency is not offered as a CZK price', async () => {
  const r = await extractFromUrl('https://8.8.8.8/x', { fetchFn: async () => new Response(fixture('shopbop-bag.html'), { status: 200 }) });
  assert.equal(r.price, null);
  assert.equal(r.foreign_price, 550);
  assert.equal(r.currency, 'USD');
});

const romyZalando = { name: 'ROMY TOTE', brand: 'Tory Burch', color: 'black' };
const romyAnswear = { name: 'Tote taška dámská kožená Romy', brand: 'Tory Burch', color: 'černá' };

test('match: same product worded differently is not uncertain, whichever shop came first', () => {
  assert.deepEqual(matchProduct(romyZalando, romyAnswear), { uncertain: false, reasons: [] });
  assert.deepEqual(matchProduct(romyAnswear, romyZalando), { uncertain: false, reasons: [] });
  const bunny = { name: 'Kabelka přes rameno dámská kožená Bunny Knot', brand: 'Tory Burch', color: 'hnědá' };
  assert.equal(matchProduct(bunny, { name: 'BUNNY KNOT SMALL SHOULDER BAG', brand: 'Tory Burch', color: 'dark cocoa' }).uncertain, false);
});

test('match: a real difference in brand, name or colour is uncertain', () => {
  assert.deepEqual(matchProduct(romyZalando, { ...romyAnswear, brand: 'Gucci' }).reasons, ['different brand']);
  assert.deepEqual(matchProduct(romyZalando, { ...romyAnswear, color: 'hnědá' }).reasons, ['colour differs']);
  const eleanor = { name: 'ELEANOR SLIM SHOULDER BAG', brand: 'Tory Burch', color: 'albarossa' };
  assert.deepEqual(matchProduct(eleanor, { name: 'Bunny Knot Small Shoulder Bag', brand: 'Tory Burch' }).reasons, ['name differs']);
  assert.deepEqual(matchProduct(eleanor, { name: 'Eleanor Slim Shoulder Bag', brand: 'Tory Burch', color: 'Warm White' }).reasons, ['colour differs']);
  assert.equal(matchProduct({ name: 'Bunny Knot Belt Bag' }, { name: 'Bunny Knot Small Shoulder Bag' }).uncertain, true);
});

test('match: an unknown fancy colour name is not treated as a difference', () => {
  assert.equal(matchProduct({ ...romyZalando, color: 'park bench' }, romyAnswear).uncertain, false);
});
