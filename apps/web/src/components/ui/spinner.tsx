import { cn } from '@/lib/cn';

const sizes = { small: 20, medium: 40, large: 80 };

/** 12 ta so'nuvchi chiziqli aylanma (WinPro SpinnerLoader). Rang — `currentColor` */
export function Spinner({ size = 'medium', className }: { size?: keyof typeof sizes; className?: string }) {
  const d = sizes[size];
  return (
    <span className={cn('relative inline-block text-gray-500', className)} style={{ width: d, height: d }} aria-hidden>
      {Array.from({ length: 12 }).map((_, i) => (
        <span
          key={i}
          className="absolute left-0 top-0 animate-spin-fade"
          style={{ transformOrigin: `${d / 2}px ${d / 2}px`, transform: `rotate(${i * 30}deg)`, animationDelay: `${-1.1 + i * 0.1}s` }}
        >
          <span className="absolute rounded-[20%] bg-current" style={{ top: d * 0.04, left: d * 0.46, width: d * 0.08, height: d * 0.22 }} />
        </span>
      ))}
    </span>
  );
}
