import React, { useState, useMemo } from 'react';
import { supabase, base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { writeAuditLog } from '@/lib/auditLog';
import { CONDITIONS } from '@/lib/shopifyReturns';

// GRN-like receipt + QC for an expected return. Only 'return_to_stock' qty
// increases inventory (server-side, via receive_shopify_return).
export default function ShopifyReturnReceipt({ ret, lines, onDone }) {
  const queryClient = useQueryClient();
  const [locationId, setLocationId] = useState('');
  const [saving, setSaving] = useState(false);

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
        qc_status: l.qc_status || 'pending',
        qc_notes: l.qc_notes || '',
        stock_decision: l.stock_decision || '',
        qty_to_stock: l.qty_to_stock || 0,
        qty_written_off: l.qty_written_off || 0,
        qty_quarantine: l.qty_quarantine || 0,
      };
    }
    return init;
  });

  const update = (lineId, patch) => {
    setRowState(prev => {
      const next = { ...prev[lineId], ...patch };
      // Auto-route the received qty to the chosen decision bucket.
      if (patch.stock_decision || patch.qty_received !== undefined) {
        const qr = Number(next.qty_received) || 0;
        if (next.stock_decision === 'return_to_stock') { next.qty_to_stock = qr; next.qty_written_off = 0; next.qty_quarantine = 0; }
        else if (next.stock_decision === 'write_off') { next.qty_written_off = qr; next.qty_to_stock = 0; next.qty_quarantine = 0; }
        else if (next.stock_decision === 'quarantine') { next.qty_quarantine = qr; next.qty_to_stock = 0; next.qty_written_off = 0; }
      }
      return { ...prev, [lineId]: next };
    });
  };

  const linesById = useMemo(() => Object.fromEntries(lines.map(l => [l.id, l])), [lines]);

  const confirm = async () => {
    if (!locationId) { toast.error('Pick a location for received stock'); return; }
    const anyDecision = Object.values(rowState).some(r => r.stock_decision);
    if (!anyDecision) { toast.error('Set a stock decision on at least one line'); return; }
    setSaving(true);

    const p_lines = lines.map(l => {
      const s = rowState[l.id];
      const qtyReturned = Number(l.qty_returned) || 0;
      const writeOffValue = qtyReturned > 0
        ? (Number(s.qty_written_off) || 0) / qtyReturned * (Number(l.return_value) || 0)
        : 0;
      return {
        line_id: l.id,
        qty_received: Number(s.qty_received) || 0,
        condition: s.condition || null,
        qc_status: s.qc_status || null,
        qc_notes: s.qc_notes || null,
        stock_decision: s.stock_decision || null,
        qty_to_stock: Number(s.qty_to_stock) || 0,
        qty_written_off: Number(s.qty_written_off) || 0,
        qty_quarantine: Number(s.qty_quarantine) || 0,
        write_off_value: writeOffValue,
        restock_location_id: locationId,
      };
    });

    const { data, error } = await supabase.rpc('receive_shopify_return', {
      p_return_id: ret.id,
      p_lines,
      p_location_id: locationId,
      p_user: null,
    });
    setSaving(false);
    if (error) { toast.error(`Receipt failed: ${error.message}`); return; }

    writeAuditLog({
      action: 'receive',
      entity_type: 'ShopifyReturn',
      entity_id: ret.id,
      description: `Received return ${ret.return_number} → ${data?.return_status}`,
    });
    toast.success(`Return received — ${data?.rows_written || 0} item(s) back to stock`);
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    onDone?.();
  };

  return (
    <div className="space-y-3">
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
              <th className="px-2 py-2">QC</th>
              <th className="px-2 py-2">Decision</th>
              <th className="px-2 py-2">To Stock</th>
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
                    <Select value={s.qc_status} onValueChange={v => update(l.id, { qc_status: v })}>
                      <SelectTrigger className="w-24 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="pass">Pass</SelectItem>
                        <SelectItem value="fail">Fail</SelectItem>
                        <SelectItem value="review">Review</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-2">
                    <Select value={s.stock_decision} onValueChange={v => update(l.id, { stock_decision: v })}>
                      <SelectTrigger className="w-36 h-8"><SelectValue placeholder="Decide..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="return_to_stock">Return to Stock</SelectItem>
                        <SelectItem value="write_off">Write Off</SelectItem>
                        <SelectItem value="quarantine">Quarantine</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 py-2">
                    <Input type="number" min="0" className="w-16 h-8"
                      value={s.qty_to_stock}
                      disabled={s.stock_decision !== 'return_to_stock'}
                      onChange={e => update(l.id, { qty_to_stock: e.target.value })} />
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
          Confirm Receipt
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Only quantities decided <strong>Return to Stock</strong> increase inventory. Write-offs and
        quarantine never add stock — write-offs are recorded for reporting only.
      </p>
    </div>
  );
}
