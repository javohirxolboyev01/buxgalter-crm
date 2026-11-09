import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Card, PageHeader } from '@/components/ui/card';
import { DatePicker } from '@/components/ui/date-picker';
import { Field } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Empty, QueryState } from '@/components/ui/states';
import { TableSkeleton } from '@/components/ui/skeleton';
import { api, qs } from '@/lib/api';
import { fmtDateTime } from '@/lib/time';
import type { AuditItem, Client, Paged, User } from '@/lib/types';

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const USER_KEYS = new Set(['assigneeId', 'accountantId']);

/**
 * audit_log.before/after har amalda boshqa shaklda (holat, diff, to'liq qator, xulosa) —
 * xom JSON o'rniga "Maydon: qiymat" ro'yxati: nomlar va enumlar tarjima qilinadi, sana/xodim o'qiladigan ko'rinishda
 */
function AuditValue({ value, entity, users }: { value: unknown; entity: string; users: Map<number, string> }) {
  const { t } = useTranslation();
  const label = (k: string) => t(`auditField.${k}`, { defaultValue: k });
  const fmt = (key: string, v: unknown): string => {
    if (v == null || v === '') return '—';
    if (typeof v === 'boolean') return t(v ? 'common.yes' : 'common.no');
    if (Array.isArray(v)) return v.length ? v.map((x) => fmt(key, x)).join(', ') : '—';
    if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${label(k)}: ${fmt(k, x)}`).join(', ');
    if (USER_KEYS.has(key)) return users.get(Number(v)) ?? `#${v}`;
    const s = String(v);
    if (key === 'status') return t(`${entity === 'client' ? 'clientStatus' : 'taskStatus'}.${s}`, { defaultValue: s });
    if (key === 'kind') return t(`taskKind.${s}`, { defaultValue: s });
    if (key === 'role') return t(`roles.${s}`, { defaultValue: s });
    if (key === 'winner' || key === 'language') return t(`auditValue.${s}`, { defaultValue: s });
    if (ISO_DATETIME.test(s)) return fmtDateTime(s);
    // Sof sana vaqt zonasiz: brauzer zonasida siljimasin
    if (ISO_DATE.test(s)) return s.split('-').reverse().join('.');
    return s;
  };

  if (value == null) return <span className="text-gray-400">—</span>;
  if (typeof value !== 'object' || Array.isArray(value)) return <span className="text-xs">{fmt('', value)}</span>;
  const entries = Object.entries(value);
  if (!entries.length) return <span className="text-gray-400">—</span>;
  return (
    <dl className="space-y-0.5 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="break-words">
          <dt className="inline text-gray-500">{label(k)}: </dt>
          <dd className="inline text-gray-800">{fmt(k, v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function Audit() {
  const { t } = useTranslation();
  const [f, setF] = useState({ actorId: '', clientId: '', from: '', to: '', page: 1, pageSize: 50 });
  const set = (p: Partial<typeof f>) => setF({ ...f, page: 1, ...p });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') });
  const clients = useQuery({ queryKey: ['clients', 'all-short'], queryFn: () => api.get<Paged<Client>>('/clients?pageSize=500') });
  const q = useQuery({
    queryKey: ['audit', f],
    queryFn: () => api.get<Paged<AuditItem>>(`/audit${qs({ ...f, })}`),
    placeholderData: (p) => p,
  });
  const userNames = new Map(users.data?.map((u) => [u.id, u.fullName]) ?? []);

  return (
    <div className="page-fill">
      <PageHeader title={t('audit.title')} />
      <Card className="flex min-h-0 flex-1 flex-col">
        <div className="grid shrink-0 gap-3 border-b p-3 sm:grid-cols-4">
          <Field label={t('audit.actor')}>
            <Select value={f.actorId} onChange={(v) => set({ actorId: v })} placeholder={t('common.all')} clearable options={users.data?.map((u) => ({ value: String(u.id), label: u.fullName })) ?? []} />
          </Field>
          <Field label={t('audit.client')}>
            <Select value={f.clientId} onChange={(v) => set({ clientId: v })} placeholder={t('common.all')} clearable options={clients.data?.items.map((c) => ({ value: String(c.id), label: c.name })) ?? []} />
          </Field>
          <Field label={t('audit.from')}><DatePicker value={f.from} onChange={(v) => set({ from: v })} /></Field>
          <Field label={t('audit.to')}><DatePicker value={f.to} onChange={(v) => set({ to: v })} /></Field>
        </div>
        <QueryState q={q} skeleton={<TableSkeleton rows={10} cols={6} />}>
          {!q.data?.items?.length ? <Empty /> : (
            <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="table-head sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-2.5">{t('audit.at')}</th>
                    <th className="px-4 py-2.5">{t('audit.actor')}</th>
                    <th className="px-4 py-2.5">{t('audit.action')}</th>
                    <th className="px-4 py-2.5">{t('audit.client')}</th>
                    <th className="px-4 py-2.5">{t('audit.before')}</th>
                    <th className="px-4 py-2.5">{t('audit.after')}</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data?.items.map((a) => (
                    <tr key={a.id} className="border-t border-gray-200 align-top transition-colors hover:bg-gray-100">
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs">{fmtDateTime(a.at)}</td>
                      <td className="px-4 py-2.5">{a.actorName ?? <span className="text-gray-400">{t('notif.system')}</span>}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{t(`auditAction.${a.action}`, { defaultValue: a.action })}</div>
                        <div className="text-xs text-gray-500">{a.entity} #{a.entityId}</div>
                      </td>
                      <td className="px-4 py-2.5">{a.clientId ? <Link className="text-brand hover:text-ink" to={`/clients/${a.clientId}`}>{a.clientName}</Link> : '—'}</td>
                      <td className="max-w-xs px-4 py-2.5"><AuditValue value={a.before} entity={a.entity} users={userNames} /></td>
                      <td className="max-w-xs px-4 py-2.5"><AuditValue value={a.after} entity={a.entity} users={userNames} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            className="shrink-0 border-t px-4 py-2.5"
            page={f.page}
            pageSize={f.pageSize}
            total={q.data?.total ?? 0}
            onPage={(page) => setF({ ...f, page })}
            onPageSize={(pageSize) => set({ pageSize })}
          />
        </QueryState>
      </Card>
    </div>
  );
}
