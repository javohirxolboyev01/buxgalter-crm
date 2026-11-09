-- Rahbar talabi: bu uch hisobot nomi rus interfeysida ham aynan Sheet'dagidek (tarjimasiz)
UPDATE report_type SET name_ru = name
WHERE code IN ('MOLIYAVIY_NATIJA', 'BALANS', 'STATISTIKA');
