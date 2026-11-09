-- V48: Platforma admini tarifni muddatidan oldin tugatadi ("Tarifni tugatish").
--
-- Tugatishda paid_until = kecha (tarif tugagan), tanlovga qarab:
--   - imtiyozli davr bilan: lock_from NULL — odatdagidek paid_until + 3 kun faqat o'qish, keyin yopiladi;
--   - darhol yopish: lock_from = bugun — imtiyozli davrsiz yopiladi.
-- lock_from faqat shu tugatishga tegishli: keyingi to'lovda paid_until undan o'tadi va u o'z-o'zidan
-- e'tiborsiz qoladi (shart: lock_from > paid_until), alohida tozalash shart emas.
-- company — platforma jadvali: app_tenant'da jadval darajasida SELECT bor (V46), UPDATE berilmaydi.
ALTER TABLE company ADD COLUMN lock_from date;
