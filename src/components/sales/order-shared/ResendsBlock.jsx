import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Send, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { RESEND_STATUS_LABELS, RESEND_STATUS_COLORS } from '@/lib/salesResends';
import { createResendFromOrder } from '@/lib/createResend';

/** List of re-sends linked to an order + the "Add Re-send" action. */
export default function ResendsBlock({ order, resends = [] }) {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const handleAddResend = async () => {
    setCreating(true);
    try {
      const id = await createResendFromOrder(order.id);
      toast.success('Draft re-send created');
      navigate(`/sales/resends/${id}`);
    } catch (err) {
      toast.error(err.message || 'Could not create re-send');
      setCreating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          onClick={handleAddResend}
          disabled={creating}
          className="inline-flex items-center gap-1.5 text-xs border rounded-md px-3 py-1.5 hover:bg-muted disabled:opacity-60"
        >
          {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Add Re-send
        </button>
      </div>

      {resends.length === 0 ? (
        <p className="text-xs text-muted-foreground rounded-lg border bg-card p-3">
          No re-sends created for this order.
        </p>
      ) : (
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
          <p className="text-xs font-semibold text-blue-700 mb-2 flex items-center gap-1.5">
            <Send className="w-3.5 h-3.5" /> {resends.length} Re-send{resends.length > 1 ? 's' : ''}
          </p>
          <div className="space-y-1.5">
            {resends.map((r) => (
              <Link
                key={r.id}
                to={`/sales/resends/${r.id}`}
                className="flex flex-wrap items-center gap-2 text-xs hover:underline"
              >
                <span className="font-mono">{r.resend_number}</span>
                <Badge className={`text-[10px] py-0 ${RESEND_STATUS_COLORS[r.status] || ''}`}>
                  {RESEND_STATUS_LABELS[r.status] || r.status}
                </Badge>
                {r.stock_deducted && <span className="text-emerald-600">stock out</span>}
                {r.courier_company && (
                  <span className="text-muted-foreground">
                    · {r.courier_company}
                    {r.courier_tracking_ref ? ` ${r.courier_tracking_ref}` : ''}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
