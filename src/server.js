import http from 'node:http';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, createStore } from './db.js';
import { rankSources, atOrBelowTarget } from './pricing.js';

const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const UPLOAD_NAME = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

// Decide the file type from the first bytes, not from what the client claims.
export function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// Shops known to need the shopper's login. Everything else defaults to public.
const GATED = new Set(['zalando lounge', 'bestsecret']);
export const shopType = (shop) => (GATED.has(String(shop).toLowerCase()) ? 'gated' : 'public');

export function createApp(store, { uploadDir = process.env.UPLOAD_DIR || 'uploads' } = {}) {
  const readRaw = async (req) => {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > MAX_PHOTO_BYTES) throw Object.assign(new Error('Photo is too large (max 5 MB)'), { status: 413 });
      chunks.push(c);
    }
    return Buffer.concat(chunks);
  };
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const readBody = async (req) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  };

  const itemView = (item, codes) => {
    const ranked = rankSources(store.sourcesFor(item.id), codes);
    return {
      ...item,
      sources: ranked,
      best: ranked.find((r) => r.cheapest) || null,
      at_target: atOrBelowTarget(ranked, item.target_price),
    };
  };

  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) {
        // Profiles are a convenience, not security: anyone who knows the name sees that profile.
        const profile = String(req.headers['x-profile'] || '').trim().toLowerCase();
        if (!profile) return send(res, 400, { error: 'Missing X-Profile header' });
        const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
        const [kind, id, sub] = parts;
        const method = req.method;

        if (kind === 'items') {
          if (!id && method === 'GET') {
            const codes = store.listCodes(profile);
            return send(res, 200, store.listItems(profile).map((i) => itemView(i, codes)));
          }
          if (!id && method === 'POST') {
            const b = await readBody(req);
            if (!b.name) return send(res, 400, { error: 'name is required' });
            const itemId = store.createItem(profile, b);
            for (const s of b.sources || []) store.addSource(itemId, { ...s, shop_type: shopType(s.shop) });
            return send(res, 201, itemView(store.getItem(profile, itemId), store.listCodes(profile)));
          }
          const itemId = Number(id);
          const item = store.getItem(profile, itemId);
          if (!item) return send(res, 404, { error: 'not found' });
          if (!sub && method === 'GET') {
            return send(res, 200, { ...itemView(item, store.listCodes(profile)), history: store.historyFor(itemId) });
          }
          if (!sub && method === 'PATCH') {
            store.updateItem(profile, itemId, await readBody(req));
            return send(res, 200, itemView(store.getItem(profile, itemId), store.listCodes(profile)));
          }
          if (!sub && method === 'DELETE') {
            store.deleteItem(profile, itemId);
            return send(res, 204, {});
          }
          if (sub === 'photo' && method === 'POST') {
            const buf = await readRaw(req);
            const ext = sniffImage(buf);
            if (!ext) return send(res, 400, { error: 'Photo must be a JPEG, PNG or WebP image' });
            await mkdir(uploadDir, { recursive: true });
            const name = `${randomBytes(16).toString('hex')}.${ext}`;
            await writeFile(join(uploadDir, name), buf);
            const old = item.image_url;
            store.setImage(profile, itemId, `/uploads/${name}`);
            if (old && old.startsWith('/uploads/') && UPLOAD_NAME.test(old.slice(9))) {
              await unlink(join(uploadDir, old.slice(9))).catch(() => {});
            }
            return send(res, 200, itemView(store.getItem(profile, itemId), store.listCodes(profile)));
          }
          if (sub === 'sources' && method === 'POST') {
            const b = await readBody(req);
            if (!b.shop) return send(res, 400, { error: 'shop is required' });
            store.addSource(itemId, { ...b, shop_type: shopType(b.shop) });
            return send(res, 201, itemView(store.getItem(profile, itemId), store.listCodes(profile)));
          }
        }

        if (kind === 'sources' && id) {
          // Ownership check: the source's item must belong to this profile.
          if (!store.sourceBelongsTo(profile, Number(id))) return send(res, 404, { error: 'not found' });
          if (method === 'PUT') {
            const b = await readBody(req);
            if (typeof b.price !== 'number') return send(res, 400, { error: 'price must be a number' });
            store.setPrice(Number(id), b.price);
            return send(res, 200, { ok: true });
          }
          if (method === 'DELETE') {
            store.deleteSource(Number(id));
            return send(res, 204, {});
          }
        }

        if (kind === 'codes') {
          if (!id && method === 'GET') return send(res, 200, store.listCodes(profile));
          if (!id && method === 'POST') {
            const b = await readBody(req);
            if (!b.code || !['percent', 'fixed'].includes(b.type) || typeof b.value !== 'number') {
              return send(res, 400, { error: 'code, type (percent|fixed) and numeric value are required' });
            }
            store.addCode(profile, b);
            return send(res, 201, store.listCodes(profile));
          }
          if (id && method === 'DELETE') {
            store.deleteCode(profile, Number(id));
            return send(res, 204, {});
          }
        }
        return send(res, 404, { error: 'not found' });
      }

      // Uploaded photos (random unguessable names, fixed pattern, nothing else is served from here)
      if (url.pathname.startsWith('/uploads/')) {
        const name = url.pathname.slice('/uploads/'.length);
        if (!UPLOAD_NAME.test(name)) return send(res, 404, { error: 'not found' });
        try {
          const data = await readFile(join(uploadDir, name));
          res.writeHead(200, { 'content-type': MIME[extname(name)], 'cache-control': 'private, max-age=86400' });
          return res.end(data);
        } catch {
          return send(res, 404, { error: 'not found' });
        }
      }

      // Static files
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = normalize(join(PUBLIC_DIR, rel));
      if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'forbidden' });
      try {
        const data = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
        res.end(data);
      } catch {
        send(res, 404, { error: 'not found' });
      }
    } catch (e) {
      send(res, e.status || 500, { error: String(e.message || e) });
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store = createStore(openDb(process.env.DB_PATH || 'data.sqlite'));
  const port = Number(process.env.PORT || 3000);
  http.createServer(createApp(store)).listen(port, '0.0.0.0', () => console.log(`Price tracker on http://localhost:${port}`));
}
