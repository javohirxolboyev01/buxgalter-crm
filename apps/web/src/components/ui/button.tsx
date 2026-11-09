import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { addRippleEffect } from '@/lib/ripple';
import { Spinner } from './spinner';

// WinPro tugma variantlari (my-winpro-admin/src/components/ui/button.tsx)
const variants = {
  default: 'bg-brand-500 text-on-brand shadow-sm hover:bg-brand-600 focus-visible:ring-brand-500/20 dark:focus-visible:ring-brand-400/40',
  secondary: 'bg-brand-100 text-brand-800 shadow-sm hover:bg-brand-200 dark:bg-brand-900/50 dark:text-brand-200 dark:hover:bg-brand-800/50',
  outline:
    'border border-brand-200 bg-page shadow-sm hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-brand-800 dark:bg-brand-950/30 dark:hover:border-brand-700 dark:hover:bg-brand-900/50 dark:hover:text-brand-200',
  ghost: 'hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-900/50 dark:hover:text-brand-300',
  link: 'text-brand-600 underline-offset-4 hover:text-brand-700 hover:underline dark:text-brand-400 dark:hover:text-brand-300',
  danger: 'bg-red-600 text-on-brand shadow-sm hover:bg-red-700',
  success: 'bg-green-600 text-on-brand shadow-sm hover:bg-green-700',
};
const sizes = { sm: 'h-8 px-3', md: 'h-10 px-4', lg: 'h-11 px-8', icon: 'h-9 w-9' };
const spinnerColor: Partial<Record<keyof typeof variants, string>> = {
  default: 'text-on-brand',
  danger: 'text-on-brand',
  success: 'text-on-brand',
  secondary: 'text-brand-800 dark:text-brand-200',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  /** So'rov ketayotganda: matn yashiriladi, o'rtada aylanma, tugma bosilmaydi */
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', type = 'button', loading = false, disabled, onClick, children, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={loading || disabled}
      onClick={(e) => {
        if (loading) return;
        addRippleEffect(e);
        onClick?.(e);
      }}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <span className="inline-flex items-center gap-2 opacity-0">{children}</span> : children}
      {loading && (
        <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2">
          <Spinner size="small" className={spinnerColor[variant] ?? 'text-brand-700 dark:text-brand-300'} />
        </span>
      )}
    </button>
  ),
);
Button.displayName = 'Button';
