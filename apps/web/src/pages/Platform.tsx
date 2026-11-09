import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Ban, Building2, CalendarX2, Check, CheckCircle2, ChevronRight, CreditCard, KeyRound, LogOut, Plus, Receipt, Search, Tag, Wallet, X, ZoomIn } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PaymentCardVisual, ReceiptViewer, RequestStatusBadge, useBlobUrl } from '@/components/BillingSettings';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, Stat } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, NumberInput, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Empty, QueryState } from '@/components/ui/states';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtMoney, type PaymentInfo, type PaymentRequestStatus, type Plan, type Tariff } from '@/lib/company';
import { showError } from '@/lib/errors';
import { fmtDate, fmtDateTime } from '@/lib/time';

// Platforma (SaaS egasi) paneli: /platform. Kompaniya xodimlari sessiyasidan alohida: o'z tokeni
// (sessionStorage — brauzer yopilsa chiqadi, refresh yo'q, 8 soat), o'z API'si (/api/platform).

const TOKEN_KEY = 'platform-token';
const getToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const setToken = (t: string | null) => {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* saqlab bo'lmasa — faqat shu sahifa hayoti */
  }
};

let onLost: (() => void) | null = null;
async function papi<T>(method: string, url: string, body?: unknown): Promise<T> {
  const token = getToken();
  const r = await fetch(`/api/platform${url}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && url !== '/auth/login') {
    setToken(null);
    onLost?.();
  }
  if (!r.ok) throw new ApiError(r.status, data.code ?? `HTTP_${r.status}`, data.message ?? r.statusText, data.details);
  return data as T;
}

/** Chek rasmi (Authorization sarlavhasi bilan) */
async function pblob(url: string): Promise<Blob> {
  const token = getToken();
  const r = await fetch(`/api/platform${url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new ApiError(r.status, `HTTP_${r.status}`, r.statusText);
  return r.blob();
}

interface PRequest {
  id: number;
  companyId: number;
  companyName: string;
  plan: Plan;
  periods: number;
  amount: number;
  note: string | null;
  status: PaymentRequestStatus;
  rejectReason: string | null;
  createdAt: string;
  createdByName: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  paidUntil: string | null;
}

interface PCompany {
  id: number;
  name: string;
  status: 'ACTIVE' | 'BLOCKED';
  plan: Plan | null;
  paidUntil: string | null;
  daysLeft: number | null;
  expired: boolean;
  /** Imtiyozli davr ham o'tgan yoki admin darhol yopgan: kompaniya yopiq */
  locked: boolean;
  contactPhone: string | null;
  note: string | null;
  usersCount: number;
  clientsCount: number;
  leaderLogin: string | null;
  hasPendingRequest: boolean;
  createdAt: string;
}
interface Payment {
  id: number;
  plan: Plan;
  periods: number;
  amount: number;
  paidFrom: string;
  paidUntil: string;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
}

export default function Platform() {
  const [token, setTok] = useState(getToken());
  onLost = () => setTok(null);
  if (!token) return <PlatformLogin onLogin={(t) => (setToken(t), setTok(t))} />;
  return <PlatformHome onLogout={() => (setToken(null), setTok(null))} />;
}

function PlatformLogin({ onLogin }: { onLogin: (token: string) => void }) {
  const { t } = useTranslation();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const m = useMutation({
    mutationFn: () => papi<{ accessToken: string }>('POST', '/auth/login', { login, password }),
    onSuccess: (d) => onLogin(d.accessToken),
    onError: (e) => showError(e, t),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <form onSubmit={submit} className="section-container w-full max-w-sm space-y-4 p-6">
        <div className="flex justify-center"><Logo className="h-10" textClassName="text-xl" /></div>
        <h1 className="text-center text-lg font-semibold">{t('platform.login')}</h1>
        <Field label={t('login.login')} htmlFor="p-login">
          <Input id="p-login" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} autoFocus />
        </Field>
        <Field label={t('login.password')} htmlFor="p-password">
          <Input id="p-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button type="submit" className="w-full" loading={m.isPending} disabled={!login || !password}>
          {t('login.submit')}
        </Button>
      </form>
    </div>
  );
}

function PlatformHome({ onLogout }: { onLogout: () => void }) {
  const { t } = useTranslation();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CompanyFilter>('ALL');
  const companies = useQuery({ queryKey: ['platform', 'companies'], queryFn: () => papi<PCompany[]>('GET', '/companies') });
  const all = companies.data ?? [];
  const s = search.trim().toLowerCase();
  const rows = all
    .filter((c) => !s || c.name.toLowerCase().includes(s) || (c.leaderLogin ?? '').toLowerCase().includes(s))
    .filter((c) => filter === 'ALL' || companyState(c) === filter || (filter === 'PENDING' && c.hasPendingRequest));
  const count = (f: CompanyFilter) => all.filter((c) => (f === 'PENDING' ? c.hasPendingRequest : companyState(c) === f)).length;

  return (
    <div className="min-h-screen bg-page">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-4 dark:bg-page">
        <Logo className="h-7" textClassName="text-base" />
        <span className="hidden rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 sm:inline dark:bg-brand-950/50 dark:text-brand-300">
          {t('platform.title')}
        </span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onLogout}>
          <LogOut className="h-4 w-4" /> {t('platform.logout')}
        </Button>
      </header>
      <main className="mx-auto max-w-7xl space-y-3 p-2 sm:p-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label={t('platform.statTotal')} value={all.length} icon={Building2} />
          <Stat label={t('platform.statActive')} value={count('ACTIVE')} icon={CheckCircle2} iconTone="done" />
          <Stat label={t('platform.statExpired')} value={count('EXPIRED') + count('BLOCKED')} icon={AlertTriangle} iconTone="overdue" hint={t('platform.statExpiringSoon', { count: count('SOON') })} />
          <Stat label={t('platform.statPending')} value={count('PENDING')} icon={Receipt} iconTone="soon" tone={count('PENDING') ? 'soon' : undefined} />
        </div>
        <PaymentRequestsCard />
        <Card>
          <CardHeader
            title={<span className="flex items-center gap-2"><Building2 className="h-5 w-5 text-brand-500" /> {t('platform.companies')}</span>}
            actions={
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('platform.search')} className="h-8 w-52 pl-8" />
                </div>
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> {t('platform.newCompany')}
                </Button>
              </>
            }
          />
          <div className="flex flex-wrap gap-2 px-4 pb-3">
            {COMPANY_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors',
                  filter === f ? 'border-brand-500 bg-brand-500 text-on-brand' : 'border-gray-200 text-gray-600 hover:border-brand-300',
                )}
              >
                {t(`platform.filter.${f}`)}
                <span className={cn('rounded-full px-1.5 text-xs tabular-nums', filter === f ? 'bg-white/25' : 'bg-gray-100')}>
                  {f === 'ALL' ? all.length : count(f)}
                </span>
              </button>
            ))}
          </div>
          <QueryState q={companies}>
            {!rows.length ? (
              <Empty />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="table-head">
                    <tr>
                      <th className="px-4 py-2.5">{t('platform.name')}</th>
                      <th className="px-4 py-2.5">{t('platform.status')}</th>
                      <th className="px-4 py-2.5">{t('platform.plan')}</th>
                      <th className="px-4 py-2.5">{t('platform.paidUntil')}</th>
                      <th className="px-4 py-2.5 text-right">{t('platform.users')}</th>
                      <th className="px-4 py-2.5 text-right">{t('platform.clients')}</th>
                      <th className="w-8 px-2 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id} onClick={() => setOpenId(c.id)} className="group cursor-pointer border-t border-gray-200 transition-colors hover:bg-brand-50/50 dark:hover:bg-brand-950/30">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <Avatar name={c.name} />
                            <div className="min-w-0">
                              <div className="truncate font-medium text-ink">{c.name}</div>
                              <div className="truncate font-mono text-xs text-gray-500">{c.leaderLogin ?? '—'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap items-center gap-1">
                            <StatusBadge c={c} />
                            {c.hasPendingRequest && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                                <Receipt className="h-3 w-3" /> {t('platform.pendingBadge')}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">{c.plan ? t(`company.planName.${c.plan}`) : '—'}</td>
                        <td className="px-4 py-2.5">
                          <div>{c.paidUntil ? fmtDate(c.paidUntil) : t('company.unlimited')}</div>
                          {c.daysLeft !== null && c.daysLeft >= 0 && (
                            <div className={cn('text-xs font-medium', c.daysLeft < 7 ? 'text-amber-700' : 'text-gray-500')}>{t('platform.days', { count: c.daysLeft })}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{c.usersCount}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{c.clientsCount}</td>
                        <td className="px-2 py-2.5 text-gray-400 group-hover:text-brand-500">
                          <ChevronRight className="h-4 w-4" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryState>
        </Card>
        <div className="grid gap-3 lg:grid-cols-2">
          <PaymentInfoCard />
          <TariffsCard />
        </div>
      </main>
      <CreateCompanyDialog open={creating} onClose={() => setCreating(false)} />
      {openId !== null && <CompanyDialog id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

type CompanyFilter = 'ALL' | 'ACTIVE' | 'SOON' | 'EXPIRED' | 'BLOCKED' | 'PENDING';
/** Karta raqami: faqat raqamlar (≤19), 4 tadan guruh — 8600 1234 5678 9012 */
const fmtCardDigits = (raw: string) => raw.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ');

const COMPANY_FILTERS: CompanyFilter[] = ['ALL', 'ACTIVE', 'SOON', 'EXPIRED', 'BLOCKED', 'PENDING'];
/** SOON: faol, lekin 7 kundan kam qolgan (rahbar sariq banner ko'radigan holat, 6.13) */
const companyState = (c: Pick<PCompany, 'status' | 'expired' | 'daysLeft'>): Exclude<CompanyFilter, 'ALL' | 'PENDING'> =>
  c.status === 'BLOCKED' ? 'BLOCKED' : c.expired ? 'EXPIRED' : c.daysLeft !== null && c.daysLeft < 7 ? 'SOON' : 'ACTIVE';

function Avatar({ name }: { name: string }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-sm font-bold uppercase text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
      {name.trim().charAt(0) || '?'}
    </span>
  );
}

function StatusBadge({ c }: { c: Pick<PCompany, 'status' | 'expired' | 'locked' | 'daysLeft'> }) {
  const { t } = useTranslation();
  const st = companyState(c);
  const [cls, dot] = {
    BLOCKED: ['border-gray-300 bg-gray-50 text-gray-600', 'bg-gray-400'],
    EXPIRED: ['border-red-300 bg-red-50 text-red-700', 'bg-red-500'],
    SOON: ['border-amber-300 bg-amber-50 text-amber-700', 'bg-amber-500'],
    ACTIVE: ['border-green-300 bg-green-50 text-green-700', 'bg-green-500'],
  }[st];
  const label = { BLOCKED: t('platform.blocked'), EXPIRED: t(c.locked ? 'platform.locked' : 'platform.expired'), SOON: t('platform.filter.SOON'), ACTIVE: t('platform.active') }[st];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium', cls)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} aria-hidden />
      {label}
    </span>
  );
}

function TariffsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform', 'tariffs'], queryFn: () => papi<Tariff[]>('GET', '/tariffs') });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (tf: Tariff) => papi('PUT', `/tariffs/${tf.code}`, { price: Number(draft[tf.code]) }),
    onSuccess: () => {
      toast.success(t('common.saved'));
      setDraft({});
      void qc.invalidateQueries({ queryKey: ['platform', 'tariffs'] });
    },
    onError: (e) => showError(e, t),
  });
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Tag className="h-5 w-5 text-brand-500" /> {t('platform.tariffs')}</span>} />
      <QueryState q={q}>
        <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
          {q.data?.map((tf) => {
            const v = draft[tf.code] ?? String(tf.price);
            const changed = v !== String(tf.price) && v !== '';
            return (
              <div key={tf.code} className="rounded-xl border border-gray-200 p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-semibold text-foreground">{t(`company.planName.${tf.code}`)}</p>
                  <span className="text-xs text-gray-500">{t('billing.planMonths', { count: tf.months })}</span>
                </div>
                <p className="mt-1 text-2xl font-bold tabular-nums text-ink">
                  {tf.price ? fmtMoney(tf.price) : '—'} <span className="text-sm font-normal text-gray-500">{t('company.sum')}</span>
                </p>
                {!tf.price && <p className="text-xs text-amber-700">{t('platform.priceNotSet')}</p>}
                <div className="mt-3 flex gap-2">
                  <NumberInput
                    aria-label={`${t(`company.planName.${tf.code}`)} — ${t('platform.price')}`}
                    placeholder={t('platform.price')}
                    value={v}
                    onChange={(d) => setDraft({ ...draft, [tf.code]: d })}
                  />
                  <Button variant={changed ? 'default' : 'outline'} onClick={() => save.mutate(tf)} disabled={!changed || save.isPending}>
                    {t('common.save')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </QueryState>
    </Card>
  );
}

function PaymentInfoCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform', 'payment-info'], queryFn: () => papi<PaymentInfo>('GET', '/payment-info') });
  const [draft, setDraft] = useState<PaymentInfo | null>(null);
  const v = draft ?? q.data;
  const set = (p: Partial<PaymentInfo>) => v && setDraft({ ...v, ...p });
  const save = useMutation({
    mutationFn: () => papi<PaymentInfo>('PUT', '/payment-info', v),
    onSuccess: (d) => {
      toast.success(t('common.saved'));
      qc.setQueryData(['platform', 'payment-info'], d);
      setDraft(null);
    },
    onError: (e) => showError(e, t),
  });
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-brand-500" /> {t('platform.paymentInfo')}</span>} />
      <QueryState q={q}>
        {v && (
          <div className="space-y-4 px-4 pb-4">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">{t('platform.preview')}</p>
              <PaymentCardVisual info={v} preview />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('platform.cardNumber')}>
                <Input
                  value={v.cardNumber}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="8600 0000 0000 0000"
                  onChange={(e) => {
                    let raw = e.target.value;
                    // Backspace faqat bo'shliqni o'chirgan bo'lsa, undan oldingi raqam o'chiriladi
                    if (raw.length < v.cardNumber.length && raw.replace(/\D/g, '') === v.cardNumber.replace(/\D/g, '')) {
                      const caret = e.target.selectionStart ?? raw.length;
                      const i = raw.slice(0, caret).search(/\d(?=\D*$)/);
                      if (i >= 0) raw = raw.slice(0, i) + raw.slice(i + 1);
                    }
                    set({ cardNumber: fmtCardDigits(raw) });
                  }}
                />
              </Field>
              <Field label={t('platform.cardHolder')}><Input value={v.cardHolder} maxLength={120} onChange={(e) => set({ cardHolder: e.target.value })} /></Field>
              <Field label={t('platform.bank')}><Input value={v.bank} maxLength={120} placeholder="Uzcard / Humo" onChange={(e) => set({ bank: e.target.value })} /></Field>
              <Field label={t('platform.payContact')}><Input value={v.contact} maxLength={200} onChange={(e) => set({ contact: e.target.value })} /></Field>
            </div>
            <Field label={t('platform.payNote')}><Textarea rows={2} value={v.note} maxLength={1000} onChange={(e) => set({ note: e.target.value })} /></Field>
            <div className="flex items-center justify-end gap-2">
              {draft && (
                <Button variant="ghost" onClick={() => setDraft(null)}>{t('common.cancel')}</Button>
              )}
              <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!draft}>{t('common.save')}</Button>
            </div>
          </div>
        )}
      </QueryState>
    </Card>
  );
}

function PaymentRequestsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  const q = useQuery({
    queryKey: ['platform', 'payment-requests', all],
    queryFn: () => papi<PRequest[]>('GET', `/payment-requests?status=${all ? 'ALL' : 'PENDING'}`),
    refetchInterval: 60_000,
  });
  const [viewId, setViewId] = useState<number | null>(null);
  const [approving, setApproving] = useState<PRequest | null>(null);
  const [rejecting, setRejecting] = useState<PRequest | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const done = (msg: string) => {
    toast.success(msg);
    setApproving(null);
    setRejecting(null);
    void qc.invalidateQueries({ queryKey: ['platform'] });
  };
  const onErr = (e: unknown) => showError(e, t);
  const approve = useMutation({
    mutationFn: (r: PRequest) => papi('POST', `/payment-requests/${r.id}/approve`, { amount: Number(amount || 0) }),
    onSuccess: () => done(t('platform.approved')),
    onError: onErr,
  });
  const reject = useMutation({
    mutationFn: (r: PRequest) => papi('POST', `/payment-requests/${r.id}/reject`, { reason }),
    onSuccess: () => done(t('platform.rejected')),
    onError: onErr,
  });
  const rows = q.data ?? [];
  const pendingCount = rows.filter((r) => r.status === 'PENDING').length;
  const amountDiff = approving ? Number(amount || 0) - approving.amount : 0;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-brand-500" /> {t('platform.requests')}
            {pendingCount > 0 && (
              <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold tabular-nums text-on-brand">{pendingCount}</span>
            )}
          </span>
        }
        actions={
          <div className="flex rounded-full border border-gray-200 p-0.5 text-sm">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                type="button"
                onClick={() => setAll(v)}
                className={cn('h-7 rounded-full px-3 font-medium transition-colors', all === v ? 'bg-brand-500 text-on-brand' : 'text-gray-600 hover:text-brand-700')}
              >
                {v ? t('platform.showAll') : t('platform.showPending')}
              </button>
            ))}
          </div>
        }
      />
      <QueryState q={q}>
        {!rows.length ? (
          <div className="mx-4 mb-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-gray-300 py-8 text-center text-gray-500">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
            <p>{t('platform.noRequests')}</p>
          </div>
        ) : (
          <div className="grid gap-3 px-4 pb-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <RequestCard
                key={r.id}
                r={r}
                onView={() => setViewId(r.id)}
                onApprove={() => (setAmount(String(r.amount)), setApproving(r))}
                onReject={() => (setReason(''), setRejecting(r))}
              />
            ))}
          </div>
        )}
      </QueryState>
      {viewId !== null && <ReceiptViewer load={() => pblob(`/payment-requests/${viewId}/screenshot`)} onClose={() => setViewId(null)} />}
      {approving && (
        <Dialog
          open
          onClose={() => setApproving(null)}
          title={`${t('platform.approve')}: ${approving.companyName}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setApproving(null)}>{t('common.cancel')}</Button>
              <Button variant="success" onClick={() => approve.mutate(approving)} loading={approve.isPending}>
                <Check className="h-4 w-4" /> {t('platform.approve')}
              </Button>
            </>
          }
        >
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3">
              <div>
                <dt className="text-xs text-gray-500">{t('platform.plan')}</dt>
                <dd className="font-semibold">{t(`company.planName.${approving.plan}`)} × {approving.periods}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">{t('platform.expectedAmount')}</dt>
                <dd className="font-semibold tabular-nums">{fmtMoney(approving.amount)} {t('company.sum')}</dd>
              </div>
            </dl>
            <Field label={t('platform.paidAmount')}>
              <NumberInput value={amount} onChange={setAmount} autoFocus />
            </Field>
            {amount !== '' && amountDiff !== 0 && (
              <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {t('platform.amountDiff', { diff: `${amountDiff > 0 ? '+' : '−'}${fmtMoney(Math.abs(amountDiff))}` })}
              </p>
            )}
            <p className="text-gray-500">{t('platform.approveHint')}</p>
          </div>
        </Dialog>
      )}
      {rejecting && (
        <Dialog
          open
          onClose={() => setRejecting(null)}
          title={`${t('platform.reject')}: ${rejecting.companyName}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRejecting(null)}>{t('common.cancel')}</Button>
              <Button variant="danger" onClick={() => reject.mutate(rejecting)} loading={reject.isPending} disabled={!reason.trim()}>
                <X className="h-4 w-4" /> {t('platform.reject')}
              </Button>
            </>
          }
        >
          <Field label={t('platform.rejectReason')} hint={t('platform.rejectHint')}>
            <Textarea rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
        </Dialog>
      )}
    </Card>
  );
}

/** Bitta chek: kichik rasm (bosilsa kattalashadi), kompaniya, summa, yuboruvchi va amallar */
function RequestCard({ r, onView, onApprove, onReject }: { r: PRequest; onView: () => void; onApprove: () => void; onReject: () => void }) {
  const { t } = useTranslation();
  const pending = r.status === 'PENDING';
  return (
    <div className={cn('flex flex-col rounded-xl border bg-white p-3', pending ? 'border-amber-300 shadow-sm' : 'border-gray-200')}>
      <div className="flex gap-3">
        <ReceiptThumb id={r.id} onClick={onView} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-semibold text-ink" title={r.companyName}>{r.companyName}</p>
            <RequestStatusBadge status={r.status} />
          </div>
          <p className="mt-1 text-xl font-bold tabular-nums text-ink">
            {fmtMoney(r.amount)} <span className="text-xs font-normal text-gray-500">{t('company.sum')}</span>
          </p>
          <p className="text-xs text-gray-500">
            {t(`company.planName.${r.plan}`)} × {r.periods}
          </p>
        </div>
      </div>
      <dl className="mt-3 space-y-1 border-t border-gray-200 pt-2 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">{t('platform.sentBy')}</dt>
          <dd className="truncate text-right">{r.createdByName ?? '—'} · {fmtDateTime(r.createdAt)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500">{t('platform.currentUntil')}</dt>
          <dd>{r.paidUntil ? fmtDate(r.paidUntil) : t('company.unlimited')}</dd>
        </div>
        {r.reviewedByName && (
          <div className="flex justify-between gap-2">
            <dt className="text-gray-500">{t('platform.reviewedBy')}</dt>
            <dd className="truncate text-right">{r.reviewedByName}{r.reviewedAt ? ` · ${fmtDateTime(r.reviewedAt)}` : ''}</dd>
          </div>
        )}
      </dl>
      {r.note && <p className="mt-2 rounded-md bg-gray-50 px-2 py-1.5 text-xs text-gray-600">“{r.note}”</p>}
      {r.rejectReason && <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-700">{r.rejectReason}</p>}
      {pending && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button size="sm" variant="success" onClick={onApprove}>
            <Check className="h-4 w-4" /> {t('platform.approve')}
          </Button>
          <Button size="sm" variant="outline" onClick={onReject} className="text-red-600">
            <X className="h-4 w-4" /> {t('platform.reject')}
          </Button>
        </div>
      )}
    </div>
  );
}

function ReceiptThumb({ id, onClick }: { id: number; onClick: () => void }) {
  const { t } = useTranslation();
  const { src, failed } = useBlobUrl(() => pblob(`/payment-requests/${id}/screenshot`));
  return (
    <button
      type="button"
      onClick={onClick}
      title={t('billing.viewReceipt')}
      aria-label={t('billing.viewReceipt')}
      className="group relative flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : failed ? <Receipt className="h-5 w-5 text-gray-400" /> : <span className="h-full w-full animate-pulse bg-gray-100" />}
      <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-on-brand opacity-0 transition-opacity group-hover:opacity-100">
        <ZoomIn className="h-5 w-5" />
      </span>
    </button>
  );
}

const PLAN_OPTIONS = (t: (k: string) => string) => [
  { value: 'MONTHLY', label: t('company.planName.MONTHLY') },
  { value: 'YEARLY', label: t('company.planName.YEARLY') },
];

function CreateCompanyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const blank = { name: '', plan: 'MONTHLY' as Plan, paidUntil: '', contactPhone: '', leaderName: '', leaderLogin: '', leaderPassword: '' };
  const [f, setF] = useState(blank);
  const set = (p: Partial<typeof blank>) => setF({ ...f, ...p });
  const m = useMutation({
    mutationFn: () =>
      papi('POST', '/companies', {
        name: f.name,
        plan: f.plan,
        paidUntil: f.paidUntil || null,
        contactPhone: f.contactPhone || null,
        leader: { fullName: f.leaderName, login: f.leaderLogin, password: f.leaderPassword },
      }),
    onSuccess: () => {
      toast.success(t('platform.created'));
      setF(blank);
      onClose();
      void qc.invalidateQueries({ queryKey: ['platform', 'companies'] });
    },
    onError: (e) => showError(e, t),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('platform.newCompany')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => m.mutate()} loading={m.isPending} disabled={!f.name || !f.leaderName || !f.leaderLogin || !f.leaderPassword}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('platform.name')}><Input value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
        <Field label={t('platform.contactPhone')}><Input value={f.contactPhone} onChange={(e) => set({ contactPhone: e.target.value })} /></Field>
        <Field label={t('platform.plan')}><Select value={f.plan} options={PLAN_OPTIONS(t)} onChange={(v) => set({ plan: v as Plan })} /></Field>
        <Field label={t('platform.paidUntil')} hint={t('platform.paidUntilHint')}><DatePicker value={f.paidUntil} onChange={(v) => set({ paidUntil: v })} /></Field>
        <Field label={t('platform.leaderName')}><Input value={f.leaderName} onChange={(e) => set({ leaderName: e.target.value })} /></Field>
        <Field label={t('platform.leaderLogin')}><Input value={f.leaderLogin} autoComplete="off" onChange={(e) => set({ leaderLogin: e.target.value.trim() })} /></Field>
        <Field label={t('platform.leaderPassword')}>
          <Input value={f.leaderPassword} inputMode="numeric" autoComplete="new-password" onChange={(e) => set({ leaderPassword: e.target.value.replace(/\D/g, '').slice(0, 12) })} />
        </Field>
      </div>
    </Dialog>
  );
}

function CompanyDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['platform', 'company', id], queryFn: () => papi<PCompany & { payments: Payment[] }>('GET', `/companies/${id}`) });
  const [pay, setPay] = useState({ plan: 'MONTHLY' as Plan, periods: '1', amount: '', note: '' });
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['platform', 'company', id] });
    void qc.invalidateQueries({ queryKey: ['platform', 'companies'] });
  };
  const onErr = (e: unknown) => showError(e, t);
  const addPayment = useMutation({
    mutationFn: () => papi('POST', `/companies/${id}/payments`, { plan: pay.plan, periods: Number(pay.periods), amount: Number(pay.amount || 0), note: pay.note || null }),
    onSuccess: () => {
      toast.success(t('platform.paymentAdded'));
      setPay({ ...pay, amount: '', note: '' });
      refresh();
    },
    onError: onErr,
  });
  const setStatus = useMutation({
    mutationFn: (status: 'ACTIVE' | 'BLOCKED') => papi('PATCH', `/companies/${id}`, { status }),
    onSuccess: () => {
      setConfirmBlock(false);
      refresh();
    },
    onError: onErr,
  });
  const endTariff = useMutation({
    mutationFn: (immediate: boolean) => papi('POST', `/companies/${id}/end-tariff`, { immediate }),
    onSuccess: (_d, immediate) => {
      toast.success(t(immediate ? 'platform.endTariffDoneLocked' : 'platform.endTariffDone'));
      setEndOpen(false);
      refresh();
    },
    onError: onErr,
  });
  const c = q.data;
  return (
    <Dialog open onClose={onClose} title={c?.name ?? '…'} className="max-w-2xl">
      <QueryState q={q}>
        {c && (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <Avatar name={c.name} />
              <div className="min-w-0 flex-1">
                <StatusBadge c={c} />
                <p className="mt-1 text-gray-500">
                  {c.leaderLogin && <span className="font-mono">{c.leaderLogin}</span>}
                  {c.contactPhone && <span> · {c.contactPhone}</span>}
                </p>
              </div>
              {c.status === 'ACTIVE' && !c.locked && (
                <Button variant="outline" size="sm" onClick={() => setEndOpen(true)}>
                  <CalendarX2 className="h-4 w-4 text-amber-600" /> {t('platform.endTariff')}
                </Button>
              )}
              {c.status === 'ACTIVE' ? (
                <Button variant="outline" size="sm" onClick={() => setConfirmBlock(true)}>
                  <Ban className="h-4 w-4 text-red-600" /> {t('platform.block')}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setStatus.mutate('ACTIVE')} loading={setStatus.isPending}>
                  <CheckCircle2 className="h-4 w-4 text-green-600" /> {t('platform.unblock')}
                </Button>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                [t('platform.plan'), c.plan ? t(`company.planName.${c.plan}`) : '—'],
                [t('platform.paidUntil'), c.paidUntil ? fmtDate(c.paidUntil) : t('company.unlimited')],
                [t('platform.users'), c.usersCount],
                [t('platform.clients'), c.clientsCount],
              ].map(([k, v], i) => (
                <div key={i} className="rounded-lg bg-gray-50 px-3 py-2">
                  <dt className="text-xs text-gray-500">{k}</dt>
                  <dd className="font-semibold tabular-nums text-ink">{v}</dd>
                </div>
              ))}
            </dl>

            <section className="rounded-xl border border-brand-200 bg-brand-50/40 p-3 dark:border-brand-800 dark:bg-brand-950/20">
              <h3 className="mb-2 flex items-center gap-2 font-semibold"><Wallet className="h-4 w-4 text-brand-500" /> {t('platform.addPayment')}</h3>
              <div className="grid gap-2 sm:grid-cols-4">
                <Field label={t('platform.plan')}><Select value={pay.plan} options={PLAN_OPTIONS(t)} onChange={(v) => setPay({ ...pay, plan: v as Plan })} /></Field>
                <Field label={t('platform.periods')}><Input inputMode="numeric" value={pay.periods} onChange={(e) => setPay({ ...pay, periods: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></Field>
                <Field label={t('platform.amount')}><NumberInput value={pay.amount} onChange={(d) => setPay({ ...pay, amount: d })} /></Field>
                <Field label={t('platform.note')}><Input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></Field>
              </div>
              <div className="mt-2 flex justify-end">
                <Button size="sm" onClick={() => addPayment.mutate()} loading={addPayment.isPending} disabled={!Number(pay.periods)}>
                  {t('platform.addPayment')}
                </Button>
              </div>
            </section>

            <section>
              <h3 className="mb-2 font-medium">{t('platform.payments')}</h3>
              {!c.payments.length ? (
                <p className="text-gray-500">{t('platform.noPayments')}</p>
              ) : (
                <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
                  {c.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                      <span className="font-medium">{t(`company.planName.${p.plan}`)} × {p.periods}</span>
                      <span>{fmtDate(p.paidFrom)} → {fmtDate(p.paidUntil)}</span>
                      <span className="font-medium">{fmtMoney(p.amount)} {t('company.sum')}</span>
                      {p.note && <span className="text-gray-500">{p.note}</span>}
                      <span className="ml-auto text-xs text-gray-500">{fmtDateTime(p.createdAt)}{p.createdByName ? ` · ${p.createdByName}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <LeadersSection companyId={id} onChanged={refresh} />
          </div>
        )}
      </QueryState>
      <ConfirmDialog
        open={confirmBlock}
        onClose={() => setConfirmBlock(false)}
        onConfirm={() => setStatus.mutate('BLOCKED')}
        text={t('platform.confirmBlock')}
        confirmLabel={t('platform.block')}
        loading={setStatus.isPending}
      />
      {endOpen && c && (
        <EndTariffDialog
          company={c}
          loading={endTariff.isPending}
          onClose={() => setEndOpen(false)}
          onConfirm={(immediate) => endTariff.mutate(immediate)}
        />
      )}
    </Dialog>
  );
}

interface PLeader {
  id: number;
  fullName: string;
  login: string;
  active: boolean;
  locked: boolean;
  createdAt: string;
}

/** Kompaniya rahbarlari: login/parolni tiklash yoki yangi rahbar ochish (faqat rahbar hisoblari) */
function LeadersSection({ companyId, onChanged }: { companyId: number; onChanged: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['platform', 'company', companyId, 'leaders'];
  const q = useQuery({ queryKey: key, queryFn: () => papi<PLeader[]>('GET', `/companies/${companyId}/leaders`) });
  // null — yopiq, 'new' — yangi rahbar, aks holda tahrirlanayotgan rahbar
  const [edit, setEdit] = useState<PLeader | 'new' | null>(null);
  return (
    <section className="rounded-xl border border-gray-200 p-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="flex flex-1 items-center gap-2 font-semibold"><KeyRound className="h-4 w-4 text-brand-500" /> {t('platform.leaders')}</h3>
        <Button variant="outline" size="sm" onClick={() => setEdit('new')}>
          <Plus className="h-4 w-4" /> {t('platform.newLeader')}
        </Button>
      </div>
      <QueryState q={q}>
        {!q.data?.length ? (
          <p className="text-gray-500">{t('platform.noLeaders')}</p>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-md border border-gray-200">
            {q.data.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="font-medium text-ink">{u.fullName}</span>
                <span className="font-mono text-xs text-gray-500">{u.login}</span>
                {!u.active && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{t('platform.inactive')}</span>}
                {u.locked && <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{t('platform.loginLocked')}</span>}
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEdit(u)}>
                  <KeyRound className="h-4 w-4" /> {t('platform.resetCredentials')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
      {edit && (
        <LeaderDialog
          companyId={companyId}
          leader={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            void qc.invalidateQueries({ queryKey: key });
            onChanged();
          }}
        />
      )}
    </section>
  );
}

function LeaderDialog({ companyId, leader, onClose, onSaved }: { companyId: number; leader: PLeader | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ fullName: leader?.fullName ?? '', login: leader?.login ?? '', password: '' });
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const m = useMutation({
    mutationFn: () =>
      leader
        ? papi('PATCH', `/companies/${companyId}/leaders/${leader.id}`, {
            fullName: f.fullName !== leader.fullName ? f.fullName : undefined,
            login: f.login !== leader.login ? f.login : undefined,
            password: f.password || undefined,
          })
        : papi('POST', `/companies/${companyId}/leaders`, f),
    onSuccess: () => {
      toast.success(t(leader ? 'platform.credentialsSaved' : 'platform.leaderCreated'));
      onSaved();
    },
    onError: (e) => showError(e, t),
  });
  const pwdOk = leader ? !f.password || f.password.length >= 6 : f.password.length >= 6;
  const valid = f.fullName.trim().length >= 2 && f.login.length >= 3 && pwdOk;
  return (
    <Dialog
      open
      onClose={onClose}
      title={leader ? t('platform.resetCredentials') : t('platform.newLeader')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => m.mutate()} loading={m.isPending} disabled={!valid}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label={t('platform.leaderName')}><Input value={f.fullName} onChange={(e) => set({ fullName: e.target.value })} /></Field>
        <Field label={t('platform.leaderLogin')}><Input value={f.login} autoComplete="off" onChange={(e) => set({ login: e.target.value.trim() })} /></Field>
        <Field label={leader ? t('platform.newPassword') : t('platform.leaderPassword')} hint={leader ? t('platform.keepPasswordHint') : undefined}>
          <Input value={f.password} inputMode="numeric" autoComplete="new-password" onChange={(e) => set({ password: e.target.value.replace(/\D/g, '').slice(0, 12) })} />
        </Field>
        {leader && <p className="text-xs text-gray-500">{t('platform.credentialsHint')}</p>}
      </div>
    </Dialog>
  );
}

/** Tarifni muddatidan oldin tugatish (V48): imtiyozli davr bilan yoki darhol yopish */
function EndTariffDialog({
  company,
  loading,
  onClose,
  onConfirm,
}: {
  company: PCompany;
  loading: boolean;
  onClose: () => void;
  onConfirm: (immediate: boolean) => void;
}) {
  const { t } = useTranslation();
  const [immediate, setImmediate] = useState(false);
  const options = [
    { value: false, title: t('platform.endTariffGrace'), hint: t('platform.endTariffGraceHint') },
    { value: true, title: t('platform.endTariffNow'), hint: t('platform.endTariffNowHint') },
  ];
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('platform.endTariffTitle', { name: company.name })}
      className="max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="danger" loading={loading} onClick={() => onConfirm(immediate)}>{t('platform.endTariff')}</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">{t('platform.endTariffText')}</p>
        <div role="radiogroup" className="space-y-2">
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={immediate === o.value}
              onClick={() => setImmediate(o.value)}
              className={cn(
                'flex w-full cursor-pointer items-start gap-3 rounded-lg border p-3 text-left transition-colors',
                immediate === o.value ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-950/30' : 'border-gray-200 hover:bg-gray-50',
              )}
            >
              <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', immediate === o.value ? 'border-brand-500' : 'border-gray-300')}>
                {immediate === o.value && <span className="h-2 w-2 rounded-full bg-brand-500" />}
              </span>
              <span>
                <span className="block font-medium text-ink">{o.title}</span>
                <span className="mt-0.5 block text-gray-500">{o.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
