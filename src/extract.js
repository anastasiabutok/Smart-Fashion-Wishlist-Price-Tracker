import dns from 'node:dns/promises';
import net from 'node:net';

// Read product details from a shop page. Best effort: any field may be missing.

const decode = (s) =>
  String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .trim();

// "12 660,00 Kč" / "12.660,00" / "1,299.50" / 12660 -> number
export function parsePrice(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;
  let s = String(raw).replace(/[\s  ]/g, '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
  const dec = Math.max(lastComma, lastDot);
  if (dec >= 0 && s.length - dec - 1 <= 2 && s.length - dec - 1 > 0) {
    s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
  } else {
    s = s.replace(/[.,]/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function metaTags(html) {
  const out = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const val = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
    if (key && val && !(key in out)) out[key.toLowerCase()] = decode(val[1] ?? val[2]);
  }
  return out;
}

function firstJsonLd(html, type) {
  const found = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const t = [].concat(n['@type'] ?? []);
    if (t.includes(type)) found.push(n);
    if (n['@graph']) walk(n['@graph']);
  };
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1])); } catch { /* ignore broken block */ }
  }
  return found[0] || null;
}

const inStock = (variant) => ![].concat(variant.offers ?? []).some((o) => /OutOfStock|SoldOut|Discontinued/i.test(o?.availability || ''));
const tidySize = (s) => {
  const t = decode(s?.name ?? s).replace(/\s+/g, ' ');
  return /^one ?size$/i.test(t) ? 'One Size' : t;
};

// Zalando lists one variant per size in a ProductGroup; Answear gives Product.size. Returns "S, M" like the form field.
function readSizes(product, group) {
  const raw = group?.hasVariant
    ? [].concat(group.hasVariant).filter(inStock).flatMap((v) => v.size ?? [])
    : [].concat(product?.size ?? []);
  const sizes = [...new Set(raw.map(tidySize).filter(Boolean))];
  return sizes.length ? sizes.join(', ') : null;
}

const CURRENCY_BY_SYMBOL = [[/Kč|CZK/i, 'CZK'], [/€|EUR/i, 'EUR'], [/zł|PLN/i, 'PLN'], [/£|GBP/i, 'GBP'], [/\$|USD/i, 'USD']];
const currencyOf = (text) => CURRENCY_BY_SYMBOL.find(([re]) => re.test(text || ''))?.[1] ?? null;

export function parseProductHtml(html, pageUrl = '') {
  const meta = metaTags(html);
  const ld = firstJsonLd(html, 'Product');
  const r = { name: null, brand: null, color: null, price: null, currency: null, image_url: null, sizes: readSizes(ld, firstJsonLd(html, 'ProductGroup')) };

  if (ld) {
    r.name = ld.name ? decode(ld.name) : null;
    // Answear appends colour and code to the name and repeats them in alternateName: "… Bunny Knot  hnědá 187633".
    const alt = typeof ld.alternateName === 'string' ? decode(ld.alternateName) : '';
    if (alt && r.name?.length > alt.length && r.name.endsWith(alt)) r.name = r.name.slice(0, -alt.length).trim();
    r.brand = decode(ld.brand?.name ?? (typeof ld.brand === 'string' ? ld.brand : '')) || null;
    r.color = ld.color ? decode(ld.color) : null;
    const img = [].concat(ld.image ?? [])[0];
    r.image_url = typeof img === 'string' ? img : img?.url ?? img?.contentUrl ?? null;
    const offer = [].concat(ld.offers ?? [])[0];
    if (offer) {
      r.price = parsePrice(offer.price ?? offer.lowPrice);
      r.currency = offer.priceCurrency || null;
    }
  }

  // Open Graph / Twitter cards (what Zalando exposes)
  if (!r.price) {
    r.price = parsePrice(meta['twitter:data1'] ?? meta['product:price:amount'] ?? meta['og:price:amount']);
    r.currency ||= meta['product:price:currency'] || currencyOf(meta['twitter:data1']);
  }
  if (!r.price) {
    const m = /za\s+([\d\s., ]+\s*(?:Kč|€|zł|£|\$))/i.exec(meta['og:description'] || '');
    if (m) { r.price = parsePrice(m[1]); r.currency ||= currencyOf(m[1]); }
  }
  r.color ||= meta['twitter:label2']?.match(/barv|colou?r|farbe/i) ? meta['twitter:data2'] || null : null;
  // Some shops put their logo in og:image; that is not the product photo.
  if (!r.image_url && meta['og:image'] && !/logo|share\./i.test(meta['og:image'])) r.image_url = meta['og:image'];

  // Title: "Tory Burch ELEANOR SLIM SHOULDER BAG - Kabelka - albarossa/bordeaux - Zalando.cz"
  let title = decode(meta['og:title'] || /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '');
  // Answear style: "Brand product name, barva hnědá | ANSWEAR.cz"
  const bm = /,\s*(?:barva|color|colour)\s+([^|,]+?)\s*(?:\||$)/i.exec(title);
  if (bm) { r.color ||= bm[1].trim(); title = title.replace(bm[0], ' |'); }
  if (!r.name && title) {
    const parts = title.split(/\s+[-–|]\s+/).map((p) => p.trim()).filter(Boolean);
    // Drop trailing shop name (contains a dot, e.g. Zalando.cz) and the colour part
    while (parts.length > 1 && /\.[a-z]{2,3}$/i.test(parts[parts.length - 1])) parts.pop();
    if (parts.length > 2 && r.color) parts.pop();
    r.name = parts[0] || title;
  }
  if (r.name && !r.brand) {
    // Zalando writes "Brand PRODUCT NAME": brand in normal case, product name in capitals.
    const m = /^((?:[A-ZÀ-Ž][\p{L}'.&]*[a-zà-ž][\p{L}'.&]*\s)+)([A-ZÀ-Ž0-9][A-ZÀ-Ž0-9'&.-]+(?:\s.*)?)$/u.exec(r.name);
    if (m) { r.brand = m[1].trim(); r.name = m[2].trim(); }
  }
  if (r.name && !r.brand && meta['og:title']) {
    // Brand is the start of the title in "Brand PRODUCT NAME - …"
    const first = decode(meta['og:title']).split(/\s+[-–|]\s+/)[0];
    const i = first.toUpperCase().indexOf(r.name.toUpperCase());
    if (i > 0) r.brand = first.slice(0, i).trim();
  }
  if (r.brand && r.name?.toLowerCase().startsWith(r.brand.toLowerCase() + ' ')) {
    // Answear's brand field is all lowercase ("tory burch"); the name has the real spelling.
    if (r.brand === r.brand.toLowerCase()) r.brand = r.name.slice(0, r.brand.length);
    const rest = r.name.slice(r.brand.length).trim();
    r.name = rest.charAt(0).toUpperCase() + rest.slice(1);
  }

  try { if (r.image_url) r.image_url = new URL(r.image_url, pageUrl).href; } catch { r.image_url = null; }
  if (r.image_url && !/^https?:/.test(r.image_url)) r.image_url = null;
  return r;
}

// ---- Fetching, with protection against being pointed at the local network ----

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  return true;
}

async function assertPublicUrl(u) {
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('Only http(s) links are supported'), { status: 400 });
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw Object.assign(new Error('That address is not allowed'), { status: 400 });
  }
}

async function safeGet(rawUrl, { maxBytes, accept, timeoutMs = 10000 }, fetchFn = fetch) {
  let url = new URL(rawUrl);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublicUrl(url);
    const res = await fetchFn(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; PersonalPriceTracker/0.1)', accept, 'accept-language': 'cs,en;q=0.8' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url);
      continue;
    }
    if (!res.ok) throw Object.assign(new Error(`The shop answered with status ${res.status}`), { status: 502 });
    const chunks = [];
    let size = 0;
    for await (const c of res.body) {
      size += c.length;
      if (size > maxBytes) break; // enough: product data is near the top of the page
      chunks.push(c);
    }
    return { buf: Buffer.concat(chunks), type: res.headers.get('content-type') || '', url: url.href };
  }
  throw Object.assign(new Error('Too many redirects'), { status: 502 });
}

export async function extractFromUrl(rawUrl, { fetchFn } = {}) {
  let u;
  try { u = new URL(rawUrl); } catch { throw Object.assign(new Error('That does not look like a link'), { status: 400 }); }
  const { buf, url } = await safeGet(u.href, { maxBytes: 2 * 1024 * 1024, accept: 'text/html' }, fetchFn);
  const r = parseProductHtml(buf.toString('utf8'), url);
  r.url = url;
  r.shop = shopFromHost(new URL(url).hostname);
  return r;
}

export async function downloadImage(rawUrl, { fetchFn } = {}) {
  const { buf } = await safeGet(rawUrl, { maxBytes: 5 * 1024 * 1024, accept: 'image/*' }, fetchFn);
  return buf;
}

const SHOP_HOSTS = [
  ['lounge', 'Zalando Lounge'], ['zalando', 'Zalando'], ['answear', 'Answear'], ['aboutyou', 'AboutYou'],
  ['bestsecret', 'BestSecret'], ['farfetch', 'Farfetch'], ['mytheresa', 'Mytheresa'], ['net-a-porter', 'Net-a-Porter'],
  ['ssense', 'SSENSE'], ['shopbop', 'Shopbop'], ['luisaviaroma', 'LuisaViaRoma'],
];
export function shopFromHost(host) {
  const h = host.toLowerCase();
  return SHOP_HOSTS.find(([k]) => h.includes(k))?.[1] ?? null;
}
