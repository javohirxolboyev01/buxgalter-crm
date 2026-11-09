import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Select } from './select';

/** 1 … 4 5 [6] 7 8 … 20: chetlar va joriy sahifa atrofi, qolgani "…" */
function pageList(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const from = Math.max(2, Math.min(page - 1, pages - 4));
  const to = Math.min(pages - 1, Math.max(page + 1, 5));
  const out: (number | '…')[] = [1];
  if (from > 2) out.push('…');
  for (let i = from; i <= to; i++) out.push(i);
  if (to < pages - 1) out.push('…');
  out.push(pages);
  return out;
}

function PageBtn({ children, onClick, disabled, active, label }: { children: ReactNode; onClick?: () => void; disabled?: boolean; active?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 min-w-8 cursor-pointer items-center justify-center rounded-md px-2 text-sm font-medium tabular-nums transition-colors disabled:cursor-default disabled:opacity-40',
        active ? 'bg-brand-500 text-on-brand shadow-sm' : 'text-gray-600 hover:bg-gray-100 disabled:hover:bg-transparent',
      )}
    >
      {children}
    </button>
  );
}

/**
 * To'liq sahifalash: jami, "1–25 / 100", sahifadagi qatorlar soni, birinchi/oldingi/raqamlar/keyingi/oxirgi.
 * compact — tor joylar (panel) uchun: faqat tugmalar.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  pageSizes = [25, 50, 100],
  compact,
  className,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize?: (n: number) => void;
  pageSizes?: number[];
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);

  const buttons = (
    <nav className="flex items-center gap-0.5" aria-label={t('pagination.label')}>
      {!compact && (
        <PageBtn onClick={() => onPage(1)} disabled={page <= 1} label={t('pagination.first')}>
          <ChevronsLeft className="h-4 w-4" />
        </PageBtn>
      )}
      <PageBtn onClick={() => onPage(page - 1)} disabled={page <= 1} label={t('common.prev')}>
        <ChevronLeft className="h-4 w-4" />
      </PageBtn>
      {pageList(page, pages).map((p, i) =>
        p === '…' ? (
          <span key={`e${i}`} className="px-1 text-sm text-gray-400" aria-hidden>…</span>
        ) : (
          <PageBtn key={p} onClick={() => onPage(p)} active={p === page} label={t('pagination.page', { n: p })}>
            {p}
          </PageBtn>
        ),
      )}
      <PageBtn onClick={() => onPage(page + 1)} disabled={page >= pages} label={t('common.next')}>
        <ChevronRight className="h-4 w-4" />
      </PageBtn>
      {!compact && (
        <PageBtn onClick={() => onPage(pages)} disabled={page >= pages} label={t('pagination.last')}>
          <ChevronsRight className="h-4 w-4" />
        </PageBtn>
      )}
    </nav>
  );

  if (compact) return <div className={cn('flex justify-center', className)}>{buttons}</div>;

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-gray-600', className)}>
      <div className="flex items-center gap-4">
        <span className="tabular-nums">{t('pagination.range', { from, to, total })}</span>
        {onPageSize && (
          <label className="flex items-center gap-2">
            <span className="hidden sm:inline">{t('pagination.perPage')}</span>
            <Select
              className="h-8 w-[72px] px-2"
              value={String(pageSize)}
              onChange={(v) => onPageSize(Number(v))}
              aria-label={t('pagination.perPage')}
              options={pageSizes.map((n) => ({ value: String(n), label: String(n) }))}
            />
          </label>
        )}
      </div>
      {buttons}
    </div>
  );
}
