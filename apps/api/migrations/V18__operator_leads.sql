-- Sotuv operatori: yangi mijoz qidirish (lead). Mavjud mijozlardan (client) alohida jadval:
-- generatsiya, oylik jadval va hisobotlarga aralashmaydi. Mijoz bo'lgach rahbar uni client'ga aylantiradi.

ALTER TABLE app_user DROP CONSTRAINT app_user_role_check;
ALTER TABLE app_user ADD CONSTRAINT app_user_role_check CHECK (role IN ('LEADER', 'ACCOUNTANT', 'OPERATOR'));

-- Holatlar (qotirilgan ro'yxat):
--   ochiq:   NEW (hali gaplashilmagan), NO_ANSWER, CALL_LATER, MEETING
--   yopiq:   HAS_ACCOUNTANT, REJECTED (operator boshqa qo'ng'iroq qilmaydi)
--   o'tdi:   WON (operator "Mijoz bo'ldi" bosdi, rahbarga o'tdi), CONVERTED (rahbar client yaratdi)
-- WON/CONVERTED operatorga ko'rinmaydi.
CREATE TABLE lead (
  id                  bigserial PRIMARY KEY,
  stir                text NOT NULL UNIQUE CHECK (stir ~ '^[0-9]{9}$' OR stir ~ '^[0-9]{14}$'),
  name                text NOT NULL,
  name_normalized     text NOT NULL,
  director            text,
  -- Bir nechta raqam vergul bilan ("+998901234567, +998931112233")
  phone               text,
  address             text,
  registered_at       date,
  status              text NOT NULL DEFAULT 'NEW' CHECK (status IN
                        ('NEW', 'NO_ANSWER', 'CALL_LATER', 'MEETING', 'HAS_ACCOUNTANT', 'REJECTED', 'WON', 'CONVERTED')),
  -- Keyingi qo'ng'iroq (yoki uchrashuv) kuni; yopiq holatlarda NULL
  next_call_date      date,
  last_call_at        timestamptz,
  transferred_at      timestamptz,
  converted_client_id bigint REFERENCES client (id),
  imported_by         bigint REFERENCES app_user (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_lead_updated BEFORE UPDATE ON lead
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX ix_lead_status_next ON lead (status, next_call_date);
CREATE INDEX ix_lead_name_trgm ON lead USING gin (name_normalized gin_trgm_ops);

-- Har bir qo'ng'iroq: natija + izoh. "Nechta, qanday gaplashdi" shu jadvaldan hisoblanadi.
CREATE TABLE lead_call (
  id             bigserial PRIMARY KEY,
  lead_id        bigint NOT NULL REFERENCES lead (id) ON DELETE CASCADE,
  user_id        bigint NOT NULL REFERENCES app_user (id),
  result         text NOT NULL CHECK (result IN
                   ('NO_ANSWER', 'CALL_LATER', 'MEETING', 'HAS_ACCOUNTANT', 'REJECTED', 'WON')),
  comment        text,
  next_call_date date,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_lead_call_lead ON lead_call (lead_id, created_at DESC);
CREATE INDEX ix_lead_call_at ON lead_call (created_at);
