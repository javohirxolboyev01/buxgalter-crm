-- Oylik jadval ustunlari Google Sheet tartibida: JSHDS, To'lov manbai, AOS, QQS, FOYDA, INPS, Poruchenya.
-- Faqat seed qiymati (70) turgan bo'lsa o'zgartiriladi: rahbar sozlamada tartibni o'zgartirgan bo'lsa tegilmaydi.
UPDATE report_type SET sort_order = 45 WHERE code = 'FOYDA' AND sort_order = 70;
