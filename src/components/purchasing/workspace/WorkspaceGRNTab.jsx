import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, PackageCheck, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { confirmGRN, validateGRNLines } from '@/components/grn/GRNConfirmLogic';
import ValidationErrorBanner from '@/components/purchasing/ValidationErrorBanner';
import { nextDocNumber } from '@/lib/docNumbering';
import { useAuth } from '@/lib/AuthContext';

function GRNRow({ grn }) {
  return (
    <div className="flex items-center gap-4 p-4 border border-border rounded-xl bg-card">
      <CheckCircle2 className={`w-5 h-5 shrink-0 ${grn.status === 'confirmed' ? 'text-green-600' : 'text-amber-500'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold font-mono">{grn.grn_number}</p>
        <p className="text-xs text-muted-foreground">Received: {grn.received_date || '—'} · By: {grn.received_by_name || '—'}</p>
        {grn.has_shortages && <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Shortages</span>}
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold">R {(grn.total_received_value || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</p>
        <Badge className={`text-[10px] mt-1 ${grn.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
          {grn.status}
        </Badge>
      </div>
    </div>
  );
}

export default function WorkspaceGRNTab({ po, grns = [], poLines = [], onGRNCreated }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [locationId, setLocationId] = useState('');
  const [receivedQtys, setReceivedQtys] = useState({});
  const [saving, setSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 50),
  });
  const { data: supplierProducts = [] } = useQuery({
    queryKey: ['supplier-products-for-br', po?.supplier_id],
    queryFn: () => base44.entities.SupplierProduct.filter({ supplier_id: po.supplier_id, active: true }, 'product_name', 200),
    enabled: !!po?.supplier_id,
  });

  const spByProductId = useMemo(() => {
    const m = {};
    supplierProducts.forEach(sp => { m[sp.product_id] = sp; });
    return m;
  }, [supplierProducts]);

  const handleConfirmGRN = async () => {
    if (!locationId) { toast.error('Select a delivery location'); return; }

    setSaving(true);
    setValidationErrors([]);

    try {
      const grnNumber = await nextDocNumber('GRN');
      const today = new Date().toISOString().slice(0, 10);

      const grn = {
        id: null,
        grn_number: grnNumber,
        purchase_order_id: po.id,
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name,
        location_id: locationId,
        status: 'draft',
        received_date: today,
      };

      const grnLines = poLines.map(l => {
        const sp = spByProductId[l.product_id];
        const cf = sp?.conversion_factor || sp?.purchase_to_stock_factor || 1;
        return {
          product_id: l.product_id,
          product_name: l.product_name,
          product_sku: l.product_sku,
          supplier_product_id: sp?.id || null,
          expected_qty: parseFloat(l.ordered_qty) || 0,
          received_qty: parseFloat(receivedQtys[l.id] ?? '') || 0,
          unit_cost: parseFloat(l.unit_cost) || 0,
          purchase_uom: l.uom || '',
          conversion_factor: cf,
          yield_factor: 1,
          condition: 'accepted',
          item_type: 'stock',
        };
      });

      const errors = validateGRNLines(grn, grnLines);
      if (errors.length > 0) {
        setValidationErrors(errors);
        setSaving(false);
        return;
      }

      // Persist the GRN first so it has an ID
      const created = await base44.entities.GoodsReceivedNote.create({
        grn_number: grnNumber,
        purchase_order_id: po.id,
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name,
        location_id: locationId,
        status: 'draft',
        received_date: today,
      });

      const grnWithId = { ...grn, id: created.id };
      const linesWithGRNId = grnLines.map(l => ({ ...l, grn_id: created.id }));

      await confirmGRN(grnWithId, linesWithGRNId, user?.full_name || user?.email || 'System');

      toast.success(`GRN ${grnNumber} confirmed — stock updated`);
      setShowCreate(false);
      setReceivedQtys({});
      qc.invalidateQueries({ queryKey: ['workspace-grns', po.id] });
      onGRNCreated && onGRNCreated();
    } catch (err) {
      if (err.validationErrors) {
        setValidationErrors(err.validationErrors);
      } else {
        toast.error(`Failed: ${err.message}`);
      }
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Goods Received Notes</h3>
        {!showCreate && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus className="w-3.5 h-3.5" /> Create GRN
          </Button>
        )}
      </div>

      {grns.length === 0 && !showCreate && (
        <div className="text-center py-10 text-sm text-muted-foreground">
          No GRNs yet. Click "Create GRN" to confirm receipt of goods.
        </div>
      )}

      {grns.map(grn => <GRNRow key={grn.id} grn={grn} />)}

      {showCreate && (
        <div className="border border-border rounded-xl p-4 space-y-4 bg-muted/20">
          <h4 className="text-sm font-semibold">New GRN — Pre-filled from PO</h4>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Delivery Location *</label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select location..." /></SelectTrigger>
              <SelectContent>
                {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <ValidationErrorBanner errors={validationErrors} />

          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">Ordered</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-36">Received Qty *</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">Unit Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {poLines.map(l => (
                  <tr key={l.id}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{l.product_name}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">{l.product_sku}</p>
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{l.ordered_qty} {l.uom}</td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        value={receivedQtys[l.id] ?? ''}
                        onChange={e => setReceivedQtys(prev => ({ ...prev, [l.id]: e.target.value }))}
                        placeholder={String(l.ordered_qty || 0)}
                        className="h-8 text-sm text-right"
                        min="0"
                        step="0.001"
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">R {(l.unit_cost || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setShowCreate(false); setValidationErrors([]); }}>Cancel</Button>
            <Button className="gap-2" onClick={handleConfirmGRN} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
              Confirm Receipt & Update Stock
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
