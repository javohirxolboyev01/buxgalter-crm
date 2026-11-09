import { AlertTriangle, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useCompany } from '@/lib/company';
import { fmtDate } from '@/lib/time';

/** Tarif ogohlantirishi: muddat tugagan (hammaga) yoki 7 kundan kam qolgan (rahbarga) */
const WARN_DAYS = 7;

export function SubscriptionBanner() {
  const { t } = useTranslation();
  const { isLeader } = useAuth();
  const { data } = useCompany();
  if (!data) return null;
  if (data.readOnly) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>{t('company.expiredBanner', { date: data.paidUntil ? fmtDate(data.paidUntil) : '—' })}</span>
        {isLeader && (
          <Link to="/settings?tab=company" className="font-medium underline underline-offset-2">
            {t('company.tariffDetails')}
          </Link>
        )}
      </div>
    );
  }
  if (isLeader && data.daysLeft !== null && data.daysLeft <= WARN_DAYS) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
        <Clock className="h-4 w-4 shrink-0" />
        <span>{t('company.expiresSoon', { count: Math.max(data.daysLeft, 0), date: data.paidUntil ? fmtDate(data.paidUntil) : '—' })}</span>
        <Link to="/settings?tab=company" className="font-medium underline underline-offset-2">
          {t('company.tariffDetails')}
        </Link>
      </div>
    );
  }
  return null;
}
