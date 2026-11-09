import { useEffect, useRef, useState } from 'react';

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Son 0 dan (keyin — oldingi qiymatdan) yangi qiymatgacha sanab chiqadi. "Harakatni kamaytirish" yoqilgan bo'lsa darhol ko'rsatadi */
export function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(reduced() ? value : 0);
  const from = useRef(shown);

  useEffect(() => {
    if (reduced()) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const v = Math.round(a + (value - a) * (1 - Math.pow(1 - p, 3))); // easeOutCubic
      setShown(v);
      from.current = v;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <>{shown}</>;
}
