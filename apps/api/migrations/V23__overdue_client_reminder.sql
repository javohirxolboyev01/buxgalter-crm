-- Kechikkan mijozlar bo'yicha takroriy eslatma (CLIENTS_OVERDUE).
-- Qoida kodda emas, sozlamada: kechikish kuni oshgan sari eslatma siyraklashadi.
--   steps: [{fromDay, everyDays}] — "fromDay-kundan boshlab har everyDays kunda".
--   Standart: 1,2,3 (har kuni) → 5,7 (2 kunda) → 10,13 (3 kunda) → 16,23,30… (haftada).
--   sendAt: kunlik xabar soati (Asia/Tashkent).
-- TODO(tasdiqlash): standart kunlar va 09:00 taxmin; "Mijozdan kutilmoqda" vazifalar ham kechikkan hisoblanadi
-- (xabarda alohida ko'rsatiladi); buxgalter vazifasi bo'lmagan hisobotlar mijoz buxgalteriga eslatiladi.
INSERT INTO setting (key, value) VALUES
  ('overdue_reminder', '{
     "enabled": true,
     "sendAt": "09:00",
     "steps": [
       {"fromDay": 1, "everyDays": 1},
       {"fromDay": 3, "everyDays": 2},
       {"fromDay": 7, "everyDays": 3},
       {"fromDay": 16, "everyDays": 7}
     ]
   }'::jsonb)
ON CONFLICT (key) DO NOTHING;
