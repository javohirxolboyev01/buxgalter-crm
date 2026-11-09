import type { TFunction } from 'i18next';
import { ApiError } from './api';

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
