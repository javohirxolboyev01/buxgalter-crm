import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type pg from 'pg';
import { pool } from './db';

// Flyway uslubidagi oddiy migrator: V<raqam>__<nom>.sql, checksum bilan.
// Qo'llangan migratsiya o'zgartirilsa xato beradi (yangisini yozish kerak).
export const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

interface Migration {
  version: number;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

function loadMigrations(): Migration[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .map((file) => {
      const m = /^V(\d+)__(.+)\.sql$/.exec(file);
      if (!m) return null;
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      return {
        version: Number(m[1]),
        name: m[2],
        file,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    })
    .filter((m): m is Migration => m !== null)
    .sort((a, b) => a.version - b.version);
}

export async function migrate(db: pg.Pool = pool, log = console.log) {
  const c = await db.connect();
  try {
    await c.query('SELECT pg_advisory_lock(7710000)');
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migration (
      version int PRIMARY KEY, name text NOT NULL, checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Map<number, string>(
      (await c.query('SELECT version, checksum FROM schema_migration')).rows.map((r) => [r.version, r.checksum]),
    );
    for (const m of loadMigrations()) {
      const prev = applied.get(m.version);
      if (prev) {
        if (prev !== m.checksum) throw new Error(`Migratsiya ${m.file} qo'llangandan keyin o'zgartirilgan`);
        continue;
      }
      await c.query('BEGIN');
      try {
        await c.query(m.sql);
        await c.query('INSERT INTO schema_migration (version, name, checksum) VALUES ($1, $2, $3)', [
          m.version,
          m.name,
          m.checksum,
        ]);
        await c.query('COMMIT');
        log(`  ✓ ${m.file}`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`${m.file}: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(7710000)').catch(() => undefined);
    c.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Migratsiyalar qo\'llandi');
      return pool.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
