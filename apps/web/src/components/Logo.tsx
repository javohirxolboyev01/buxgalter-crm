import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

// Mahsulot (SaaS platformasi) belgisi — neytral: hech bir kompaniyaga tegishli emas.
// Faqat kompaniyadan tashqarida (login, /platform, yuklanish) ko'rinadi; kompaniya ichida — o'z logosi (CompanyBrand).
// TODO(tasdiqlash): startap nomi va logosi tayyor bo'lsa shu yerda (va public/favicon.svg, i18n app.name) almashtiriladi.

/** Belgi: brend rangidagi kvadrat ichida hujjat va belgi (✓). public/favicon.svg bilan bir xil. */
export function LogoMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn('block', className)}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4bb5c1" />
          <stop offset="1" stopColor="#2a8794" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${id})`} />
      <path d="M20 13h16l10 10v26a3 3 0 0 1-3 3H20a3 3 0 0 1-3-3V16a3 3 0 0 1 3-3Z" fill="#fff" />
      <path d="M36 13v8a2 2 0 0 0 2 2h8" fill="none" stroke="#9fd3da" strokeWidth="2" />
      <path d="m24 37 5 5 10-11" fill="none" stroke="#2a8794" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * variant: mark — faqat belgi; row — belgi + mahsulot nomi (i18n app.name).
 * className — belgi balandligi (h-*), textClassName — nom o'lchami/rangi.
 */
export function Logo({
  className,
  textClassName,
  variant = 'row',
}: {
  className?: string;
  textClassName?: string;
  variant?: 'mark' | 'row';
}) {
  const { t } = useTranslation();
  if (variant === 'mark') return <LogoMark className={className} />;
  return (
    <span className="inline-flex items-center gap-2.5" role="img" aria-label={t('app.name')}>
      <LogoMark className={cn('w-auto shrink-0', className)} />
      <span aria-hidden className={cn('whitespace-nowrap font-bold tracking-tight text-navy dark:text-on-brand', textClassName)}>
        {t('app.name')}
      </span>
    </span>
  );
}
