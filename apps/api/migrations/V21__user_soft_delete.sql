-- Ish tarixi bor xodimni "o'chirish": yozuv tarix (audit_log, vazifalar, qo'ng'iroqlar) uchun qoladi,
-- lekin hamma ro'yxatdan yashiriladi, kira olmaydi (active = false), login boshqa xodimga bo'shatiladi.
ALTER TABLE app_user ADD COLUMN deleted_at timestamptz;
