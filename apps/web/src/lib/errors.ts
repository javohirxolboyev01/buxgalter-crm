import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { ApiError } from './api';
import { isSubscriptionExpired, openTariffModal } from './tariffModal';

/** Server xato kodi -> tarjima qilingan matn (noma'lum kod bo'lsa server xabari) */
export function errorText(e: unknown, t: TFunction): string {
  if (e instanceof ApiError) {
    const key = `errors.${e.code}`;
    const tr = t(key);
    return tr !== key ? tr : e.message;
  }
  if (e instanceof Error) return e.message;
  return t('errors.INTERNAL');
}

/**
 * Mutatsiya xatosi toast'i. Tarif muddati tugagan (402 SUBSCRIPTION_EXPIRED) bo'lsa toast chiqmaydi:
 * o'rniga "Tarif tanlang" oynasi ochiladi (useMutation'siz to'g'ridan-to'g'ri api chaqiruvlari uchun ham shu yerda).
 */
export function showError(e: unknown, t: TFunction) {
  if (isSubscriptionExpired(e)) return openTariffModal();
  toast.error(errorText(e, t));
}
