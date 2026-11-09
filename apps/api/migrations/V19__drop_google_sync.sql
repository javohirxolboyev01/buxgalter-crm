-- Google Sheets ikki tomonlama sinxron ishlatilmaydi (rahbar qarori): ma'lumot faqat Excel import bilan keladi,
-- har sahifa o'z faylini yuklaydi. Sinxron jadvallari olib tashlanadi; sheet_sync_error faqat
-- importning "qo'lda tekshirish" ro'yxati (IMPORT_REVIEW) uchun qoladi.
DELETE FROM sheet_sync_error WHERE kind = 'SYNC';
ALTER TABLE sheet_sync_error DROP COLUMN state_id;
ALTER TABLE sheet_sync_error DROP CONSTRAINT sheet_sync_error_kind_check;
ALTER TABLE sheet_sync_error ALTER COLUMN kind SET DEFAULT 'IMPORT_REVIEW';
ALTER TABLE sheet_sync_error ADD CONSTRAINT sheet_sync_error_kind_check CHECK (kind = 'IMPORT_REVIEW');
DROP TABLE sheet_sync_cell;
DROP TABLE sheet_sync_state;
