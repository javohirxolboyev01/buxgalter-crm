#!/usr/bin/env bash
# Kunlik zaxira: pg_dump (custom format), sana bilan nomlash, 14 kundan eskisini o'chirish.
# Foydalanish: DATABASE_URL=postgres://... BACKUP_DIR=./backups scripts/backup.sh
# Cron misoli (har kuni 02:30):  30 2 * * * cd /opt/buxcrm && set -a && . ./.env && set +a && scripts/backup.sh >> backups/backup.log 2>&1
# Yoki API ichida: BACKUP_ENABLED=true (node-cron 02:30 da shu skriptni chaqiradi).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL kerak}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"

STAMP="$(TZ=Asia/Tashkent date +%Y-%m-%d_%H%M%S)"
FILE="$BACKUP_DIR/buxcrm_${STAMP}.dump"

pg_dump --format=custom --no-owner --no-privileges --file="$FILE.tmp" "$DATABASE_URL"
mv "$FILE.tmp" "$FILE"
# Nusxa o'qiladiganligini tekshirish
pg_restore --list "$FILE" > /dev/null

find "$BACKUP_DIR" -name 'buxcrm_*.dump' -type f -mtime +"$KEEP_DAYS" -delete
echo "Zaxira tayyor: $FILE ($(du -h "$FILE" | cut -f1))"
