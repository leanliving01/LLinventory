import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCircle2, XCircle, Clock, Lock } from 'lucide-react';

const QS_STYLES = {
  fresh: 'bg-green-100 text-green-700',
  use_today: 'bg-amber-100 text-amber-700',
  quarantine: 'bg-red-100 text-red-600',
};

export default function QCBatchRow({ batch, decision, onDecide, onRestOverride, product, selected, onToggleSelect }) {
  const restHours = product?.minimum_rest_time_hours || 0;
  const now = new Date();

  const restInfo = useMemo(() => {
    if (!restHours || restHours <= 0) return { met: true, readyAt: null, hoursLeft: 0, ageHours: 0 };
    const readyAt = batch.rest_ready_at ? new Date(batch.rest_ready_at) : null;
    if (readyAt && now >= readyAt) return { met: true, readyAt, hoursLeft: 0, ageHours: 0 };
    // Calculate from cooking run completed_at if rest_ready_at not set
    if (!readyAt) return { met: batch.rest_time_met !== false, readyAt: null, hoursLeft: 0, ageHours: 0 };
    const hoursLeft = Math.max(0, (readyAt - now) / 3600000);
    const producedAt = batch.rest_ready_at ? new Date(new Date(batch.rest_ready_at).getTime() - restHours * 3600000) : null;
    const ageHours = producedAt ? (now - producedAt) / 3600000 : 0;
    return { met: false, readyAt, hoursLeft, ageHours };
  }, [batch, restHours, now]);

  const isApproved = decision === 'approved';
  const isDeclined = decision === 'declined';
  const needsOverride = !restInfo.met && isApproved;

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 transition-colors ${
      isApproved ? 'bg-green-50/50 dark:bg-green-950/10' : isDeclined ? 'bg-red-50/50 dark:bg-red-950/10' : ''
    } ${selected ? 'ring-2 ring-inset ring-primary/30' : ''}`}>
      {/* Selection checkbox */}
      {onToggleSelect && (
        <Checkbox
          checked={!!selected}
          onCheckedChange={() => onToggleSelect(batch.id)}
          className="shrink-0"
        />
      )}
      {/* Batch info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium truncate">{batch.bulk_product_name}</p>
          <Badge className={`text-[10px] ${QS_STYLES[batch.quality_status] || 'bg-muted text-muted-foreground'}`}>
            {batch.quality_status?.replace('_', ' ')}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
          <span className="font-mono">{batch.batch_number}</span>
          <span>{(batch.qty_kg || 0).toFixed(1)} kg</span>
          <span>Produced {batch.produced_date}</span>
          {batch.supplier_name && <span>{batch.supplier_name}</span>}
        </div>
        {/* Rest time warning */}
        {restHours > 0 && !restInfo.met && (
          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-amber-600">
            <Clock className="w-3 h-3" />
            <span>Rest time: {restInfo.hoursLeft.toFixed(1)}h remaining of {restHours}h minimum</span>
          </div>
        )}
      </div>

      {/* Decision buttons */}
      <div className="flex items-center gap-2 shrink-0">
        {!restInfo.met && !decision && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-amber-600 border-amber-300 hover:bg-amber-50 h-9"
            onClick={() => onRestOverride(batch)}
          >
            <Lock className="w-3.5 h-3.5" /> Override & Approve
          </Button>
        )}
        <Button
          variant={isApproved ? 'default' : 'outline'}
          size="sm"
          className={`gap-1.5 h-9 ${isApproved ? 'bg-green-600 hover:bg-green-700 text-white' : 'text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950'}`}
          onClick={() => onDecide(batch.id, 'approved')}
          disabled={!restInfo.met && !decision}
        >
          <CheckCircle2 className="w-3.5 h-3.5" />
          {isApproved ? 'Approved' : 'Approve'}
        </Button>
        <Button
          variant={isDeclined ? 'destructive' : 'outline'}
          size="sm"
          className={`gap-1.5 h-9 ${isDeclined ? '' : 'text-red-700 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950'}`}
          onClick={() => onDecide(batch.id, 'declined')}
        >
          <XCircle className="w-3.5 h-3.5" />
          {isDeclined ? 'Declined' : 'Decline'}
        </Button>
      </div>
    </div>
  );
}