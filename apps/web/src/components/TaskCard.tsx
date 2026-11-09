import { AlertCircle, CheckCircle2, Clock, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { fmtShortDue } from '@/lib/time';
import type { Task } from '@/lib/types';
import { taskTitle, taskTone, toneClasses } from '@/hooks/tasks';
import { SHOW_CHECKLIST } from './TaskPanel';
import { Badge } from './ui/card';

export function TaskCard({
  task,
  onOpen,
  onDone,
  draggable,
  showAssignee,
}: {
  task: Task;
  onOpen: (id: number) => void;
  onDone?: (id: number) => void;
  draggable?: boolean;
  showAssignee?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const tone = taskTone(task);
  return (
    <div
      draggable={draggable}
      onDragStart={(e) => e.dataTransfer.setData('text/task-id', String(task.id))}
      className={cn(
        'group rounded-md border border-l-4 border-gray-200 bg-white p-2.5 text-sm shadow-sm',
        tone ? toneClasses[tone] : 'border-l-gray-300',
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <button className="block w-full text-left" onClick={() => onOpen(task.id)}>
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium leading-snug">{taskTitle(task, i18n.language)}</span>
          {task.kind === 'URGENT' && <Badge className="border-red-300 bg-red-50 text-red-700">{t('taskKind.URGENT')}</Badge>}
        </div>
        <div className="mt-0.5 truncate text-xs text-gray-600">{task.clientName}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          <span className={cn('inline-flex items-center gap-1', tone === 'overdue' && 'font-medium text-overdue')}>
            {tone === 'overdue' ? <AlertCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
            {task.dueAt ? fmtShortDue(task.dueAt) : t('task.noDue')}
          </span>
          {SHOW_CHECKLIST && task.checklistTotal > 0 && (
            <span>
              ☑ {task.checklistDone}/{task.checklistTotal}
            </span>
          )}
          {task.timerStartedAt && (
            <span className="inline-flex items-center gap-1 text-blue-700">
              <Timer className="h-3 w-3 animate-pulse" /> {t('task.timerOn')}
            </span>
          )}
          {showAssignee && <span>{task.assigneeName ?? t('task.unassigned')}</span>}
        </div>
      </button>
      {onDone && task.status !== 'DONE' && (
        <button
          onClick={() => onDone(task.id)}
          className="mt-2 inline-flex items-center gap-1 rounded border border-green-300 px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-50"
        >
          <CheckCircle2 className="h-3 w-3" /> {t('task.done')}
        </button>
      )}
    </div>
  );
}
