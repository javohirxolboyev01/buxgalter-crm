-- Dividend hisoboti endi OYLIK: mijoz qaysi oyda dividend to'lasa, hisobot shu oyda topshiriladi,
-- muddat = sozlamadagi due_day (shu oy ichida). Belgi chorak ("2026-Q3") o'rniga oy ("2026-10").

CREATE TABLE client_dividend_month (
  client_id bigint NOT NULL REFERENCES client (id) ON DELETE CASCADE,
  month     text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  marked_by bigint REFERENCES app_user (id),
  marked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, month)
);

-- Eski chorak belgilari: hisobot keyingi chorak boshida chiqardi (2026-Q3 -> 2026-10), shu oyga ko'chiriladi
INSERT INTO client_dividend_month (client_id, month, marked_by, marked_at)
SELECT client_id,
       to_char(make_date(left(quarter, 4)::int, (right(quarter, 1)::int - 1) * 3 + 1, 1) + interval '3 months', 'YYYY-MM'),
       marked_by, marked_at
FROM client_dividend_quarter
ON CONFLICT DO NOTHING;

DROP TABLE client_dividend_quarter;

UPDATE report_type SET frequency = 'MONTHLY', generation_months = NULL WHERE code = 'DIVIDEND';

-- V5 dagi funksiya, faqat dividend sharti oy belgisiga almashdi
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
        SELECT 1 FROM client_dividend_month d
        WHERE d.client_id = c.id AND d.month = to_char(p_period, 'YYYY-MM')) THEN 'NO_DIVIDEND'
      ELSE NULL
    END AS reason
  ) r;
$$;
