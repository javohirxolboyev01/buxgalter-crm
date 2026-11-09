-- Hisobot topshirish jadvalida choraklik/yillik ustunlar ham HAR OY ko'rinadi (Google Sheet'dagidek:
-- oktyabr varag'ida "Moliyaviy natijalar (F-2) yillik", "Balans (F-1)", "Statistika" ustunlari bor).
-- Vazifa baribir o'z davrida BIR MARTA yaratiladi (generation_months); boshqa oylarda katak shu oxirgi
-- vazifaning holatini ko'rsatadi: noyabrda Foyda -> oktyabr vazifasi, oktyabrda yillik -> fevral vazifasi,
-- yanvarda yillik -> o'tgan yil fevrali.

-- Hisobot ustuni qaysi davr vazifasidan olinadi: oylik -> shu oy, aks holda eng oxirgi generatsiya oyi
CREATE OR REPLACE FUNCTION fn_report_source_period(p_period date, p_frequency text, p_months int[]) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_frequency = 'MONTHLY' THEN p_period ELSE (
    SELECT max(d)::date
    FROM generate_series(p_period - interval '11 months', p_period::timestamp, interval '1 month') d
    WHERE extract(month FROM d)::int = ANY (p_months)
  ) END;
$$;

-- Jadval ustunlari: barcha faol hisobotlar, har biri manba davri bilan
CREATE OR REPLACE FUNCTION fn_grid_columns(p_period date)
RETURNS TABLE (report_type_id bigint, source_period date)
LANGUAGE sql STABLE AS $$
  SELECT rt.id, fn_report_source_period(p_period, rt.frequency, rt.generation_months)
  FROM report_type rt
  WHERE rt.active
  ORDER BY rt.sort_order, rt.id;
$$;

-- Qaytariladigan ustunlar o'zgaradi (source_period qo'shiladi): DROP + CREATE, view ham qayta yaratiladi
DROP VIEW v_monthly_grid;
DROP FUNCTION fn_monthly_grid(date);

-- Katak: qo'llanishi va vazifa manba davri bo'yicha; tax_type esa ko'rilayotgan oydagi tur (filtr uchun)
CREATE FUNCTION fn_monthly_grid(p_period date)
RETURNS TABLE (client_id bigint, report_type_id bigint, tax_type text, applicable boolean,
               task_id bigint, task_status text, due_at timestamptz, cell text, source_period date)
LANGUAGE sql STABLE AS $$
  WITH cols AS (SELECT * FROM fn_grid_columns(p_period) WHERE source_period IS NOT NULL),
       src AS (SELECT DISTINCT source_period FROM cols)
  SELECT a.client_id, a.report_type_id,
         fn_client_tax_type(a.client_id, fn_period_end(p_period)),
         a.applicable,
         t.id, t.status, t.due_at,
         CASE
           WHEN t.id IS NOT NULL THEN
             CASE WHEN t.status = 'DONE' THEN '1'
                  WHEN t.due_at IS NOT NULL AND t.due_at < now() THEN '!'
                  ELSE '0' END
           WHEN NOT a.applicable THEN 'X'
           ELSE '0'
         END,
         s.source_period
  FROM src s
  CROSS JOIN LATERAL fn_report_applicability(s.source_period) a
  JOIN cols g ON g.report_type_id = a.report_type_id AND g.source_period = s.source_period
  LEFT JOIN task t ON t.client_id = a.client_id AND t.kind = 'REPORT'
                  AND t.report_type_id = a.report_type_id AND t.period = s.source_period
                  AND t.status <> 'CANCELLED';
$$;

CREATE VIEW v_monthly_grid AS
SELECT p.period, g.*
FROM (SELECT DISTINCT period FROM task) p
CROSS JOIN LATERAL fn_monthly_grid(p.period) g;
