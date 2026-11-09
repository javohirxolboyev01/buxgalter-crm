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
  /** Muddat o'tgan: imtiyozli davrda faqat o'qish */
  readOnly: boolean;
  /** Imtiyozli davr ham o'tgan: kompaniya yopiq (rahbarga faqat to'lov, boshqalarga "tarif tugagan" ekrani) */
  locked: boolean;
  /** Yopilish sanasi (paid_until + imtiyozli kunlar) */
  lockAt: string | null;
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
    // Yopiq kompaniyada: to'lov tasdiqlansa xodimlar ekrani o'zi ochilsin
    refetchInterval: (query) => (query.state.data?.locked ? 60_000 : false),
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

// ---------- Tarif to'lovi: kartaga o'tkazma + chek (V47) ----------
export interface PaymentInfo {
  cardNumber: string;
  cardHolder: string;
  bank: string;
  contact: string;
  note: string;
}
export type PaymentRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export interface PaymentRequest {
  id: number;
  plan: Plan;
  periods: number;
  amount: number;
  note: string | null;
  status: PaymentRequestStatus;
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  /** Tasdiqlangan chek → company_payment (tarixda bitta qator) */
  paymentId: number | null;
}
export interface CompanyPayment {
  id: number;
  plan: Plan;
  periods: number;
  amount: number;
  paidFrom: string;
  paidUntil: string;
  createdAt: string;
}
export interface Billing {
  paymentInfo: PaymentInfo;
  requests: PaymentRequest[];
  payments: CompanyPayment[];
}
export const BILLING_KEY = ['company', 'billing'] as const;

export const fmtMoney = (n: number) => new Intl.NumberFormat('ru-RU').format(n);
