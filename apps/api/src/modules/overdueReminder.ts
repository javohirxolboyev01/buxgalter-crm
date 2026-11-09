import { DateTime } from 'luxon';
import { z } from 'zod';
import { TZ } from '../common/time';
import { type Db, one, pool, q, tx } from '../db';
import { enqueue } from './notifications';

/*
 * Kechikkan mijozlar bo'yicha takroriy eslatma (CLIENTS_OVERDUE).
 *
 * TASK_OVERDUE — har vazifa muddati o'tgan zahoti bir marta (0-kun).
 * CLIENTS_OVERDUE — keyingi kunlarda, har kuni `sendAt` soatida bitta yig'ma xabar:
 *   - buxgalterga: o'ziga tegishli kechikkan mijozlar (vazifa mas'uli, bo'lmasa mijoz buxgalteri);
 *   - rahbarga: barcha kechikkan mijozlar.
 * Mijoz ro'yxatga faqat shu kun uning "eslatma kuni" bo'lsa tushadi. Kechikish kuni = eng eski ochiq
 * muddati o'tgan vazifasidan beri o'tgan kalendar kunlar (Asia/Tashkent). Eslatma kunlari `steps` qoidasidan:
 * kechikish uzaygan sari xabar siyraklashadi (har kuni → 2 kunda → 3 kunda → haftada), spam bo'lmasin.
 */

export const reminderStepSchema = z.object({
  fromDay: z.number().int().min(1).max(365),
  everyDays: z.number().int().min(1).max(90),
});
export type ReminderStep = z.infer<typeof reminderStepSchema>;

export const overdueReminderSchema = z.object({
  enabled: z.boolean(),
  sendAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  steps: z
    .array(reminderStepSchema)
    .min(1)
    .max(10)
    .refine((s) => new Set(s.map((x) => x.fromDay)).size === s.length, { message: 'fromDay takrorlanmasin' })
    .transform((s) => [...s].sort((a, b) => a.fromDay - b.fromDay)),
});
export type OverdueReminderConfig = z.infer<typeof overdueReminderSchema>;

export const DEFAULT_OVERDUE_REMINDER: OverdueReminderConfig = {
  enabled: true,
  sendAt: '09:00',
  steps: [
    { fromDay: 1, everyDays: 1 },
    { fromDay: 3, everyDays: 2 },
    { fromDay: 7, everyDays: 3 },
    { fromDay: 16, everyDays: 7 },
  ],
};

/**
 * Bugun eslatma kunimi: `days` ga mos oxirgi bosqich (fromDay <= days) olinadi,
 * eslatma — bosqich boshidan har `everyDays` kunda. Standartda: 1,2,3,5,7,10,13,16,23,30,…
 */
export function isReminderDay(days: number, steps: ReminderStep[]): boolean {
  if (days < 1) return false;
  let step: ReminderStep | undefined;
  for (const s of steps) if (s.fromDay <= days && (!step || s.fromDay > step.fromDay)) step = s;
  return !!step && (days - step.fromDay) % step.everyDays === 0;
}

/** Sozlama sahifasida ko'rsatish uchun: 1..maxDay oralig'idagi eslatma kunlari */
export function reminderDays(steps: ReminderStep[], maxDay = 60): number[] {
  const out: number[] = [];
  for (let d = 1; d <= maxDay; d++) if (isReminderDay(d, steps)) out.push(d);
  return out;
}

export async function getOverdueReminder(db: Db): Promise<OverdueReminderConfig> {
  const r = await one<{ value: unknown }>(db, `SELECT value FROM setting WHERE key = 'overdue_reminder'`);
  const parsed = overdueReminderSchema.safeParse(r?.value);
  return parsed.success ? parsed.data : DEFAULT_OVERDUE_REMINDER;
}

interface OverdueRow {
  user_id: number | null;
  client_id: number;
  client_name: string;
  accountant_name: string | null;
  days: number;
  tasks: number;
  waiting: number;
  oldest_due_at: Date;
}

export interface OverdueClientItem {
  clientId: number;
  clientName: string;
  accountantName: string | null;
  days: number;
  tasks: number;
  waiting: number;
  oldestDueAt: string;
}

// Ochiq, muddati o'tgan vazifalar; kechikish kunlari Toshkent kalendari bo'yicha
const OVERDUE_CTE = `
  WITH od AS (
    SELECT t.client_id, coalesce(t.assignee_id, c.accountant_id) AS user_id, t.status, t.due_at,
           ($1::date - (t.due_at AT TIME ZONE '${TZ}')::date) AS days
    FROM task t JOIN client c ON c.id = t.client_id
    WHERE t.status IN ('TODO', 'IN_PROGRESS', 'WAITING_CLIENT') AND t.due_at IS NOT NULL AND t.due_at < $2
  )`;

/** Rahbar uchun: mijoz bo'yicha (user_id = NULL); buxgalter uchun: (mas'ul, mijoz) bo'yicha */
async function loadOverdue(db: Db, today: string, now: Date, perUser: boolean) {
  const key = perUser ? 'od.user_id, ' : '';
  return q<OverdueRow>(
    db,
    `${OVERDUE_CTE}
     SELECT ${perUser ? 'od.user_id' : 'NULL::bigint AS user_id'}, od.client_id, c.name AS client_name,
            a.full_name AS accountant_name, max(od.days)::int AS days, count(*)::int AS tasks,
            count(*) FILTER (WHERE od.status = 'WAITING_CLIENT')::int AS waiting, min(od.due_at) AS oldest_due_at
     FROM od JOIN client c ON c.id = od.client_id LEFT JOIN app_user a ON a.id = c.accountant_id
     ${perUser ? 'WHERE od.user_id IS NOT NULL' : ''}
     GROUP BY ${key}od.client_id, c.name, a.full_name
     ORDER BY days DESC, c.name`,
    [today, now],
  );
}

const toItem = (r: OverdueRow): OverdueClientItem => ({
  clientId: r.client_id,
  clientName: r.client_name,
  accountantName: r.accountant_name,
  days: r.days,
  tasks: r.tasks,
  waiting: r.waiting,
  oldestDueAt: r.oldest_due_at.toISOString(),
});

function payloadOf(date: string, scope: 'ALL' | 'MINE', all: OverdueRow[], steps: ReminderStep[]) {
  const due = all.filter((r) => isReminderDay(r.days, steps));
  if (!due.length) return null;
  return {
    date,
    scope,
    clients: due.map(toItem),
    clientCount: due.length,
    taskCount: due.reduce((n, r) => n + r.tasks, 0),
    maxDays: due[0]!.days,
    // Shu kun eslatilmaydiganlar ham hisobga: jami kechikkan mijozlar soni
    totalOverdueClients: all.length,
  };
}

/**
 * Har daqiqa chaqiriladi; kuniga bir marta (sendAt'dan keyin) ishlaydi. Server sendAt paytida o'chiq bo'lsa,
 * yoqilganda o'sha kuni baribir yuboriladi. "Bugun yuborildi" belgisi setting'da atomik olinadi
 * (bir nechta API nusxasi bo'lsa ham ikki marta ketmaydi); xabarlar dedupe_key bilan ham himoyalangan.
 */
export async function remindOverdueClients(now: DateTime = DateTime.now()) {
  const local = now.setZone(TZ);
  const cfg = await getOverdueReminder(pool);
  if (!cfg.enabled) return { sent: 0, skipped: 'DISABLED' as const };
  if (local.toFormat('HH:mm') < cfg.sendAt) return { sent: 0, skipped: 'TOO_EARLY' as const };
  const today = local.toISODate()!;

  return tx(async (db) => {
    const claimed = await db.query(
      `INSERT INTO setting (key, value) VALUES ('overdue_reminder_last_run', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value WHERE setting.value IS DISTINCT FROM EXCLUDED.value`,
      [JSON.stringify(today)],
    );
    if (!claimed.rowCount) return { sent: 0, skipped: 'ALREADY_RAN' as const };

    const nowDate = local.toJSDate();
    const dedupeKey = `clients-overdue:${today}`;
    let sent = 0;

    const leaders = await q<{ id: number }>(db, `SELECT id FROM app_user WHERE role = 'LEADER' AND active`);
    if (leaders.length) {
      const payload = payloadOf(today, 'ALL', await loadOverdue(db, today, nowDate, false), cfg.steps);
      if (payload) {
        for (const l of leaders) await enqueue(db, { userId: l.id, kind: 'CLIENTS_OVERDUE', payload, dedupeKey });
        sent += leaders.length;
      }
    }

    // Buxgalterlar: rahbar/operatorga biriktirilgan vazifalar shaxsiy ro'yxatga kirmaydi (rahbar umumiyni oladi)
    const accountants = new Set(
      (await q<{ id: number }>(db, `SELECT id FROM app_user WHERE role = 'ACCOUNTANT' AND active`)).map((u) => u.id),
    );
    const byUser = new Map<number, OverdueRow[]>();
    for (const r of await loadOverdue(db, today, nowDate, true)) {
      if (!accountants.has(r.user_id!)) continue;
      byUser.set(r.user_id!, [...(byUser.get(r.user_id!) ?? []), r]);
    }
    for (const [userId, rows] of byUser) {
      const payload = payloadOf(today, 'MINE', rows, cfg.steps);
      if (!payload) continue;
      await enqueue(db, { userId, kind: 'CLIENTS_OVERDUE', payload, dedupeKey });
      sent++;
    }
    return { sent, skipped: null };
  });
}
