-- D5: hisob-kitob viewlari va funksiyalari.
-- "X" qoidasi bitta joyda (fn_report_applicability): generator ham, oylik jadval ham shundan o'qiydi.

CREATE VIEW v_task_state AS
SELECT t.*,
       (t.status NOT IN ('DONE', 'CANCELLED') AND t.due_at IS NOT NULL AND t.due_at < now()) AS is_overdue,
       (t.status NOT IN ('DONE', 'CANCELLED') AND t.due_at >= now()
          AND t.due_at < now() + interval '24 hours')                                     AS is_due_soon,
       (t.status = 'WAITING_CLIENT')                                                        AS is_waiting_client,
       (t.status = 'DONE' AND t.due_at IS NOT NULL AND t.done_at <= t.due_at)              AS on_time
FROM task t;

CREATE VIEW v_accountant_load AS
SELECT u.id AS user_id,
       u.full_name,
       count(t.id) AS open_count
FROM app_user u
LEFT JOIN task t ON t.assignee_id = u.id AND t.status IN ('TODO', 'IN_PROGRESS', 'WAITING_CLIENT')
WHERE u.role = 'ACCOUNTANT' AND u.active
GROUP BY u.id, u.full_name;

-- Mijozning berilgan sanadagi soliq turi (tarix bo'yicha). Tarixdan oldingi sana uchun eng birinchi yozuv.
CREATE OR REPLACE FUNCTION fn_client_tax_type(p_client_id bigint, p_on date) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT h.tax_type FROM client_tax_type_history h
      WHERE h.client_id = p_client_id AND h.effective_from <= p_on
      ORDER BY h.effective_from DESC LIMIT 1),
    (SELECT h.tax_type FROM client_tax_type_history h
      WHERE h.client_id = p_client_id ORDER BY h.effective_from ASC LIMIT 1),
    (SELECT c.tax_type FROM client c WHERE c.id = p_client_id)
  );
$$;

-- Davr (oy) uchun soliq turi: oy oxiridagi holat. Oy o'rtasida o'zgarsa, shu oy yangi tur bo'yicha.
CREATE OR REPLACE FUNCTION fn_period_end(p_period date) RETURNS date
LANGUAGE sql IMMUTABLE AS $$
  SELECT (p_period + interval '1 month' - interval '1 day')::date;
$$;

-- Davr ichidagi muddat: due_day (oy uzunligidan oshmaydi) + soat, Asia/Tashkent
CREATE OR REPLACE FUNCTION fn_due_at(p_period date, p_due_day int, p_time text) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN p_due_day IS NULL THEN NULL ELSE
    ((make_date(extract(year FROM p_period)::int, extract(month FROM p_period)::int,
                least(p_due_day, extract(day FROM fn_period_end(p_period))::int))
      + p_time::time) AT TIME ZONE 'Asia/Tashkent')
  END;
$$;

-- Choraklik hisobot qaysi chorak uchun: generatsiya oyidan oldingi chorak (oktyabr -> Q3)
CREATE OR REPLACE FUNCTION fn_reported_quarter(p_period date) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p_period - interval '1 month', 'YYYY') || '-Q' ||
         extract(quarter FROM (p_period - interval '1 month'))::int;
$$;

-- Shu oyda chiqadigan hisobot ustunlari
CREATE OR REPLACE FUNCTION fn_report_columns(p_period date)
RETURNS SETOF report_type
LANGUAGE sql STABLE AS $$
  SELECT rt.* FROM report_type rt
  WHERE rt.active
    AND (rt.frequency = 'MONTHLY' OR extract(month FROM p_period)::int = ANY (rt.generation_months))
  ORDER BY rt.sort_order, rt.id;
$$;

-- Mijoz x hisobot: qo'llanadimi (false = "X")
CREATE OR REPLACE FUNCTION fn_report_applicability(p_period date)
RETURNS TABLE (client_id bigint, report_type_id bigint, tax_type text, applicable boolean, reason text)
LANGUAGE sql STABLE AS $$
  WITH c AS (
    SELECT cl.id, cl.status, fn_client_tax_type(cl.id, fn_period_end(p_period)) AS tax_type
    FROM client cl
  )
  SELECT c.id, rt.id, c.tax_type,
         r.reason IS NULL AS applicable,
         r.reason
  FROM c
  CROSS JOIN fn_report_columns(p_period) rt
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN c.status = 'LIQUIDATING' THEN 'LIQUIDATING'
      WHEN c.tax_type = 'AOS' AND NOT rt.applies_to_aos THEN 'TAX_TYPE'
      WHEN c.tax_type = 'QQS' AND NOT rt.applies_to_qqs THEN 'TAX_TYPE'
      WHEN rt.requires_dividend_flag AND NOT EXISTS (
        SELECT 1 FROM client_dividend_quarter d
        WHERE d.client_id = c.id AND d.quarter = fn_reported_quarter(p_period)) THEN 'NO_DIVIDEND'
      ELSE NULL
    END AS reason
  ) r;
$$;

-- Oylik jadval katagi: vazifa bo'lsa uning holati, bo'lmasa qo'llanmaydigani 'X'
CREATE OR REPLACE FUNCTION fn_monthly_grid(p_period date)
RETURNS TABLE (client_id bigint, report_type_id bigint, tax_type text, applicable boolean,
               task_id bigint, task_status text, due_at timestamptz, cell text)
LANGUAGE sql STABLE AS $$
  SELECT a.client_id, a.report_type_id, a.tax_type, a.applicable,
         t.id, t.status, t.due_at,
         CASE
           WHEN t.id IS NOT NULL THEN
             CASE WHEN t.status = 'DONE' THEN '1'
                  WHEN t.due_at IS NOT NULL AND t.due_at < now() THEN '!'
                  ELSE '0' END
           WHEN NOT a.applicable THEN 'X'
           ELSE '0'
         END
  FROM fn_report_applicability(p_period) a
  LEFT JOIN task t ON t.client_id = a.client_id AND t.kind = 'REPORT'
                  AND t.report_type_id = a.report_type_id AND t.period = p_period
                  AND t.status <> 'CANCELLED';
$$;

-- Vazifasi bor barcha davrlar uchun umumiy ko'rinish (WHERE period = ... bilan so'raladi)
CREATE VIEW v_monthly_grid AS
SELECT p.period, g.*
FROM (SELECT DISTINCT period FROM task) p
CROSS JOIN LATERAL fn_monthly_grid(p.period) g;
