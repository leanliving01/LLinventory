import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronUp, FileX2, ClipboardCheck } from 'lucide-react';
import { format } from 'date-fns';

const REASON_LABELS = {
  quality_deterioration: 'Quality Deterioration',
  shelf_life_exceeded: 'Shelf Life Expired',
  contamination: 'Contamination',
  damaged: 'Damaged',
  stocktake_variance: 'Stocktake Variance',
  other: 'Other',
};

export default function WriteOffList({ writeOffs }) {
  if (writeOffs.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground bg-card border border-border rounded-xl">
        No write-offs recorded yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {writeOffs.map(wo => (
        <WriteOffRow key={`${wo._type}-${wo.id}`} wo={wo} />
      ))}
    </div>
  );
}

function WriteOffRow({ wo }) {
  const [expanded, setExpanded] = useState(false);
  const isWip = wo._type === 'wip';

  let woLines = [];
  if (isWip && wo.lines) {
    try { woLines = JSON.parse(wo.lines); } catch {}
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isWip ? (
            <ClipboardCheck className="w-4 h-4 text-amber-500" />
          ) : (
            <FileX2 className="w-4 h-4 text-red-500" />
          )}
          <div className="text-left">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold font-mono">{wo._displayNumber || '—'}</p>
              <Badge className={`text-[10px] ${isWip ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                {isWip ? 'Morning QC' : 'Manual'}
              </Badge>
              <Badge className={`text-[10px] ${wo.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                {wo.status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {wo._displayDate && format(new Date(wo._displayDate + 'T00:00:00'), 'dd MMM yyyy')}
              {!isWip && wo.product_name && ` · ${wo.product_name}`}
              {!isWip && wo.product_sku && ` (${wo.product_sku})`}
              {wo.confirmed_by_name && ` · by ${wo.confirmed_by_name}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isWip ? (
            <span className="text-sm font-semibold text-red-600 tabular-nums">
              {(wo.total_qty_kg || 0).toFixed(1)} kg · R {(wo.total_value || 0).toFixed(2)}
            </span>
          ) : (
            <span className="text-sm font-semibold text-red-600 tabular-nums">
              {wo.qty} {wo.uom} · R {(wo.total_value || 0).toFixed(2)}
            </span>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-5 py-3 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground">Reason</span>
              <p className="font-medium">{REASON_LABELS[wo.reason] || wo.reason || '—'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Status</span>
              <p className="font-medium">{wo.status}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Confirmed By</span>
              <p className="font-medium">{wo.confirmed_by_name || wo.approved_by_name || '—'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Confirmed At</span>
              <p className="font-medium">{wo.confirmed_at ? format(new Date(wo.confirmed_at), 'dd MMM yyyy HH:mm') : '—'}</p>
            </div>
          </div>
          {wo.notes && (
            <div className="text-xs">
              <span className="text-muted-foreground">Notes</span>
              <p className="font-medium mt-0.5">{wo.notes}</p>
            </div>
          )}

          {/* WIP write-off lines */}
          {isWip && woLines.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Batches Written Off</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-1.5 pr-4">Product</th>
                    <th className="text-right py-1.5 pr-4">Qty (kg)</th>
                    <th className="text-right py-1.5 pr-4">Cost/kg</th>
                    <th className="text-right py-1.5">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {woLines.map((l, i) => (
                    <tr key={i}>
                      <td className="py-1.5 pr-4">{l.bulk_product_name}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">{(l.qty_kg || 0).toFixed(1)}</td>
                      <td className="py-1.5 pr-4 text-right tabular-nums">R {(l.carrying_cost_per_kg || 0).toFixed(2)}</td>
                      <td className="py-1.5 text-right tabular-nums font-semibold text-red-600">R {(l.total_value || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Manual write-off detail */}
          {!isWip && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mt-2">
              <div>
                <span className="text-muted-foreground">Product</span>
                <p className="font-medium">{wo.product_name} ({wo.product_sku})</p>
              </div>
              <div>
                <span className="text-muted-foreground">Quantity</span>
                <p className="font-medium tabular-nums">{wo.qty} {wo.uom}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Unit Cost</span>
                <p className="font-medium tabular-nums">R {(wo.unit_cost || 0).toFixed(2)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Total Value</span>
                <p className="font-medium tabular-nums text-red-600">R {(wo.total_value || 0).toFixed(2)}</p>
              </div>
              {wo.effective_date && (
                <div>
                  <span className="text-muted-foreground">Effective Date</span>
                  <p className="font-medium">{format(new Date(wo.effective_date + 'T00:00:00'), 'dd MMM yyyy')}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}