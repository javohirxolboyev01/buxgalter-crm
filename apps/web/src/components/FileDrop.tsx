import { FileSpreadsheet, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { Button } from './ui/button';

const fmtSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Native "Choose File" o'rniga: bosib tanlash yoki sudrab tashlash */
export function FileDrop({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  if (file) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-2.5 dark:border-brand-800 dark:bg-brand-950/30">
        <FileSpreadsheet className="h-8 w-8 shrink-0 text-green-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-gray-900">{file.name}</div>
          <div className="text-xs text-gray-500">{fmtSize(file.size)}</div>
        </div>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onChange(null)} aria-label={t('sheets.removeFile')} title={t('sheets.removeFile')}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-lg border border-dashed px-3 py-2.5 transition-colors',
        over ? 'border-brand-500 bg-brand-50 dark:bg-brand-950/40' : 'border-gray-300 hover:border-brand-400 hover:bg-gray-50',
      )}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onChange(f);
      }}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
        <Upload className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-gray-900">{t('sheets.chooseFile')}</span>
        <span className="block text-xs text-gray-500">{t('sheets.fileHint')}</span>
      </span>
      <input
        type="file"
        accept=".xlsx"
        className="sr-only"
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
    </label>
  );
}
