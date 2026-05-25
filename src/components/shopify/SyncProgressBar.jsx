import React from 'react';
import { Progress } from '@/components/ui/progress';
import { CheckCircle2, Loader2 } from 'lucide-react';

export default function SyncProgressBar({ current, total, status }) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const isComplete = status === 'complete';
  const isFetching = status === 'fetching';
  const isProcessing = status === 'processing';

  return (
    <div className="bg-card border border-border rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isComplete ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          ) : (
            <Loader2 className="w-5 h-5 text-primary animate-spin" />
          )}
          <span className="text-sm font-medium">
            {isFetching && 'Fetching orders from Shopify...'}
            {isProcessing && `Syncing orders: ${current} of ${total}`}
            {isComplete && `Sync complete — ${total} orders processed`}
          </span>
        </div>
        {(isProcessing || isComplete) && (
          <span className="text-sm font-semibold tabular-nums text-muted-foreground">{pct}%</span>
        )}
      </div>
      <Progress value={isFetching ? undefined : pct} className="h-2" />
    </div>
  );
}