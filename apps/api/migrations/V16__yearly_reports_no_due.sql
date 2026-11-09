-- Rahbar talabi: Moliyaviy natijalar, Balans, Statistika "Yillik" deb ko'rinadi, muddat kuni yo'q.
-- Jadvalda ustun baribir har oy chiqadi: generation_months = barcha oylar (vazifa har oy yaratiladi).
UPDATE report_type SET frequency = 'YEARLY', generation_months = '{1,2,3,4,5,6,7,8,9,10,11,12}', due_day = NULL
WHERE code IN ('MOLIYAVIY_NATIJA', 'BALANS', 'STATISTIKA');

-- Ochiq vazifalardan muddat olinadi (oktyabrda 15.10 bilan yaratilganlari qizil "!" bo'lib turmasin)
UPDATE task t SET due_at = NULL
FROM report_type rt
WHERE rt.id = t.report_type_id
  AND rt.code IN ('MOLIYAVIY_NATIJA', 'BALANS', 'STATISTIKA')
  AND t.status IN ('TODO', 'IN_PROGRESS', 'WAITING_CLIENT');
