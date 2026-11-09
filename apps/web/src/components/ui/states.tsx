import { AlertTriangle, Inbox } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/Logo';
import { cn } from '@/lib/cn';
import { Button } from './button';
import { ListSkeleton } from './skeleton';
import { errorText } from '@/lib/errors';

/**
 * Asosiy loader — faqat loyiha yuklanayotganda (auth, lazy sahifa chunk'i).
 * Backend ma'lumoti uchun loader emas, skeleton (QueryState) ishlatiladi: ikki xil loader ketma-ket chiqmasin.
 */
export function Loading({ className = 'py-10' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn('flex animate-fade-in-late flex-col items-center justify-center gap-3', className)} role="status" aria-live="polite">
      <div className="relative h-16 w-16">
        <span className="absolute inset-0 rounded-full border-2 border-brand-500/15" />
        <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-brand-500 motion-safe:animate-orbit" />
        <Logo variant="mark" className="absolute inset-4 motion-safe:animate-breathe" />
      </div>
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
        {t('common.loading').replace('…', '')}
        <span className="flex gap-0.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1 w-1 rounded-full bg-brand-500 motion-safe:animate-dot-rise" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </span>
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-sm text-red-700" role="alert">
      <AlertTriangle className="h-5 w-5" />
      <span>{errorText(error, t)}</span>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

export function Empty({ text }: { text?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 p-4 py-10 text-center text-sm font-medium text-gray-500">
      <Inbox className="h-5 w-5" />
      {text ?? t('common.empty')}
    </div>
  );
}

/**
 * useQuery natijasi uchun umumiy holatlar. Yuklanayotganda — o'z joyida skeleton (blok shakliga mos `skeleton` beriladi),
 * server ma'lumot qaytarmasa (null/undefined) — Empty.
 */
export function QueryState({ q, skeleton, children }: { q: { isLoading: boolean; error: unknown; data?: unknown; refetch: () => unknown }; skeleton?: React.ReactNode; children: React.ReactNode }) {
  if (q.isLoading) return <>{skeleton ?? <ListSkeleton />}</>;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.data == null) return <Empty />;
  return <>{children}</>;
}
