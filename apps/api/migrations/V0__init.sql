-- D0: baza muhiti. Kengaytmalar, vaqt zonasi, umumiy trigger funksiyasi.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

-- Baza darajasida vaqt zonasi: har yangi ulanishda SHOW timezone = Asia/Tashkent
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Asia/Tashkent');
END $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;
