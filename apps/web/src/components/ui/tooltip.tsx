import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Yengil tooltip (faqat CSS): sichqoncha yoki klaviatura fokusida element tepasida chiqadi.
 * gray-900 / white qorong'i rejimda o'zi aylanadi — kontrast saqlanadi.
 */
export function Tooltip({ content, children, className, style }: { content: ReactNode; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <span className={cn('group/tip relative outline-none', className)} style={style} tabIndex={0}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md bg-gray-900 px-2.5 py-1.5 text-xs text-white opacity-0 shadow-pop transition-all duration-150 group-hover/tip:translate-y-0 group-hover/tip:opacity-100 group-focus-visible/tip:translate-y-0 group-focus-visible/tip:opacity-100"
      >
        {content}
        <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-gray-900" aria-hidden />
      </span>
    </span>
  );
}
