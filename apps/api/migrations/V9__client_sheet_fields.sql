-- "Бухгалтер ишлари" faylining qolgan ustunlari: oylik to'lov, bank-kalit, my.mehnat.uz ma'lumotlari.
-- 30% buxgalter ulushi SAQLANMAYDI: monthly_fee * setting.accountant_share_percent dan hisoblanadi.

ALTER TABLE client
  ADD COLUMN monthly_fee        numeric(14, 0) CHECK (monthly_fee IS NULL OR monthly_fee >= 0),
  -- Bank-kalit (ЭЦП) bormi: NULL = noma'lum (faylda bo'sh katak)
  ADD COLUMN bank_key           boolean,
  ADD COLUMN employee_count     int CHECK (employee_count IS NULL OR employee_count >= 0),
  -- my.mehnat.uz ma'lumotlari oxirgi marta tekshirilgan sana
  ADD COLUMN mehnat_checked_at  date,
  ADD COLUMN mehnat_login       text,
  -- AES-256-GCM: 'iv.tag.ciphertext' (base64), kalit CREDENTIALS_KEY (.env). Ochiq parol bazaga tushmaydi.
  ADD COLUMN mehnat_password_enc text;

INSERT INTO setting (key, value) VALUES ('accountant_share_percent', '30') ON CONFLICT (key) DO NOTHING;
