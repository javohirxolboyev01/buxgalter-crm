import { beforeAll, describe, expect, it } from 'vitest';
import { one, pool, resetDb, seedTeam } from './helpers';

describe('DB darajasidagi qoidalar', () => {
  beforeAll(async () => {
    await resetDb();
    await seedTeam();
  });

  it('vaqt zonasi Asia/Tashkent', async () => {
    expect((await one(pool, 'SHOW timezone')).TimeZone).toBe('Asia/Tashkent');
  });

  it('audit_log: UPDATE va DELETE taqiqlangan', async () => {
    await pool.query(`INSERT INTO audit_log (entity, entity_id, action) VALUES ('x', '1', 'TEST')`);
    await expect(pool.query(`UPDATE audit_log SET action = 'HACK'`)).rejects.toThrow(/faqat qo'shiladi/);
    await expect(pool.query(`DELETE FROM audit_log`)).rejects.toThrow(/faqat qo'shiladi/);
    await expect(pool.query(`TRUNCATE audit_log`)).rejects.toThrow(/faqat qo'shiladi/);
  });

  it('tax_type faqat AOS|QQS, STIR dublikati rad etiladi', async () => {
    await expect(
      pool.query(`INSERT INTO client (stir, name, name_normalized, tax_type) VALUES ('123456789', 'A', 'a', 'XYZ')`),
    ).rejects.toThrow(/check/i);
    await pool.query(`INSERT INTO client (stir, name, name_normalized, tax_type) VALUES ('123456789', 'A', 'a', 'AOS')`);
    await expect(
      pool.query(`INSERT INTO client (stir, name, name_normalized, tax_type) VALUES ('123456789', 'B', 'b', 'QQS')`),
    ).rejects.toThrow(/duplicate|unique/i);
  });

  it('11-chi faol oylik ish qo\'shilmaydi', async () => {
    await pool.query(`INSERT INTO routine_work_type (name, name_ru) VALUES ('9-ish', '9'), ('10-ish', '10')`);
    await expect(pool.query(`INSERT INTO routine_work_type (name, name_ru) VALUES ('11-ish', '11')`)).rejects.toThrow(
      /ROUTINE_LIMIT/,
    );
    // Nofaol yozuv limitga kirmaydi
    await pool.query(`INSERT INTO routine_work_type (name, name_ru, active) VALUES ('nofaol', 'x', false)`);
  });

  it('bir (mijoz, hisobot, davr) ikki marta yozilmaydi; bir foydalanuvchida ikkinchi ochiq taymer yo\'q', async () => {
    const c = await one(pool, `SELECT id FROM client WHERE stir = '123456789'`);
    const ins = `INSERT INTO task (client_id, kind, report_type_id, period, title) VALUES ($1, 'REPORT', 1, '2026-10-01', 'JShDS') RETURNING id`;
    const t = await one(pool, ins, [c.id]);
    await expect(pool.query(ins, [c.id])).rejects.toThrow(/duplicate|unique/i);
    // URGENT uchun unique qo'llanmaydi
    await pool.query(`INSERT INTO task (client_id, kind, period, title) VALUES ($1, 'URGENT', '2026-10-01', 'a'), ($1, 'URGENT', '2026-10-01', 'a')`, [c.id]);

    const u = await one(pool, `SELECT id FROM app_user WHERE login = 'acc1'`);
    await pool.query('INSERT INTO time_entry (task_id, user_id) VALUES ($1, $2)', [t.id, u.id]);
    await expect(pool.query('INSERT INTO time_entry (task_id, user_id) VALUES ($1, $2)', [t.id, u.id])).rejects.toThrow(
      /duplicate|unique/i,
    );
  });

  it('report_type seed: AOS/QQS bo\'yicha so\'rov', async () => {
    const aos = (await pool.query(`SELECT code FROM report_type WHERE applies_to_aos ORDER BY sort_order`)).rows.map((r) => r.code);
    const qqs = (await pool.query(`SELECT code FROM report_type WHERE applies_to_qqs ORDER BY sort_order`)).rows.map((r) => r.code);
    expect(aos).not.toContain('QQS');
    expect(aos).not.toContain('FOYDA');
    expect(aos).toContain('AOS');
    expect(qqs).not.toContain('AOS');
    expect(qqs).toEqual(expect.arrayContaining(['QQS', 'FOYDA', 'INPS', 'JSHDS']));
  });
});
