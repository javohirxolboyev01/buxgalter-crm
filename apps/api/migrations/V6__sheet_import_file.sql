-- Import qilingan .xlsx fayllar: bir xil faylni (SHA-256 mazmuni bo'yicha, nomidan qat'i nazar)
-- xato bilib-bilmay qayta yuklashni aniqlash uchun.
CREATE TABLE sheet_import_file (
  id          bigserial PRIMARY KEY,
  file_hash   text NOT NULL UNIQUE,
  file_name   text NOT NULL,
  period      date NOT NULL,
  imported_by bigint REFERENCES app_user (id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  summary     jsonb NOT NULL DEFAULT '{}'::jsonb
);
