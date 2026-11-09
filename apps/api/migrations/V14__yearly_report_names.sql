-- Hisobot nomlari Google Sheet sarlavhalaridagidek (jadval ustuni va yangi vazifa sarlavhasi)
UPDATE report_type SET name = v.name, name_ru = v.name_ru
FROM (VALUES
  ('MOLIYAVIY_NATIJA', 'Moliyaviy natijalar to''g''risida hisobot (F-2) yillik', 'Отчёт о финансовых результатах (Ф-2) годовой'),
  ('BALANS', 'Buxgalteriya balansi (F-1) yillik', 'Бухгалтерский баланс (Ф-1) годовой'),
  ('STATISTIKA', 'Statistika hisoboti (yillik)', 'Статистический отчёт (годовой)')
) AS v (code, name, name_ru)
WHERE report_type.code = v.code;
