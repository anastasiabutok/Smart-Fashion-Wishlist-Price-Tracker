import { DatabaseSync } from 'node:sqlite';

export function openDb(path = 'data.sqlite') {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile TEXT NOT NULL,
      name TEXT NOT NULL,
      brand TEXT,
      color TEXT,
      image_url TEXT,
      sizes TEXT,
      target_price REAL,
      created_at TEXT NOT NULL DEFAULT (date('now'))
    );
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      shop TEXT NOT NULL,
      shop_type TEXT NOT NULL DEFAULT 'public',
      url TEXT,
      price REAL,
      currency TEXT NOT NULL DEFAULT 'CZK',
      price_date TEXT,
      uncertain INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      price REAL NOT NULL,
      date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile TEXT NOT NULL,
      shop TEXT NOT NULL DEFAULT 'all',
      code TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('percent','fixed')),
      value REAL NOT NULL,
      min_order REAL,
      valid_from TEXT,
      valid_to TEXT,
      note TEXT
    );
  `);
  return db;
}

const today = () => new Date().toISOString().slice(0, 10);

export function createStore(db) {
  const q = (sql) => db.prepare(sql);
  return {
    listItems(profile) {
      return q('SELECT * FROM items WHERE profile = ? ORDER BY id DESC').all(profile);
    },
    getItem(profile, id) {
      return q('SELECT * FROM items WHERE profile = ? AND id = ?').get(profile, id);
    },
    createItem(profile, i) {
      const r = q(
        'INSERT INTO items (profile, name, brand, color, image_url, sizes, target_price) VALUES (?,?,?,?,?,?,?)'
      ).run(profile, i.name, i.brand ?? null, i.color ?? null, i.image_url ?? null, i.sizes ?? null, i.target_price ?? null);
      return Number(r.lastInsertRowid);
    },
    updateItem(profile, id, i) {
      q('UPDATE items SET name = COALESCE(?, name), target_price = ?, sizes = COALESCE(?, sizes), image_url = COALESCE(?, image_url) WHERE profile = ? AND id = ?')
        .run(i.name ?? null, i.target_price ?? null, i.sizes ?? null, i.image_url ?? null, profile, id);
    },
    setImage(profile, id, imageUrl) {
      q('UPDATE items SET image_url = ? WHERE profile = ? AND id = ?').run(imageUrl, profile, id);
    },
    deleteItem(profile, id) {
      q('DELETE FROM items WHERE profile = ? AND id = ?').run(profile, id);
    },
    sourceBelongsTo(profile, sourceId) {
      return !!q(
        'SELECT 1 FROM sources s JOIN items i ON i.id = s.item_id WHERE s.id = ? AND i.profile = ?'
      ).get(sourceId, profile);
    },
    sourcesFor(itemId) {
      return q('SELECT * FROM sources WHERE item_id = ?').all(itemId);
    },
    addSource(itemId, s) {
      const r = q('INSERT INTO sources (item_id, shop, shop_type, url, price, currency, price_date, uncertain) VALUES (?,?,?,?,?,?,?,?)')
        .run(itemId, s.shop, s.shop_type ?? 'public', s.url ?? null, s.price ?? null, s.currency ?? 'CZK', s.price != null ? today() : null, s.uncertain ? 1 : 0);
      const id = Number(r.lastInsertRowid);
      if (s.price != null) q('INSERT INTO price_history (source_id, price, date) VALUES (?,?,?)').run(id, s.price, today());
      return id;
    },
    setPrice(sourceId, price) {
      q('UPDATE sources SET price = ?, price_date = ? WHERE id = ?').run(price, today(), sourceId);
      q('INSERT INTO price_history (source_id, price, date) VALUES (?,?,?)').run(sourceId, price, today());
    },
    deleteSource(id) {
      q('DELETE FROM sources WHERE id = ?').run(id);
    },
    historyFor(itemId) {
      return q(
        `SELECT h.date, h.price, s.shop FROM price_history h JOIN sources s ON s.id = h.source_id
         WHERE s.item_id = ? ORDER BY h.date, h.id`
      ).all(itemId);
    },
    listCodes(profile) {
      return q('SELECT * FROM codes WHERE profile = ? ORDER BY id DESC').all(profile);
    },
    addCode(profile, c) {
      const r = q('INSERT INTO codes (profile, shop, code, type, value, min_order, valid_from, valid_to, note) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(profile, c.shop || 'all', c.code, c.type, c.value, c.min_order ?? null, c.valid_from ?? null, c.valid_to ?? null, c.note ?? null);
      return Number(r.lastInsertRowid);
    },
    deleteCode(profile, id) {
      q('DELETE FROM codes WHERE profile = ? AND id = ?').run(profile, id);
    },
  };
}
