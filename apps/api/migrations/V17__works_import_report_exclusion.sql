-- 1) "Бухгалтер ишлари" faylini import qilish: ish ustunini sarlavhadan tanish uchun kalit so'zlar
--    (report_type.sheet_aliases kabi; lotinlashtirilgan, katta harf, headerKey bilan solishtiriladi).
ALTER TABLE routine_work_type ADD COLUMN sheet_aliases text[] NOT NULL DEFAULT '{}';

UPDATE routine_work_type w SET sheet_aliases = v.a
FROM (VALUES
  ('INPS hisoboti', '{INPS}'::text[]),
  ('Ish haqi hisoblash', '{ISHHAQI,ZARPLAT}'),
  ('Bank aylanmalarini kiritish', '{VIPISKA,VYPISKA,AYLANMA}'),
  ('Kirim hisobvaraq-fakturalarini kiritish', '{KIRIM,VXOD}'),
  ('Chiqim hisobvaraq-fakturalarini kiritish', '{CHIQIM,ISXOD}'),
  ('Debitor-kreditorlar bilan ishlash', '{DEBITOR,DEBETOR}'),
  ('Oyni yopish', '{YOPIL,ZAKRYT}'),
  ('Boshqa ishlar', '{BOSHQA,PROCH}')
) AS v (name, a)
WHERE w.name = v.name;

-- 2) Mijoz shu hisobotni topshirmaydi (Sheet'dagi "X", soliq turidan tashqari). Rahbar talabi: fayldagi X
--    doimiy saqlanadi — effective_from oyidan boshlab vazifa yaratilmaydi, jadvalda X. O'tgan davrlar o'zgarmaydi.
CREATE TABLE client_report_exclusion (
  client_id      bigint NOT NULL REFERENCES client (id) ON DELETE CASCADE,
  report_type_id bigint NOT NULL REFERENCES report_type (id),
  effective_from date NOT NULL CHECK (extract(day FROM effective_from) = 1),
  created_by     bigint REFERENCES app_user (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, report_type_id)
);

-- V12 dagi funksiya + CLIENT_EXCLUDED sababi
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
      WHEN EXISTS (
        SELECT 1 FROM client_report_exclusion e
        WHERE e.client_id = c.id AND e.report_type_id = rt.id AND e.effective_from <= p_period) THEN 'CLIENT_EXCLUDED'
      WHEN rt.requires_dividend_flag AND NOT EXISTS (
        SELECT 1 FROM client_dividend_month d
        WHERE d.client_id = c.id AND d.month = to_char(p_period, 'YYYY-MM')) THEN 'NO_DIVIDEND'
      ELSE NULL
    END AS reason
  ) r;
$$;
