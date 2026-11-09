import { AlertTriangle, Clock } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useCompany } from '@/lib/company';
import { fmtDate } from '@/lib/time';
import { cn } from '@/lib/cn';

/** Tarif ogohlantirishi: muddat tugagan (hammaga) yoki 7 kundan kam qolgan (rahbarga) */
const WARN_DAYS = 7;

// Sarlavha (h-14) ostida yopishib turadi. Balandligi `--banner-h` CSS o'zgaruvchisiga yoziladi: PageHeader shu
// ostida qotadi, `.page-fill` jadval sahifalari undan kichrayadi — banner chiqqanda butun sahifa (fon) aylanmaydi.
// Tashqi qatlam sahifa fonida (kontent ostidan ko'rinmasin), karta main p-2 sm:p-4 bilan bir chiziqda.
// Qorong'i rejimda `dark:` yozilmaydi: red/amber shkalasi o'zi teskari aylanadi (tailwind.config.js),
// `dark:` qo'shilsa ikki marta aylanib och bo'lib qoladi
const WRAP = 'sticky top-14 z-40 bg-page px-2 pt-2 sm:px-4 sm:pt-4';
const BOX = 'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-4 py-2.5 text-sm shadow-card';

export function SubscriptionBanner() {
  const { t } = useTranslation();
  const { isLeader } = useAuth();
  const { data } = useCompany();
  const ref = useRef<HTMLDivElement>(null);

  const kind = !data ? null : data.readOnly ? 'expired' : isLeader && data.daysLeft !== null && data.daysLeft <= WARN_DAYS ? 'soon' : null;

  useLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement.style;
    if (!el) return;
    const set = () => root.setProperty('--banner-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.removeProperty('--banner-h');
    };
  }, [kind]);

  if (!data || !kind) return null;
  const date = data.paidUntil ? fmtDate(data.paidUntil) : '—';
  const link = (
    <Link to="/settings?tab=billing" className="font-medium underline underline-offset-2">
      {t('company.tariffDetails')}
    </Link>
  );

  return (
    <div ref={ref} className={WRAP}>
      {kind === 'expired' ? (
        <div role="alert" className={cn(BOX, 'border-red-200 bg-red-50 text-red-800')}>
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-500" />
          <span>{t('company.expiredBanner', { date, lockDate: data.lockAt ? fmtDate(data.lockAt) : '—' })}</span>
          {isLeader && link}
        </div>
      ) : (
        <div role="status" className={cn(BOX, 'border-amber-200 bg-amber-50 text-amber-800')}>
          <Clock className="h-4 w-4 shrink-0 text-amber-500" />
          <span>{t('company.expiresSoon', { count: Math.max(data.daysLeft ?? 0, 0), date })}</span>
          {link}
        </div>
      )}
    </div>
  );
}
