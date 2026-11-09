import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './api';
import { useAuth } from './auth';

// Kompaniya brendi va tarif holati (SaaS). Logo data URL ko'rinishida keladi (≤300 KB, Authorization'siz <img>).
export type Plan = 'MONTHLY' | 'YEARLY';
export interface Tariff {
  code: Plan;
  months: number;
  price: number;
}
export interface Company {
  id: number;
  name: string;
  plan: Plan | null;
  paidUntil: string | null;
  daysLeft: number | null;
  readOnly: boolean;
  logo: string | null;
  logoVersion: number;
  tariffs: Tariff[];
}

export const COMPANY_KEY = ['company'] as const;

const DEFAULT_TITLE = 'Buxgalteriya CRM';
const DEFAULT_FAVICON = '/favicon.svg';

function setFavicon(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = href.startsWith('data:') ? href.slice(5, href.indexOf(';')) : 'image/svg+xml';
  link.href = href;
}

export function useCompany() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: COMPANY_KEY,
    queryFn: () => api.get<Company>('/company'),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
  return q;
}

/**
 * Brauzer sarlavhasi va tab ikonkasi: kompaniya nomi va logosi (logo bo'lmasa — mahsulot belgisi).
 * Faqat bir joyda (Layout) chaqiriladi: chiqishda mahsulotniki qaytadi.
 */
export function useCompanyDocumentBranding() {
  const { data } = useCompany();
  const name = data?.name;
  const logo = data?.logo;
  useEffect(() => {
    if (!name) return;
    document.title = name;
    setFavicon(logo ?? DEFAULT_FAVICON);
    return () => {
      document.title = DEFAULT_TITLE;
      setFavicon(DEFAULT_FAVICON);
    };
  }, [name, logo]);
}
