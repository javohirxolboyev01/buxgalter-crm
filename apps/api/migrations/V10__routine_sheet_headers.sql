-- Oylik ishlar jadvali sarlavhalari "Бухгалтер ишлари" faylidagidek qisqa: "Иш ҳақи", "Банк виписка",
-- "Счёт-фактура" guruhi ostida kirim/chiqim. To'liq nom (name) vazifa sarlavhasi bo'lib qoladi.

ALTER TABLE routine_work_type
  ADD COLUMN short_name      text,
  ADD COLUMN short_name_ru   text,
  -- Ketma-ket ustunlar bir xil guruhda bo'lsa, sarlavha ustida birlashtiriladi
  ADD COLUMN header_group    text,
  ADD COLUMN header_group_ru text;

UPDATE routine_work_type w SET short_name = v.s, short_name_ru = v.sr, header_group = v.g, header_group_ru = v.gr
FROM (VALUES
  ('INPS hisoboti', 'INPS hisobot', 'Отчёт ИНПС', NULL, NULL),
  ('Ish haqi hisoblash', 'Ish haqi', 'Зарплата', NULL, NULL),
  ('Bank aylanmalarini kiritish', 'Bank vipiska', 'Банк выписка', NULL, NULL),
  ('Kirim hisobvaraq-fakturalarini kiritish', 'Kirim', 'Входящие', 'Schyot-faktura', 'Счёт-фактура'),
  ('Chiqim hisobvaraq-fakturalarini kiritish', 'Chiqim', 'Исходящие', 'Schyot-faktura', 'Счёт-фактура'),
  ('Debitor-kreditorlar bilan ishlash', 'Debitor-Kreditor', 'Дебитор-Кредитор', NULL, NULL),
  ('Oyni yopish', 'Oylar yopilishi', 'Закрытие месяцев', NULL, NULL),
  ('Boshqa ishlar', 'Boshqa ishlar', 'Прочие работы', NULL, NULL)
) AS v(name, s, sr, g, gr)
WHERE w.name = v.name;

-- Faylda "Ойлар ёпилиши" "Бошқа ишлар"dan oldin. Faqat seed tartibi turgan bo'lsa (rahbar o'zgartirmagan).
UPDATE routine_work_type SET sort_order = CASE name WHEN 'Oyni yopish' THEN 7 ELSE 8 END
WHERE name IN ('Oyni yopish', 'Boshqa ishlar')
  AND (SELECT sort_order FROM routine_work_type WHERE name = 'Boshqa ishlar' LIMIT 1) = 7
  AND (SELECT sort_order FROM routine_work_type WHERE name = 'Oyni yopish' LIMIT 1) = 8;
