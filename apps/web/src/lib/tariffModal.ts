import { useSyncExternalStore } from 'react';
import { ApiError } from './api';

// "Tarif tanlang" oynasi: tarif muddati tugagan (imtiyozli davr, faqat o'qish) kompaniyada yozish so'rovi
// 402 SUBSCRIPTION_EXPIRED qaytarsa — xato toast'i o'rniga shu oyna ochiladi (rahbar qarori).
// Global holat: oyna Layout'da bitta, ochuvchi esa mutationCache (main.tsx) — React daraxtidan tashqarida.

let open = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const isSubscriptionExpired = (e: unknown) => e instanceof ApiError && e.code === 'SUBSCRIPTION_EXPIRED';

export function openTariffModal() {
  if (open) return;
  open = true;
  emit();
}
export function closeTariffModal() {
  open = false;
  emit();
}
export function useTariffModalOpen() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
  );
}
