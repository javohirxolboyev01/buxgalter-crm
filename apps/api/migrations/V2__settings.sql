-- D2: sozlama jadvallari va seed (CLAUDE.md 6.2, 6.3). Qoidalar kodda emas, shu ma'lumotda.

CREATE TABLE report_type (
  id                      bigserial PRIMARY KEY,
  code                    text NOT NULL UNIQUE,
  name                    text NOT NULL,
  name_ru                 text NOT NULL,
  frequency               text NOT NULL CHECK (frequency IN ('MONTHLY', 'QUARTERLY', 'YEARLY')),
  -- NULL = muddat hali aniqlanmagan
  due_day                 int CHECK (due_day BETWEEN 1 AND 31),
  generation_months       int[],
  applies_to_aos          boolean NOT NULL,
  applies_to_qqs          boolean NOT NULL,
  creates_accountant_task boolean NOT NULL DEFAULT false,
  -- true: faqat mijozda shu chorak uchun dividend belgisi bo'lsa qo'llanadi
  requires_dividend_flag  boolean NOT NULL DEFAULT false,
  -- Google Sheet sarlavhasini tanish uchun kalit so'zlar (lotinlashtirilgan, katta harf)
  sheet_aliases           text[] NOT NULL DEFAULT '{}',
  active                  boolean NOT NULL DEFAULT true,
  sort_order              int NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (frequency = 'MONTHLY' OR (generation_months IS NOT NULL AND cardinality(generation_months) > 0)),
  CHECK (generation_months IS NULL OR generation_months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12])
);
CREATE TRIGGER trg_report_type_updated BEFORE UPDATE ON report_type
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE routine_work_type (
  id             bigserial PRIMARY KEY,
  name           text NOT NULL,
  name_ru        text NOT NULL,
  sort_order     int NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT true,
  -- Shu ish hisobot bilan bir xil bo'lsa (INPS): hisobot qo'llansa alohida ish yaratilmaydi
  report_type_id bigint REFERENCES report_type (id),
  -- "Boshqa ishlar": buxgalter har oy erkin matn yozadi (task.note)
  is_free_text   boolean NOT NULL DEFAULT false,
  -- Yangi ish keyingi oydan chiqadi
  effective_from date NOT NULL DEFAULT (date_trunc('month', now()) + interval '1 month')::date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_routine_work_type_updated BEFORE UPDATE ON routine_work_type
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Faol oylik ishlar soni 10 dan oshmasin (parallel yozuvlar uchun advisory lock)
CREATE OR REPLACE FUNCTION check_routine_work_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active THEN
    PERFORM pg_advisory_xact_lock(7710001);
    IF (SELECT count(*) FROM routine_work_type WHERE active AND id <> NEW.id) >= 10 THEN
      RAISE EXCEPTION 'ROUTINE_LIMIT' USING ERRCODE = 'P0001',
        DETAIL = 'Faol oylik ishlar soni 10 tadan oshmasligi kerak';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_routine_work_limit BEFORE INSERT OR UPDATE OF active ON routine_work_type
  FOR EACH ROW EXECUTE FUNCTION check_routine_work_limit();

CREATE TABLE setting (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_setting_updated BEFORE UPDATE ON setting
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- Seed: hisobotlar (CLAUDE.md 6.3 jadvali AYNAN) ----------
INSERT INTO report_type
  (code, name, name_ru, frequency, due_day, generation_months, applies_to_aos, applies_to_qqs,
   creates_accountant_task, requires_dividend_flag, sheet_aliases, sort_order)
VALUES
  ('JSHDS', 'JShDS', 'НДФЛ', 'MONTHLY', 15, NULL, true, true, false, false, '{JSHDS}', 10),
  ('TOLOV_MANBAI', 'To''lov manbaidan ushlanadigan soliq', 'Налог у источника выплаты', 'MONTHLY', 15, NULL, true, true, false, false, '{TOLOVMANBA,ISTOCHNIK}', 20),
  ('AOS', 'AOS', 'Оборотный налог (АОС)', 'MONTHLY', 15, NULL, true, false, false, false, '{AOS,AOC}', 30),
  ('QQS', 'QQS', 'НДС (ҚҚС)', 'MONTHLY', 20, NULL, false, true, false, false, '{QQS,KKS,NDS}', 40),
  -- INPS: buxgalterga vazifa yaratiladigan yagona hisobot
  ('INPS', 'INPS', 'ИНПС', 'MONTHLY', 15, NULL, true, true, true, false, '{INPS}', 50),
  -- TODO(tasdiqlash): Poruchenya JShDS muddat kuni noma'lum (due_day NULL)
  ('PORUCHENYA_JSHDS', 'Poruchenya JShDS (to''lov topshiriqnomasi)', 'Платёжное поручение НДФЛ', 'MONTHLY', NULL, NULL, true, true, false, false, '{PORUCH}', 60),
  ('FOYDA', 'Foyda solig''i', 'Налог на прибыль', 'QUARTERLY', 20, '{1,4,7,10}', false, true, false, false, '{FOYDA,PRIBYL}', 70),
  ('DIVIDEND', 'Dividend hisoboti', 'Отчёт по дивидендам', 'QUARTERLY', 20, '{1,4,7,10}', true, true, false, true, '{DIVIDEND}', 80),
  ('MOLIYAVIY_NATIJA', 'Moliyaviy natijalar', 'Отчёт о финансовых результатах', 'YEARLY', 15, '{2}', true, true, false, false, '{MOLIYAVIY,FINANSOV}', 90),
  ('BALANS', 'Buxgalteriya balansi', 'Бухгалтерский баланс', 'YEARLY', 15, '{2}', true, true, false, false, '{BALANS}', 100),
  ('STATISTIKA', 'Statistika hisoboti', 'Статистический отчёт', 'YEARLY', 15, '{2}', true, true, false, false, '{STATISTIK}', 110);
-- TODO(tasdiqlash): creates_accountant_task faqat INPS = true, qolganlari false (CLAUDE.md 10.3)

-- ---------- Seed: 8 ta oylik doimiy ish (6.2 tartibida) ----------
INSERT INTO routine_work_type (name, name_ru, sort_order, report_type_id, is_free_text, effective_from) VALUES
  ('INPS hisoboti', 'Отчёт ИНПС', 1, (SELECT id FROM report_type WHERE code = 'INPS'), false, '2000-01-01'),
  ('Ish haqi hisoblash', 'Расчёт заработной платы', 2, NULL, false, '2000-01-01'),
  ('Bank aylanmalarini kiritish', 'Ввод банковских оборотов', 3, NULL, false, '2000-01-01'),
  ('Kirim hisobvaraq-fakturalarini kiritish', 'Ввод входящих счетов-фактур', 4, NULL, false, '2000-01-01'),
  ('Chiqim hisobvaraq-fakturalarini kiritish', 'Ввод исходящих счетов-фактур', 5, NULL, false, '2000-01-01'),
  ('Debitor-kreditorlar bilan ishlash', 'Работа с дебиторами и кредиторами', 6, NULL, false, '2000-01-01'),
  ('Boshqa ishlar', 'Прочие работы', 7, NULL, true, '2000-01-01'),
  ('Oyni yopish', 'Закрытие месяца', 8, NULL, false, '2000-01-01');

-- ---------- Seed: sozlamalar ----------
INSERT INTO setting (key, value) VALUES
  ('urgent_templates', '[
     {"id": "t1", "text": "Mijoz bank ko''chirmasini yubordi, bugun kiritilsin"},
     {"id": "t2", "text": "Soliq idorasidan talabnoma keldi, javob tayyorlansin"},
     {"id": "t3", "text": "Akt-sverka tayyorlab berilsin"}
   ]'::jsonb),
  -- TODO(tasdiqlash): muddat soati 18:00 (23:59 emas) deb olindi
  ('task_due_time', '"18:00"'::jsonb);
