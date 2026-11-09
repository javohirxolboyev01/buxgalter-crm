-- D3: vazifalar, checklist, taymer (CLAUDE.md 5, 6.4). "Muddati o'tgan" SAQLANMAYDI.

CREATE TABLE task (
  id                  bigserial PRIMARY KEY,
  client_id           bigint NOT NULL REFERENCES client (id),
  kind                text NOT NULL CHECK (kind IN ('ROUTINE', 'REPORT', 'URGENT', 'MANUAL')),
  routine_type_id     bigint REFERENCES routine_work_type (id),
  report_type_id      bigint REFERENCES report_type (id),
  -- Davr: oyning 1-kuni
  period              date NOT NULL CHECK (extract(day FROM period) = 1),
  title               text NOT NULL,
  note                text,
  -- NULL: buxgalterga biriktirilmagan (creates_accountant_task=false hisobot, faqat oylik jadvalda)
  assignee_id         bigint REFERENCES app_user (id),
  due_at              timestamptz,
  status              text NOT NULL DEFAULT 'TODO'
                        CHECK (status IN ('TODO', 'IN_PROGRESS', 'WAITING_CLIENT', 'DONE', 'CANCELLED')),
  -- "Bekor qilish" (undo) uchun DONE'dan oldingi holat
  prev_status         text,
  done_at             timestamptz,
  done_by             bigint REFERENCES app_user (id),
  cancel_reason       text,
  overdue_notified_at timestamptz,
  -- NULL = tizim (generator, sinxron)
  created_by          bigint REFERENCES app_user (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'ROUTINE' AND routine_type_id IS NOT NULL AND report_type_id IS NULL) OR
    (kind = 'REPORT' AND report_type_id IS NOT NULL AND routine_type_id IS NULL) OR
    (kind IN ('URGENT', 'MANUAL') AND routine_type_id IS NULL AND report_type_id IS NULL)
  ),
  CHECK ((status = 'DONE') = (done_at IS NOT NULL))
);
CREATE TRIGGER trg_task_updated BEFORE UPDATE ON task
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Generator idempotentligi: bir mijoz/tur/davr uchun bitta vazifa. URGENT/MANUAL'ga qo'llanmaydi.
CREATE UNIQUE INDEX ux_task_generated
  ON task (client_id, kind, coalesce(routine_type_id, 0), coalesce(report_type_id, 0), period)
  WHERE kind IN ('ROUTINE', 'REPORT');

CREATE INDEX ix_task_assignee_status ON task (assignee_id, status);
CREATE INDEX ix_task_due_open ON task (due_at) WHERE status NOT IN ('DONE', 'CANCELLED');
CREATE INDEX ix_task_client_period ON task (client_id, period);

CREATE TABLE task_checklist_item (
  id         bigserial PRIMARY KEY,
  task_id    bigint NOT NULL REFERENCES task (id) ON DELETE CASCADE,
  text       text NOT NULL,
  done       boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_checklist_task ON task_checklist_item (task_id);

CREATE TABLE time_entry (
  id         bigserial PRIMARY KEY,
  task_id    bigint NOT NULL REFERENCES task (id),
  user_id    bigint NOT NULL REFERENCES app_user (id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at   timestamptz,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
-- Bir foydalanuvchida bir vaqtda faqat bitta ochiq taymer
CREATE UNIQUE INDEX ux_time_entry_one_open ON time_entry (user_id) WHERE ended_at IS NULL;
CREATE INDEX ix_time_entry_task ON time_entry (task_id);
CREATE INDEX ix_time_entry_user_started ON time_entry (user_id, started_at);
