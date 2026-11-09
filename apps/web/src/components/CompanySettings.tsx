import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { QueryState } from '@/components/ui/states';
import { api } from '@/lib/api';
import { type Company, COMPANY_KEY, useCompany } from '@/lib/company';
import { showError } from '@/lib/errors';

const LOGO_MAX_KB = 300;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Sozlamalar → Kompaniya: nom va logo (rahbar). Tarif va to'lovlar — alohida tab (BillingSettings) */
export function CompanySettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useCompany();
  const [name, setName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (q.data) setName(q.data.name);
  }, [q.data]);

  const onDone = (c: Company) => {
    qc.setQueryData<Company>(COMPANY_KEY, (old) => (old ? { ...old, ...c } : c));
    toast.success(t('common.saved'));
  };
  const onErr = (e: unknown) => showError(e, t);
  const saveName = useMutation({ mutationFn: () => api.patch<Company>('/company', { name: name.trim() }), onSuccess: onDone, onError: onErr });
  const uploadLogo = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.put<Company>('/company/logo', fd);
    },
    onSuccess: onDone,
    onError: onErr,
  });
  const removeLogo = useMutation({ mutationFn: () => api.del<Company>('/company/logo'), onSuccess: onDone, onError: onErr });

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!LOGO_TYPES.includes(f.type)) return toast.error(t('errors.BAD_IMAGE'));
    if (f.size > LOGO_MAX_KB * 1024) return toast.error(t('errors.LOGO_TOO_LARGE'));
    uploadLogo.mutate(f);
  };

  return (
    <QueryState q={q}>
      {q.data && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader title={t('company.brandTitle')} />
            <div className="space-y-4 px-4 pb-4 text-sm">
              <p className="text-gray-600">{t('company.brandHint')}</p>
              <Field label={t('company.name')} htmlFor="company-name">
                <div className="flex gap-2">
                  <Input id="company-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
                  <Button
                    onClick={() => saveName.mutate()}
                    disabled={!name.trim() || name.trim() === q.data.name || saveName.isPending}
                  >
                    {t('common.save')}
                  </Button>
                </div>
              </Field>
              <Field label={t('company.logo')} hint={t('company.logoHint', { kb: LOGO_MAX_KB })}>
                <div className="flex items-center gap-3">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-gray-300 bg-gray-50 dark:bg-white/5">
                    {q.data.logo ? (
                      <img src={q.data.logo} alt={t('company.logo')} className="h-full w-full object-contain" />
                    ) : (
                      <ImagePlus className="h-6 w-6 text-gray-400" />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept={LOGO_TYPES.join(',')}
                      className="hidden"
                      onChange={(e) => {
                        pick(e.target.files?.[0]);
                        e.target.value = '';
                      }}
                    />
                    <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploadLogo.isPending}>
                      <ImagePlus className="h-4 w-4" /> {t(q.data.logo ? 'company.changeLogo' : 'company.uploadLogo')}
                    </Button>
                    {q.data.logo && (
                      <Button variant="ghost" size="sm" onClick={() => removeLogo.mutate()} disabled={removeLogo.isPending}>
                        <Trash2 className="h-4 w-4" /> {t('company.removeLogo')}
                      </Button>
                    )}
                  </div>
                </div>
              </Field>
            </div>
          </Card>
        </div>
      )}
    </QueryState>
  );
}
