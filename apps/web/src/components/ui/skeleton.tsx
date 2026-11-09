import { cn } from '@/lib/cn';

/** Backend ma'lumoti kelguncha joy egallovchi blok. gray-* qorong'i rejimda o'zi aylanadi */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-gray-200/70', className)} aria-hidden />;
}

// Qatorlar bir xil uzunlikda bo'lmasin — jonliroq ko'rinadi
const W = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-2/5'];

/** Teal sarlavhali jadval o'rniga */
export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden" role="status" aria-busy>
      <div className="table-head flex gap-4 px-4 py-3">
        {Array.from({ length: cols }).map((_, c) => (
          <div key={c} className="h-3 flex-1 rounded bg-white/30" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-t border-gray-200 px-4 py-3.5">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="flex-1">
              <Skeleton className={cn('h-3', W[(r + c) % W.length])} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Oddiy ro'yxat (tarix, bildirishnoma, shablonlar) o'rniga */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-gray-200" role="status" aria-busy>
      {Array.from({ length: rows }).map((_, r) => (
        <li key={r} className="space-y-2 px-4 py-3">
          <Skeleton className={cn('h-3', W[r % W.length])} />
          <Skeleton className="h-2.5 w-1/3" />
        </li>
      ))}
    </ul>
  );
}

/** KPI kartalari qatori (Dashboard, Mening kunim) o'rniga */
export function KpiSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" role="status" aria-busy>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex min-h-[184px] flex-col gap-3 rounded-md bg-white p-4">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-8 w-1/3" />
          <div className="mt-auto space-y-2">
            <Skeleton className="h-2 w-full" />
            <Skeleton className="h-2 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Forma maydonlari o'rniga (sarlavha + input) */
export function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <div className="grid gap-4 p-4 sm:grid-cols-2" role="status" aria-busy>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-2.5 w-1/4" />
          <Skeleton className="h-9 w-full rounded-md" />
        </div>
      ))}
    </div>
  );
}
