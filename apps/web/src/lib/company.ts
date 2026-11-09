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

export function useCompany() {
  const { user } = useAuth();
  const q = useQuery({
    queryKey: COMPANY_KEY,
    queryFn: () => api.get<Company>('/company'),
    enabled: !!user,
    staleTime: 5 * 60_000,
  });
  // Brauzer sarlavhasi: kompaniya nomi
  const name = q.data?.name;
  useEffect(() => {
    if (name) document.title = name;
  }, [name]);
  return q;
}
