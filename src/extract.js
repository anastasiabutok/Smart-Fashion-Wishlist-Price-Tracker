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
  const group = firstJsonLd(html, 'ProductGroup');
  const r = { name: null, brand: null, color: null, price: null, currency: null, image_url: null, sizes: readSizes(ld, group) };

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
  // Shopbop has only a ProductGroup with one variant per colour. It fills gaps, so Zalando's tags above still win.
  if (group && !ld) {
    r.brand = decode(group.brand?.name ?? '') || null;
    const variants = [].concat(group.hasVariant ?? []);
    const offer = [].concat((variants.find(inStock) ?? variants[0])?.offers ?? [])[0];
    if (!r.price && offer) {
      r.price = parsePrice(offer.price ?? offer.lowPrice);
      r.currency ||= offer.priceCurrency || null;
    }
    const colours = [...new Set(variants.map((v) => v.color).filter(Boolean))];
    if (colours.length === 1) r.color ||= decode(colours[0]);
  }
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
    if (!res.ok) throw Object.assign(new Error(`The shop answered with status ${res.status}`), { status: 502, shopStatus: res.status });
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

export async function extractFromUrl(rawUrl, { fetchFn, ratesFn = czkRates } = {}) {
  let u;
  try { u = new URL(rawUrl); } catch { throw Object.assign(new Error('That does not look like a link'), { status: 400 }); }
  const { buf, url } = await safeGet(u.href, { maxBytes: 2 * 1024 * 1024, accept: 'text/html' }, fetchFn);
  const r = parseProductHtml(buf.toString('utf8'), url);
  r.url = url;
  r.shop = shopFromHost(new URL(url).hostname);
  // The app compares everything in CZK, so $550 must never be saved as "550 CZK". No rate means no price, not a guess.
  if (r.price != null && r.currency && r.currency !== 'CZK') {
    r.foreign_price = r.price;
    r.foreign_currency = r.currency;
    const rate = (await ratesFn())?.[r.currency];
    r.price = rate ? Math.round(r.foreign_price * rate) : null;
    if (rate) r.currency = 'CZK';
  }
  return r;
}

// ---- Converting to CZK with the Czech National Bank's daily rates ----
const CNB_RATES_URL = 'https://www.cnb.cz/en/financial-markets/foreign-exchange-market/central-bank-exchange-rate-fixing/central-bank-exchange-rate-fixing/daily.txt';
const RATES_MAX_AGE_MS = 6 * 60 * 60 * 1000;

// Lines look like "USA|dollar|1|USD|21.762". The amount matters: "Japan|yen|100|JPY|13.779" is per 100 yen.
export function parseCnbRates(text) {
  const rates = {};
  for (const line of String(text).split('\n')) {
    const [, , amount, code, rate] = line.trim().split('|');
    const czkPerUnit = Number(rate?.replace(',', '.')) / Number(amount);
    if (/^[A-Z]{3}$/.test(code || '') && czkPerUnit > 0) rates[code] = czkPerUnit;
  }
  return Object.keys(rates).length ? rates : null;
}

let cachedRates = null;
let cachedAt = 0;
// Falls back to the last rates we have if the bank cannot be reached.
export async function czkRates() {
  if (cachedRates && Date.now() - cachedAt < RATES_MAX_AGE_MS) return cachedRates;
  try {
    const res = await fetch(CNB_RATES_URL, { signal: AbortSignal.timeout(8000) });
    const rates = res.ok ? parseCnbRates(await res.text()) : null;
    if (rates) { cachedRates = rates; cachedAt = Date.now(); }
  } catch { /* use what we have */ }
  return cachedRates;
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

// ---- Is a page from another shop the same product as an item we already track? ----
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ');
const tokens = (s) => new Set(norm(s).split(/\s+/).filter((t) => t.length > 1));

// Words that describe the type of product, in the shops' Czech and English. Only model words ("Romy", "Bunny Knot") identify it.
const GENERIC_WORDS = new Set('kabelka kabelky taska damska damske damsky kozena kozeny semisova pres rameno crossbody nakupni vakova leather suede womens shoulder tote bag'.split(' '));
const modelWords = (s) => new Set([...tokens(s)].filter((t) => !GENERIC_WORDS.has(t)));

// Shops name colours in Czech or with fancy names. albarossa is labelled bordeaux on Zalando.
const COLOUR_FAMILIES = {
  black: 'black cerna cerny', brown: 'brown hneda hnedy cocoa chocolate espresso', beige: 'beige bezova bezovy cream ecru sand',
  white: 'white bila bily ivory', red: 'red cervena cerveny', burgundy: 'burgundy bordeaux burgundska vinova wine albarossa',
  blue: 'blue modra modry navy namornicka', green: 'green zelena zeleny olive khaki', pink: 'pink ruzova ruzovy',
  grey: 'grey gray seda sedy', yellow: 'yellow zluta zluty', purple: 'purple fialova fialovy lilac', orange: 'orange oranzova oranzovy',
};
const colourFamilies = (s) => {
  const t = tokens(s);
  return new Set(Object.keys(COLOUR_FAMILIES).filter((f) => COLOUR_FAMILIES[f].split(' ').some((w) => t.has(w))));
};
// Different only when both colours are understood and share nothing; an unknown fancy name proves nothing.
function coloursDiffer(a, b) {
  const tb = tokens(b);
  if ([...tokens(a)].some((t) => tb.has(t))) return false;
  const fa = colourFamilies(a), fb = colourFamilies(b);
  return fa.size > 0 && fb.size > 0 && ![...fa].some((f) => fb.has(f));
}

// Returns { uncertain, reasons }. Different shops word names differently, so we only
// say "confident" when brand agrees and most model words overlap; otherwise the user is warned.
export function matchProduct(item, found) {
  const reasons = [];
  if (item.brand && found.brand && norm(item.brand).trim() !== norm(found.brand).trim()) reasons.push('different brand');
  if (!found.brand && item.brand && !norm(found.name).includes(norm(item.brand).trim())) reasons.push('brand not found on page');
  const a = modelWords(item.name), b = modelWords(found.name);
  const common = [...a].filter((t) => b.has(t)).length;
  // Measured against the words of both names, so the result is the same whichever shop was added first.
  const allWords = a.size + b.size - common;
  if ((allWords ? common / allWords : 0) < 0.6) reasons.push('name differs');
  if (item.color && found.color && coloursDiffer(item.color, found.color)) reasons.push('colour differs');
  return { uncertain: reasons.length > 0, reasons };
}
