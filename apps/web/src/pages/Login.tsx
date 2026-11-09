import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Field, Input, PIN_MAX } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { errorText } from '@/lib/errors';
import { useTheme } from '@/lib/theme';

/** WinPro GridShape: o'ng paneldagi to'r naqshi */
function GridShape() {
  return (
    <>
      <div className="absolute right-0 top-0 -z-[1] w-full max-w-[250px] xl:max-w-[450px]">
        <img src="/images/shape/grid-01.svg" alt="" />
      </div>
      <div className="absolute bottom-0 left-0 -z-[1] w-full max-w-[250px] rotate-180 xl:max-w-[450px]">
        <img src="/images/shape/grid-01.svg" alt="" />
      </div>
    </>
  );
}

export default function Login() {
  const { t, i18n } = useTranslation();
  const { user, login } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ login: '', password: '' });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.role === 'LEADER' ? '/dashboard' : '/my-day'} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(form.login, form.password);
      const from = (location.state as any)?.from;
      navigate(from ?? '/', { replace: true });
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    // WinPro AuthLayout: chapda forma, o'ngda to'q ko'k brend paneli
    <div className="relative z-[1] bg-white p-6 dark:bg-page sm:p-0">
      <div className="relative flex h-screen w-full flex-col justify-center lg:flex-row">
        <main className="flex flex-1 flex-col">
          <div className="flex justify-end p-4">
            <div className="flex gap-1" role="group" aria-label={t('profile.language')}>
              {['uz', 'ru'].map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => i18n.changeLanguage(l)}
                  aria-pressed={i18n.language === l}
                  className={cn(
                    'cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold uppercase transition-colors',
                    i18n.language === l ? 'bg-brand-500 text-on-brand' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
            <div className="rounded-md p-6 shadow-aesthetic">
              <div className="mx-auto mb-5 sm:mb-8">
                <h1 className="mb-2 text-center text-xl font-semibold text-gray-800 sm:text-2xl">{t('login.title')}</h1>
                <p className="text-center text-sm text-gray-500">{t('login.subtitle')}</p>
              </div>
              <form onSubmit={submit} className="space-y-6">
                <Field label={t('login.login')} htmlFor="login">
                  <div className="relative">
                    <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
                    <Input
                      id="login"
                      className="px-4 pl-10"
                      autoComplete="username"
                      autoFocus
                      value={form.login}
                      onChange={(e) => setForm({ ...form, login: e.target.value })}
                    />
                  </div>
                </Field>
                <Field label={t('login.password')} htmlFor="password">
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
                    <Input
                      id="password"
                      className="px-10"
                      type={showPw ? 'text' : 'password'}
                      autoComplete="current-password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={PIN_MAX}
                      value={form.password}
                      // Parol faqat raqamdan iborat: harf yozilmaydi
                      onChange={(e) => setForm({ ...form, password: e.target.value.replace(/\D/g, '').slice(0, PIN_MAX) })}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-md p-1.5 text-gray-400 transition-colors hover:text-gray-700"
                      aria-label={showPw ? t('login.hidePassword') : t('login.showPassword')}
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </Field>
                {error && (
                  <p className="text-center text-sm text-red-700" role="alert">
                    {error}
                  </p>
                )}
                <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!form.login || !form.password}>
                  {t('login.submit')}
                </Button>
              </form>
            </div>
          </div>
        </main>

        <aside className="hidden h-full w-full items-center bg-navy dark:bg-[#ffffff0d] lg:grid lg:w-1/2">
          <div className="relative z-[1] flex items-center justify-center">
            <GridShape />
            <div className="flex flex-col items-center px-6 text-center">
              <Logo variant="row" className="mb-6 h-20 w-auto text-on-brand xl:h-24" />
              <p className="whitespace-nowrap text-[#9ca3af]">{t('login.tagline')}</p>
            </div>
          </div>
        </aside>

        {/* WinPro ThemeTogglerTwo: pastki o'ng burchakdagi dumaloq tugma */}
        <div className="fixed bottom-6 right-6 z-50 hidden sm:block">
          <button
            type="button"
            onClick={toggle}
            aria-label={theme === 'dark' ? t('nav.themeLight') : t('nav.themeDark')}
            className="inline-flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-brand-500 text-on-brand transition-colors hover:bg-brand-600 dark:bg-navy"
          >
            <svg className="hidden dark:block" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <circle cx="10" cy="10" r="4" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M4 4l1.4 1.4M14.6 14.6 16 16M4 16l1.4-1.4M14.6 5.4 16 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <svg className="dark:hidden" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M17.45 11.97A7.08 7.08 0 0 1 8.03 2.55 7.71 7.71 0 1 0 17.45 11.97Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
