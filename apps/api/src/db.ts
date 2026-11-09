import pg from 'pg';
import { config } from './config';

// int8 (bigserial, count) -> number: id'lar 2^53 dan oshmaydi
pg.types.setTypeParser(20, (v) => Number(v));
// date -> 'YYYY-MM-DD' satr (vaqt zonasi siljishisiz)
pg.types.setTypeParser(1082, (v) => v);
// numeric -> number
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  options: `-c timezone=${config.timezone}`,
});

export type Db = pg.Pool | pg.PoolClient;

export async function q<T = any>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const r = await db.query(text, params as any[]);
  return r.rows as T[];
}

export async function one<T = any>(db: Db, text: string, params: unknown[] = []): Promise<T | undefined> {
  const rows = await q<T>(db, text, params);
  return rows[0];
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Dry-run: haqiqiy mantiq bilan ishlaydi, lekin oxirida ROLLBACK (natija aynan haqiqiyday bo'ladi) */
export async function dryTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => undefined);
    c.release();
  }
}
