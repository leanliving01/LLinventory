import React, { useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Truck, PackageCheck, ShieldAlert, DollarSign, Send,
  RotateCcw, Boxes, ClipboardCheck, AlertTriangle,
} from 'lucide-react';
import { matchesTab } from '@/lib/shopifyReturns';
import { resendMatchesQueue } from '@/lib/salesResends';

// Returns Operations Dashboard (Phase 4): mirrors the process flow with WIP
// counts. Clicking a card opens the filtered list (returns / refunds / resends).
export default function ReturnsOpsDashboard() {
  const navigate = useNavigate();

  const { data: returns = [], isLoading: lr } = useQuery({
    queryKey: ['shopify-returns'],
    queryFn: () => base44.entities.ShopifyReturn.list('-created_date', 5000),
    staleTime: 20000,
  });
  const { data: resends = [], isLoading: ls } = useQuery({
    queryKey: ['sales-resends'],
    queryFn: () => base44.entities.SalesResend.list('-created_date', 5000),
    staleTime: 20000,
  });

  const rc = (q) => returns.filter(r => matchesTab(r, q)).length;
  const sc = (q) => resends.filter(r => resendMatchesQueue(r, q)).length;

  const groups = useMemo(() => ([
    {
      title: 'Returns in progress',
      cards: [
        { label: 'Draft Returns', count: rc('draft_return'), icon: RotateCcw, to: '/sales/returns?queue=draft_return' },
        { label: 'Courier To Be Booked', count: rc('courier_to_be_booked'), icon: Truck, to: '/sales/returns?queue=courier_to_be_booked', alert: true },
        { label: 'Courier Booked / Awaiting Collection', count: rc('courier_booked'), icon: Truck, to: '/sales/returns?queue=courier_booked' },
        { label: 'Awaiting Warehouse Receival', count: rc('awaiting_receival'), icon: Boxes, to: '/sales/returns?queue=awaiting_receival' },
        { label: 'Received / Awaiting QC', count: rc('received_pending_qc'), icon: PackageCheck, to: '/sales/returns?queue=received_pending_qc' },
        { label: 'QC Exceptions', count: rc('qc_exceptions'), icon: ShieldAlert, to: '/sales/returns?queue=qc_exceptions', alert: true },
      ],
    },
    {
      title: 'Decisions & outcomes',
      cards: [
        { label: 'Awaiting Refund Decision', count: rc('awaiting_refund_decision'), icon: ClipboardCheck, to: '/sales/returns?queue=awaiting_refund_decision' },
        { label: 'Awaiting Re-send Decision', count: sc('resend_awaiting_decision'), icon: Send, to: '/sales/resends?queue=resend_awaiting_decision' },
        { label: 'Re-sends To Be Packed / Sent', count: sc('resend_to_pack'), icon: Send, to: '/sales/resends?queue=resend_to_pack' },
        { label: 'Open Refunds', count: rc('open_refunds'), icon: DollarSign, to: '/sales/refunds?tab=open', alert: true },
        { label: 'Completed Refunds', count: rc('completed_refunds'), icon: DollarSign, to: '/sales/refunds?tab=completed' },
      ],
    },
    {
      title: 'Closed / reference',
      cards: [
        { label: 'Written Off', count: rc('written_off'), icon: AlertTriangle, to: '/sales/returns?queue=written_off' },
        { label: 'Returned To Stock', count: rc('returned_to_stock'), icon: Boxes, to: '/sales/returns?queue=returned_to_stock' },
        { label: 'Completed Returns', count: rc('completed'), icon: PackageCheck, to: '/sales/returns?queue=completed' },
        { label: 'All Returns', count: returns.length, icon: RotateCcw, to: '/sales/returns?queue=all' },
      ],
    },
  ]), [returns, resends]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = lr || ls;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1500px] mx-auto">
      <div className="flex items-center gap-3">
        <LayoutDashboard className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Returns Operations</h1>
        <span className="text-sm text-muted-foreground ml-auto">Click a queue to action it</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-muted border-t-primary rounded-full animate-spin" /></div>
      ) : (
        groups.map(g => (
          <div key={g.title} className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{g.title}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {g.cards.map(c => {
                const Icon = c.icon;
                const hot = c.alert && c.count > 0;
                return (
                  <button key={c.label} onClick={() => navigate(c.to)}
                    className={`text-left rounded-xl border p-4 transition-colors hover:shadow-sm ${hot ? 'border-amber-300 bg-amber-50' : 'bg-card hover:bg-muted/40'}`}>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Icon className={`w-3.5 h-3.5 ${hot ? 'text-amber-600' : ''}`} />
                      {c.label}
                    </div>
                    <div className={`text-2xl font-bold mt-1 ${hot ? 'text-amber-700' : ''}`}>{c.count}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
