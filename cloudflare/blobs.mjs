// Cloudflare replacement for "@netlify/blobs".
// Same functions the site already uses (getStore, get, set, setJSON, list, delete, getWithMetadata),
// so the CRM code works unchanged.
//   JSON records (bookings, inquiries, income, reviews, settings) -> D1 database (instant, reliable)
//   Files (receipts, review photos, form uploads)                  -> KV storage (up to 25 MB each)
let ENV = null;
// The free plan allows 50 database queries per request, so list() loads all values in ONE query
// and later get() calls are answered from this cache (reset for every new request).
let CACHE = new Map();
export function bindEnv(env) { ENV = env; CACHE = new Map(); }
const ck = (store, key) => store + "\u0000" + key;
const db = () => { if (!ENV?.DB) throw new Error("Database not connected (DB binding missing)"); return ENV.DB; };
const kv = () => { if (!ENV?.FILES) throw new Error("File storage not connected (FILES binding missing)"); return ENV.FILES; };

let ready = null;
function init() {
  ready ||= db().prepare("CREATE TABLE IF NOT EXISTS blobs (store TEXT NOT NULL, key TEXT NOT NULL, value TEXT, updated_at TEXT, PRIMARY KEY (store, key))").run();
  return ready;
}

const FILE_STORES = new Set(["receipts", "review-photos", "uploads", "site-images"]); // only these keep files in KV
class Store {
  constructor(name) { this.name = name; this.files = FILE_STORES.has(name); }

  async get(key, opts = {}) {
    const type = opts.type || "text";
    if (type === "json" || type === "text") {
      const c = CACHE.get(ck(this.name, key));
      if (c !== undefined) return c === null ? null : type === "json" ? JSON.parse(c) : c;
      await init();
      const row = await db().prepare("SELECT value FROM blobs WHERE store=? AND key=?").bind(this.name, key).first();
      if (row && row.value != null) return type === "json" ? JSON.parse(row.value) : row.value;
      if (!this.files) return null;
      // a file stored as bytes, read as text/json
      const v = await kv().get(this.name + ":" + key, type === "json" ? "json" : "text");
      return v ?? null;
    }
    const v = await kv().get(this.name + ":" + key, type === "stream" ? "stream" : "arrayBuffer");
    return v ?? null;
  }

  async getWithMetadata(key, opts = {}) {
    const type = opts.type === "stream" ? "stream" : "arrayBuffer";
    const { value, metadata } = await kv().getWithMetadata(this.name + ":" + key, type);
    if (value == null) return null;
    return { data: value, metadata: metadata || {} };
  }

  async getMetadata(key) {
    const { value, metadata } = await kv().getWithMetadata(this.name + ":" + key, "stream");
    if (value == null) return null;
    try { await value.cancel(); } catch {}
    return { metadata: metadata || {} };
  }

  async setJSON(key, val, opts = {}) {
    await init();
    const now = new Date().toISOString();
    if (opts.onlyIfNew) {
      const r = await db().prepare("INSERT OR IGNORE INTO blobs (store,key,value,updated_at) VALUES (?,?,?,?)").bind(this.name, key, JSON.stringify(val), now).run();
      const changed = (r.meta?.changes || 0) > 0;
      if (changed) CACHE.set(ck(this.name, key), JSON.stringify(val));
      return { modified: changed };
    }
    CACHE.set(ck(this.name, key), JSON.stringify(val));
    await db().prepare("INSERT INTO blobs (store,key,value,updated_at) VALUES (?,?,?,?) ON CONFLICT(store,key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").bind(this.name, key, JSON.stringify(val), now).run();
    return { modified: true };
  }

  async set(key, data, opts = {}) {
    if (typeof data === "string") {
      CACHE.set(ck(this.name, key), data);
      await init();
      await db().prepare("INSERT INTO blobs (store,key,value,updated_at) VALUES (?,?,?,?) ON CONFLICT(store,key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").bind(this.name, key, data, new Date().toISOString()).run();
      return { modified: true };
    }
    const bytes = data instanceof ArrayBuffer ? data : data?.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
    await kv().put(this.name + ":" + key, bytes, { metadata: opts.metadata || {} });
    return { modified: true };
  }

  async delete(key) {
    CACHE.delete(ck(this.name, key));
    await init();
    await db().prepare("DELETE FROM blobs WHERE store=? AND key=?").bind(this.name, key).run();
    if (this.files) { try { await kv().delete(this.name + ":" + key); } catch {} }
  }

  async list(opts = {}) {
    await init();
    const prefix = opts.prefix || "";
    const { results } = await db().prepare("SELECT key, value FROM blobs WHERE store=? AND substr(key,1,?)=? ORDER BY key").bind(this.name, prefix.length, prefix).all();
    for (const r of results) CACHE.set(ck(this.name, r.key), r.value);
    const blobs = results.map((r) => ({ key: r.key, etag: "" }));
    // files kept in KV (e.g. receipts) are listed too
    let cursor;
    if (this.files) do {
      const page = await kv().list({ prefix: this.name + ":" + prefix, cursor });
      for (const k of page.keys) blobs.push({ key: k.name.slice(this.name.length + 1), etag: "" });
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    return { blobs, directories: [] };
  }
}

export function getStore(opts) { return new Store(typeof opts === "string" ? opts : opts.name); }
export function connectLambda() {}
