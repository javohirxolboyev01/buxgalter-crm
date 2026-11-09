import { useQueryClient } from '@tanstack/react-query';
import { Lock, LogOut, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Loading } from '@/components/ui/states';
import { useAuth } from '@/lib/auth';
import { type Company, useCompany, useCompanyDocumentBranding } from '@/lib/company';
import { fmtDate } from '@/lib/time';
import { BillingSettings } from './BillingSettings';
import { CompanyBrand } from './CompanyBrand';

/**
 * Tarif + imtiyozli davr o'tgan kompaniya (6.13): asosiy ilova (Layout) umuman ochilmaydi —
 * rahbarga faqat «Tarif va to'lovlar», qolgan xodimlarga "tarif tugagan" ekrani.
 * Server ham shu yo'llardan boshqasini 402 SUBSCRIPTION_LOCKED bilan yopadi (frontend faqat qulaylik).
 */
export function SubscriptionGate({ children }: { children: ReactNode }) {
  const q = useCompany();
  // Kompaniya holati kelmaguncha ilova so'rovlari boshlanmasin (yopiq kompaniyada 402 lar bo'lmasin)
  if (q.isLoading) return <Loading className="h-screen animate-none" />;
  if (q.data?.locked) return <SubscriptionLocked company={q.data} />;
  return <>{children}</>;
}

function SubscriptionLocked({ company }: { company: Company }) {
  const { t } = useTranslation();
  const { isLeader, logout } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useCompany();
  useCompanyDocumentBranding();
  const date = company.paidUntil ? fmtDate(company.paidUntil) : '—';

  const signOut = async () => {
    await logout();
    qc.clear();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-page">
      <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-gray-200 bg-white px-3 dark:bg-page sm:px-4">
        <CompanyBrand className="min-w-0 max-w-[60vw]" />
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={signOut}>
          <LogOut className="h-4 w-4" /> {t('nav.logout')}
        </Button>
      </header>

      <main className="mx-auto w-full max-w-6xl space-y-3 p-2 sm:p-4">
        <div role="alert" className="section-container flex items-start gap-3 border border-red-200 bg-red-50 text-red-800">
          <Lock className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold">{t('company.lockedTitle')}</h1>
            <p className="mt-1 text-sm">{t(isLeader ? 'company.lockedLeader' : 'company.lockedStaff', { date })}</p>
          </div>
          {!isLeader && (
            <Button variant="outline" size="sm" loading={q.isFetching} onClick={() => void q.refetch()}>
              <RefreshCw className="h-4 w-4" /> {t('company.lockedRefresh')}
            </Button>
          )}
        </div>
        {isLeader && <BillingSettings company={company} />}
      </main>
    </div>
  );
}
