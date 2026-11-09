import request from 'supertest';
import { createApp } from '../src/app';
import { one, pool, q } from '../src/db';
import { migrate } from '../src/migrate';
import { hashPassword } from '../src/modules/auth';

export const app = createApp();
export { one, pool, q };

/** Test bazasini noldan: public sxemani o'chirib, barcha migratsiyalarni qo'llash */
export async function resetDb() {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await migrate(pool, () => undefined);
}

export const PASSWORD = 'Parol123!';

export async function createUser(login: string, role: 'LEADER' | 'ACCOUNTANT' | 'OPERATOR', fullName = login) {
  const u = await one(
    pool,
    `INSERT INTO app_user (login, full_name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
    [login, fullName, role, await hashPassword(PASSWORD)],
  );
  return u.id as number;
}

export async function token(login: string) {
  const r = await request(app).post('/api/auth/login').send({ login, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login ${login}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.accessToken as string;
}

export const api = (tok: string) => ({
  get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${tok}`),
  post: (url: string, body?: object) => request(app).post(url).set('Authorization', `Bearer ${tok}`).send(body),
  patch: (url: string, body?: object) => request(app).patch(url).set('Authorization', `Bearer ${tok}`).send(body),
  put: (url: string, body?: object) => request(app).put(url).set('Authorization', `Bearer ${tok}`).send(body),
  del: (url: string) => request(app).delete(url).set('Authorization', `Bearer ${tok}`),
});

/** Standart muhit: 1 rahbar, 2 buxgalter */
export async function seedTeam() {
  const leader = await createUser('leader', 'LEADER', 'Rahbar');
  const acc1 = await createUser('acc1', 'ACCOUNTANT', 'Aziza');
  const acc2 = await createUser('acc2', 'ACCOUNTANT', 'Bobur');
  return { leader, acc1, acc2 };
}

export async function reportCodes(clientId: number, period: string) {
  const rows = await q<{ code: string }>(
    pool,
    `SELECT rt.code FROM task t JOIN report_type rt ON rt.id = t.report_type_id
     WHERE t.client_id = $1 AND t.period = $2 AND t.kind = 'REPORT' AND t.status <> 'CANCELLED' ORDER BY rt.sort_order`,
    [clientId, period],
  );
  return rows.map((r) => r.code);
}
