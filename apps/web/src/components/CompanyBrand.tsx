import { cn } from '@/lib/cn';
import { useCompany } from '@/lib/company';

/** Kompaniya bosh harflari (logo yuklanmagan bo'lsa) */
function initials(name: string) {
  const words = name
    .replace(/["«»']/g, '')
    .split(/\s+/)
    .filter((w) => w && !/^(mchj|мчж|ooo|ооо|xk|ak|yatt)$/i.test(w));
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? name).slice(0, 2)).toUpperCase();
}

/**
 * Sarlavhadagi brend: kompaniya logosi va nomi (Sozlamalar → Kompaniya). Logo bo'lmasa — bosh harflar.
 * size: sidebar (h-8) yoki ixcham (mobil header, chat).
 */
export function CompanyBrand({ className, compact = false, showName = true }: { className?: string; compact?: boolean; showName?: boolean }) {
  const { data } = useCompany();
  if (!data) return <div className={cn(compact ? 'h-7' : 'h-8', 'w-24 animate-pulse rounded-md bg-gray-100 dark:bg-white/5', className)} />;
  const box = compact ? 'h-7 w-7 text-[11px]' : 'h-8 w-8 text-xs';
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)} title={data.name}>
      {data.logo ? (
        <img src={data.logo} alt="" className={cn(box, 'shrink-0 rounded-md object-contain')} />
      ) : (
        <span className={cn(box, 'flex shrink-0 items-center justify-center rounded-md bg-brand-500 font-semibold text-on-brand')}>
          {initials(data.name)}
        </span>
      )}
      {showName && (
        <span className={cn('truncate font-semibold text-gray-900', compact ? 'text-sm' : 'text-[15px]')}>{data.name}</span>
      )}
    </span>
  );
}
