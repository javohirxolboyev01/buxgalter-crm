import { ChevronRight, House, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';

/** Oq blok (WinPro `section-container`). Ichki bo'shliqni foydalanuvchi o'zi beradi */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('overflow-hidden rounded-md bg-white', className)}>{children}</div>;
}

export function CardHeader({ title, actions, className }: { title: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-2 px-4 py-3', className)}>
      <h2 className="text-lg font-medium text-foreground">{title}</h2>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', className)}>{children}</span>
  );
}

/** WinPro BreadCrumb: uy belgisi › Orqaga › ... › joriy sahifa */
function Breadcrumbs({ items, current }: { items: { to: string; label: ReactNode }[]; current: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sep = <ChevronRight className="mx-0.5 h-5 w-5 shrink-0 text-gray-500" aria-hidden />;
  return (
    <nav aria-label="breadcrumb" className="section-container flex overflow-hidden py-1.5">
      <ol className="no-scrollbar flex items-center overflow-x-auto text-sm font-medium leading-none text-ink">
        <li className="flex shrink-0 items-center">
          <Link to="/" aria-label={t('nav.home')}>
            <House className="h-[18px] w-[18px]" />
          </Link>
          {sep}
        </li>
        <li className="flex shrink-0 items-center">
          <button type="button" className="cursor-pointer" onClick={() => navigate(-1)}>
            {t('common.back')}
          </button>
          {sep}
        </li>
        {items.map((c, i) => (
          <li key={i} className="flex shrink-0 items-center">
            <Link to={c.to}>{c.label}</Link>
            {sep}
          </li>
        ))}
        <li className="shrink-0 text-gray-400">{current}</li>
      </ol>
    </nav>
  );
}

/** breadcrumb={false}: bosh sahifalarda (Dashboard, Mening kunim) "Uy › Orqaga" yo'li ma'nosiz */
export function PageHeader({
  title,
  actions,
  crumbs = [],
  breadcrumb = true,
}: {
  title: ReactNode;
  actions?: ReactNode;
  crumbs?: { to: string; label: ReactNode }[];
  breadcrumb?: boolean;
}) {
  return (
    // Header (h-14) ostida qotadi; manfiy margin + padding: tagidan o'tayotgan kontent chetlardan ko'rinmasin
    <div className="sticky top-14 z-30 -mx-2 -mt-2 mb-2 shrink-0 space-y-2 bg-page px-2 pt-2 sm:-mx-4 sm:-mt-4 sm:px-4 sm:pt-4">
      {breadcrumb && <Breadcrumbs items={crumbs} current={title} />}
      <div className="section-container flex min-h-[52px] flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:px-4 sm:py-2.5">
        <h1 className="flex min-w-0 items-center gap-2.5 text-xl font-semibold leading-tight tracking-tight text-foreground">
          <span className="h-5 w-1 shrink-0 rounded-full bg-brand-500" aria-hidden />
          <span className="truncate">{title}</span>
        </h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

type Tone = 'overdue' | 'done' | 'soon' | 'waiting' | 'brand';
const toneText: Record<Tone, string> = {
  overdue: 'text-overdue',
  done: 'text-done',
  soon: 'text-soon',
  waiting: 'text-waiting',
  brand: 'text-brand',
};
const toneIcon: Record<Tone, string> = {
  overdue: 'bg-overdue-bg text-overdue',
  done: 'bg-done-bg text-done',
  soon: 'bg-soon-bg text-soon',
  waiting: 'bg-waiting-bg text-waiting',
  brand: 'bg-brand-light text-brand',
};
const toneBar: Record<Tone, string> = {
  overdue: 'bg-overdue',
  done: 'bg-done',
  soon: 'bg-soon',
  waiting: 'bg-waiting',
  brand: 'bg-brand-500',
};

/**
 * Analitik karta. tone — qiymat rangi (holat ranglari 6.5), iconTone — belgi foni (qiymat neytral bo'lsa ham).
 * progress (0–100) berilsa pastda chiziq chiziladi.
 */
export function Stat({
  label,
  value,
  tone,
  icon: Icon,
  iconTone = tone ?? 'brand',
  hint,
  progress,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  icon?: LucideIcon;
  iconTone?: Tone;
  hint?: ReactNode;
  progress?: number;
}) {
  return (
    <Card className="relative p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium leading-snug text-gray-500">{label}</div>
          <div className={cn('mt-2 text-3xl font-semibold tabular-nums tracking-tight text-foreground', tone && toneText[tone])}>{value}</div>
        </div>
        {Icon && (
          <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', toneIcon[iconTone])}>
            <Icon className="h-6 w-6" aria-hidden />
          </div>
        )}
      </div>
      {progress !== undefined && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn('h-full rounded-full transition-[width] duration-500', toneBar[iconTone])} style={{ width: `${progress}%` }} />
        </div>
      )}
      {hint && <div className="mt-2 text-xs text-gray-500">{hint}</div>}
    </Card>
  );
}
