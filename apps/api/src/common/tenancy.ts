import { asSystem, pool, withCompany } from '../db';
import { COMPANY_EXPIRED_SQL } from './auth';

/**
 * Fon ishi (scheduler, ishga tushish) har kompaniya uchun alohida, o'z kontekstida (RLS) bajariladi:
 * yozuvlar shu kompaniyaga tushadi, sozlamalar (muddat soati, eslatma) shu kompaniyanikidan o'qiladi.
 * Shablon va bloklangan kompaniyalar o'tkaziladi; paidOnly — tarif muddati o'tganlar ham o'tkaziladi.
 * Bir kompaniyadagi xato qolganlarini to'xtatmaydi.
 */
export async function forEachCompany<T>(
  name: string,
  fn: (companyId: number) => Promise<T>,
  opts: { paidOnly?: boolean } = {},
): Promise<Map<number, T>> {
  const rows = await asSystem(() =>
    pool.query<{ id: number }>(
      `SELECT c.id FROM company c
       WHERE NOT c.is_template AND c.status = 'ACTIVE' ${opts.paidOnly ? `AND NOT ${COMPANY_EXPIRED_SQL}` : ''}
       ORDER BY c.id`,
    ),
  );
  const out = new Map<number, T>();
  for (const { id } of rows.rows) {
    try {
      out.set(id, await withCompany(id, () => fn(id)));
    } catch (e) {
      console.error(`[${name}] kompaniya ${id}:`, e);
    }
  }
  return out;
}
