import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { COMPANY_EXPIRED_SQL, me, requireAuth, requireLeader } from '../common/auth';
import { audit } from '../common/audit';
import { AppError, parse } from '../common/errors';
import { currentCompanyId, one, pool, q, tx } from '../db';

// Kompaniya brendi va tarif holati (SaaS, V46). Hamma rol o'qiydi (sarlavhada logo/nom), faqat rahbar o'zgartiradi.
// Tarif va muddatni faqat platforma admini o'zgartiradi (DB'da app_tenant'ga ham faqat brend ustunlari ochiq).

export const LOGO_MAX_BYTES = 300 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LOGO_MAX_BYTES, files: 1 } });

/** Fayl mazmuni bo'yicha tur (brauzer yuborgan mime'ga ishonilmaydi). SVG qabul qilinmaydi (skript bo'lishi mumkin). */
export function sniffImage(b: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const COMPANY = `c.id, c.name, c.plan, c.paid_until AS "paidUntil", c.logo_version AS "logoVersion",
  CASE WHEN c.logo IS NULL THEN NULL ELSE 'data:' || c.logo_mime || ';base64,' || encode(c.logo, 'base64') END AS logo,
  ${COMPANY_EXPIRED_SQL} AS "readOnly",
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
