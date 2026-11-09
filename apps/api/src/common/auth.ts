import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { asSystem, one, pool, withCompany } from '../db';
import { AppError, forbidden } from './errors';

export type Role = 'LEADER' | 'ACCOUNTANT' | 'OPERATOR';

export interface AuthUser {
  id: number;
  role: Role;
  fullName: string;
  language: 'uz' | 'ru';
  companyId: number;
  /** Tarif muddati o'tgan: faqat o'qish rejimi (imtiyozli davr) */
  readOnly: boolean;
  /** Imtiyozli davr ham o'tgan: kompaniya yopiq (faqat profil va tarif to'lovi) */
  locked: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signAccessToken(u: { id: number; role: Role }) {
  return jwt.sign({ sub: String(u.id), role: u.role }, config.jwtAccessSecret, { expiresIn: config.accessTtlSec });
}

export async function userFromToken(token: string | undefined): Promise<AuthUser> {
  if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Avtorizatsiya talab qilinadi');
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.jwtAccessSecret) as jwt.JwtPayload;
  } catch {
    throw new AppError(401, 'TOKEN_INVALID', 'Token yaroqsiz yoki muddati tugagan');
  }
  // Har so'rovda bazadan: faolsizlantirilgan xodim darhol uziladi, rol o'zgarishi darhol kuchga kiradi.
  // Tizim rejimida: kompaniya hali ma'lum emas (login global unikal, kompaniyani u aniqlaydi)
  const u = await asSystem(() =>
    one<Omit<AuthUser, 'readOnly' | 'locked'> & { active: boolean; companyStatus: string; expired: boolean; locked: boolean }>(
      pool,
      `SELECT u.id, u.role, u.full_name AS "fullName", u.language, u.active, u.company_id AS "companyId",
              c.status AS "companyStatus", ${COMPANY_EXPIRED_SQL} AS expired, ${COMPANY_LOCKED_SQL} AS locked
       FROM app_user u JOIN company c ON c.id = u.company_id WHERE u.id = $1`,
      [Number(payload.sub)],
    ),
  );
  if (!u || !u.active) throw new AppError(401, 'TOKEN_INVALID', 'Foydalanuvchi faol emas');
  if (u.companyStatus !== 'ACTIVE') throw new AppError(403, 'COMPANY_BLOCKED', 'Kompaniya bloklangan. Administratorga murojaat qiling');
  return { id: u.id, role: u.role, fullName: u.fullName, language: u.language, companyId: u.companyId, readOnly: u.expired, locked: u.locked };
}

/** Tarif muddati: paid_until kuni oxirigacha (Asia/Tashkent) amal qiladi; NULL — muddatsiz */
export const COMPANY_EXPIRED_SQL = `coalesce(c.paid_until < (now() AT TIME ZONE 'Asia/Tashkent')::date, false)`;

/**
 * Imtiyozli davr: muddat o'tgach shuncha kun faqat o'qish, keyin kompaniya yopiladi —
 * rahbar faqat «Tarif va to'lovlar»ni, qolgan xodimlar faqat "tarif tugagan" ekranini ko'radi.
 * TODO(tasdiqlash): 3 kun
 */
export const TARIFF_GRACE_DAYS = 3;
const TODAY_SQL = `(now() AT TIME ZONE 'Asia/Tashkent')::date`;
// lock_from (V48): admin tarifni "darhol yopish" bilan tugatgan — imtiyozli davrsiz (faqat shu tugatishga, lock_from > paid_until)
export const COMPANY_LOCKED_SQL = `coalesce(c.paid_until < ${TODAY_SQL} AND (c.paid_until + ${TARIFF_GRACE_DAYS} < ${TODAY_SQL}
  OR (c.lock_from > c.paid_until AND c.lock_from <= ${TODAY_SQL})), false)`;
/** Yopilishdan oldingi oxirgi kun (banner: "shu sanadan keyin yopiladi") */
export const COMPANY_LOCK_AT_SQL = `CASE WHEN c.paid_until IS NULL THEN NULL
  WHEN c.lock_from > c.paid_until THEN least(c.lock_from - 1, c.paid_until + ${TARIFF_GRACE_DAYS})
  ELSE c.paid_until + ${TARIFF_GRACE_DAYS} END`;

// Muddat o'tganda ham ruxsat: o'z profili (til, parol, Telegram), bildirishnomani o'qilgan qilish
// va tarif to'lovi cheki (V47) — aynan muddat o'tganda kerak
const READ_ONLY_ALLOWED = [/^\/api\/me(\/|$)/, /^\/api\/notifications(\/|$)/, /^\/api\/company\/payment-requests(\/|$)/];

// Yopiq kompaniyada (imtiyozli davr o'tgan) faqat: o'z profili, kompaniya holati (nom, logo, muddat)
// va tarif to'lovi (rekvizitlar, chek — router ichida faqat rahbarga). Ko'rish (GET) ham yopiq.
const LOCKED_ALLOWED = [/^\/api\/me(\/|\?|$)/, /^\/api\/company(\/billing|\/payment-requests(\/[^?]*)?)?(\?|$)/];

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  // app.ts'dagi rol guardi bilan ikki marta chaqirilsa, bazaga qayta so'ralmaydi (kontekst allaqachon o'rnatilgan)
  if (req.user) return next();
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
  const user = await userFromToken(token);
  req.user = user;
  if (user.locked && !LOCKED_ALLOWED.some((r) => r.test(req.originalUrl))) {
    throw new AppError(402, 'SUBSCRIPTION_LOCKED', 'Kompaniya tarifi tugagan. Ishni davom ettirish uchun tarifni to\'lang');
  }
  if (user.readOnly && req.method !== 'GET' && req.method !== 'HEAD' && !READ_ONLY_ALLOWED.some((r) => r.test(req.originalUrl))) {
    throw new AppError(402, 'SUBSCRIPTION_EXPIRED', 'Tarif muddati tugagan: faqat ko\'rish mumkin. To\'lovdan keyin ishlash davom etadi');
  }
  // Qolgan barcha middleware va handler shu kompaniya kontekstida (RLS) ishlaydi
  withCompany(user.companyId, () => next());
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Avtorizatsiya talab qilinadi');
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

export const requireLeader = requireRole('LEADER');
/** Buxgalteriya ishi (mijozlar, vazifalar, jadval): operatorga yopiq */
export const requireStaff = requireRole('LEADER', 'ACCOUNTANT');

export function me(req: Request): AuthUser {
  if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Avtorizatsiya talab qilinadi');
  return req.user;
}

export const isLeader = (u: AuthUser) => u.role === 'LEADER';
