import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));

// One pool per process. Any Postgres works (DATABASE_URL); the hosted one is Neon.
export function openDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is not set. The account server needs Postgres.');
  const ssl = /sslmode=require|neon\.tech/.test(url) ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({ connectionString: url.replace(/[?&]sslmode=require/, ''), ssl, max: Number(process.env.DB_POOL || 5) });
  const db = {
    pool,
    async query(sql, args = []) { return (await pool.query(sql, args)).rows; },
    async get(sql, args = []) { return (await pool.query(sql, args)).rows[0] ?? null; },
    async run(sql, args = []) { return (await pool.query(sql, args)).rowCount; },
    async tx(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const t = { query: async (s, a = []) => (await c.query(s, a)).rows, get: async (s, a = []) => (await c.query(s, a)).rows[0] ?? null, run: async (s, a = []) => (await c.query(s, a)).rowCount };
        const out = await fn(t);
        await c.query('COMMIT');
        return out;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    close: () => pool.end(),
  };
  return db;
}

// Database updates apply themselves on start, each file once, inside a transaction.
export async function migrate(db) {
  const dir = path.join(here, '..', 'migrations');
  await db.run('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const done = new Set((await db.query('SELECT name FROM migrations')).map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await db.tx(async (t) => {
      await t.run('SELECT pg_advisory_xact_lock(4242)');
      if (await t.get('SELECT 1 FROM migrations WHERE name = $1', [f])) return;
      await t.query(sql);
      await t.run('INSERT INTO migrations (name) VALUES ($1)', [f]);
    });
  }
}
