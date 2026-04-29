import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Trash2, ArrowRightLeft, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Generic confirmation modal for destructive or important actions.
 * Props:
 *  - title: string
 *  - message: string or JSX
 *  - confirmLabel: string (default "Confirm")
 *  - confirmVariant: "destructive" | "default" (default "destructive")
 *  - icon: "delete" | "move" (controls the icon shown)
 *  - onConfirm: () => void
 *  - onCancel: () => void
 *  - loading: boolean
 */
export default function ConfirmActionModal({
  title,
  message,
  confirmLabel = 'Confirm',
  confirmVariant = 'destructive',
  icon = 'delete',
  onConfirm,
  onCancel,
  loading = false,
}) {
  const IconComp = icon === 'move' ? ArrowRightLeft : Trash2;
  const iconBg = icon === 'move' ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={e => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-card rounded-2xl border border-border w-full max-w-md shadow-xl">
        <div className="px-6 pt-6 pb-2 flex items-start gap-4">
          <div className={cn('w-10 h-10 rounded-full flex items-center justify-center shrink-0', iconBg)}>
            <IconComp className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold">{title}</h3>
            <div className="text-sm text-muted-foreground mt-1 leading-relaxed">{message}</div>
          </div>
          <Button variant="ghost" size="icon" className="shrink-0 -mt-1 -mr-2" onClick={onCancel}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="px-6 py-4 flex gap-3 justify-end">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            onClick={onConfirm}
            disabled={loading}
            className="gap-2"
          >
            {loading && <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}