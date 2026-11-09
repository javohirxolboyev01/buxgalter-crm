import { execFile } from 'node:child_process';
import path from 'node:path';
import cron from 'node-cron';
import { config } from './config';
import { forEachCompany } from './common/tenancy';
import { currentPeriod } from './common/time';
import { runGenerator } from './modules/generator';
import { dispatchDue, remindOverdue } from './modules/notifications';
import { remindOverdueClients } from './modules/overdueReminder';

const tz = { timezone: config.timezone };
const intervals: NodeJS.Timeout[] = [];
const safe = (name: string, fn: () => Promise<unknown>) => () =>
  fn().catch((e) => console.error(`[scheduler] ${name}:`, e));

/** Bitta kompaniya uchun joriy oy (idempotent): scheduler va tarif uzaytirilganda chaqiriladi */
export async function generateCurrentForCompany(companyId: number) {
  const r = await runGenerator(currentPeriod(), false, null);
  if (r.created || r.reopened) {
    console.log(`[generator] kompaniya ${companyId} ${r.period}: +${r.created} vazifa, ${r.reopened} qayta ochildi`);
  }
}

// Har kompaniya o'z kontekstida; tarif muddati o'tganlarga vazifa va eslatma chiqmaydi (faqat o'qish rejimi)
const generateCurrent = () => forEachCompany('generator', generateCurrentForCompany, { paidOnly: true });

export function startScheduler() {
  // Har oyning 1-kuni 00:05 (Asia/Tashkent)
  cron.schedule('5 0 1 * *', safe('generator', generateCurrent), tz);
  // Ishga tushganda ham: server 1-kuni o'chiq bo'lsa, joriy oy baribir yaratiladi (idempotent)
  void safe('generator(startup)', generateCurrent)();

  // Bildirishnoma dispatcher: har soniyada. Tizim rejimida — navbatdagi yozuvlar allaqachon kompaniyaga tegishli
  intervals.push(setInterval(safe('dispatcher', () => dispatchDue()), 1000));
  // Muddat o'tdi eslatmasi: har daqiqa
  intervals.push(setInterval(safe('overdue', () => forEachCompany('overdue', remindOverdue, { paidOnly: true })), 60_000));
  // Kechikkan mijozlar: har daqiqa tekshiradi, kuniga bir marta (kompaniya sozlamasidagi soatdan keyin) yuboradi
  intervals.push(
    setInterval(safe('overdue-clients', () => forEachCompany('overdue-clients', () => remindOverdueClients(), { paidOnly: true })), 60_000),
  );

  if (config.backup.enabled) {
    // Kunlik zaxira 02:30
    cron.schedule(
      '30 2 * * *',
      () => {
        const script = path.resolve(__dirname, '../../../scripts/backup.sh');
        execFile(script, { env: { ...process.env, DATABASE_URL: config.databaseUrl, BACKUP_DIR: config.backup.dir } }, (err, out, errOut) => {
          if (err) console.error('[backup] xato:', errOut || err.message);
          else console.log('[backup]', out.trim());
        });
      },
      tz,
    );
  }
}

export function stopScheduler() {
  intervals.forEach(clearInterval);
  cron.getTasks().forEach((t) => t.stop());
}
