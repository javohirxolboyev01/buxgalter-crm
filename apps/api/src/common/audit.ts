import type { Db } from '../db';

export interface AuditEntry {
  actorId: number | null;
  entity: string;
  entityId: string | number | null;
  action: string;
  before?: unknown;
  after?: unknown;
  clientId?: number | null;
}

/** audit_log faqat qo'shiladi (DB trigger UPDATE/DELETE ni taqiqlaydi) */
export async function audit(db: Db, e: AuditEntry) {
  await db.query(
    `INSERT INTO audit_log (actor_id, entity, entity_id, client_id, action, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      e.actorId,
      e.entity,
      e.entityId === null ? null : String(e.entityId),
      e.clientId ?? null,
      e.action,
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
    ],
  );
}

/** Faqat o'zgargan maydonlar (before/after ixcham bo'lsin) */
export function diff<T extends Record<string, any>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(after)) {
    if (after[k] === undefined) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
