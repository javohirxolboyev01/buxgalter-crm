import crypto from 'node:crypto';
import { config } from '../config';
import { AppError } from './errors';

// Mijozning tashqi tizim parollari (my.mehnat.uz) uchun AES-256-GCM.
// Qaror: bazada faqat shifrlangan matn ('iv.tag.ciphertext', base64); kalit .env'da (CREDENTIALS_KEY).
// Baza zaxirasi yoki audit_log orqali ochiq parol chiqib ketmaydi. Kalit yo'qolsa parollar tiklanmaydi.

const DEV_KEY = 'dev-credentials-key-change-me-0123456789abcdef';

function key() {
  const raw = process.env.CREDENTIALS_KEY ?? (config.isProd ? '' : DEV_KEY);
  // Prod'da kalitsiz ishga tushish bloklanmaydi, faqat parol saqlash/ochish ishlamaydi
  if (raw.length < 32) throw new AppError(500, 'CREDENTIALS_KEY_MISSING', 'CREDENTIALS_KEY sozlanmagan (kamida 32 belgi)');
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(box: string): string {
  const [iv, tag, enc] = box.split('.').map((s) => Buffer.from(s, 'base64'));
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch {
    throw new AppError(500, 'CREDENTIALS_DECRYPT_FAILED', "Parolni ochib bo'lmadi (CREDENTIALS_KEY o'zgarganmi?)");
  }
}
