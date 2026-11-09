-- D4: audit (faqat qo'shiladi), bildirishnomalar, Sheets sinxron jadvallari

CREATE TABLE audit_log (
  id        bigserial PRIMARY KEY,
  actor_id  bigint REFERENCES app_user (id),
  entity    text NOT NULL,
  entity_id text,
  -- Mijoz bo'yicha filtrlash uchun (mijoz va uning vazifalari)
  client_id bigint,
  action    text NOT NULL,
  before    jsonb,
  after     jsonb,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_entity ON audit_log (entity, entity_id);
CREATE INDEX ix_audit_actor_at ON audit_log (actor_id, at);
CREATE INDEX ix_audit_client_at ON audit_log (client_id, at);
CREATE INDEX ix_audit_at ON audit_log (at);

CREATE OR REPLACE FUNCTION forbid_audit_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log faqat qo''shiladi: % taqiqlangan', TG_OP USING ERRCODE = 'P0002';
END $$;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_audit_change();
CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_audit_change();

CREATE TABLE notification (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES app_user (id),
  kind         text NOT NULL,
  channel      text NOT NULL CHECK (channel IN ('APP', 'TELEGRAM')),
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  task_id      bigint REFERENCES task (id),
  -- Bir xil xabar ikki marta yaratilmasligi uchun (masalan "overdue:123")
  dedupe_key   text,
  deliver_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  cancelled_at timestamptz,
  failed_at    timestamptz,
  read_at      timestamptz,
  attempts     int NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_notification_pending ON notification (deliver_at)
  WHERE delivered_at IS NULL AND cancelled_at IS NULL AND failed_at IS NULL;
CREATE INDEX ix_notification_user_app ON notification (user_id, created_at DESC) WHERE channel = 'APP';
CREATE INDEX ix_notification_task ON notification (task_id);
CREATE UNIQUE INDEX ux_notification_dedupe ON notification (user_id, channel, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE sheet_sync_state (
  id             bigserial PRIMARY KEY,
  spreadsheet_id text NOT NULL,
  sheet_title    text NOT NULL,
  period         date NOT NULL,
  enabled        boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  status         text NOT NULL DEFAULT 'NEVER',
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (spreadsheet_id, sheet_title)
);

-- Oxirgi sinxronlangan katak qiymati: qaysi tomon o'zgarganini aniqlash uchun
CREATE TABLE sheet_sync_cell (
  state_id    bigint NOT NULL REFERENCES sheet_sync_state (id) ON DELETE CASCADE,
  stir        text NOT NULL,
  report_code text NOT NULL,
  value       text NOT NULL,
  synced_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (state_id, stir, report_code)
);

-- kind: SYNC (sinxron xatosi) | IMPORT_REVIEW (qo'lda tekshirish ro'yxati)
CREATE TABLE sheet_sync_error (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL DEFAULT 'SYNC' CHECK (kind IN ('SYNC', 'IMPORT_REVIEW')),
  state_id    bigint REFERENCES sheet_sync_state (id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  ref         text,
  stir        text,
  message     text NOT NULL,
  raw_value   text,
  resolved    boolean NOT NULL DEFAULT false,
  resolved_by bigint REFERENCES app_user (id),
  resolved_at timestamptz
);
CREATE INDEX ix_sheet_sync_error_open ON sheet_sync_error (kind, occurred_at DESC) WHERE NOT resolved;
