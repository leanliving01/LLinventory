import React from 'react';
import { Card } from '@/components/ui/card';
import {
  Plus, Download, Pencil, CreditCard, Truck, XCircle, RotateCcw, Send,
  DollarSign, StickyNote, FileText, Activity, ArrowRightLeft,
} from 'lucide-react';
import { formatDateTimeSAST } from '@/lib/dateUtils';

const EVENT_ICONS = {
  created:         Plus,
  imported:        Download,
  edited:          Pencil,
  payment_updated: CreditCard,
  fulfilled:       Truck,
  cancelled:       XCircle,
  refunded:        DollarSign,
  return_created:  RotateCcw,
  resend_created:  Send,
  cost_added:      Plus,
  note_added:      StickyNote,
  document_added:  FileText,
  status_changed:  ArrowRightLeft,
};

const EVENT_COLORS = {
  created:         'text-emerald-600',
  imported:        'text-sky-600',
  edited:          'text-amber-600',
  payment_updated: 'text-emerald-600',
  fulfilled:       'text-green-600',
  cancelled:       'text-rose-600',
  refunded:        'text-purple-600',
  return_created:  'text-rose-600',
  resend_created:  'text-blue-600',
};

/** Full event timeline, newest first. */
export default function AuditHistoryTab({ events = [] }) {
  const sorted = [...events].sort(
    (a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0)
  );

  if (sorted.length === 0) {
    return (
      <Card className="p-6 text-center">
        <Activity className="w-6 h-6 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm text-muted-foreground">No history recorded for this order.</p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <p className="text-sm font-semibold mb-4 flex items-center gap-1.5">
        <Activity className="w-4 h-4" /> Audit History
      </p>
      <ol className="relative border-l border-border ml-2 space-y-4">
        {sorted.map((e) => {
          const Icon = EVENT_ICONS[e.event_type] || Activity;
          const color = EVENT_COLORS[e.event_type] || 'text-slate-500';
          return (
            <li key={e.id} className="ml-4">
              <span className="absolute -left-[9px] flex items-center justify-center w-4 h-4 bg-card rounded-full ring-4 ring-background">
                <Icon className={`w-3.5 h-3.5 ${color}`} />
              </span>
              <div className="flex items-center justify-between flex-wrap gap-x-2">
                <span className="text-sm font-medium capitalize">
                  {(e.event_type || '').replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-muted-foreground">
                  {e.created_date ? formatDateTimeSAST(e.created_date) : ''}
                </span>
              </div>
              {e.description && <p className="text-sm text-slate-700">{e.description}</p>}
              {e.actor && <p className="text-xs text-muted-foreground">by {e.actor}</p>}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
