-- Oylik ishlar jadvali ("Бухгалтер ишлари" fayli): har mijoz x ish uchun "qaysi oygacha bajarilgan".
-- Tizim davridagi holat SAQLANMAYDI, vazifalardan hisoblanadi (works.ts). Bu jadval faqat tizimgacha
-- bo'lgan oylar uchun boshlang'ich nuqta: rahbar fayldagi sanani bir marta kiritadi, keyin buxgalter
-- qolgan eski oylarni katakni bosib birma-bir yopadi.

CREATE TABLE client_routine_baseline (
  client_id         bigint NOT NULL REFERENCES client (id) ON DELETE CASCADE,
  routine_type_id   bigint NOT NULL REFERENCES routine_work_type (id),
  -- Ish oyi (oyning 1-kuni): shu oy ham bajarilgan
  done_through      date NOT NULL CHECK (extract(day FROM done_through) = 1),
  -- Katakni bosib bir oy surilganda oldingi qiymat: 5 soniyalik "Bekor qilish" uchun
  prev_done_through date CHECK (prev_done_through IS NULL OR extract(day FROM prev_done_through) = 1),
  updated_by        bigint REFERENCES app_user (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, routine_type_id)
);
CREATE TRIGGER trg_client_routine_baseline_updated BEFORE UPDATE ON client_routine_baseline
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
