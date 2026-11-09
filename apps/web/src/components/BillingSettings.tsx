import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle2, Copy, Hourglass, Receipt, ShieldCheck, Upload, Wifi, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { QueryState } from '@/components/ui/states';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import {
  type Billing,
  BILLING_KEY,
  type Company,
  COMPANY_KEY,
  type CompanyPayment,
  fmtMoney,
  type PaymentInfo,
  type Plan,
  type PaymentRequest,
  useCompany,
} from '@/lib/company';
import { closeTariffModal, useTariffModalOpen } from '@/lib/tariffModal';
import { showError } from '@/lib/errors';
import { fmtDate, fmtDateTime } from '@/lib/time';

// Sozlamalar → Tarif va to'lovlar: tarifni to'lash (V47). Click/Payme integratsiyasi yo'q (rahbar qarori):
// rahbar platforma kartasiga o'tkazadi va chek skrinshotini yuboradi, platforma admini tasdiqlaydi.

const RECEIPT_MAX_MB = 5;
const RECEIPT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const PERIOD_OPTIONS = { MONTHLY: [1, 2, 3, 6, 12], YEARLY: [1, 2, 3] } as const;

export const REQUEST_STATUS_CLS: Record<PaymentRequest['status'], string> = {
  PENDING: 'border-amber-300 bg-amber-50 text-amber-700',
  APPROVED: 'border-green-300 bg-green-50 text-green-700',
  REJECTED: 'border-red-300 bg-red-50 text-red-700',
  CANCELLED: 'border-gray-300 bg-gray-50 text-gray-500',
};

export function RequestStatusBadge({ status }: { status: PaymentRequest['status'] }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        REQUEST_STATUS_CLS[status],
      )}
    >
      {t(`billing.requestStatus.${status}`)}
    </span>
  );
}

const copyText = (text: string, ok: string) =>
  navigator.clipboard.writeText(text).then(
    () => toast.success(ok),
    () => undefined,
  );

/** Faqat raqamlardan iborat bo'lsa 4 tadan guruhlanadi (8600 1234 5678 9012), aks holda kiritilganicha */
export const fmtCardNumber = (s: string) => {
  const d = s.replace(/\s/g, '');
  return /^\d{12,19}$/.test(d) ? d.replace(/(\d{4})(?=\d)/g, '$1 ') : s;
};

/** Tarif imkoniyatlari: tariflar faqat muddat bilan farq qiladi (6.13) — hammasi ikkala tarifda ochiq */
const FEATURES = ['clients', 'reports', 'tasks', 'notify', 'chat', 'import', 'brand'] as const;

function FeatureList({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <ul className={cn('space-y-3', className)}>
      {FEATURES.map((f) => (
        <li key={f} className="flex items-start gap-3 text-ink">
          <Check className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" strokeWidth={2.5} aria-hidden />
          <span>{t(`billing.feature.${f}`)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Yillik tarifning oylikka nisbatan tejami (oylik narx × 12 dan arzon bo'lsa) */
function yearlySaving(tariffs: Company['tariffs']) {
  const m = tariffs.find((x) => x.code === 'MONTHLY');
  const y = tariffs.find((x) => x.code === 'YEARLY');
  if (!m?.price || !y?.price) return null;
  const full = (m.price * y.months) / m.months;
  if (y.price >= full) return null;
  return { amount: full - y.price, pct: Math.round(((full - y.price) / full) * 100), monthly: m.price / m.months };
}

/** Sozlamalar → Tarif va to'lovlar: joriy tarif, tarif kartalari, to'lov oynasi (chek), to'lovlar tarixi */
export function BillingSettings({ company }: { company: Company }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  // Chek tekshirilayotganda vaqti-vaqti bilan yangilanadi: tasdiqlansa muddat va banner darhol yangilansin
  const q = useQuery({
    queryKey: BILLING_KEY,
    queryFn: () => api.get<Billing>('/company/billing'),
    refetchInterval: (query) => (query.state.data?.requests.some((r) => r.status === 'PENDING') ? 30_000 : false),
  });
  const [payPlan, setPayPlan] = useState<Plan | null>(null);
  // Tanlangan tarif kartasi (ramka va to'ldirilgan tugma unga o'tadi); boshida — joriy tarif
  const [selected, setSelected] = useState<Plan>(company.plan ?? 'MONTHLY');
  const [confirmCancel, setConfirmCancel] = useState<number | null>(null);
  const [viewId, setViewId] = useState<number | null>(null);
  const plansRef = useRef<HTMLDivElement>(null);

  const pending = q.data?.requests.find((r) => r.status === 'PENDING');
  const lastClosed = q.data?.requests.find((r) => r.status !== 'PENDING');
  const pendingId = pending?.id;
  const [watched, setWatched] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (watched !== undefined && pendingId === undefined)
      void qc.invalidateQueries({ queryKey: COMPANY_KEY, exact: true });
    setWatched(pendingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingId]);

  const cancel = useMutation({
    mutationFn: (id: number) => api.post<PaymentRequest>(`/company/payment-requests/${id}/cancel`),
    onSuccess: () => {
      toast.success(t('billing.cancelled'));
      setConfirmCancel(null);
      void qc.invalidateQueries({ queryKey: BILLING_KEY });
    },
    onError: (e) => showError(e, t),
  });

  return (
    <QueryState q={q}>
      {q.data && (
        <div className="space-y-3">
          <h2 className="px-1 text-xl font-semibold text-ink">{t('billing.pageTitle')}</h2>

          {pending ? (
            <PendingPanel request={pending} onView={() => setViewId(pending.id)} onCancel={() => setConfirmCancel(pending.id)} />
          ) : (
            lastClosed?.status === 'REJECTED' && (
              <div role="alert" className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-semibold">{t('billing.rejectedTitle')}</p>
                  <p className="mt-0.5">{t('billing.rejectedText', { reason: lastClosed.rejectReason })}</p>
                </div>
              </div>
            )
          )}

          <CurrentPlanCard
            company={company}
            lastPayment={q.data.payments[0]}
            pending={!!pending}
            onRenew={() => setPayPlan(company.plan ?? 'MONTHLY')}
            onShowPlans={() => plansRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          />

          <div ref={plansRef} role="radiogroup" aria-label={t('billing.plan')} className="grid scroll-mt-4 gap-4 pt-3 md:grid-cols-2">
            {company.tariffs.map((tf) => (
              <PlanCard
                key={tf.code}
                tariff={tf}
                company={company}
                pending={!!pending}
                selected={selected === tf.code}
                onSelect={() => setSelected(tf.code)}
                onBuy={() => {
                  setSelected(tf.code);
                  setPayPlan(tf.code);
                }}
              />
            ))}
          </div>

          <HistoryTable billing={q.data} onView={setViewId} />

          {payPlan && (
            <PayDialog
              company={company}
              info={q.data.paymentInfo}
              initialPlan={payPlan}
              onClose={() => setPayPlan(null)}
              onSent={() => {
                setPayPlan(null);
                void qc.invalidateQueries({ queryKey: BILLING_KEY });
              }}
            />
          )}
          <ConfirmDialog
            open={confirmCancel !== null}
            onClose={() => setConfirmCancel(null)}
            onConfirm={() => confirmCancel !== null && cancel.mutate(confirmCancel)}
            text={t('billing.confirmCancel')}
            confirmLabel={t('billing.cancel')}
            loading={cancel.isPending}
          />
          {viewId !== null && (
            <ReceiptViewer load={() => api.blob(`/company/payment-requests/${viewId}/screenshot`)} onClose={() => setViewId(null)} />
          )}
        </div>
      )}
    </QueryState>
  );
}

/** Joriy tarif: chapda nom, holat, muddat va tugmalar; o'ngda imkoniyatlar ro'yxati */
function CurrentPlanCard({
  company: c,
  lastPayment,
  pending,
  onRenew,
  onShowPlans,
}: {
  company: Company;
  lastPayment?: CompanyPayment;
  pending: boolean;
  onRenew: () => void;
  onShowPlans: () => void;
}) {
  const { t } = useTranslation();
  const soon = !c.readOnly && c.daysLeft !== null && c.daysLeft < 7;
  const tone = c.readOnly ? 'expired' : soon ? 'soon' : 'ok';
  const months = c.tariffs.find((x) => x.code === c.plan)?.months ?? 1;
  const badge = {
    ok: 'border-green-200 bg-green-50 text-green-700',
    soon: 'border-amber-200 bg-amber-50 text-amber-700',
    expired: 'border-red-200 bg-red-50 text-red-700',
  }[tone];
  const dot = { ok: 'bg-green-500', soon: 'bg-amber-500', expired: 'bg-red-500' }[tone];
  return (
    <Card className="grid rounded-xl border border-gray-200 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">{t('billing.currentPlan')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <span className="text-2xl font-bold uppercase text-ink">{c.plan ? t(`company.planName.${c.plan}`) : '—'}</span>
          <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-sm font-medium', badge)}>
            <span className={cn('h-2 w-2 rounded-full', dot)} aria-hidden />
            {t(c.readOnly ? 'billing.stateExpired' : soon ? 'billing.stateSoon' : 'company.stateActive')}
          </span>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-gray-500">{t('billing.planType')}</dt>
            <dd className="mt-1 font-semibold text-ink">{c.plan ? t(`company.planName.${c.plan}`) : '—'}</dd>
            {c.plan && <dd className="text-xs text-gray-500">{t('billing.planMonths', { count: months })}</dd>}
          </div>
          <div>
            <dt className="text-gray-500">{t('billing.periodStarted')}</dt>
            <dd className="mt-1 font-semibold tabular-nums text-ink">{lastPayment ? fmtDate(lastPayment.paidFrom) : '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">{t('company.paidUntil')}</dt>
            <dd className="mt-1 font-semibold tabular-nums text-ink">{c.paidUntil ? fmtDate(c.paidUntil) : t('company.unlimited')}</dd>
            {c.daysLeft !== null && !c.readOnly && (
              <dd className={cn('text-xs', soon ? 'font-medium text-amber-700' : 'text-gray-500')}>{t('company.daysLeft', { count: c.daysLeft })}</dd>
            )}
          </div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-3 border-t border-gray-200 pt-5">
          <Button onClick={onRenew} disabled={pending} title={pending ? t('billing.pendingTitle') : undefined}>
            {t('billing.renew')}
          </Button>
          <Button variant="outline" onClick={onShowPlans}>
            {t('billing.otherPlans')}
          </Button>
        </div>
      </div>
      <div className="border-t border-gray-200 p-5 text-sm sm:p-6 lg:border-l lg:border-t-0">
        <FeatureList />
      </div>
    </Card>
  );
}

/** Tarif kartasi: narx (yillikda oyiga hisob va tejam), imkoniyatlar, sotib olish tugmasi */
function PlanCard({
  tariff: tf,
  company: c,
  pending,
  selected,
  onSelect,
  onBuy,
}: {
  tariff: Company['tariffs'][number];
  company: Company;
  pending: boolean;
  selected: boolean;
  onSelect: () => void;
  onBuy: () => void;
}) {
  const { t } = useTranslation();
  const saving = tf.code === 'YEARLY' ? yearlySaving(c.tariffs) : null;
  const perMonth = tf.price ? Math.round(tf.price / tf.months) : 0;
  const current = c.plan === tf.code;
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'relative flex cursor-pointer flex-col rounded-2xl border-2 bg-white p-5 outline-none transition-[border-color,box-shadow] sm:p-7',
        'focus-visible:ring-[3px] focus-visible:ring-brand-500/30',
        selected ? 'border-brand-500 shadow-md' : 'border-gray-200 hover:border-brand-300',
      )}
    >
      {saving && (
        <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-amber-500 px-4 py-1 text-sm font-semibold text-on-brand shadow-sm">
          {t('billing.bestValue')}
        </span>
      )}
      <div className="flex items-start justify-between gap-3">
        <p className="text-gray-500">{t(`billing.planSubtitle.${tf.code}`)}</p>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {current && (
            <span className="rounded-md border border-brand-300 bg-brand-50 px-2 py-0.5 text-sm font-medium text-brand-700 dark:border-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
              {t('billing.currentBadge')}
            </span>
          )}
          {saving && <span className="rounded-md bg-green-500 px-2 py-0.5 text-sm font-semibold text-on-brand">−{saving.pct}%</span>}
        </div>
      </div>
      <p className="mt-1 text-3xl font-bold uppercase text-ink">{t(`company.planName.${tf.code}`)}</p>
      <p className="mt-1 text-sm text-gray-500">{t('billing.planMonths', { count: tf.months })}</p>
      {saving && (
        <p className="mt-1 font-medium text-green-600 dark:text-green-400">
          {t('billing.yearlySaving', { amount: fmtMoney(Math.round(saving.amount)) })}
        </p>
      )}
      <p className="mt-5 flex flex-wrap items-baseline gap-x-2">
        {saving && <span className="text-xl tabular-nums text-gray-500 line-through">{fmtMoney(Math.round(saving.monthly))}</span>}
        <span className="text-4xl font-bold tabular-nums text-ink">{tf.price ? fmtMoney(perMonth) : '—'}</span>
        <span className="text-gray-500">{t('billing.perMonth')}</span>
      </p>
      {tf.months > 1 && tf.price > 0 && (
        <p className="mt-1 text-sm text-gray-500">{t('billing.totalFor', { amount: fmtMoney(tf.price), count: tf.months })}</p>
      )}
      <FeatureList className="mt-6 flex-1" />
      <div className="mt-6 border-t border-dashed border-gray-300 pt-6">
        <Button
          size="lg"
          variant={selected ? 'default' : 'outline'}
          className="w-full"
          onClick={(e) => {
            e.stopPropagation();
            onBuy();
          }}
          disabled={pending || !tf.price}
          title={pending ? t('billing.pendingTitle') : !tf.price ? t('billing.priceNotSet') : undefined}
        >
          {t(current ? 'billing.renew' : 'billing.buy')}
        </Button>
      </div>
    </div>
  );
}

/** To'lov oynasi: davr → kartaga o'tkazma → chek (Click/Payme yo'q, admin tasdiqlaydi) */
function PayDialog({
  company,
  info,
  initialPlan,
  onClose,
  onSent,
}: {
  company: Company;
  info: PaymentInfo;
  initialPlan: Plan;
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [periods, setPeriods] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const tariff = company.tariffs.find((x) => x.code === plan);
  const total = (tariff?.price ?? 0) * periods;

  const send = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('plan', plan);
      fd.append('periods', String(periods));
      if (note.trim()) fd.append('note', note.trim());
      fd.append('file', file!);
      return api.post<PaymentRequest>('/company/payment-requests', fd);
    },
    onSuccess: () => {
      toast.success(t('billing.sent'));
      onSent();
    },
    onError: (e) => showError(e, t),
  });
  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (!RECEIPT_TYPES.includes(f.type)) return toast.error(t('errors.BAD_IMAGE'));
    if (f.size > RECEIPT_MAX_MB * 1024 * 1024) return toast.error(t('errors.RECEIPT_TOO_LARGE'));
    setFile(f);
  };
  const pill = (active: boolean) =>
    cn(
      'h-9 min-w-[3.25rem] rounded-full border px-3 font-medium transition-colors',
      active
        ? 'border-brand-500 bg-brand-500 text-on-brand'
        : 'border-gray-300 hover:border-brand-400 hover:text-brand-700 dark:hover:text-brand-300',
    );

  return (
    <Dialog open onClose={onClose} title={t('billing.title')} className="max-w-2xl">
      <ol className="text-sm">
        <Step n={1} title={t('billing.step1Title')} hint={t('billing.step1')} done={total > 0}>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('billing.plan')}>
            {company.tariffs.map((tf) => (
              <button
                key={tf.code}
                type="button"
                role="radio"
                aria-checked={plan === tf.code}
                className={pill(plan === tf.code)}
                onClick={() => {
                  setPlan(tf.code);
                  setPeriods(1);
                }}
              >
                {t(`company.planName.${tf.code}`)}
              </button>
            ))}
          </div>
          <p className="mb-1.5 mt-4 text-xs font-medium uppercase tracking-wide text-gray-500">{t('billing.periods')}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('billing.periods')}>
            {PERIOD_OPTIONS[plan].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={periods === n} onClick={() => setPeriods(n)} className={pill(periods === n)}>
                × {n}
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-50 px-4 py-3 dark:bg-brand-950/40">
            <div>
              <p className="text-xs text-gray-500">{t('billing.total')}</p>
              <p className="text-2xl font-bold tabular-nums text-brand-700 dark:text-brand-300">
                {total ? `${fmtMoney(total)} ${t('company.sum')}` : '—'}
              </p>
              <p className="text-xs text-gray-500">
                {t(`company.planName.${plan}`)} × {periods} · {t('billing.planMonths', { count: (tariff?.months ?? 1) * periods })}
              </p>
            </div>
            {total > 0 && (
              <Button size="sm" variant="outline" onClick={() => copyText(String(total), t('billing.copied'))}>
                <Copy className="h-4 w-4" /> {t('billing.copyAmount')}
              </Button>
            )}
          </div>
        </Step>

        <Step n={2} title={t('billing.step2Title')} hint={t('billing.step2')} done={false}>
          <PaymentCardVisual info={info} />
          {(info.contact || info.note) && info.cardNumber && (
            <div className="mt-3 space-y-1 text-gray-600">
              {info.note && <p className="whitespace-pre-line">{info.note}</p>}
              {info.contact && (
                <p>
                  <span className="text-gray-500">{t('billing.contact')}:</span> <span className="font-medium text-ink">{info.contact}</span>
                </p>
              )}
            </div>
          )}
        </Step>

        <Step n={3} title={t('billing.step3Title')} hint={t('billing.step3')} done={!!file} last>
          <div className="space-y-3">
            <Field label={t('billing.receipt')} hint={t('billing.receiptHint', { mb: RECEIPT_MAX_MB })}>
              <ReceiptPicker file={file} onPick={pick} onClear={() => setFile(null)} />
            </Field>
            <Field label={t('billing.note')}>
              <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Button
              className="w-full sm:w-auto"
              size="lg"
              onClick={() => send.mutate()}
              loading={send.isPending}
              disabled={!file || !info.cardNumber || !total}
            >
              <Upload className="h-4 w-4" /> {t('billing.send')}
            </Button>
          </div>
        </Step>
      </ol>
    </Dialog>
  );
}

type HistoryRow = {
  key: string;
  at: string;
  plan: Plan;
  periods: number;
  amount: number;
  period: string | null;
  method: 'RECEIPT' | 'ADMIN';
  status: 'PAID' | Exclude<PaymentRequest['status'], 'APPROVED'>;
  reason: string | null;
  requestId: number | null;
};

/** To'lovlar tarixi: tasdiqlangan to'lovlar + kutilayotgan/rad etilgan/bekor qilingan cheklar, yangisi tepada */
function HistoryTable({ billing, onView }: { billing: Billing; onView: (id: number) => void }) {
  const { t } = useTranslation();
  const rows = useMemo<HistoryRow[]>(() => {
    const byPayment = new Map(billing.requests.filter((r) => r.paymentId).map((r) => [r.paymentId!, r.id]));
    const paid: HistoryRow[] = billing.payments.map((p) => ({
      key: `p${p.id}`,
      at: p.createdAt,
      plan: p.plan,
      periods: p.periods,
      amount: p.amount,
      period: t('billing.period', { from: fmtDate(p.paidFrom), until: fmtDate(p.paidUntil) }),
      method: byPayment.has(p.id) ? 'RECEIPT' : 'ADMIN',
      status: 'PAID',
      reason: null,
      requestId: byPayment.get(p.id) ?? null,
    }));
    const open: HistoryRow[] = billing.requests
      .filter((r) => r.status !== 'APPROVED')
      .map((r) => ({
        key: `r${r.id}`,
        at: r.createdAt,
        plan: r.plan,
        periods: r.periods,
        amount: r.amount,
        period: null,
        method: 'RECEIPT',
        status: r.status as HistoryRow['status'],
        reason: r.rejectReason,
        requestId: r.id,
      }));
    return [...paid, ...open].sort((a, b) => b.at.localeCompare(a.at));
  }, [billing, t]);

  const statusCls: Record<HistoryRow['status'], string> = {
    PAID: 'text-green-700 dark:text-green-400',
    PENDING: 'text-amber-700 dark:text-amber-400',
    REJECTED: 'text-red-700 dark:text-red-400',
    CANCELLED: 'text-gray-500',
  };
  const StatusIcon = { PAID: Check, PENDING: Hourglass, REJECTED: X, CANCELLED: X };

  return (
    <Card className="rounded-xl border border-gray-200">
      <CardHeader title={t('billing.history')} />
      {!rows.length ? (
        <p className="px-4 pb-6 pt-2 text-center text-sm text-gray-500">{t('billing.noHistory')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-2.5">{t('billing.col.date')}</th>
                <th className="px-4 py-2.5">{t('billing.col.plan')}</th>
                <th className="px-4 py-2.5 text-right">{t('billing.col.amount')}</th>
                <th className="px-4 py-2.5">{t('billing.col.period')}</th>
                <th className="px-4 py-2.5">{t('billing.col.method')}</th>
                <th className="px-4 py-2.5">{t('billing.col.status')}</th>
                <th className="w-12 px-2 py-2.5" aria-label={t('billing.viewReceipt')} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const Icon = StatusIcon[r.status];
                return (
                  <tr key={r.key} className="border-t border-gray-200 hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink">{fmtDateTime(r.at)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {t(`company.planName.${r.plan}`)} × {r.periods}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-ink">
                      {fmtMoney(r.amount)} {t('company.sum')}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-gray-600">{r.period ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">{t(`billing.method.${r.method}`)}</td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap font-medium', statusCls[r.status])}>
                        <Icon className="h-4 w-4" aria-hidden /> {t(`billing.rowStatus.${r.status}`)}
                      </span>
                      {r.reason && <p className="mt-0.5 max-w-xs text-xs text-red-600">{r.reason}</p>}
                    </td>
                    <td className="px-2 py-3 text-right">
                      {r.requestId !== null && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => onView(r.requestId!)}
                          title={t('billing.viewReceipt')}
                          aria-label={t('billing.viewReceipt')}
                        >
                          <Receipt className="h-4 w-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Bosqich: chapda raqamli doira va vertikal chiziq, o'ngda sarlavha + mazmun */
function Step({
  n,
  title,
  hint,
  done,
  last,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  done: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="relative flex gap-4">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
            done ? 'bg-brand-500 text-on-brand' : 'border-2 border-brand-500 text-brand-600 dark:text-brand-300',
          )}
        >
          {done ? <Check className="h-4 w-4" /> : n}
        </span>
        {!last && <span className="mt-1 w-0.5 flex-1 rounded-full bg-brand-100 dark:bg-brand-900/60" aria-hidden />}
      </div>
      <div className={cn('min-w-0 flex-1', !last && 'pb-6')}>
        <p className="pt-1 font-semibold text-foreground">{title}</p>
        <p className="mb-3 text-gray-500">{hint}</p>
        {children}
      </div>
    </li>
  );
}

/** Chek yuborilgan: uch bosqichli holat (yuborildi → tekshirilmoqda → muddat uzayadi) */
function PendingPanel({
  request,
  onView,
  onCancel,
}: {
  request: PaymentRequest;
  onView: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const steps = [
    { label: t('billing.flowSent'), sub: fmtDateTime(request.createdAt), state: 'done' as const },
    { label: t('billing.flowReview'), sub: t('billing.flowReviewHint'), state: 'current' as const },
    { label: t('billing.flowExtended'), sub: '', state: 'next' as const },
  ];
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Hourglass className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-base font-semibold text-amber-900">{t('billing.pendingTitle')}</p>
          <p className="mt-0.5 text-amber-800">
            {t('billing.pendingText', {
              date: fmtDateTime(request.createdAt),
              plan: t(`company.planName.${request.plan}`),
              periods: request.periods,
            })}
          </p>
          <p className="mt-2 text-xl font-bold tabular-nums text-ink">
            {fmtMoney(request.amount)} {t('company.sum')}
          </p>
        </div>
      </div>
      <ol className="mt-5 grid gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2">
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                s.state === 'done' && 'bg-green-600 text-on-brand',
                s.state === 'current' && 'animate-pulse bg-amber-500 text-on-brand',
                s.state === 'next' && 'border-2 border-gray-300 text-gray-400',
              )}
            >
              {s.state === 'done' ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0">
              <p className={cn('font-medium', s.state === 'next' ? 'text-gray-500' : 'text-ink')}>{s.label}</p>
              {s.sub && <p className="text-xs text-gray-500">{s.sub}</p>}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onView}>
          <Receipt className="h-4 w-4" /> {t('billing.viewReceipt')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="h-4 w-4" /> {t('billing.cancel')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Bank kartasi ko'rinishidagi rekvizitlar. CRM (rahbar) va platforma panelida (jonli ko'rinish) bir xil.
 * Brend gradiyenti ataylab mavzuga qarab aylanmaydi — karta har ikki rejimda bir xil ko'rinadi.
 */
export function PaymentCardVisual({
  info,
  className,
  preview,
}: {
  info: PaymentInfo;
  className?: string;
  preview?: boolean;
}) {
  const { t } = useTranslation();
  if (!info.cardNumber && !preview) {
    return (
      <div
        className={cn(
          'flex aspect-[1.586] w-full max-w-sm flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 p-5 text-center text-gray-500',
          className,
        )}
      >
        <Wifi className="h-6 w-6 rotate-90 text-gray-400" aria-hidden />
        <p>{t('billing.noCard')}</p>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'relative flex aspect-[1.586] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-gradient-to-br from-brand-400 via-brand-600 to-navy p-5 text-on-brand shadow-pop',
        className,
      )}
    >
      <span className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10" aria-hidden />
      <span
        className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-white/5"
        aria-hidden
      />
      <div className="relative flex items-start justify-between gap-2">
        <span className="truncate text-sm font-semibold uppercase tracking-wider text-on-brand/90">
          {info.bank || t('billing.card')}
        </span>
        <Wifi className="h-5 w-5 shrink-0 rotate-90 text-on-brand/80" aria-hidden />
      </div>
      <div
        className="relative mt-4 h-8 w-11 rounded-md bg-gradient-to-br from-[#fde68a] to-[#f59e0b] shadow-inner"
        aria-hidden
      >
        <span className="absolute inset-x-0 top-1/2 h-px bg-[#b45309]/40" />
        <span className="absolute inset-y-0 left-1/2 w-px bg-[#b45309]/40" />
      </div>
      <p
        className="relative mt-auto whitespace-nowrap font-mono text-lg font-semibold tracking-[0.1em] drop-shadow sm:text-xl"
        aria-label={t('billing.card')}
      >
        {info.cardNumber ? fmtCardNumber(info.cardNumber) : '•••• •••• •••• ••••'}
      </p>
      <div className="relative mt-3 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-widest text-on-brand/70">{t('billing.holder')}</p>
          <p className="truncate font-medium uppercase tracking-wide">{info.cardHolder || '—'}</p>
        </div>
        {info.cardNumber && (
          <button
            type="button"
            onClick={() => copyText(info.cardNumber.replace(/\s/g, ''), t('billing.copied'))}
            className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-white/20 px-3 text-xs font-medium text-on-brand backdrop-blur transition-colors hover:bg-white/30"
          >
            <Copy className="h-3.5 w-3.5" /> {t('billing.copy')}
          </button>
        )}
      </div>
    </div>
  );
}

function ReceiptPicker({
  file,
  onPick,
  onClear,
}: {
  file: File | null;
  onPick: (f: File | null) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  if (file && preview) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-green-300 bg-green-50 p-2">
        <img src={preview} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 font-medium text-green-700">
            <CheckCircle2 className="h-4 w-4" /> {t('billing.receiptReady')}
          </p>
          <p className="truncate text-xs text-gray-500">
            {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
          </p>
        </div>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClear} aria-label={t('common.cancel')}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }
  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
        over
          ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40'
          : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50',
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onPick(e.dataTransfer.files?.[0] ?? null);
      }}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-300">
        <Upload className="h-5 w-5" aria-hidden />
      </span>
      <span className="font-medium text-ink">{t('billing.pickReceipt')}</span>
      <input
        type="file"
        accept={RECEIPT_TYPES.join(',')}
        className="sr-only"
        onChange={(e) => {
          onPick(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
    </label>
  );
}

/** Blob'ni object URL qilib beradi (Authorization kerak bo'lgan rasm uchun) */
export function useBlobUrl(load: () => Promise<Blob>) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    load().then(
      (b) => {
        url = URL.createObjectURL(b);
        if (alive) setSrc(url);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { src, failed };
}

/** Chek rasmi (Authorization kerak — blob orqali). Platforma panelida ham ishlatiladi. */
export function ReceiptViewer({ load, onClose }: { load: () => Promise<Blob>; onClose: () => void }) {
  const { t } = useTranslation();
  const { src, failed } = useBlobUrl(load);
  return (
    <Dialog open onClose={onClose} title={t('billing.receipt')} className="max-w-2xl">
      {failed ? (
        <p className="text-red-600">{t('errors.INTERNAL')}</p>
      ) : src ? (
        <img src={src} alt={t('billing.receipt')} className="mx-auto max-h-[70vh] w-auto rounded object-contain" />
      ) : (
        <div className="h-40 animate-pulse rounded bg-gray-100" />
      )}
    </Dialog>
  );
}

/**
 * "Tarif tanlang" oynasi (WinPro uslubi): tarif muddati tugagan kompaniyada yozish urinishi (402 SUBSCRIPTION_EXPIRED)
 * xato toast'i o'rniga shu oynani ochadi. Rahbar tarif kartasidan to'lov oynasiga o'tadi; buxgalter va operator
 * to'lay olmaydi (/company/billing faqat rahbarga) — ularga "rahbaringizga murojaat qiling" ko'rinadi.
 */
export function TariffModal() {
  const open = useTariffModalOpen();
  const { isLeader } = useAuth();
  const { data: company } = useCompany();
  if (!open || !company) return null;
  return createPortal(
    isLeader ? <LeaderTariffModal company={company} /> : <StaffTariffModal company={company} />,
    document.body,
  );
}

function ExpiredNotice({ company, text }: { company: Company; text: string }) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
      <div>
        <p className="font-semibold">{t('billing.expiredTitle', { date: company.paidUntil ? fmtDate(company.paidUntil) : '—' })}</p>
        <p className="mt-0.5">{text}</p>
      </div>
    </div>
  );
}

function LeaderTariffModal({ company }: { company: Company }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: BILLING_KEY, queryFn: () => api.get<Billing>('/company/billing') });
  const [selected, setSelected] = useState<Plan>(company.plan ?? 'YEARLY');
  const [payPlan, setPayPlan] = useState<Plan | null>(null);
  const pending = q.data?.requests.find((r) => r.status === 'PENDING');
  const lockDate = company.lockAt ? fmtDate(company.lockAt) : '—';

  // To'lov oynasi tarif oynasi o'rnida ochiladi (ikki modal ustma-ust turmasin)
  if (payPlan && q.data)
    return (
      <PayDialog
        company={company}
        info={q.data.paymentInfo}
        initialPlan={payPlan}
        onClose={() => setPayPlan(null)}
        onSent={() => {
          closeTariffModal();
          void qc.invalidateQueries({ queryKey: BILLING_KEY });
        }}
      />
    );

  return (
    <Dialog open onClose={closeTariffModal} title={<span className="block text-center text-xl">{t('billing.chooseTitle')}</span>} className="max-w-4xl">
      <QueryState q={q}>
        <div className="space-y-4 pt-3">
          {pending && (
            <div role="status" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <Hourglass className="h-4 w-4 shrink-0" />
              {t('billing.pendingText', {
                date: fmtDateTime(pending.createdAt),
                plan: t(`company.planName.${pending.plan}`),
                periods: pending.periods,
              })}
            </div>
          )}
          <div role="radiogroup" aria-label={t('billing.plan')} className="grid gap-4 md:grid-cols-2">
            {company.tariffs.map((tf) => (
              <PlanCard
                key={tf.code}
                tariff={tf}
                company={company}
                pending={!!pending}
                selected={selected === tf.code}
                onSelect={() => setSelected(tf.code)}
                onBuy={() => {
                  setSelected(tf.code);
                  setPayPlan(tf.code);
                }}
              />
            ))}
          </div>
          <ExpiredNotice company={company} text={t('billing.expiredModalText', { lockDate })} />
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-brand-500" /> {t('billing.allFeatures')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Receipt className="h-3.5 w-3.5 text-brand-500" /> {t('billing.receiptFlow')}
            </span>
            <Link to="/settings?tab=billing" onClick={closeTariffModal} className="font-medium text-brand-600 underline underline-offset-2 dark:text-brand-400">
              {t('billing.history')}
            </Link>
          </div>
        </div>
      </QueryState>
    </Dialog>
  );
}

function StaffTariffModal({ company }: { company: Company }) {
  const { t } = useTranslation();
  return (
    <Dialog
      open
      onClose={closeTariffModal}
      title={t('billing.expiredStaffTitle')}
      footer={<Button onClick={closeTariffModal}>{t('common.close')}</Button>}
    >
      <ExpiredNotice company={company} text={t('billing.askLeader', { lockDate: company.lockAt ? fmtDate(company.lockAt) : '—' })} />
    </Dialog>
  );
}
