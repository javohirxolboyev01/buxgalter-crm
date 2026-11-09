-- "Holat amalga oshganligi bo'yicha" hisobotlar (firma egasi jadvali): Dividend, Norezident foyda, Norezident QQS.
-- Mijoz kartasida har biri uchun alohida belgi: "shu oyda holat bo'ldi" (dividend to'landi, norezidentga daromad
-- to'landi, chet eldan tovar/xizmat olindi). Hisobot HOLAT OYIDAN KEYINGI oyda chiqadi, muddat = due_day
-- ("hisobot oyidan keyingi oyning 20 kunigacha"; boshqa oylik hisobotlar kabi: oktyabr vazifasi = sentabr hisoboti).
-- Qaror: dividend uchun alohida jadval o'rniga bitta umumiy jadval — keyin shunday hisobot qo'shilsa kod kerak emas.

ALTER TABLE report_type RENAME COLUMN requires_dividend_flag TO requires_event_flag;

CREATE TABLE client_report_event (
  client_id      bigint NOT NULL REFERENCES client (id) ON DELETE CASCADE,
  report_type_id bigint NOT NULL REFERENCES report_type (id),
  -- Holat bo'lgan oy; hisobot vazifasi keyingi oyda
  month          text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  marked_by      bigint REFERENCES app_user (id),
  marked_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, report_type_id, month)
);

-- Eski dividend belgisi = vazifa chiqqan oy (V12). Yangi ma'noda holat oyi bir oy oldin: vazifalar o'z joyida qoladi
INSERT INTO client_report_event (client_id, report_type_id, month, marked_by, marked_at)
SELECT d.client_id, rt.id, to_char(to_date(d.month, 'YYYY-MM') - interval '1 month', 'YYYY-MM'), d.marked_by, d.marked_at
FROM client_dividend_month d
CROSS JOIN report_type rt
WHERE rt.code = 'DIVIDEND'
ON CONFLICT DO NOTHING;

DROP TABLE client_dividend_month;

-- Faqat QQS to'lovchilar, muddat keyingi oyning 20-kuni; nomlar firma egasi bergan Excel sarlavhasi bilan bir xil
INSERT INTO report_type
  (code, name, name_ru, frequency, due_day, generation_months, applies_to_aos, applies_to_qqs,
   creates_accountant_task, requires_event_flag, sheet_aliases, sort_order)
VALUES
  ('NOREZIDENT_FOYDA', 'Norezident foyda', 'Налог на прибыль нерезидента', 'MONTHLY', 20, NULL, false, true, false, true,
   '{NOREZIDENTFOYDA,NEREZIDENTPRIBYL}', 82),
  ('NOREZIDENT_QQS', 'Norezident QQS', 'НДС нерезидента', 'MONTHLY', 20, NULL, false, true, false, true,
   '{NOREZIDENTQQS,NEREZIDENTNDS}', 84)
ON CONFLICT (code) DO NOTHING;

-- V17 dagi funksiya; NO_DIVIDEND o'rniga NO_EVENT: belgi o'tgan oy (holat oyi) uchun qo'yilgan bo'lishi kerak
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
      WHEN rt.requires_event_flag AND NOT EXISTS (
        SELECT 1 FROM client_report_event ev
        WHERE ev.client_id = c.id AND ev.report_type_id = rt.id
          AND ev.month = to_char(p_period - interval '1 month', 'YYYY-MM')) THEN 'NO_EVENT'
      ELSE NULL
    END AS reason
  ) r;
$$;
