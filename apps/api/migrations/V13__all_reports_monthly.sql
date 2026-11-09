-- Rahbar talabi: Foyda solig'i va yillik hisobotlar (Moliyaviy natijalar, Balans, Statistika) ham HAR OY
-- chiqadi; muddat = sozlamadagi due_day (shu oy ichida). Generatsiya oylari endi kerak emas.
UPDATE report_type SET frequency = 'MONTHLY', generation_months = NULL
WHERE code IN ('FOYDA', 'MOLIYAVIY_NATIJA', 'BALANS', 'STATISTIKA');
