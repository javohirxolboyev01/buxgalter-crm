// Playwright uchun: alohida e2e bazasini noldan tayyorlab, namuna ma'lumot bilan API ni ishga tushiradi.
// DATABASE_URL e2e bazaga qaratilgan bo'lishi shart (dev bazaga tegmaslik uchun tekshiriladi).
import { pool } from '../src/db';
import { seedE2e } from './e2e-seed';

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/e2e/.test(url)) throw new Error(`E2E server faqat *e2e* bazada ishlaydi: ${url}`);
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await seedE2e();
  await import('../src/index');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
