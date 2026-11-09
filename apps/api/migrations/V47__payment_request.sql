-- V47: Tarif to'lovi — kartaga o'tkazma + chek skrinshoti (rahbar qarori, Click/Payme yo'q).
--
-- Oqim: rahbar Sozlamalar → Kompaniya'da platforma karta raqamini ko'radi, pul o'tkazadi, tarif (oylik/yillik)
-- va chek skrinshotini yuboradi (payment_request, PENDING). Platforma admini skrinshotni ko'rib tasdiqlaydi —
-- odatdagi qo'lda to'lov (company_payment) yoziladi va paid_until uzayadi — yoki sababi bilan rad etadi.
-- Muddat o'tgan (faqat o'qish) kompaniya ham so'rov yubora oladi.

-- ---------- Platforma sozlamalari (karta rekvizitlari) ----------
CREATE TABLE platform_setting (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- TODO(tasdiqlash): karta raqami bo'sh — platforma panelidan kiritiladi
INSERT INTO platform_setting (key, value)
VALUES ('payment_info', '{"cardNumber": "", "cardHolder": "", "bank": "", "contact": "", "note": ""}');

-- ---------- To'lov so'rovi (kompaniya ma'lumoti: RLS) ----------
CREATE TABLE payment_request (
  id              bigserial PRIMARY KEY,
  company_id      bigint NOT NULL DEFAULT fn_current_company() REFERENCES company (id),
  plan            text NOT NULL CHECK (plan IN ('MONTHLY', 'YEARLY')),
  periods         int NOT NULL DEFAULT 1 CHECK (periods BETWEEN 1 AND 36),
  -- So'rov paytidagi tarif narxi × davr (ma'lumot uchun; admin tasdiqlashda haqiqiy summani kiritadi)
  amount          bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
  screenshot      bytea NOT NULL,
  screenshot_mime text NOT NULL CHECK (screenshot_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  note            text CHECK (length(note) <= 500),
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reject_reason   text CHECK (length(reject_reason) <= 500),
  created_by      bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_by     bigint REFERENCES platform_admin (id),
  reviewed_at     timestamptz,
  payment_id      bigint UNIQUE REFERENCES company_payment (id),
  CHECK ((status = 'APPROVED') = (payment_id IS NOT NULL)),
  CHECK (status <> 'REJECTED' OR reject_reason IS NOT NULL)
);

-- Kompozit FK: so'rov muallifi shu kompaniya xodimi
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'app_user'::regclass AND conname = 'uq_app_user_company_id') THEN
    ALTER TABLE app_user ADD CONSTRAINT uq_app_user_company_id UNIQUE (company_id, id);
  END IF;
END $$;
ALTER TABLE payment_request ADD CONSTRAINT cfk_payment_request_created_by
  FOREIGN KEY (company_id, created_by) REFERENCES app_user (company_id, id);

CREATE INDEX ix_payment_request_company ON payment_request (company_id, created_at DESC);
CREATE INDEX ix_payment_request_pending ON payment_request (created_at) WHERE status = 'PENDING';
-- Bir kompaniyada bir vaqtda bitta kutilayotgan so'rov
CREATE UNIQUE INDEX uq_payment_request_pending ON payment_request (company_id) WHERE status = 'PENDING';

ALTER TABLE payment_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_request
  USING (current_setting('app.bypass', true) = 'on' OR company_id = NULLIF(current_setting('app.company_id', true), '')::bigint)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR company_id = NULLIF(current_setting('app.company_id', true), '')::bigint);

-- Tenant huquqlari: platforma sozlamalari yopiq (rekvizitlar API orqali beriladi); so'rov o'chirilmaydi (tarix)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    REVOKE ALL ON platform_setting FROM app_tenant;
    REVOKE DELETE ON payment_request FROM app_tenant;
  END IF;
END $$;
