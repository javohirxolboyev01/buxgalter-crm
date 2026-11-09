import { config } from '../src/config';
import { currentPeriod } from '../src/common/time';
import { one, pool, tx } from '../src/db';
import { migrate } from '../src/migrate';
import { hashPassword } from '../src/modules/auth';
import { createClient } from '../src/modules/clients';
import { runGenerator } from '../src/modules/generator';

// Faqat Playwright e2e bazasi uchun (e2e-server.ts): 1 rahbar, 3 buxgalter, 1 sotuv operatori, 10 namuna mijoz.
// Dev/prod bazaga demo ma'lumot yozilmaydi: birinchi rahbar .env BOOTSTRAP_LEADER_* dan yaratiladi.
export async function seedE2e() {
  if (config.isProd) throw new Error('E2E seed prod muhitida ishlatilmaydi');
  await migrate();
  const exists = await one<{ n: number }>(pool, 'SELECT count(*) AS n FROM client');
  if (exists!.n > 0) {
    console.log('Bazada mijozlar bor, seed o\'tkazib yuborildi');
    return;
  }
  await tx(async (db) => {
    const pw = await hashPassword('123456');
    const user = async (login: string, fullName: string, role: string) =>
      (
        await one(
          db,
          `INSERT INTO app_user (login, full_name, role, password_hash) VALUES ($1, $2, $3, $4)
           ON CONFLICT (login) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id`,
          [login, fullName, role, pw],
        )
      ).id as number;
    const leader = await user('rahbar', 'Dilnoza Rahimova', 'LEADER');
    const a1 = await user('aziza', 'Aziza Karimova', 'ACCOUNTANT');
    const a2 = await user('bobur', 'Bobur Toshmatov', 'ACCOUNTANT');
    const a3 = await user('gulnora', 'Gulnora Yusupova', 'ACCOUNTANT');
    await user('operator', 'Nodira Operator', 'OPERATOR');

    const clients = [
      { stir: '305123456', name: 'SHERPROM STROY MChJ', taxType: 'AOS', accountantId: a1, status: 'ACTIVE' },
      { stir: '306234567', name: 'INSAR MIX TRADE MChJ', taxType: 'QQS', accountantId: a1, status: 'ACTIVE' },
      { stir: '307345678', name: '"Navro\'z Agro" МЧЖ', taxType: 'QQS', accountantId: a2, status: 'ACTIVE' },
      { stir: '308456789', name: 'Samarqand Tekstil MChJ', taxType: 'QQS', accountantId: a2, status: 'ACTIVE' },
      { stir: '309567890', name: 'Orzu Savdo XK', taxType: 'AOS', accountantId: a3, status: 'ACTIVE' },
      { stir: '310678901', name: 'Toshkent Logistika MChJ', taxType: 'QQS', accountantId: a3, status: 'ACTIVE' },
      { stir: '311789012', name: 'Yangi Avlod MChJ', taxType: 'AOS', accountantId: a1, status: 'ZERO_REPORT' },
      { stir: '312890123', name: 'Bahor Servis MChJ', taxType: 'QQS', accountantId: a2, status: 'ZERO_REPORT' },
      { stir: '313901234', name: 'Eski Qurilish MChJ', taxType: 'AOS', accountantId: a3, status: 'LIQUIDATING', note: 'Tugatishga bergan' },
      {
        stir: '314012345',
        name: 'Farg\'ona Oziq-ovqat MChJ',
        taxType: 'AOS',
        accountantId: a3,
        status: 'ACTIVE',
        taxTypeEffectiveFrom: '2026-01-01',
        note: '01.01.2026 dan AOS to\'lovchisi',
      },
    ] as const;
    for (const c of clients) {
      await createClient(
        db,
        { contactPerson: 'Direktor', phone: '+998 90 123 45 67', note: null, taxTypeEffectiveFrom: null, ...c } as any,
        leader,
      );
    }
  });
  await runGenerator(currentPeriod(), false, null);
  console.log('E2E seed tayyor. Loginlar: rahbar / aziza / bobur / gulnora');
}
