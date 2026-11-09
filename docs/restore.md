# Zaxiradan tiklash

Zaxira fayllari `scripts/backup.sh` bilan olinadi: `pg_dump --format=custom`, nomi `buxcrm_YYYY-MM-DD_HHMMSS.dump`,
14 kundan eskilari o'chiriladi. Quyidagi buyruqlar lokal PostgreSQL 16 da tekshirilgan.

## 1. Zaxira faylini tekshirish

```bash
pg_restore --list backups/buxcrm_2026-10-23_175129.dump | head
```

## 2. Yangi (bo'sh) bazaga tiklash — tavsiya etiladi

Ishlab turgan bazani ustidan yozmang: avval yangi bazaga tiklang, tekshiring, keyin almashtiring.

```bash
createdb -O buxcrm buxcrm_restored
pg_restore --no-owner --role=buxcrm \
  -d postgres://buxcrm:PAROL@localhost:5432/buxcrm_restored \
  backups/buxcrm_2026-10-23_175129.dump

# Baza darajasidagi vaqt zonasi dump'ga kirmaydi — qayta o'rnating
psql -d buxcrm_restored -c "ALTER DATABASE buxcrm_restored SET timezone TO 'Asia/Tashkent'"
```

Docker'da:

```bash
docker compose exec -T db createdb -U buxcrm buxcrm_restored
docker compose exec -T db pg_restore --no-owner -U buxcrm -d buxcrm_restored < backups/buxcrm_2026-10-23_175129.dump
```

## 3. Tekshirish

```bash
psql -d buxcrm_restored -tAc "select (select count(*) from client), (select count(*) from task), (select count(*) from audit_log)"
psql -d buxcrm_restored -tAc "select max(version) from schema_migration"
```

Mijozlar, vazifalar va audit yozuvlari soni kutilganiga mos bo'lishi kerak; `schema_migration` dagi oxirgi versiya
`apps/api/migrations` dagi oxirgi fayl raqamiga teng bo'lishi kerak.

## 4. Almashtirish

```bash
# API ni to'xtating, keyin:
psql -d postgres -c "ALTER DATABASE buxcrm RENAME TO buxcrm_old"
psql -d postgres -c "ALTER DATABASE buxcrm_restored RENAME TO buxcrm"
# API ni qayta ishga tushiring; hammasi joyida bo'lsa buxcrm_old ni keyinroq o'chiring
```

## Eslatmalar

- `audit_log` triggeri faqat UPDATE/DELETE/TRUNCATE ni taqiqlaydi; tiklash (COPY/INSERT) bunga to'sqinlik qilmaydi.
- Zaxira fayllari maxfiy ma'lumot (mijozlar, parol hashlari) saqlaydi: serverdan tashqariga shifrlangan holda ko'chiring.
