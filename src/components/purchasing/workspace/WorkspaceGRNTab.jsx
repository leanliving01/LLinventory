import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Plus, PackageCheck, Loader2, CheckCircle2, ChevronDown, AlertTriangle, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { confirmGRN, validateGRNLines, finaliseGRNWithDecisions } from '@/components/grn/GRNConfirmLogic';
import ValidationErrorBanner from '@/components/purchasing/ValidationErrorBanner';
import { nextDocNumber } from '@/lib/docNumbering';
import { useAuth } from '@/lib/AuthContext';
import GRNDrawer from '@/components/grn/GRNDrawer';

function ExpandableGRNRow({ grn, lines, poLines, onOpenDrawer }) {
  const [open, setOpen] = useState(false);
  const grnLines = lines.filter(l => l.grn_id === grn.id);

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      <button
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <CheckCircle2 className={`w-5 h-5 shrink-0 ${grn.status === 'confirmed' ? 'text-green-600' : 'text-amber-500'}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold font-mono">{grn.grn_number}</p>
          <p className="text-xs text-muted-foreground">
            Received: {grn.received_date || '—'} · By: {grn.received_by_name || '—'}
          </p>
          {grn.has_shortages && (
            <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Shortages</span>
          )}
        </div>
        <div className="text-right shrink-0 flex flex-col items-end gap-1">
          <p className="text-sm font-bold">R {(grn.total_received_value || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</p>
          <Badge className={`text-[10px] ${grn.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
            {grn.status}
          </Badge>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        <Button
          variant="ghost"
          size="sm"
          className="text-xs gap-1 shrink-0 h-7"
          onClick={(e) => { e.stopPropagation(); onOpenDrawer && onOpenDrawer(grn); }}
        >
          <ExternalLink className="w-3 h-3" /> Details
        </Button>
      </button>

      {open && grnLines.length > 0 && (
        <div className="border-t border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left px-3 py-2 font-semibold text-muted-foreground uppercase text-[10px]">Product</th>
                <th className="text-right px-3 py-2 font-semibold text-muted-foreground uppercase text-[10px]">Ordered</th>
                <th className="text-right px-3 py-2 font-semibold text-muted-foreground uppercase text-[10px]">Received</th>
                <th className="text-right px-3 py-2 font-semibold text-muted-foreground uppercase text-[10px]">Still Short</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {grnLines.map(gl => {
                const poLine = poLines.find(p => p.product_id === gl.product_id);
                const orderedQty = parseFloat(poLine?.ordered_qty) || 0;
                const totalReceived = gl._totalReceived || 0;
                const stillShort = Math.max(0, orderedQty - totalReceived);
                return (
                  <tr key={gl.id}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{gl.product_name}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">{gl.product_sku}</p>
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{orderedQty}</td>
                    <td className="px-3 py-2 text-right font-medium">{gl.received_qty}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${stillShort > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                      {stillShort > 0 ? stillShort : '✓ Complete'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && grnLines.length === 0 && (
        <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          No line detail available.
        </div>
      )}
    </div>
  );
}

export default function WorkspaceGRNTab({ po, grns = [], poLines = [], onGRNCreated }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [drawerGRN, setDrawerGRN] = useState(null);
  const [locationId, setLocationId] = useState('');
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [receivedQtys, setReceivedQtys] = useState({});
  const [saving, setSaving] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);

  // Shortage decision step
  const [pendingDecision, setPendingDecision] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [expectedDates, setExpectedDates] = useState({});

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

  // Fetch GRN lines for all GRNs in this PO so we can show per-line detail
  const grnIds = useMemo(() => grns.map(g => g.id), [grns]);
  const { data: allGrnLines = [] } = useQuery({
    queryKey: ['grn-lines-for-po', po.id, grnIds.join(',')],
    queryFn: async () => {
      if (!grnIds.length) return [];
      const chunks = await Promise.all(
        grnIds.map(id => base44.entities.GRNLine.filter({ grn_id: id }, 'product_name', 100))
      );
      return chunks.flat();
    },
    enabled: grnIds.length > 0,
  });

  const totalReceivedByProductId = useMemo(() => {
    const m = {};
    allGrnLines.forEach(l => {
      m[l.product_id] = (m[l.product_id] || 0) + (parseFloat(l.received_qty) || 0);
    });
    return m;
  }, [allGrnLines]);

  // Already-received per PO line, so a follow-up GRN only expects the REMAINING qty
  const receivedByPoLineId = useMemo(() => {
    const m = {};
    allGrnLines.forEach(l => {
      if (l.po_line_id) m[l.po_line_id] = (m[l.po_line_id] || 0) + (parseFloat(l.received_qty) || 0);
    });
    return m;
  }, [allGrnLines]);

  // "Already received" from the strongest available source so a follow-up GRN only
  // offers the REMAINING qty even if older GRN lines predate po_line_id.
  const alreadyReceivedForLine = (l) => Math.max(
    receivedByPoLineId[l.id] || 0,            // GRN lines linked by po_line_id
    totalReceivedByProductId[l.product_id] || 0, // GRN lines matched by product
    parseFloat(l.received_qty) || 0,          // the PO line's own received_qty field
  );

  const remainingForLine = (l) =>
    Math.max(0, (parseFloat(l.ordered_qty) || 0) - alreadyReceivedForLine(l));

  const enrichedLines = useMemo(() =>
    allGrnLines.map(l => ({ ...l, _totalReceived: totalReceivedByProductId[l.product_id] || 0 })),
    [allGrnLines, totalReceivedByProductId]
  );

  const handleConfirmGRN = async () => {
    if (!locationId) { toast.error('Select a delivery location'); return; }

    setSaving(true);
    setValidationErrors([]);

    try {
      const grnNumber = await nextDocNumber('GRN');

      const grn = {
        id: null,
        grn_number: grnNumber,
        purchase_order_id: po.id,
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name,
        location_id: locationId,
        status: 'draft',
        received_date: receivedDate,
      };

      const grnLines = poLines.map(l => {
        const sp = spByProductId[l.product_id];
        const cf = sp?.conversion_factor || sp?.purchase_to_stock_factor || 1;
        return {
          po_line_id: l.id,
          product_id: l.product_id,
          product_name: l.product_name,
          product_sku: l.product_sku,
          supplier_product_id: sp?.id || null,
          expected_qty: remainingForLine(l),
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

      const created = await base44.entities.GoodsReceivedNote.create({
        grn_number: grnNumber,
        purchase_order_id: po.id,
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name,
        location_id: locationId,
        status: 'draft',
        received_date: receivedDate,
      });

      const grnWithId = { ...grn, id: created.id };
      const linesWithGRNId = grnLines.map(l => ({ ...l, grn_id: created.id }));

      const result = await confirmGRN(grnWithId, linesWithGRNId, user?.full_name || user?.email || 'System');

      if (result.requiresDecision) {
        // Shortage detected — show per-line decision step before finalising
        const initDecisions = {};
        result.shortLines.forEach(l => { initDecisions[l.id] = 'receive_later'; });
        setPendingDecision(result);
        setDecisions(initDecisions);
        setSaving(false);
        return;
      }

      toast.success(`GRN ${grnNumber} confirmed — stock updated`);
      resetCreateForm();
      qc.invalidateQueries({ queryKey: ['workspace-grns', po.id] });
      qc.invalidateQueries({ queryKey: ['grn-lines-for-po', po.id] });
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

  const handleFinaliseDecisions = async () => {
    setSaving(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(decisions).map(([id, action]) => [
          id,
          { action, expected_delivery_date: action === 'receive_later' ? (expectedDates[id] || null) : null },
        ])
      );
      await finaliseGRNWithDecisions(
        pendingDecision.grn,
        pendingDecision.persistedLines,
        payload,
        user?.full_name || user?.email || 'System'
      );
      toast.success(`GRN ${pendingDecision.grn.grn_number} confirmed`);
      setPendingDecision(null);
      setDecisions({});
      resetCreateForm();
      qc.invalidateQueries({ queryKey: ['workspace-grns', po.id] });
      qc.invalidateQueries({ queryKey: ['grn-lines-for-po', po.id] });
      onGRNCreated && onGRNCreated();
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
      setSaving(false);
    }
  };

  const resetCreateForm = () => {
    setShowCreate(false);
    setReceivedQtys({});
    setReceivedDate(new Date().toISOString().slice(0, 10));
    setValidationErrors([]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Goods Received Notes</h3>
        {!showCreate && !pendingDecision && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus className="w-3.5 h-3.5" /> Create GRN
          </Button>
        )}
      </div>

      {grns.length === 0 && !showCreate && !pendingDecision && (
        <div className="text-center py-10 text-sm text-muted-foreground">
          No GRNs yet. Click "Create GRN" to confirm receipt of goods.
        </div>
      )}

      {grns.map(grn => (
        <ExpandableGRNRow
          key={grn.id}
          grn={grn}
          lines={enrichedLines}
          poLines={poLines}
          onOpenDrawer={setDrawerGRN}
        />
      ))}

      {/* ── Shortage decision step (replaces create form) ── */}
      {pendingDecision && (
        <div className="border border-amber-200 rounded-xl p-4 space-y-4 bg-amber-50/40">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-800">Shortage Detected</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Some items were short-received. Choose how to handle each shortage, then finalise the GRN.
              </p>
            </div>
          </div>

          <div className="border border-border rounded-lg overflow-hidden bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Expected</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Received</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Short</th>
                  <th className="px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pendingDecision.shortLines.map(l => {
                  const short = parseFloat(l.expected_qty) - parseFloat(l.received_qty);
                  return (
                    <tr key={l.id}>
                      <td className="px-3 py-2">
                        <p className="font-medium">{l.product_name}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">{l.product_sku}</p>
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{l.expected_qty}</td>
                      <td className="px-3 py-2 text-right">{l.received_qty}</td>
                      <td className="px-3 py-2 text-right font-semibold text-amber-600">{short}</td>
                      <td className="px-3 py-2 min-w-[200px]">
                        <Select
                          value={decisions[l.id] || 'receive_later'}
                          onValueChange={val => setDecisions(prev => ({ ...prev, [l.id]: val }))}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="receive_later">Wait for delivery</SelectItem>
                            <SelectItem value="request_credit">Request credit note</SelectItem>
                          </SelectContent>
                        </Select>
                        {(decisions[l.id] || 'receive_later') === 'receive_later' && (
                          <div className="mt-1.5">
                            <label className="text-[10px] text-muted-foreground">Expected next delivery</label>
                            <Input
                              type="date"
                              value={expectedDates[l.id] || ''}
                              onChange={e => setExpectedDates(prev => ({ ...prev, [l.id]: e.target.value }))}
                              className="h-8 text-xs mt-0.5"
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            <strong>Wait for delivery</strong> — stock received now is added; PO stays open and the shortage is tracked as "Awaiting remaining receival" until the next GRN.<br />
            <strong>Request credit note</strong> — raises a shortage for credit; PO moves to credit-note pending.
          </p>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setPendingDecision(null); setDecisions({}); setExpectedDates({}); }}>Cancel</Button>
            <Button className="gap-2" onClick={handleFinaliseDecisions} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Finalise GRN
            </Button>
          </div>
        </div>
      )}

      {/* ── Create GRN form ── */}
      {showCreate && !pendingDecision && (
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

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Received Date *</label>
            <Input
              type="date"
              value={receivedDate}
              onChange={e => setReceivedDate(e.target.value)}
              className="mt-1"
            />
          </div>

          <ValidationErrorBanner errors={validationErrors} />

          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-24">Ordered</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-24">Already</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-24">Remaining</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-36">Received Qty *</th>
                  <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">Unit Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {poLines.map(l => {
                  const already = alreadyReceivedForLine(l);
                  const remaining = remainingForLine(l);
                  const done = remaining <= 0;
                  return (
                  <tr key={l.id} className={done ? 'opacity-50' : ''}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{l.product_name}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">{l.product_sku}</p>
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{l.ordered_qty} {l.uom}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{already || '—'}</td>
                    <td className="px-3 py-2 text-right font-medium">{remaining}</td>
                    <td className="px-3 py-2">
                      {done ? (
                        <span className="text-[10px] text-green-600 font-medium block text-right">Fully received</span>
                      ) : (
                        <Input
                          type="number"
                          value={receivedQtys[l.id] ?? ''}
                          onChange={e => setReceivedQtys(prev => ({ ...prev, [l.id]: e.target.value }))}
                          placeholder={String(remaining)}
                          className="h-8 text-sm text-right"
                          min="0"
                          max={remaining}
                          step="0.001"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">R {(l.unit_cost || 0).toFixed(2)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={resetCreateForm}>Cancel</Button>
            <Button className="gap-2" onClick={handleConfirmGRN} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
              Confirm Receipt & Update Stock
            </Button>
          </div>
        </div>
      )}

      {/* Full-screen GRN detail/edit drawer */}
      {drawerGRN && (
        <GRNDrawer
          grn={drawerGRN}
          onClose={() => setDrawerGRN(null)}
          onUpdated={() => {
            setDrawerGRN(null);
            qc.invalidateQueries({ queryKey: ['workspace-grns', po.id] });
            qc.invalidateQueries({ queryKey: ['grn-lines-for-po', po.id] });
            onGRNCreated && onGRNCreated();
          }}
        />
      )}
    </div>
  );
}
