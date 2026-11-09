-- D1: foydalanuvchilar va mijozlar (CLAUDE.md 4, 5, 6.1)

CREATE TABLE app_user (
  id                       bigserial PRIMARY KEY,
  role                     text NOT NULL CHECK (role IN ('LEADER', 'ACCOUNTANT')),
  full_name                text NOT NULL,
  login                    citext NOT NULL UNIQUE,
  password_hash            text NOT NULL,
  language                 text NOT NULL DEFAULT 'uz' CHECK (language IN ('uz', 'ru')),
  telegram_chat_id         bigint UNIQUE,
  telegram_link_code       text UNIQUE,
  telegram_link_expires_at timestamptz,
  -- {"TASK_DONE": {"app": true, "telegram": false}, ...}; yo'q kalit = yoqilgan
  notification_prefs       jsonb NOT NULL DEFAULT '{}'::jsonb,
  failed_login_count       int NOT NULL DEFAULT 0,
  locked_until             timestamptz,
  active                   boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_app_user_updated BEFORE UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Refresh tokenlar: faqat hash saqlanadi, har yangilashda aylanadi (rotation)
CREATE TABLE refresh_token (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES app_user (id),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by bigint REFERENCES refresh_token (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_refresh_token_user ON refresh_token (user_id);

CREATE TABLE client (
  id                      bigserial PRIMARY KEY,
  -- TODO(tasdiqlash): STIR 9 raqam (yuridik shaxs) yoki JShShIR 14 raqam (YaTT) deb olindi
  stir                    text NOT NULL UNIQUE CHECK (stir ~ '^[0-9]{9}$' OR stir ~ '^[0-9]{14}$'),
  name                    text NOT NULL,
  name_normalized         text NOT NULL,
  contact_person          text,
  phone                   text,
  -- Eng oxirgi belgilangan tur; davr bo'yicha haqiqiy tur client_tax_type_history'dan olinadi
  tax_type                text NOT NULL CHECK (tax_type IN ('AOS', 'QQS')),
  tax_type_effective_from date,
  accountant_id           bigint REFERENCES app_user (id),
  status                  text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ZERO_REPORT', 'LIQUIDATING')),
  note                    text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_client_updated BEFORE UPDATE ON client
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX ix_client_accountant ON client (accountant_id);
CREATE INDEX ix_client_status ON client (status);
CREATE INDEX ix_client_name_trgm ON client USING gin (name_normalized gin_trgm_ops);

CREATE TABLE client_tax_type_history (
  id             bigserial PRIMARY KEY,
  client_id      bigint NOT NULL REFERENCES client (id) ON DELETE CASCADE,
  tax_type       text NOT NULL CHECK (tax_type IN ('AOS', 'QQS')),
  effective_from date NOT NULL,
  created_by     bigint REFERENCES app_user (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, effective_from)
);

-- Dividend: alohida jadval ("2026-Q3" ko'rinishidagi chorak belgisi)
CREATE TABLE client_dividend_quarter (
  client_id bigint NOT NULL REFERENCES client (id) ON DELETE CASCADE,
  quarter   text NOT NULL CHECK (quarter ~ '^[0-9]{4}-Q[1-4]$'),
  marked_by bigint REFERENCES app_user (id),
  marked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, quarter)
);
