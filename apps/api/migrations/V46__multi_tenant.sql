-- V46: SaaS — ko'p kompaniyali (multi-tenant) tizim.
--
-- Qaror: bitta baza, har tenant jadvalida company_id + PostgreSQL Row-Level Security (RLS).
--   * Ilova kodi (toza SQL) deyarli o'zgarmaydi: company_id ustunining DEFAULT qiymati sessiyadagi
--     app.company_id dan olinadi, SELECT/UPDATE/DELETE esa RLS siyosati bilan o'z kompaniyasiga cheklanadi.
--     WHERE company_id ni unutish boshqa kompaniya ma'lumotini ochmaydi — ajratish baza darajasida.
--   * Tizim ishlari (migratsiya, login, scheduler sikli, Telegram) app.bypass = 'on' bilan ishlaydi.
--   * Superuser RLS'ni chetlab o'tadi (Railway'da DATABASE_URL foydalanuvchisi superuser), shuning uchun
--     kompaniya so'rovlari imkon bo'lsa app_tenant roliga o'tib (SET ROLE) bajariladi; superuser bo'lmagan
--     egada FORCE ROW LEVEL SECURITY yetarli.
--   * Kompaniyalararo bog'lanish (A kompaniyasi vazifasi B mijoziga) kompozit FK bilan taqiqlanadi.
--
-- Shu paytgacha bazadagi barcha yozuvlar (6.3 jadvali seed'lari: report_type, routine_work_type, setting)
-- 1-kompaniyaga — SHABLONga o'tadi. Yangi kompaniya yaratilganda seed shablondan nusxalanadi (fn_company_seed).

-- ---------- Kompaniya, tarif, to'lov, platforma admini ----------
CREATE TABLE company (
  id           bigserial PRIMARY KEY,
  name         text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  is_template  boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'BLOCKED')),
  plan         text CHECK (plan IN ('MONTHLY', 'YEARLY')),
  -- Shu sana (kun oxiri, Asia/Tashkent) gacha to'langan. O'tsa — faqat o'qish rejimi.
  paid_until   date,
  logo         bytea,
  logo_mime    text CHECK (logo_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  logo_version int NOT NULL DEFAULT 0,
  contact_phone text,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_template OR status = 'BLOCKED')
);
CREATE TRIGGER trg_company_updated BEFORE UPDATE ON company FOR EACH ROW EXECUTE FUNCTION set_updated_at();
INSERT INTO company (id, name, is_template, status) VALUES (1, 'Shablon (seed)', true, 'BLOCKED');
SELECT setval('company_id_seq', 1);

-- Tariflar: farq faqat muddat va narxda (hamma funksiya ochiq). Narx so'mda; platforma admini o'zgartiradi.
CREATE TABLE tariff (
  code       text PRIMARY KEY CHECK (code IN ('MONTHLY', 'YEARLY')),
  months     int NOT NULL CHECK (months > 0),
  price      bigint NOT NULL DEFAULT 0 CHECK (price >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- TODO(tasdiqlash): narxlar 0 — platforma panelidan kiritiladi
INSERT INTO tariff (code, months, price) VALUES ('MONTHLY', 1, 0), ('YEARLY', 12, 0);

CREATE TABLE platform_admin (
  id                 bigserial PRIMARY KEY,
  login              citext NOT NULL UNIQUE,
  full_name          text NOT NULL,
  password_hash      text NOT NULL,
  active             boolean NOT NULL DEFAULT true,
  failed_login_count int NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- To'lov tarixi (qo'lda kiritiladi: naqd/o'tkazma). Faqat qo'shiladi.
CREATE TABLE company_payment (
  id          bigserial PRIMARY KEY,
  company_id  bigint NOT NULL REFERENCES company (id),
  plan        text NOT NULL CHECK (plan IN ('MONTHLY', 'YEARLY')),
  periods     int NOT NULL CHECK (periods BETWEEN 1 AND 36),
  amount      bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
  paid_from   date NOT NULL,
  paid_until  date NOT NULL,
  note        text,
  created_by  bigint REFERENCES platform_admin (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_company_payment_company ON company_payment (company_id, created_at DESC);

-- ---------- Joriy kompaniya ----------
CREATE FUNCTION fn_current_company() RETURNS bigint
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.company_id', true), '')::bigint $$;

-- ---------- Tenant jadvallari: company_id + RLS + kompozit FK ----------
-- Tashqarida: tizim jadvallari, kompaniyaning o'zi, platforma jadvallari va refresh_token (login tizim rejimida).
CREATE TEMP TABLE _non_tenant (t text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _non_tenant VALUES ('schema_migration'), ('company'), ('tariff'), ('platform_admin'), ('company_payment'), ('refresh_token');

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS t FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
      AND c.relname NOT IN (SELECT t FROM _non_tenant)
    ORDER BY c.relname
  LOOP
    -- ADD COLUMN ... DEFAULT 1: mavjud qatorlar shablonga (UPDATE emas — audit_log trigger'i ishlamaydi)
    EXECUTE format('ALTER TABLE %I ADD COLUMN company_id bigint NOT NULL DEFAULT 1 REFERENCES company (id)', r.t);
    EXECUTE format('ALTER TABLE %I ALTER COLUMN company_id SET DEFAULT fn_current_company()', r.t);
    EXECUTE format('CREATE INDEX %I ON %I (company_id)', 'ix_' || r.t || '_company', r.t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', r.t);
    EXECUTE format($p$CREATE POLICY tenant_isolation ON %I
      USING (current_setting('app.bypass', true) = 'on' OR company_id = NULLIF(current_setting('app.company_id', true), '')::bigint)
      WITH CHECK (current_setting('app.bypass', true) = 'on' OR company_id = NULLIF(current_setting('app.company_id', true), '')::bigint)$p$, r.t);
  END LOOP;

  -- Kompozit FK: bolaning company_id si ota yozuvniki bilan bir xil bo'lishi shart.
  -- Asl FK (ON DELETE amali bilan) qoladi; NULL ustun MATCH SIMPLE bo'yicha tekshirilmaydi.
  FOR r IN
    SELECT con.conrelid::regclass::text AS child, con.confrelid::regclass::text AS parent,
           a.attname AS col, pa.attname AS pcol
    FROM pg_constraint con
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
    WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace
      AND array_length(con.conkey, 1) = 1
      AND con.conrelid::regclass::text NOT IN (SELECT t FROM _non_tenant)
      AND con.confrelid::regclass::text NOT IN (SELECT t FROM _non_tenant)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conrelid = r.parent::regclass AND contype = 'u'
        AND conname = 'uq_' || r.parent || '_company_' || r.pcol
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (company_id, %I)',
        r.parent, 'uq_' || r.parent || '_company_' || r.pcol, r.pcol);
    END IF;
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (company_id, %I) REFERENCES %I (company_id, %I)',
      r.child, 'cfk_' || substr(md5(r.child || '.' || r.col), 1, 16), r.col, r.parent, r.pcol);
  END LOOP;
END $$;

-- ---------- Unikal kalitlar endi kompaniya ichida ----------
ALTER TABLE client DROP CONSTRAINT client_stir_key;
ALTER TABLE client ADD CONSTRAINT client_company_stir_key UNIQUE (company_id, stir);
ALTER TABLE lead DROP CONSTRAINT lead_stir_key;
ALTER TABLE lead ADD CONSTRAINT lead_company_stir_key UNIQUE (company_id, stir);
ALTER TABLE report_type DROP CONSTRAINT report_type_code_key;
ALTER TABLE report_type ADD CONSTRAINT report_type_company_code_key UNIQUE (company_id, code);
ALTER TABLE setting DROP CONSTRAINT setting_pkey;
ALTER TABLE setting ADD PRIMARY KEY (company_id, key);
ALTER TABLE sheet_import_file DROP CONSTRAINT sheet_import_file_file_hash_key;
ALTER TABLE sheet_import_file ADD CONSTRAINT sheet_import_file_company_hash_key UNIQUE (company_id, file_hash);
-- app_user.login global unikal qoladi: kirishda kompaniya so'ralmaydi (login o'zi kompaniyani aniqlaydi)

-- Oylik ishlar limiti (10) — har kompaniyaga alohida
CREATE OR REPLACE FUNCTION check_routine_work_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active THEN
    PERFORM pg_advisory_xact_lock(7710001, NEW.company_id::int);
    IF (SELECT count(*) FROM routine_work_type WHERE active AND id <> NEW.id AND company_id = NEW.company_id) >= 10 THEN
      RAISE EXCEPTION 'ROUTINE_LIMIT' USING ERRCODE = 'P0001',
        DETAIL = 'Faol oylik ishlar soni 10 tadan oshmasligi kerak';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- View'lar chaqiruvchi huquqi bilan: aks holda view egasi nomidan o'qib RLS'ni chetlab o'tadi
DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER VIEW %I SET (security_invoker = true)', v.viewname);
  END LOOP;
END $$;

-- Kompaniya qatori: tenant faqat o'zinikini ko'radi
ALTER TABLE company ENABLE ROW LEVEL SECURITY;
ALTER TABLE company FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON company
  USING (current_setting('app.bypass', true) = 'on' OR id = NULLIF(current_setting('app.company_id', true), '')::bigint)
  WITH CHECK (current_setting('app.bypass', true) = 'on' OR id = NULLIF(current_setting('app.company_id', true), '')::bigint);

-- ---------- app_tenant roli (superuser ulanish uchun) ----------
-- Rol klaster darajasida: bor bo'lsa qayta yaratilmaydi; huquqlar shu bazaga beriladi.
-- Rol yaratish huquqi yo'q bo'lsa (oddiy foydalanuvchi) — o'tkaziladi: FORCE RLS o'zi yetarli.
DO $$
DECLARE can boolean;
BEGIN
  SELECT rolsuper OR rolcreaterole INTO can FROM pg_roles WHERE rolname = current_user;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    IF NOT can THEN
      RAISE NOTICE 'app_tenant roli yaratilmadi (huquq yo''q) — FORCE RLS ishlatiladi';
      RETURN;
    END IF;
    CREATE ROLE app_tenant NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
  IF can THEN
    EXECUTE format('GRANT app_tenant TO %I', current_user);
  END IF;
  GRANT USAGE ON SCHEMA public TO app_tenant;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_tenant;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_tenant;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_tenant;
  -- Platforma jadvallari tenant'ga yopiq; kompaniya qatorida faqat brend maydonlari o'zgaradi
  REVOKE ALL ON platform_admin, company_payment, schema_migration FROM app_tenant;
  REVOKE ALL ON tariff FROM app_tenant;
  GRANT SELECT ON tariff TO app_tenant;
  REVOKE ALL ON company FROM app_tenant;
  GRANT SELECT ON company TO app_tenant;
  GRANT UPDATE (name, logo, logo_mime, logo_version, updated_at) ON company TO app_tenant;
END $$;

-- ---------- Yangi kompaniyaga seed: shablondan nusxa ----------
-- Ustunlar katalogdan o'qiladi: keyingi migratsiyalarda report_type'ga ustun qo'shilsa ham nusxalanadi.
CREATE FUNCTION fn_company_seed(p_company bigint) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  tmpl bigint;
  cols text;
  sel text;
BEGIN
  SELECT id INTO tmpl FROM company WHERE is_template ORDER BY id LIMIT 1;
  IF tmpl IS NULL THEN RAISE EXCEPTION 'Shablon kompaniya topilmadi'; END IF;
  IF EXISTS (SELECT 1 FROM report_type WHERE company_id = p_company) THEN RETURN; END IF;

  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO cols
  FROM pg_attribute WHERE attrelid = 'report_type'::regclass AND attnum > 0 AND NOT attisdropped
    AND attname NOT IN ('id', 'company_id');
  EXECUTE format('INSERT INTO report_type (company_id, %s) SELECT $1, %s FROM report_type WHERE company_id = $2', cols, cols)
    USING p_company, tmpl;

  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum),
         string_agg(CASE WHEN attname = 'report_type_id'
                      THEN '(SELECT rn.id FROM report_type ro JOIN report_type rn ON rn.code = ro.code AND rn.company_id = $1 WHERE ro.id = s.report_type_id)'
                      ELSE 's.' || quote_ident(attname) END, ', ' ORDER BY attnum)
    INTO cols, sel
  FROM pg_attribute WHERE attrelid = 'routine_work_type'::regclass AND attnum > 0 AND NOT attisdropped
    AND attname NOT IN ('id', 'company_id');
  EXECUTE format('INSERT INTO routine_work_type (company_id, %s) SELECT $1, %s FROM routine_work_type s WHERE s.company_id = $2 ORDER BY s.id', cols, sel)
    USING p_company, tmpl;

  INSERT INTO setting (company_id, key, value)
  SELECT p_company, key, value FROM setting WHERE company_id = tmpl AND key NOT LIKE '%last_run%';
END $$;
