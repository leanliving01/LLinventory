import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { AlertTriangle, Truck, ArrowLeftRight } from 'lucide-react';
import { formatDateTimeSAST } from '@/lib/dateUtils';
import { COURIER_LABELS } from '@/lib/shopifyReturns';

// Phase 10: linked operational history for an order — Write-Offs, Courier
// Actions, and Stock Movements traceable back to this order, its returns and
// its re-sends. All read-only; each item links by reference.
const money = (n) => `R ${(Number(n) || 0).toFixed(2)}`;

export default function OrderOperationalHistory({ order, returns = [], resends = [] }) {
  const refIds = useMemo(() => {
    const ids = [order?.id, ...returns.map(r => r.id), ...resends.map(r => r.id)].filter(Boolean);
    return Array.from(new Set(ids));
  }, [order, returns, resends]);

  const { data: movements = [] } = useQuery({
    queryKey: ['order-stock-movements', refIds],
    queryFn: () => base44.entities.StockMovement.filter({ ref_id: refIds }, '-created_date', 300),
    enabled: refIds.length > 0,
  });

  const writeOffs = returns.filter(r => (Number(r.total_write_off_value) || 0) > 0);
  const courierActions = [
    ...returns.filter(r => r.courier_responsibility || r.courier_company || r.courier_status)
      .map(r => ({ key: `ret-${r.id}`, kind: 'Return', ref: r.return_number,
        who: r.courier_responsibility === 'us' ? 'We book' : r.courier_responsibility === 'customer' ? 'Customer' : '—',
        status: COURIER_LABELS[r.courier_status] || r.courier_status || '—',
        company: r.courier_company, tracking: r.courier_tracking_ref, date: r.courier_collection_date })),
    ...resends.filter(r => r.courier_company || r.courier_tracking_ref || r.dispatch_date)
      .map(r => ({ key: `rsn-${r.id}`, kind: 'Re-send', ref: r.resend_number, who: 'Dispatch',
        status: r.status, company: r.courier_company, tracking: r.courier_tracking_ref, date: r.dispatch_date })),
  ];

  return (
    <div className="space-y-5">
      {/* Write-offs */}
      <div className="space-y-2">
        <Heading icon={AlertTriangle}>Write-Offs</Heading>
        {writeOffs.length === 0 ? (
          <Empty>No write-offs recorded against this order.</Empty>
        ) : (
          <div className="rounded-lg border bg-card divide-y">
            {writeOffs.map(r => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <span className="font-mono">{r.return_number}</span>
                <span className="text-rose-600 font-medium">{money(r.total_write_off_value)}</span>
                {r.not_receiving_reason && <span className="text-muted-foreground">· {r.not_receiving_reason.replace(/_/g, ' ')}</span>}
                <span className="text-muted-foreground ml-auto">Reporting only — no stock added back.</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Courier actions */}
      <div className="space-y-2">
        <Heading icon={Truck}>Courier Actions</Heading>
        {courierActions.length === 0 ? (
          <Empty>No courier actions linked to this order.</Empty>
        ) : (
          <div className="rounded-lg border bg-card divide-y">
            {courierActions.map(c => (
              <div key={c.key} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <span className="font-medium">{c.kind}</span>
                <span className="font-mono">{c.ref}</span>
                <span className="text-muted-foreground">{c.who}</span>
                <span className="text-muted-foreground">· {c.status}</span>
                {c.company && <span className="text-muted-foreground">· {c.company}</span>}
                {c.tracking && <span className="text-muted-foreground">· {c.tracking}</span>}
                {c.date && <span className="text-muted-foreground ml-auto">{c.date}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stock movements */}
      <div className="space-y-2">
        <Heading icon={ArrowLeftRight}>Stock Movements</Heading>
        {movements.length === 0 ? (
          <Empty>No stock movements traced to this order, its returns or re-sends.</Empty>
        ) : (
          <div className="rounded-lg border bg-card overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground bg-muted/40">
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">SKU</th>
                  <th className="text-left px-3 py-2">Reason</th>
                  <th className="text-left px-3 py-2">Ref</th>
                  <th className="text-right px-3 py-2">Qty</th>
                </tr>
              </thead>
              <tbody>
                {movements.map(m => {
                  const inbound = !!m.to_location_id;
                  return (
                    <tr key={m.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2 text-muted-foreground">{m.created_date ? formatDateTimeSAST(m.created_date) : '—'}</td>
                      <td className="px-3 py-2 font-mono">{m.product_sku || '—'}</td>
                      <td className="px-3 py-2">{(m.reason || '').replace(/_/g, ' ')}</td>
                      <td className="px-3 py-2 text-muted-foreground">{m.ref_type ? `${m.ref_type.replace(/_/g, ' ')} ${m.ref_number || ''}` : '—'}</td>
                      <td className={`px-3 py-2 text-right font-medium ${inbound ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {inbound ? '+' : '−'}{Math.abs(Number(m.qty) || 0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Heading({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-4 h-4 text-slate-500" />
      <h3 className="text-sm font-semibold">{children}</h3>
    </div>
  );
}
function Empty({ children }) {
  return <p className="text-xs text-muted-foreground rounded-lg border bg-card p-3">{children}</p>;
}
