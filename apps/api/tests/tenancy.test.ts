import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { forEachCompany } from '../src/common/tenancy';
import { currentPeriod } from '../src/common/time';
import { asSystem } from '../src/db';
import { runGenerator } from '../src/modules/generator';
import { bootstrapPlatformAdmin } from '../src/modules/platform';
import { api, app, one, pool, resetDb, seedTeam, token } from './helpers';

// SaaS (V46): kompaniyalar bir-birini ko'rmaydi; tarif muddati, bloklash, brend, platforma paneli.

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

let team: Awaited<ReturnType<typeof seedTeam>>;
let L: ReturnType<typeof api>; // A kompaniyasi (test kompaniyasi) rahbari
let A1: ReturnType<typeof api>;
let P: ReturnType<typeof api>; // platforma admini
let LB: ReturnType<typeof api>; // B kompaniyasi rahbari
let companyB: number;

async function betaToken() {
  const r = await request(app).post('/api/auth/login').send({ login: 'beta', password: '24681357' });
  expect(r.status).toBe(200);
  return r.body.accessToken as string;
}

async function platformToken() {
  const r = await request(app).post('/api/platform/auth/login').send({ login: 'root', password: 'root-parol-1' });
  expect(r.status).toBe(200);
  return r.body.accessToken as string;
}

beforeAll(async () => {
  await resetDb();
  team = await seedTeam();
  L = api(await token('leader'));
  A1 = api(await token('acc1'));
  await bootstrapPlatformAdmin('root', 'root-parol-1', 'Root');
  P = api(await platformToken());
  const r = await P.post('/api/platform/companies', {
    name: 'Beta Audit',
    plan: 'YEARLY',
    leader: { fullName: 'Beta rahbar', login: 'beta', password: '24681357' },
  });
  expect(r.status).toBe(201);
  companyB = r.body.id;
  LB = api(await betaToken());
});

describe('platforma paneli', () => {
  it('kompaniya yaratilganda shablon seed nusxalanadi, yillik tarif 12 oy', async () => {
    const c = (await P.get(`/api/platform/companies/${companyB}`)).body;
    expect(c.plan).toBe('YEARLY');
    expect(c.daysLeft).toBeGreaterThanOrEqual(365);
    expect(c.leaderLogin).toBe('beta');
    const types = (await LB.get('/api/settings/report-types')).body;
    const mine = (await L.get('/api/settings/report-types')).body;
    expect(types.map((t: any) => t.code)).toEqual(mine.map((t: any) => t.code));
    // id'lar boshqa — har kompaniyaning o'z nusxasi
    expect(new Set([...types.map((t: any) => t.id), ...mine.map((t: any) => t.id)]).size).toBe(types.length * 2);
    // Oylik ishlar INPS hisobotiga o'z kompaniyasi ichida bog'langan
    const inpsB = types.find((t: any) => t.code === 'INPS').id;
    const routinesB = (await LB.get('/api/settings/routine-works')).body;
    expect(routinesB.filter((r: any) => r.reportTypeId !== null).every((r: any) => r.reportTypeId === inpsB)).toBe(true);
  });

  it('band login bilan kompaniya yaratilmaydi; tokenlar aralashmaydi', async () => {
    const r = await P.post('/api/platform/companies', {
      name: 'X',
      plan: 'MONTHLY',
      leader: { fullName: 'X X', login: 'leader', password: '11223344' },
    });
    expect(r.status).toBe(409);
    // Xodim tokeni platformaga, platforma tokeni kompaniya API'siga o'tmaydi
    expect((await L.get('/api/platform/companies')).status).toBe(401);
    expect((await P.get('/api/clients')).status).toBe(401);
  });
});

describe('kompaniyalar ajratilgan (RLS)', () => {
  let clientA: number;

  it('mijozlar, STIR va xodimlar faqat o\'z kompaniyasida', async () => {
    const a = await L.post('/api/clients', { stir: '300000001', name: 'Alfa MChJ', taxType: 'AOS', accountantId: team.acc1 });
    expect(a.status).toBe(201);
    clientA = a.body.id;
    // B'da xuddi shu STIR — ruxsat (STIR kompaniya ichida unikal)
    const b = await LB.post('/api/clients', { stir: '300000001', name: 'Alfa MChJ (B)', taxType: 'QQS' });
    expect(b.status).toBe(201);

    const listB = (await LB.get('/api/clients')).body;
    const itemsB = listB.items ?? listB;
    expect(itemsB.map((c: any) => c.id)).not.toContain(clientA);
    expect((await LB.get(`/api/clients/${clientA}`)).status).toBe(404);
    expect((await LB.patch(`/api/clients/${clientA}`, { name: 'buzildi' })).status).toBe(404);

    const usersB = (await LB.get('/api/users')).body.map((u: any) => u.login);
    expect(usersB).toEqual(['beta']);
    expect((await LB.get('/api/users/accountants')).body).toEqual([]);
  });

  it('boshqa kompaniya xodimini biriktirib yoki unga yozib bo\'lmaydi', async () => {
    const b = (await LB.get('/api/clients')).body;
    const clientB = (b.items ?? b)[0].id;
    const r = await LB.patch(`/api/clients/${clientB}`, { accountantId: team.acc1 });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await one(pool, 'SELECT accountant_id FROM client WHERE id = $1', [clientB]).catch(() => null))?.accountant_id ?? null).toBe(null);
    expect((await LB.post(`/api/chat/with/${team.acc1}`, { body: 'salom' })).status).toBeGreaterThanOrEqual(400);
    const chats = (await LB.get('/api/chat/contacts')).body;
    expect(JSON.stringify(chats)).not.toContain('Aziza');
  });

  it('vazifalar, jadval va dashboard boshqa kompaniyani ko\'rsatmaydi', async () => {
    const tasksA = (await L.get(`/api/tasks?clientId=${clientA}`)).body;
    const anyTask = (tasksA.items ?? tasksA)[0];
    expect(anyTask).toBeTruthy();
    expect((await LB.get(`/api/tasks/${anyTask.id}`)).status).toBe(404);
    expect((await LB.post(`/api/tasks/${anyTask.id}/done`)).status).toBe(404);
    const grid = (await LB.get('/api/monthly-grid')).body;
    expect(JSON.stringify(grid)).not.toContain('Alfa MChJ"');
    const audit = (await LB.get('/api/audit?pageSize=100')).body;
    const items = audit.items ?? audit;
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((a: any) => a.clientId === clientA || (a.entity === 'client' && String(a.entityId) === String(clientA)))).toBe(false);
  });

  it('baza darajasida: kompaniya kontekstisiz kod hech narsani ko\'rmaydi, aralash bog\'lanish rad etiladi', async () => {
    // Kompozit FK: B kompaniyasidagi vazifa A mijoziga bog'lanmaydi (hatto tizim rejimida ham)
    await expect(
      asSystem(() =>
        pool.query(`INSERT INTO task (company_id, client_id, kind, period, title) VALUES ($1, $2, 'MANUAL', '2026-10-01', 'x')`, [
          companyB,
          clientA,
        ]),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('scheduler har kompaniyaga o\'z hisobot turlari bilan vazifa yaratadi', async () => {
    const res = await forEachCompany('test', () => runGenerator(currentPeriod(), true, null));
    expect([...res.keys()].sort()).toEqual([2, companyB].sort((a, b) => a - b));
    const bad = await asSystem(() =>
      one(
        pool,
        `SELECT count(*)::int AS n FROM task t JOIN report_type rt ON rt.id = t.report_type_id WHERE rt.company_id <> t.company_id`,
      ),
    );
    expect(bad.n).toBe(0);
  });
});

describe('tarif muddati va bloklash', () => {
  it('muddat o\'tsa faqat o\'qish (402), to\'lovdan keyin yozish qaytadi', async () => {
    const yesterday = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
    expect((await P.patch(`/api/platform/companies/${companyB}`, { paidUntil: yesterday })).status).toBe(200);
    expect((await LB.get('/api/clients')).status).toBe(200);
    const w = await LB.post('/api/clients', { stir: '300000002', name: 'Yangi', taxType: 'AOS' });
    expect(w.status).toBe(402);
    expect(w.body.code).toBe('SUBSCRIPTION_EXPIRED');
    expect((await LB.get('/api/company')).body.readOnly).toBe(true);
    // Profil (til) o'zgartirish muddatdan qat'i nazar ochiq
    expect((await LB.patch('/api/me', { language: 'ru' })).status).toBe(200);

    const p = await P.post(`/api/platform/companies/${companyB}/payments`, { plan: 'MONTHLY', periods: 2, amount: 500000 });
    expect(p.status).toBe(201);
    expect(p.body.expired).toBe(false);
    expect(p.body.plan).toBe('MONTHLY');
    expect(p.body.daysLeft).toBeGreaterThanOrEqual(58);
    expect((await LB.post('/api/clients', { stir: '300000002', name: 'Yangi', taxType: 'AOS' })).status).toBe(201);
    const hist = (await P.get(`/api/platform/companies/${companyB}`)).body.payments;
    expect(hist[0]).toMatchObject({ plan: 'MONTHLY', periods: 2, amount: 500000 });
  });

  it('bloklangan kompaniyaga kirib bo\'lmaydi', async () => {
    await P.patch(`/api/platform/companies/${companyB}`, { status: 'BLOCKED' });
    expect((await LB.get('/api/clients')).status).toBe(403);
    const r = await request(app).post('/api/auth/login').send({ login: 'beta', password: '24681357' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('COMPANY_BLOCKED');
    await P.patch(`/api/platform/companies/${companyB}`, { status: 'ACTIVE' });
    LB = api(await betaToken());
    expect((await LB.get('/api/clients')).status).toBe(200);
  });
});

describe('kompaniya brendi (sozlamalar)', () => {
  it('rahbar nom va logoni o\'zgartiradi, boshqalar faqat ko\'radi', async () => {
    expect((await L.get('/api/company')).body.name).toBe('Test MChJ');
    expect((await A1.patch('/api/company', { name: 'Buzildi' })).status).toBe(403);
    const r = await L.patch('/api/company', { name: 'Alfa Buxgalteriya' });
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Alfa Buxgalteriya');
    expect((await LB.get('/api/company')).body.name).toBe('Beta Audit');

    const tokL = await token('leader');
    const up = await request(app).put('/api/company/logo').set('Authorization', `Bearer ${tokL}`).attach('file', PNG, 'logo.png');
    expect(up.status).toBe(200);
    expect(up.body.logo).toMatch(/^data:image\/png;base64,/);
    // SVG (skript bo'lishi mumkin) qabul qilinmaydi
    const svg = await request(app)
      .put('/api/company/logo')
      .set('Authorization', `Bearer ${tokL}`)
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.png');
    expect(svg.status).toBe(400);
    expect((await A1.get('/api/company')).body.logo).toMatch(/^data:image\/png/);
    expect((await LB.get('/api/company')).body.logo).toBe(null);
    expect((await L.del('/api/company/logo')).body.logo).toBe(null);
  });

  it('kompaniya tarif muddatini o\'zi o\'zgartira olmaydi', async () => {
    const before = (await L.get('/api/company')).body.paidUntil;
    await L.patch('/api/company', { name: 'Alfa', paidUntil: '2099-01-01', plan: 'YEARLY' });
    expect((await L.get('/api/company')).body.paidUntil).toBe(before);
  });
});
