import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { COMPANY_EXPIRED_SQL, COMPANY_LOCKED_SQL } from '../common/auth';
import { AppError, notFound, parse } from '../common/errors';
import { config } from '../config';
import { asSystem, one, pool, q, tx, withCompany } from '../db';
import { generateCurrentForCompany } from '../scheduler';
import { hashPassword, passwordSchema } from './auth';

// Platforma (SaaS egasi) paneli: kompaniyalar, tarif, qo'lda kiritiladigan to'lovlar va chek so'rovlari (V47).
// Qaror: alohida jadval (platform_admin) va alohida JWT kaliti — kompaniya xodimining tokeni bu yerga
// o'tmaydi va aksincha. Barcha so'rovlar tizim rejimida (RLS bypass): admin hamma kompaniyani ko'radi.

const PLATFORM_SECRET = () => `${config.jwtAccessSecret}:platform`;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const PLANS = ['MONTHLY', 'YEARLY'] as const;
const PLAN_MONTHS: Record<(typeof PLANS)[number], number> = { MONTHLY: 1, YEARLY: 12 };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      platformAdmin?: { id: number; fullName: string };
    }
  }
}

const platformPassword = z.string().min(8).max(100);

async function requirePlatform(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
  if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Avtorizatsiya talab qilinadi');
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, PLATFORM_SECRET(), { audience: 'platform' }) as jwt.JwtPayload;
  } catch {
    throw new AppError(401, 'TOKEN_INVALID', 'Token yaroqsiz yoki muddati tugagan');
  }
  const a = await one<{ id: number; fullName: string; active: boolean }>(
    pool,
    'SELECT id, full_name AS "fullName", active FROM platform_admin WHERE id = $1',
    [Number(payload.sub)],
  );
  if (!a?.active) throw new AppError(401, 'TOKEN_INVALID', 'Admin faol emas');
  req.platformAdmin = { id: a.id, fullName: a.fullName };
  next();
}

const admin = (req: Request) => req.platformAdmin!;

/** .env: PLATFORM_ADMIN_*. Login bazada bo'lmasa yaratiladi, bor bo'lsa tegilmaydi. */
export async function bootstrapPlatformAdmin(login: string, password: string, fullName: string) {
  if (!login || !password) return false;
  return asSystem(async () => {
    if (await one(pool, 'SELECT id FROM platform_admin WHERE login = $1', [login])) return false;
    platformPassword.parse(password);
    await pool.query('INSERT INTO platform_admin (login, full_name, password_hash) VALUES ($1, $2, $3)', [
      login,
      fullName,
      await hashPassword(password),
    ]);
    console.log(`Platforma admini yaratildi: ${login}`);
    return true;
  });
}

const COMPANY = `c.id, c.name, c.status, c.plan, c.paid_until AS "paidUntil", c.contact_phone AS "contactPhone", c.note,
  c.created_at AS "createdAt", (c.logo IS NOT NULL) AS "hasLogo", ${COMPANY_EXPIRED_SQL} AS expired, ${COMPANY_LOCKED_SQL} AS locked,
  CASE WHEN c.paid_until IS NULL THEN NULL ELSE c.paid_until - (now() AT TIME ZONE 'Asia/Tashkent')::date END AS "daysLeft",
  (SELECT count(*) FROM app_user u WHERE u.company_id = c.id AND u.active AND u.deleted_at IS NULL)::int AS "usersCount",
  (SELECT count(*) FROM client k WHERE k.company_id = c.id AND k.status <> 'ARCHIVED')::int AS "clientsCount",
  (SELECT u.login FROM app_user u WHERE u.company_id = c.id AND u.role = 'LEADER' ORDER BY u.id LIMIT 1) AS "leaderLogin",
  EXISTS (SELECT 1 FROM payment_request r WHERE r.company_id = c.id AND r.status = 'PENDING') AS "hasPendingRequest"`;

const loadCompany = (db: typeof pool | import('pg').PoolClient, id: number) =>
  one(db, `SELECT ${COMPANY} FROM company c WHERE c.id = $1 AND NOT c.is_template`, [id]);

export const platformRouter = Router();
// Platforma — kompaniyadan tashqarida: tizim rejimi
platformRouter.use((_req, _res, next) => asSystem(() => next()));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isTest ? 1000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { code: 'RATE_LIMITED', message: 'Juda ko\'p urinish. Keyinroq qayta urining.', details: null },
});

platformRouter.post('/auth/login', loginLimiter, async (req, res) => {
  const { login, password } = parse(z.object({ login: z.string().trim().min(1), password: z.string().min(1) }), req.body);
  const a = await one<any>(
    pool,
    `SELECT id, full_name AS "fullName", password_hash, active, locked_until > now() AS locked FROM platform_admin WHERE login = $1`,
    [login],
  );
  if (a?.locked) throw new AppError(423, 'ACCOUNT_LOCKED', `Hisob ${LOCK_MINUTES} daqiqaga bloklangan`);
  if (!a || !a.active || !(await bcrypt.compare(password, a.password_hash))) {
    if (a) {
      await pool.query(
        `UPDATE platform_admin SET failed_login_count = failed_login_count + 1,
           locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(mins => $3) END
         WHERE id = $1`,
        [a.id, MAX_FAILED, LOCK_MINUTES],
      );
    }
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Login yoki parol noto\'g\'ri');
  }
  await pool.query('UPDATE platform_admin SET failed_login_count = 0, locked_until = NULL WHERE id = $1', [a.id]);
  const accessToken = jwt.sign({ sub: String(a.id) }, PLATFORM_SECRET(), {
    audience: 'platform',
    expiresIn: config.platformTokenTtlSec,
  });
  res.json({ accessToken, expiresIn: config.platformTokenTtlSec, admin: { id: a.id, fullName: a.fullName } });
});

platformRouter.use(requirePlatform);

platformRouter.get('/me', (req, res) => {
  res.json(admin(req));
});

// ---------- Tariflar ----------
platformRouter.get('/tariffs', async (_req, res) => {
  res.json(await q(pool, 'SELECT code, months, price FROM tariff ORDER BY months'));
});

platformRouter.put('/tariffs/:code', async (req, res) => {
  const code = parse(z.enum(PLANS), req.params.code);
  const { price } = parse(z.object({ price: z.number().int().min(0).max(1e12) }), req.body);
  const r = await one(pool, 'UPDATE tariff SET price = $2, updated_at = now() WHERE code = $1 RETURNING code, months, price', [code, price]);
  res.json(r);
});

// ---------- Kompaniyalar ----------
platformRouter.get('/companies', async (_req, res) => {
  res.json(await q(pool, `SELECT ${COMPANY} FROM company c WHERE NOT c.is_template ORDER BY c.created_at DESC`));
});

platformRouter.get('/companies/:id', async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const c = await loadCompany(pool, id);
  if (!c) throw notFound('Kompaniya');
  const payments = await q(
    pool,
    `SELECT p.id, p.plan, p.periods, p.amount, p.paid_from AS "paidFrom", p.paid_until AS "paidUntil", p.note,
            p.created_at AS "createdAt", a.full_name AS "createdByName"
     FROM company_payment p LEFT JOIN platform_admin a ON a.id = p.created_by
     WHERE p.company_id = $1 ORDER BY p.created_at DESC`,
    [id],
  );
  res.json({ ...c, payments });
});

platformRouter.post('/companies', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(120),
      plan: z.enum(PLANS),
      // Bo'sh bo'lsa: bugundan tarif muddati (1 oy / 1 yil)
      paidUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      contactPhone: z.string().trim().max(50).nullable().optional(),
      note: z.string().trim().max(1000).nullable().optional(),
      leader: z.object({
        fullName: z.string().trim().min(2).max(200),
        login: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9._-]+$/),
        password: passwordSchema,
      }),
    }),
    req.body,
  );
  const company = await tx(async (db) => {
    if (await one(db, 'SELECT 1 FROM app_user WHERE login = $1', [body.leader.login])) {
      throw new AppError(409, 'LOGIN_TAKEN', 'Bu login band, boshqasini tanlang');
    }
    const c = await one<{ id: number }>(
      db,
      `INSERT INTO company (name, plan, paid_until, contact_phone, note)
       VALUES ($1, $2, coalesce($3::date, ((now() AT TIME ZONE 'Asia/Tashkent')::date + make_interval(months => $4))::date), $5, $6)
       RETURNING id`,
      [body.name, body.plan, body.paidUntil ?? null, PLAN_MONTHS[body.plan], body.contactPhone ?? null, body.note ?? null],
    );
    // Hisobot turlari, oylik ishlar va sozlamalar shablondan (6.3 jadvali) — keyin rahbar o'zi moslaydi
    await db.query('SELECT fn_company_seed($1)', [c!.id]);
    await db.query(
      `INSERT INTO app_user (company_id, full_name, login, password_hash, role) VALUES ($1, $2, $3, $4, 'LEADER')`,
      [c!.id, body.leader.fullName, body.leader.login, await hashPassword(body.leader.password)],
    );
    return loadCompany(db, c!.id);
  });
  res.status(201).json(company);
});

platformRouter.patch('/companies/:id', async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const body = parse(
    z.object({
      name: z.string().trim().min(1).max(120).optional(),
      status: z.enum(['ACTIVE', 'BLOCKED']).optional(),
      paidUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      contactPhone: z.string().trim().max(50).nullable().optional(),
      note: z.string().trim().max(1000).nullable().optional(),
    }),
    req.body,
  );
  const r = await pool.query(
    `UPDATE company SET name = coalesce($2, name), status = coalesce($3, status), paid_until = coalesce($4::date, paid_until),
       contact_phone = CASE WHEN $5 THEN $6 ELSE contact_phone END, note = CASE WHEN $7 THEN $8 ELSE note END
     WHERE id = $1 AND NOT is_template`,
    [id, body.name ?? null, body.status ?? null, body.paidUntil ?? null,
      body.contactPhone !== undefined, body.contactPhone ?? null, body.note !== undefined, body.note ?? null],
  );
  if (!r.rowCount) throw notFound('Kompaniya');
  if (body.status === 'BLOCKED') {
    // Bloklangan kompaniya xodimlarining sessiyalari darhol yopiladi
    await pool.query(
      `UPDATE refresh_token SET revoked_at = now()
       WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM app_user WHERE company_id = $1)`,
      [id],
    );
  }
  res.json(await loadCompany(pool, id));
});

/**
 * Tarifni tugatish (V48): muddat kechagi kunga tushadi — kompaniya darhol "muddati o'tgan" bo'ladi.
 * immediate=false — odatdagi imtiyozli davr (3 kun faqat o'qish, keyin yopiladi); true — bugundan yopiq.
 * Muddat allaqachon o'tgan bo'lsa paid_until o'zgarmaydi. To'lov kiritilsa yoki chek tasdiqlansa — bugundan qayta ochiladi.
 */
platformRouter.post('/companies/:id/end-tariff', async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const body = parse(z.object({ immediate: z.boolean().default(false) }), req.body);
  const r = await pool.query(
    `UPDATE company SET paid_until = least(coalesce(paid_until, t.today - 1), t.today - 1),
            lock_from = CASE WHEN $2 THEN t.today ELSE NULL END
     FROM (SELECT (now() AT TIME ZONE 'Asia/Tashkent')::date AS today) t
     WHERE id = $1 AND NOT is_template`,
    [id, body.immediate],
  );
  if (!r.rowCount) throw notFound('Kompaniya');
  console.log(`[platform] admin ${admin(req).id}: kompaniya ${id} tarifi tugatildi (${body.immediate ? 'darhol yopildi' : 'imtiyozli davr bilan'})`);
  res.json(await loadCompany(pool, id));
});

/**
 * To'lov (qo'lda): muddat davom ettiriladi — hali tugamagan bo'lsa paid_until'dan, tugagan bo'lsa bugundan.
 * Tarif turi oxirgi to'lovdagisiga almashadi. Qo'lda kiritish va chek so'rovini tasdiqlash — ikkalasi shu yerdan.
 */
async function addCompanyPayment(
  db: import('pg').PoolClient,
  companyId: number,
  p: { plan: (typeof PLANS)[number]; periods: number; amount: number; note: string | null; adminId: number },
) {
  const c = await one<{ from: string; until: string }>(
    db,
    `SELECT greatest(coalesce(paid_until, today), today) AS "from",
            (greatest(coalesce(paid_until, today), today) + make_interval(months => $2))::date AS "until"
     FROM company, (SELECT (now() AT TIME ZONE 'Asia/Tashkent')::date AS today) t
     WHERE id = $1 AND NOT is_template FOR UPDATE OF company`,
    [companyId, PLAN_MONTHS[p.plan] * p.periods],
  );
  if (!c) throw notFound('Kompaniya');
  await db.query('UPDATE company SET plan = $2, paid_until = $3 WHERE id = $1', [companyId, p.plan, c.until]);
  const r = await one<{ id: number }>(
    db,
    `INSERT INTO company_payment (company_id, plan, periods, amount, paid_from, paid_until, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [companyId, p.plan, p.periods, p.amount, c.from, c.until, p.note, p.adminId],
  );
  return r!.id;
}

/** Muddat o'tgan paytda scheduler kompaniyani o'tkazib yuborgan: joriy oy vazifalari endi (idempotent) */
const generateAfterPayment = (id: number) =>
  withCompany(id, () => generateCurrentForCompany(id)).catch((e) => console.error('[payment] generator:', e));

const paymentBody = z.object({
  plan: z.enum(PLANS),
  periods: z.number().int().min(1).max(36).default(1),
  amount: z.number().int().min(0).max(1e12),
  note: z.string().trim().max(500).nullable().optional(),
});

platformRouter.post('/companies/:id/payments', async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const body = parse(paymentBody, req.body);
  await tx((db) => addCompanyPayment(db, id, { ...body, note: body.note ?? null, adminId: admin(req).id }));
  await generateAfterPayment(id);
  res.status(201).json(await loadCompany(pool, id));
});

// ---------- To'lov rekvizitlari (rahbar Sozlamalar → Kompaniya'da ko'radi) ----------
export const paymentInfoSchema = z.object({
  cardNumber: z.string().trim().max(40).regex(/^[\d ]*$/), // faqat raqam (4 tadan bo'shliq bilan)
  cardHolder: z.string().trim().max(120),
  bank: z.string().trim().max(120),
  contact: z.string().trim().max(200),
  note: z.string().trim().max(1000),
});
export type PaymentInfo = z.infer<typeof paymentInfoSchema>;

export async function loadPaymentInfo(): Promise<PaymentInfo> {
  const r = await asSystem(() => one<{ value: Partial<PaymentInfo> }>(pool, `SELECT value FROM platform_setting WHERE key = 'payment_info'`));
  return { cardNumber: '', cardHolder: '', bank: '', contact: '', note: '', ...(r?.value ?? {}) };
}

platformRouter.get('/payment-info', async (_req, res) => {
  res.json(await loadPaymentInfo());
});

platformRouter.put('/payment-info', async (req, res) => {
  const body = parse(paymentInfoSchema, req.body);
  await pool.query(
    `INSERT INTO platform_setting (key, value) VALUES ('payment_info', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(body)],
  );
  res.json(await loadPaymentInfo());
});

// ---------- To'lov so'rovlari (rahbar yuborgan chek skrinshoti) ----------
const REQUEST = `r.id, r.company_id AS "companyId", c.name AS "companyName", r.plan, r.periods, r.amount, r.note, r.status,
  r.reject_reason AS "rejectReason", r.created_at AS "createdAt", u.full_name AS "createdByName",
  r.reviewed_at AS "reviewedAt", a.full_name AS "reviewedByName", c.paid_until AS "paidUntil"`;
const REQUEST_FROM = `payment_request r JOIN company c ON c.id = r.company_id
  LEFT JOIN app_user u ON u.id = r.created_by LEFT JOIN platform_admin a ON a.id = r.reviewed_by`;

platformRouter.get('/payment-requests', async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(['PENDING', 'ALL']).default('PENDING') }), req.query);
  res.json(
    await q(
      pool,
      `SELECT ${REQUEST} FROM ${REQUEST_FROM}
       ${status === 'PENDING' ? `WHERE r.status = 'PENDING' ORDER BY r.created_at` : 'ORDER BY r.created_at DESC LIMIT 100'}`,
    ),
  );
});

platformRouter.get('/payment-requests/:id/screenshot', async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const r = await one<{ screenshot: Buffer; mime: string }>(pool, 'SELECT screenshot, screenshot_mime AS mime FROM payment_request WHERE id = $1', [id]);
  if (!r) throw notFound('So\'rov');
  res.setHeader('Content-Type', r.mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(r.screenshot);
});

async function lockPending(db: import('pg').PoolClient, id: number) {
  const r = await one<{ companyId: number; plan: (typeof PLANS)[number]; periods: number; amount: number; status: string }>(
    db,
    `SELECT company_id AS "companyId", plan, periods, amount, status FROM payment_request WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!r) throw notFound('So\'rov');
  if (r.status !== 'PENDING') throw new AppError(409, 'PAYMENT_REQUEST_CLOSED', 'So\'rov allaqachon ko\'rib chiqilgan');
  return r;
}

/** Tasdiqlash: so'rovdagi tarif va davr bilan odatdagi to'lov yoziladi; summa admin kiritgani (bo'lmasa so'rovdagi) */
platformRouter.post('/payment-requests/:id/approve', async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const body = parse(
    z.object({ amount: z.number().int().min(0).max(1e12).optional(), note: z.string().trim().max(500).nullable().optional() }),
    req.body ?? {},
  );
  const companyId = await tx(async (db) => {
    const r = await lockPending(db, id);
    const paymentId = await addCompanyPayment(db, r.companyId, {
      plan: r.plan,
      periods: r.periods,
      amount: body.amount ?? r.amount,
      note: body.note || `Chek #${id}`,
      adminId: admin(req).id,
    });
    await db.query(
      `UPDATE payment_request SET status = 'APPROVED', payment_id = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1`,
      [id, paymentId, admin(req).id],
    );
    return r.companyId;
  });
  await generateAfterPayment(companyId);
  res.json(await one(pool, `SELECT ${REQUEST} FROM ${REQUEST_FROM} WHERE r.id = $1`, [id]));
});

platformRouter.post('/payment-requests/:id/reject', async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(500) }), req.body);
  await tx(async (db) => {
    await lockPending(db, id);
    await db.query(
      `UPDATE payment_request SET status = 'REJECTED', reject_reason = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1`,
      [id, reason, admin(req).id],
    );
  });
  res.json(await one(pool, `SELECT ${REQUEST} FROM ${REQUEST_FROM} WHERE r.id = $1`, [id]));
});

// ---------- Kompaniya rahbarlari (kirish ma'lumoti) ----------
// Platforma admini faqat rahbar hisoblari bilan ishlaydi: rahbar kira olmasa login/parolini tiklaydi
// yoki yangi rahbar ochadi. Buxgalter va operatorlarni rahbar o'zi boshqaradi (kompaniya ichki ma'lumoti).
const LOGIN = z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9._-]+$/);
const LEADER = `u.id, u.full_name AS "fullName", u.login, u.active, coalesce(u.locked_until > now(), false) AS locked,
  u.created_at AS "createdAt"`;

async function assertLoginFree(db: typeof pool | import('pg').PoolClient, login: string, exceptUserId?: number) {
  if (await one(db, 'SELECT 1 FROM app_user WHERE login = $1 AND id IS DISTINCT FROM $2::bigint', [login, exceptUserId ?? null])) {
    throw new AppError(409, 'LOGIN_TAKEN', 'Bu login band, boshqasini tanlang');
  }
}

async function companyExists(id: number) {
  if (!(await one(pool, 'SELECT 1 FROM company WHERE id = $1 AND NOT is_template', [id]))) throw notFound('Kompaniya');
}

platformRouter.get('/companies/:id/leaders', async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  await companyExists(id);
  res.json(
    await q(pool, `SELECT ${LEADER} FROM app_user u WHERE u.company_id = $1 AND u.role = 'LEADER' AND u.deleted_at IS NULL ORDER BY u.id`, [id]),
  );
});

/** Yangi rahbar (masalan, eski rahbar ketgan yoki logini unutilgan) */
platformRouter.post('/companies/:id/leaders', async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const body = parse(z.object({ fullName: z.string().trim().min(2).max(200), login: LOGIN, password: passwordSchema }), req.body);
  await companyExists(id);
  const u = await tx(async (db) => {
    await assertLoginFree(db, body.login);
    return one<{ id: number }>(
      db,
      `INSERT INTO app_user (company_id, full_name, login, password_hash, role) VALUES ($1, $2, $3, $4, 'LEADER') RETURNING id`,
      [id, body.fullName, body.login, await hashPassword(body.password)],
    );
  });
  console.log(`[platform] admin ${admin(req).id}: kompaniya ${id} uchun yangi rahbar ${u!.id} (${body.login})`);
  res.status(201).json(await one(pool, `SELECT ${LEADER} FROM app_user u WHERE u.id = $1`, [u!.id]));
});

/**
 * Rahbar kirish ma'lumotini tiklash: login va/yoki parol. Blok (urinishlar) olinadi, hisob faollashtiriladi,
 * parol o'zgarsa sessiyalar yopiladi.
 */
platformRouter.patch('/companies/:id/leaders/:userId', async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const userId = parse(z.coerce.number().int().positive(), req.params.userId);
  const body = parse(
    z.object({ fullName: z.string().trim().min(2).max(200).optional(), login: LOGIN.optional(), password: passwordSchema.optional() }),
    req.body,
  );
  await tx(async (db) => {
    if (body.login) await assertLoginFree(db, body.login, userId);
    const u = await one(
      db,
      `UPDATE app_user SET full_name = coalesce($3, full_name), login = coalesce($4, login),
              password_hash = coalesce($5, password_hash), failed_login_count = 0, locked_until = NULL, active = true
       WHERE id = $2 AND company_id = $1 AND role = 'LEADER' AND deleted_at IS NULL RETURNING id`,
      [id, userId, body.fullName ?? null, body.login ?? null, body.password ? await hashPassword(body.password) : null],
    );
    if (!u) throw notFound('Rahbar');
    if (body.password || body.login) {
      await db.query('UPDATE refresh_token SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
    }
  });
  console.log(`[platform] admin ${admin(req).id}: kompaniya ${id} rahbari ${userId} kirish ma'lumoti yangilandi`);
  res.json(await one(pool, `SELECT ${LEADER} FROM app_user u WHERE u.id = $1`, [userId]));
});
