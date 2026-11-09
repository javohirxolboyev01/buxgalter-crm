import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { COMPANY_EXPIRED_SQL, COMPANY_LOCK_AT_SQL, COMPANY_LOCKED_SQL, me, requireAuth, requireLeader } from '../common/auth';
import { audit } from '../common/audit';
import { AppError, parse } from '../common/errors';
import { config } from '../config';
import { asSystem, currentCompanyId, one, pool, q, tx } from '../db';
import { loadPaymentInfo } from './platform';
import { sendTelegram, telegramEnabled } from './telegram';

// Kompaniya brendi va tarif holati (SaaS, V46). Hamma rol o'qiydi (sarlavhada logo/nom), faqat rahbar o'zgartiradi.
// Tarif va muddatni faqat platforma admini o'zgartiradi (DB'da app_tenant'ga ham faqat brend ustunlari ochiq).

export const LOGO_MAX_BYTES = 300 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LOGO_MAX_BYTES, files: 1 } });
/** To'lov cheki skrinshoti (V47) */
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const receiptUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: RECEIPT_MAX_BYTES, files: 1 } });

/** Fayl mazmuni bo'yicha tur (brauzer yuborgan mime'ga ishonilmaydi). SVG qabul qilinmaydi (skript bo'lishi mumkin). */
export function sniffImage(b: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const COMPANY = `c.id, c.name, c.plan, c.paid_until AS "paidUntil", c.logo_version AS "logoVersion",
  CASE WHEN c.logo IS NULL THEN NULL ELSE 'data:' || c.logo_mime || ';base64,' || encode(c.logo, 'base64') END AS logo,
  ${COMPANY_EXPIRED_SQL} AS "readOnly", ${COMPANY_LOCKED_SQL} AS locked,
  ${COMPANY_LOCK_AT_SQL} AS "lockAt",
  CASE WHEN c.paid_until IS NULL THEN NULL
       ELSE c.paid_until - (now() AT TIME ZONE 'Asia/Tashkent')::date END AS "daysLeft"`;

async function loadCompany() {
  // RLS: faqat o'z kompaniyasi ko'rinadi; id baribir aniq beriladi
  return one(pool, `SELECT ${COMPANY} FROM company c WHERE c.id = $1`, [currentCompanyId()]);
}

export const companyRouter = Router();
companyRouter.use(requireAuth);

companyRouter.get('/', async (_req, res) => {
  const company = await loadCompany();
  const tariffs = await q(pool, `SELECT code, months, price FROM tariff ORDER BY months`);
  res.json({ ...company, tariffs });
});

companyRouter.patch('/', requireLeader, async (req, res) => {
  const u = me(req);
  const body = parse(z.object({ name: z.string().trim().min(1).max(120) }), req.body);
  await tx(async (db) => {
    const before = await one<{ name: string }>(db, 'SELECT name FROM company WHERE id = $1', [u.companyId]);
    if (before!.name === body.name) return;
    await db.query('UPDATE company SET name = $2 WHERE id = $1', [u.companyId, body.name]);
    await audit(db, { actorId: u.id, entity: 'company', entityId: u.companyId, action: 'UPDATE', before, after: body });
  });
  res.json(await loadCompany());
});

companyRouter.put(
  '/logo',
  requireLeader,
  (req, res, next) =>
    upload.single('file')(req, res, (err: any) => {
      if (err?.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'LOGO_TOO_LARGE', `Logo ${LOGO_MAX_BYTES / 1024} KB dan oshmasin`));
      next(err);
    }),
  async (req, res) => {
    const u = me(req);
    const file = req.file;
    if (!file?.buffer?.length) throw new AppError(400, 'NO_FILE', 'Fayl tanlanmagan');
    const mime = sniffImage(file.buffer);
    if (!mime) throw new AppError(400, 'BAD_IMAGE', 'Faqat PNG, JPG yoki WEBP rasm');
    await tx(async (db) => {
      await db.query('UPDATE company SET logo = $2, logo_mime = $3, logo_version = logo_version + 1 WHERE id = $1', [
        u.companyId,
        file.buffer,
        mime,
      ]);
      await audit(db, { actorId: u.id, entity: 'company', entityId: u.companyId, action: 'LOGO_SET', after: { mime, size: file.size } });
    });
    res.json(await loadCompany());
  },
);

companyRouter.delete('/logo', requireLeader, async (req, res) => {
  const u = me(req);
  await tx(async (db) => {
    await db.query('UPDATE company SET logo = NULL, logo_mime = NULL, logo_version = logo_version + 1 WHERE id = $1', [u.companyId]);
    await audit(db, { actorId: u.id, entity: 'company', entityId: u.companyId, action: 'LOGO_REMOVE' });
  });
  res.json(await loadCompany());
});

// ---------- Tarif to'lovi: kartaga o'tkazma + chek (V47) ----------
// Rahbar platforma kartasiga pul o'tkazadi va chek skrinshotini yuboradi; platforma admini tasdiqlagach muddat uzayadi.
// Muddat o'tgan kompaniyada ham ochiq (auth.ts READ_ONLY_ALLOWED).

const REQUEST = `id, plan, periods, amount, note, status, reject_reason AS "rejectReason", created_at AS "createdAt", reviewed_at AS "reviewedAt", payment_id AS "paymentId"`;

/** Rekvizitlar, so'rovlar va to'lovlar tarixi (company_payment platforma jadvali: tizim rejimida, aniq company_id bilan) */
companyRouter.get('/billing', requireLeader, async (_req, res) => {
  const companyId = currentCompanyId();
  const [paymentInfo, requests, payments] = await Promise.all([
    loadPaymentInfo(),
    q(pool, `SELECT ${REQUEST} FROM payment_request ORDER BY created_at DESC LIMIT 20`),
    asSystem(() =>
      q(
        pool,
        `SELECT id, plan, periods, amount, paid_from AS "paidFrom", paid_until AS "paidUntil", created_at AS "createdAt"
         FROM company_payment WHERE company_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [companyId],
      ),
    ),
  ]);
  res.json({ paymentInfo, requests, payments });
});

companyRouter.post(
  '/payment-requests',
  requireLeader,
  (req, res, next) =>
    receiptUpload.single('file')(req, res, (err: any) => {
      if (err?.code === 'LIMIT_FILE_SIZE') return next(new AppError(413, 'RECEIPT_TOO_LARGE', `Chek ${RECEIPT_MAX_BYTES / 1024 / 1024} MB dan oshmasin`));
      next(err);
    }),
  async (req, res) => {
    const u = me(req);
    const body = parse(
      z.object({
        plan: z.enum(['MONTHLY', 'YEARLY']),
        periods: z.coerce.number().int().min(1).max(36).default(1),
        note: z.string().trim().max(500).optional().transform((v) => v || null),
      }),
      req.body,
    );
    const file = req.file;
    if (!file?.buffer?.length) throw new AppError(400, 'NO_FILE', 'Chek rasmi tanlanmagan');
    const mime = sniffImage(file.buffer);
    if (!mime) throw new AppError(400, 'BAD_IMAGE', 'Faqat PNG, JPG yoki WEBP rasm');
    const created = await tx(async (db) => {
      if (await one(db, `SELECT 1 FROM payment_request WHERE status = 'PENDING'`)) {
        throw new AppError(409, 'PAYMENT_REQUEST_PENDING', 'Oldingi chek hali ko\'rib chiqilmoqda');
      }
      const tariff = await one<{ price: number }>(db, 'SELECT price FROM tariff WHERE code = $1', [body.plan]);
      const r = await one<{ id: number }>(
        db,
        `INSERT INTO payment_request (plan, periods, amount, screenshot, screenshot_mime, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [body.plan, body.periods, (tariff?.price ?? 0) * body.periods, file.buffer, mime, body.note, u.id],
      );
      await audit(db, {
        actorId: u.id,
        entity: 'payment_request',
        entityId: r!.id,
        action: 'CREATE',
        after: { plan: body.plan, periods: body.periods, note: body.note, size: file.size },
      });
      return one(db, `SELECT ${REQUEST} FROM payment_request WHERE id = $1`, [r!.id]);
    });
    notifyPlatform(created, u.fullName).catch((e) => console.error('[payment-request] telegram:', e));
    res.status(201).json(created);
  },
);

companyRouter.get('/payment-requests/:id/screenshot', requireLeader, async (req, res) => {
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const r = await one<{ screenshot: Buffer; mime: string }>(pool, 'SELECT screenshot, screenshot_mime AS mime FROM payment_request WHERE id = $1', [id]);
  if (!r) throw new AppError(404, 'NOT_FOUND', 'So\'rov topilmadi');
  res.setHeader('Content-Type', r.mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(r.screenshot);
});

/** Xato chek yuborilgan bo'lsa: hali ko'rib chiqilmagan so'rovni rahbar bekor qiladi */
companyRouter.post('/payment-requests/:id/cancel', requireLeader, async (req, res) => {
  const u = me(req);
  const id = parse(z.coerce.number().int().positive(), req.params.id);
  const r = await tx(async (db) => {
    const row = await one<{ id: number }>(
      db,
      `UPDATE payment_request SET status = 'CANCELLED' WHERE id = $1 AND status = 'PENDING' RETURNING id`,
      [id],
    );
    if (!row) throw new AppError(409, 'PAYMENT_REQUEST_CLOSED', 'So\'rov allaqachon ko\'rib chiqilgan');
    await audit(db, { actorId: u.id, entity: 'payment_request', entityId: id, action: 'CANCEL' });
    return one(db, `SELECT ${REQUEST} FROM payment_request WHERE id = $1`, [id]);
  });
  res.json(r);
});

/** Platforma adminiga Telegram xabari (TELEGRAM_PLATFORM_CHAT_ID sozlangan bo'lsa) */
async function notifyPlatform(r: any, leaderName: string) {
  if (!telegramEnabled() || !config.telegram.platformChatId) return;
  const company = await one<{ name: string }>(pool, 'SELECT name FROM company WHERE id = $1', [currentCompanyId()]);
  const plan = r.plan === 'YEARLY' ? 'Yillik' : 'Oylik';
  await sendTelegram(
    config.telegram.platformChatId,
    `💳 Yangi tarif cheki #${r.id}\nKompaniya: ${company?.name ?? '—'}\nRahbar: ${leaderName}\nTarif: ${plan} × ${r.periods}\n` +
      `Summa: ${new Intl.NumberFormat('ru-RU').format(r.amount)} so'm${r.note ? `\nIzoh: ${r.note}` : ''}\nPlatforma panelida tasdiqlang.`,
  );
}
