import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { COMPANY_EXPIRED_SQL } from '../common/auth';
import { AppError, notFound, parse } from '../common/errors';
import { config } from '../config';
import { asSystem, one, pool, q, tx, withCompany } from '../db';
import { generateCurrentForCompany } from '../scheduler';
import { hashPassword, passwordSchema } from './auth';

// Platforma (SaaS egasi) paneli: kompaniyalar, tarif va qo'lda kiritiladigan to'lovlar.
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
  c.created_at AS "createdAt", (c.logo IS NOT NULL) AS "hasLogo", ${COMPANY_EXPIRED_SQL} AS expired,
  CASE WHEN c.paid_until IS NULL THEN NULL ELSE c.paid_until - (now() AT TIME ZONE 'Asia/Tashkent')::date END AS "daysLeft",
  (SELECT count(*) FROM app_user u WHERE u.company_id = c.id AND u.active AND u.deleted_at IS NULL)::int AS "usersCount",
  (SELECT count(*) FROM client k WHERE k.company_id = c.id AND k.status <> 'ARCHIVED')::int AS "clientsCount",
  (SELECT u.login FROM app_user u WHERE u.company_id = c.id AND u.role = 'LEADER' ORDER BY u.id LIMIT 1) AS "leaderLogin"`;

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
 * To'lov (qo'lda): muddat davom ettiriladi — hali tugamagan bo'lsa paid_until'dan, tugagan bo'lsa bugundan.
 * Tarif turi oxirgi to'lovdagisiga almashadi. Muddat o'tgan kompaniyaga shu oy vazifalari darhol yaratiladi.
 */
platformRouter.post('/companies/:id/payments', async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const body = parse(
    z.object({
      plan: z.enum(PLANS),
      periods: z.number().int().min(1).max(36).default(1),
      amount: z.number().int().min(0).max(1e12),
      note: z.string().trim().max(500).nullable().optional(),
    }),
    req.body,
  );
  await tx(async (db) => {
    const c = await one<{ from: string; until: string }>(
      db,
      `SELECT greatest(coalesce(paid_until, today), today) AS "from",
              (greatest(coalesce(paid_until, today), today) + make_interval(months => $2))::date AS "until"
       FROM company, (SELECT (now() AT TIME ZONE 'Asia/Tashkent')::date AS today) t
       WHERE id = $1 AND NOT is_template FOR UPDATE OF company`,
      [id, PLAN_MONTHS[body.plan] * body.periods],
    );
    if (!c) throw notFound('Kompaniya');
    await db.query('UPDATE company SET plan = $2, paid_until = $3 WHERE id = $1', [id, body.plan, c.until]);
    await db.query(
      `INSERT INTO company_payment (company_id, plan, periods, amount, paid_from, paid_until, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, body.plan, body.periods, body.amount, c.from, c.until, body.note ?? null, admin(req).id],
    );
  });
  // Muddat o'tgan paytda scheduler bu kompaniyani o'tkazib yuborgan: joriy oy vazifalari endi (idempotent)
  await withCompany(id, () => generateCurrentForCompany(id)).catch((e) => console.error('[payment] generator:', e));
  res.status(201).json(await loadCompany(pool, id));
});

/** Rahbar parolini unutsa: platforma admini yangi parol qo'yadi (sessiyalar yopiladi) */
platformRouter.post('/companies/:id/leader-password', async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const { login, password } = parse(z.object({ login: z.string().trim().min(1), password: passwordSchema }), req.body);
  const u = await one<{ id: number }>(
    pool,
    `UPDATE app_user SET password_hash = $3, failed_login_count = 0, locked_until = NULL
     WHERE company_id = $1 AND login = $2 AND role = 'LEADER' RETURNING id`,
    [id, login, await hashPassword(password)],
  );
  if (!u) throw notFound('Rahbar');
  await pool.query('UPDATE refresh_token SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [u.id]);
  res.json({ ok: true });
});
