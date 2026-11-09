import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, refreshAccess, setAccessToken, setOnAuthLost } from './api';
import type { Me } from './types';

interface AuthCtx {
  user: Me | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
  isLeader: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const { i18n } = useTranslation();
  const qc = useQueryClient();

  const applyUser = useCallback(
    (u: Me | null) => {
      setUser(u);
      if (u && i18n.language !== u.language) void i18n.changeLanguage(u.language);
    },
    [i18n],
  );

  const reload = useCallback(async () => {
    applyUser(await api.get<Me>('/me'));
  }, [applyUser]);

  useEffect(() => {
    // Sahifa yangilanganda: refresh cookie orqali sessiyani tiklash
    setOnAuthLost(() => {
      setAccessToken(null);
      setUser(null);
      qc.clear();
    });
    refreshAccess()
      .then(async (d) => {
        if (d) applyUser(await api.get<Me>('/me'));
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [applyUser, qc]);

  const login = async (login: string, password: string) => {
    const d = await api.post<{ accessToken: string }>('/auth/login', { login, password });
    setAccessToken(d.accessToken);
    applyUser(await api.get<Me>('/me'));
  };

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    setAccessToken(null);
    setUser(null);
    qc.clear();
  };

  return (
    <Ctx.Provider value={{ user, loading, login, logout, reload, isLeader: user?.role === 'LEADER' }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider yo\'q');
  return c;
}
