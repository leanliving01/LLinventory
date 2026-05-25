import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Persistent banner showing last scan result.
 * Props:
 *  - result: { type: 'success'|'error', message: string } | null
 *  - onDismiss: () => void
 */
export default function ScanResultBanner({ result, onDismiss }) {
  if (!result) return null;

  const isSuccess = result.type === 'success';

  return (
    <button
      onClick={onDismiss}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 text-left transition-colors",
        isSuccess
          ? "bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700"
          : "bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700"
      )}
    >
      {isSuccess ? (
        <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" />
      ) : (
        <XCircle className="w-6 h-6 text-red-600 shrink-0" />
      )}
      <p className={cn(
        "flex-1 text-sm font-semibold",
        isSuccess ? "text-green-800 dark:text-green-300" : "text-red-800 dark:text-red-300"
      )}>
        {result.message}
      </p>
      <span className="text-xs text-muted-foreground shrink-0">Tap to dismiss</span>
    </button>
  );
}