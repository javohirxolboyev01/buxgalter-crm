import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { config } from './config';

// int8 (bigserial, count) -> number: id'lar 2^53 dan oshmaydi
pg.types.setTypeParser(20, (v) => Number(v));
// date -> 'YYYY-MM-DD' satr (vaqt zonasi siljishisiz)
pg.types.setTypeParser(1082, (v) => v);
// numeric -> number
pg.types.setTypeParser(1700, (v) => Number(v));

// ---------- Kompaniya konteksti (multi-tenant, V46) ----------
// Qaror: kontekst AsyncLocalStorage'da, har pool checkout'da ulanishga qo'llanadi:
//   * { companyId: N } — kompaniya so'rovi: app_tenant roli (bo'lsa) + app.company_id = N, RLS ishlaydi.
//   * { companyId: null } — anonim HTTP so'rov (login'dan oldin): hech qaysi kompaniya qatori ko'rinmaydi.
//   * kontekst yo'q / system — tizim ishi (migratsiya, scheduler sikli, Telegram, login): app.bypass = 'on'.
// Shunday qilib route ichida WHERE company_id unutilsa ham boshqa kompaniya ma'lumoti ochilmaydi.
export type DbContext = { companyId: number | null } | { system: true };
const als = new AsyncLocalStorage<DbContext>();

/**
 * Testda kontekstsiz kod (to'g'ridan-to'g'ri chaqirilgan servis funksiyalari) test kompaniyasi sifatida, RLS bilan
 * ishlaydi — mavjud testlar bitta kompaniya kabi, lekin haqiqiy so'rovdagidek ajratilgan holda. Bypass faqat asSystem().
 */
export const TEST_COMPANY_ID = 2;

export const currentCompanyId = (): number | null => {
  const s = als.getStore();
  return s && 'companyId' in s ? s.companyId : null;
};
export const withCompany = <T>(companyId: number, fn: () => T): T => als.run({ companyId }, fn);
export const asAnonymous = <T>(fn: () => T): T => als.run({ companyId: null }, fn);
export const asSystem = <T>(fn: () => T): T => als.run({ system: true }, fn);

let tenantRole = false;
/** app_tenant roliga o'tish mumkinmi (migratsiyadan keyin bir marta aniqlanadi) */
export async function detectTenantRole() {
  const r = await asSystem(() =>
    pool.query(
      `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant')
              AND pg_has_role(current_user, 'app_tenant', 'MEMBER') AS ok,
              (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses`,
    ),
  );
  tenantRole = Boolean(r.rows[0].ok);
  // Superuser/BYPASSRLS ulanish va app_tenant yo'q: RLS ishlamaydi — kompaniyalar aralashib ketadi
  if (!tenantRole && r.rows[0].bypasses) {
    const msg = 'DB foydalanuvchisi RLSni chetlab o\'tadi va app_tenant roli yo\'q (V46 migratsiyasini tekshiring)';
    if (config.isProd) throw new Error(msg);
    console.warn(`OGOHLANTIRISH: ${msg}`);
  }
  return tenantRole;
}

const applied = new WeakMap<pg.PoolClient, string>();

async function applyContext(c: pg.PoolClient) {
  const s: DbContext = als.getStore() ?? (config.isTest ? { companyId: TEST_COMPANY_ID } : { system: true });
  let key: string;
  let sql: string;
  if ('system' in s) {
    key = 'system';
    sql = `RESET ROLE; SELECT set_config('app.bypass', 'on', false), set_config('app.company_id', '', false)`;
  } else {
    const id = s.companyId === null ? '' : String(Math.trunc(Number(s.companyId)));
    key = `tenant:${id}`;
    // Tartib: avval bypass o'chadi, keyin rol almashadi (SET ROLE xato bersa ham bypass yoqilib qolmaydi)
    sql = `SELECT set_config('app.bypass', 'off', false), set_config('app.company_id', '${id}', false);${tenantRole ? ' SET ROLE app_tenant;' : ''}`;
  }
  if (applied.get(c) === key) return;
  applied.delete(c);
  await c.query(sql);
  applied.set(c, key);
}

class TenantPool extends pg.Pool {
  // pg-pool ichida connect() callback bilan ham chaqirilishi mumkin — ikkala shakl qo'llab-quvvatlanadi
  connect(): Promise<pg.PoolClient>;
  connect(cb: (err: Error | undefined, client: pg.PoolClient | undefined, done: (release?: any) => void) => void): void;
  connect(cb?: any): any {
    const p = (async () => {
      const c = await super.connect();
      try {
        await applyContext(c);
      } catch (e) {
        applied.delete(c);
        c.release(e as Error);
        throw e;
      }
      return c;
    })();
    if (!cb) return p;
    p.then(
      (c) => cb(undefined, c, (err?: any) => c.release(err)),
      (e) => cb(e, undefined, () => undefined),
    );
  }

  // Har so'rov kontekst qo'llangan ulanish orqali (pg.Pool.query'ning ilovada ishlatiladigan shakli)
  // @ts-expect-error — pg.Pool.query'ning barcha overload'lari qayta yozilmaydi
  async query(text: string | pg.QueryConfig, params?: unknown[]): Promise<pg.QueryResult> {
    const c = await this.connect();
    try {
      return await c.query(text as any, params as any[]);
    } finally {
      c.release();
    }
  }
}

export const pool = new TenantPool({
  connectionString: config.databaseUrl,
  max: 10,
  options: `-c timezone=${config.timezone}`,
}) as unknown as pg.Pool;

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
