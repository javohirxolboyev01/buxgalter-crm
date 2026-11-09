import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'theme';

/** Saqlangan tanlov, bo'lmasa tizim sozlamasi. Brauzer xotirasi yopiq bo'lsa ham ishlaydi */
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let current = initialTheme();
const listeners = new Set<() => void>();

export function applyTheme(theme: Theme = current) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

function setTheme(theme: Theme) {
  current = theme;
  applyTheme(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => current);
  return { theme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') };
}
