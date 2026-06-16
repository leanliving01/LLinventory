import React, { useState, useMemo } from 'react';
import { supabase, base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, PackageCheck, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { writeAuditLog } from '@/lib/auditLog';
import { CONDITIONS, QC_OUTCOMES } from '@/lib/shopifyReturns';

// Maps a QC outcome to the received-qty bucket it lands in.
function bucketFor(outcome) {
  if (outcome === 'return_to_stock') return 'to_stock';
  if (['needs_manager_review', 'other'].includes(outcome)) return 'quarantine';
  if (outcome) return 'written_off';      // write_off / damaged / opened / expired / incorrect_item
  return null;
}

// GRN-like receipt + per-item Quality Check for an expected return. Only the
// 'Approved — Return to Stock' outcome increases inventory (server-side, via
// receive_shopify_return). Risky outcomes escalate the return to manager review.
export default function ShopifyReturnReceipt({ ret, lines, onDone, courierGateActive = false, canApprove = false, userName = null }) {
  const queryClient = useQueryClient();
  const [locationId, setLocationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  const { data: locations = [] } = useQuery({
    queryKey: ['stock-bearing-locations'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 200),
  });

  const [rowState, setRowState] = useState(() => {
    const init = {};
    for (const l of lines) {
      init[l.id] = {
        qty_received: l.qty_received || l.qty_returned || 0,
        condition: l.condition || 'unopened',
        qc_outcome: l.qc_outcome || '',
        qc_notes: l.qc_notes || '',
      };
    }
    return init;
  });

  const update = (lineId, patch) => {
    setRowState(prev => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  };

  const buckets = (s) => {
    const qr = Number(s.qty_received) || 0;
    const b = bucketFor(s.qc_outcome);
    return {
      qty_to_stock: b === 'to_stock' ? qr : 0,
      qty_written_off: b === 'written_off' ? qr : 0,
      qty_quarantine: b === 'quarantine' ? qr : 0,
    };
  };

  const confirm = async () => {
    if (!locationId) { toast.error('Pick a location for received stock'); return; }
    const anyOutcome = Object.values(rowState).some(r => r.qc_outcome);
    if (!anyOutcome) { toast.error('Set a quality-check outcome on at least one line'); return; }
    if (courierGateActive && !override) {
      toast.error('Courier not booked — confirm the courier first, or use the authorised override.');
      return;
    }
    if (courierGateActive && override && !overrideReason.trim()) {
      toast.error('Enter a reason for overriding the courier-booked gate.');
      return;
    }
    setSaving(true);

    const p_lines = lines.map(l => {
      const s = rowState[l.id];
      const bk = buckets(s);
      const qtyReturned = Number(l.qty_returned) || 0;
      const writeOffValue = qtyReturned > 0
        ? (bk.qty_written_off / qtyReturned) * (Number(l.return_value) || 0)
        : 0;
      return {
        line_id: l.id,
        qty_received: Number(s.qty_received) || 0,
        condition: s.condition || null,
        qc_outcome: s.qc_outcome || null,
        qc_notes: s.qc_notes || null,
        qty_to_stock: bk.qty_to_stock,
        qty_written_off: bk.qty_written_off,
        qty_quarantine: bk.qty_quarantine,
        write_off_value: writeOffValue,
        restock_location_id: locationId,
      };
    });

    const { data, error } = await supabase.rpc('receive_shopify_return', {
      p_return_id: ret.id,
      p_lines,
      p_location_id: locationId,
      p_user: userName,
      p_override: courierGateActive ? override : false,
      p_override_reason: courierGateActive && override ? overrideReason : null,
    });
    setSaving(false);
    if (error) { toast.error(`Receipt failed: ${error.message}`); return; }
    if (data?.status === 'error') {
      toast.error(data.error === 'courier_not_booked'
        ? 'Receipt blocked — the courier must be booked first (or use the override).'
        : `Receipt failed: ${data.error}`);
      return;
    }

    writeAuditLog({
      action: 'receive',
      entity_type: 'ShopifyReturn',
      entity_id: ret.id,
      description: `Received return ${ret.return_number} → ${data?.return_status}`,
    });
    if (data?.exception) {
      toast.warning('Return received — flagged for manager approval (risky QC outcome).');
    } else {
      toast.success(`Return received — ${data?.rows_written || 0} item(s) back to stock`);
    }
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    onDone?.();
  };

  return (
    <div className="space-y-3">
      {courierGateActive && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 space-y-2">
          <p className="text-sm text-orange-800 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> Courier not yet booked — receiving is blocked until the courier is confirmed.
          </p>
          {canApprove ? (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={override} onChange={e => setOverride(e.target.checked)} />
              Authorised override — receive without the courier being booked
            </label>
          ) : (
            <p className="text-xs text-orange-700">A manager can authorise an override to receive anyway.</p>
          )}
          {override && (
            <Input placeholder="Override reason (required)" value={overrideReason} onChange={e => setOverrideReason(e.target.value)} />
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <span className="text-sm font-medium">Receive into location:</span>
        <Select value={locationId} onValueChange={setLocationId}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Select location..." /></SelectTrigger>
          <SelectContent>
            {locations.map(loc => <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground bg-muted/40">
              <th className="text-left px-3 py-2">Item</th>
              <th className="px-2 py-2">Returned</th>
              <th className="px-2 py-2">Received</th>
              <th className="px-2 py-2">Condition</th>
              <th className="px-2 py-2">QC Outcome</th>
              <th className="px-2 py-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => {
              const s = rowState[l.id];
              return (
                <tr key={l.id} className="border-b last:border-b-0 align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{l.product_name || l.sku}</div>
                    <div className="text-xs text-muted-foreground font-mono">{l.sku}{!l.product_id && ' · unmapped'}</div>
                  </td>
                  <td className="px-2 py-2 text-center">{l.qty_returned}</td>
                  <td className="px-2 py-2">
                    <Input type="number" min="0" className="w-16 h-8" value={s.qty_received}
                      onChange={e => update(l.id, { qty_received: e.target.value })} />
                  </td>
                  <td className="px-2 py-2">
                    <Select value={s.condition} onValueChange={v => update(l.id, { condition: v })}>
                      <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CONDITIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-2">
                    <Select value={s.qc_outcome} onValueChange={v => update(l.id, { qc_outcome: v })}>
                      <SelectTrigger className="w-52 h-8"><SelectValue placeholder="Choose outcome..." /></SelectTrigger>
                      <SelectContent>
                        {QC_OUTCOMES.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-2">
                    <Input className="w-40 h-8" placeholder="QC notes" value={s.qc_notes}
                      onChange={e => update(l.id, { qc_notes: e.target.value })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button onClick={confirm} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
          Confirm Receipt & QC
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Only the <strong>Approved — Return to Stock</strong> outcome increases inventory. Write-offs and
        quarantine never add stock. Damaged / Opened / Expired / Needs Manager Review escalate the return
        to a manager-approval exception before any refund or re-send can complete.
      </p>
    </div>
  );
}
