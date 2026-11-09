import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, KeyRound, LogOut, Plus, Wallet } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Empty, QueryState } from '@/components/ui/states';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { Plan, Tariff } from '@/lib/company';
import { errorText } from '@/lib/errors';
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

interface PCompany {
  id: number;
  name: string;
  status: 'ACTIVE' | 'BLOCKED';
  plan: Plan | null;
  paidUntil: string | null;
  daysLeft: number | null;
  expired: boolean;
  contactPhone: string | null;
  note: string | null;
  usersCount: number;
  clientsCount: number;
  leaderLogin: string | null;
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

const fmtMoney = (n: number) => new Intl.NumberFormat('ru-RU').format(n);

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
    onError: (e) => toast.error(errorText(e, t)),
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
  const companies = useQuery({ queryKey: ['platform', 'companies'], queryFn: () => papi<PCompany[]>('GET', '/companies') });
  const s = search.trim().toLowerCase();
  const rows = (companies.data ?? []).filter((c) => !s || c.name.toLowerCase().includes(s) || (c.leaderLogin ?? '').toLowerCase().includes(s));

  return (
    <div className="min-h-screen bg-page">
      <header className="flex h-14 items-center gap-3 border-b border-gray-200 bg-white px-4 dark:bg-page">
        <Logo className="h-7" textClassName="text-base" />
        <span className="hidden text-sm font-medium text-gray-500 sm:inline">{t('platform.title')}</span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onLogout}>
          <LogOut className="h-4 w-4" /> {t('platform.logout')}
        </Button>
      </header>
      <main className="mx-auto max-w-7xl space-y-3 p-2 sm:p-4">
        <TariffsCard />
        <Card>
          <CardHeader
            title={`${t('platform.companies')} (${companies.data?.length ?? 0})`}
            actions={
              <>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('platform.search')} className="h-8 w-48" />
                <Button size="sm" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> {t('platform.newCompany')}
                </Button>
              </>
            }
          />
          <QueryState q={companies}>
            {!rows.length ? (
              <Empty />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="table-head">
                    <tr>
                      <th className="px-4 py-2.5">{t('platform.name')}</th>
                      <th className="px-4 py-2.5">{t('platform.leader')}</th>
                      <th className="px-4 py-2.5">{t('platform.status')}</th>
                      <th className="px-4 py-2.5">{t('platform.plan')}</th>
                      <th className="px-4 py-2.5">{t('platform.paidUntil')}</th>
                      <th className="px-4 py-2.5 text-right">{t('platform.users')}</th>
                      <th className="px-4 py-2.5 text-right">{t('platform.clients')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.id} onClick={() => setOpenId(c.id)} className="cursor-pointer border-t border-gray-200 transition-colors hover:bg-gray-100">
                        <td className="px-4 py-2.5 font-medium">{c.name}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{c.leaderLogin ?? '—'}</td>
                        <td className="px-4 py-2.5">
                          <StatusBadge c={c} />
                        </td>
                        <td className="px-4 py-2.5">{c.plan ? t(`company.planName.${c.plan}`) : '—'}</td>
                        <td className="px-4 py-2.5">
                          {c.paidUntil ? fmtDate(c.paidUntil) : t('company.unlimited')}
                          {c.daysLeft !== null && c.daysLeft >= 0 && <span className="ml-1 text-xs text-gray-500">({t('platform.days', { count: c.daysLeft })})</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right">{c.usersCount}</td>
                        <td className="px-4 py-2.5 text-right">{c.clientsCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </QueryState>
        </Card>
      </main>
      <CreateCompanyDialog open={creating} onClose={() => setCreating(false)} />
      {openId !== null && <CompanyDialog id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function StatusBadge({ c }: { c: Pick<PCompany, 'status' | 'expired'> }) {
  const { t } = useTranslation();
  const [cls, label] =
    c.status === 'BLOCKED'
      ? ['border-gray-300 text-gray-600', t('platform.blocked')]
      : c.expired
        ? ['border-red-300 text-red-700 dark:text-red-300', t('platform.expired')]
        : ['border-green-300 text-green-700 dark:text-green-400', t('platform.active')];
  return <span className={cn('inline-block rounded-full border px-2 py-0.5 text-xs font-medium', cls)}>{label}</span>;
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
    onError: (e) => toast.error(errorText(e, t)),
  });
  return (
    <Card>
      <CardHeader title={t('platform.tariffs')} />
      <QueryState q={q}>
        <div className="flex flex-wrap gap-4 px-4 pb-4">
          {q.data?.map((tf) => {
            const v = draft[tf.code] ?? String(tf.price);
            return (
              <Field key={tf.code} label={`${t(`company.planName.${tf.code}`)} — ${t('platform.price')}`}>
                <div className="flex gap-2">
                  <Input inputMode="numeric" className="w-40" value={v} onChange={(e) => setDraft({ ...draft, [tf.code]: e.target.value.replace(/\D/g, '') })} />
                  <Button variant="outline" onClick={() => save.mutate(tf)} disabled={v === String(tf.price) || v === '' || save.isPending}>
                    {t('common.save')}
                  </Button>
                </div>
              </Field>
            );
          })}
        </div>
      </QueryState>
    </Card>
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
    onError: (e) => toast.error(errorText(e, t)),
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
  const [pwd, setPwd] = useState('');
  const [confirmBlock, setConfirmBlock] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['platform', 'company', id] });
    void qc.invalidateQueries({ queryKey: ['platform', 'companies'] });
  };
  const onErr = (e: unknown) => toast.error(errorText(e, t));
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
  const resetPwd = useMutation({
    mutationFn: () => papi('POST', `/companies/${id}/leader-password`, { login: q.data!.leaderLogin, password: pwd }),
    onSuccess: () => {
      toast.success(t('platform.passwordReset'));
      setPwd('');
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
              <StatusBadge c={c} />
              <span>
                {c.plan ? t(`company.planName.${c.plan}`) : '—'} · {c.paidUntil ? fmtDate(c.paidUntil) : t('company.unlimited')}
              </span>
              {c.contactPhone && <span className="text-gray-500">{c.contactPhone}</span>}
              <div className="flex-1" />
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

            <section className="rounded-md border border-gray-200 p-3">
              <h3 className="mb-2 flex items-center gap-2 font-medium"><Wallet className="h-4 w-4" /> {t('platform.addPayment')}</h3>
              <div className="grid gap-2 sm:grid-cols-4">
                <Field label={t('platform.plan')}><Select value={pay.plan} options={PLAN_OPTIONS(t)} onChange={(v) => setPay({ ...pay, plan: v as Plan })} /></Field>
                <Field label={t('platform.periods')}><Input inputMode="numeric" value={pay.periods} onChange={(e) => setPay({ ...pay, periods: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></Field>
                <Field label={t('platform.amount')}><Input inputMode="numeric" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value.replace(/\D/g, '') })} /></Field>
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

            {c.leaderLogin && (
              <section className="rounded-md border border-gray-200 p-3">
                <h3 className="mb-2 flex items-center gap-2 font-medium"><KeyRound className="h-4 w-4" /> {t('platform.resetLeaderPassword')} <span className="font-mono text-xs text-gray-500">({c.leaderLogin})</span></h3>
                <div className="flex gap-2">
                  <Input value={pwd} inputMode="numeric" autoComplete="new-password" placeholder={t('platform.newPassword')} onChange={(e) => setPwd(e.target.value.replace(/\D/g, '').slice(0, 12))} />
                  <Button variant="outline" onClick={() => resetPwd.mutate()} loading={resetPwd.isPending} disabled={pwd.length < 6}>
                    {t('common.save')}
                  </Button>
                </div>
              </section>
            )}
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
    </Dialog>
  );
}
