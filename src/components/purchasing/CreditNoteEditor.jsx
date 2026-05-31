import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, CreditCard, Loader2, AlertTriangle, Plus, Search, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { nextDocNumber } from '@/lib/docNumbering';
import { resolveTaxRateRecord } from '@/lib/taxResolution';
import { shortageKind, createCreditNote, saveCreditNoteDraft } from '@/lib/shortageEngine';

const RESOLVED = ['resolved', 'cancelled', 'credit_received'];
const rnd2 = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;
const fmtR = (v) => `R ${(parseFloat(v) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`;

/**
 * Full-screen supplier credit-note document editor.
 * Props:
 *   po            – the purchase order
 *   shortages     – the PO's shortages (open credit ones are pre-seeded as lines)
 *   existingCreditNote – when set, opens read-only view of an existing SCN
 *   onCreated / onCancel
 */
export default function CreditNoteEditor({ po, shortages = [], existingCreditNote = null, onCreated, onCancel }) {
  const { user } = useAuth();
  const isDraft = existingCreditNote?.status === 'draft';
  const viewMode = !!existingCreditNote && !isDraft;   // finalised → read-only
  const editMode = !viewMode;                           // new or draft → editable

  const { data: taxRates = [] } = useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => base44.entities.TaxRate.filter({ active: true }, 'name', 20),
    staleTime: 300000,
  });
  const { data: supplier = null } = useQuery({
    queryKey: ['supplier-single', po.supplier_id],
    queryFn: async () => (await base44.entities.Supplier.filter({ id: po.supplier_id }))[0] || null,
    enabled: !!po.supplier_id,
  });
  const { data: supplierProducts = [] } = useQuery({
    queryKey: ['supplier-products-for-cn', po.supplier_id],
    queryFn: () => base44.entities.SupplierProduct.filter({ supplier_id: po.supplier_id, active: true }, 'product_name', 200),
    enabled: !!po.supplier_id && editMode,
  });

  // Existing CN lines (view or draft-edit)
  const { data: savedLines = [] } = useQuery({
    queryKey: ['scn-lines', existingCreditNote?.id],
    queryFn: () => base44.entities.SupplierCreditNoteLine.filter({ credit_note_id: existingCreditNote.id }, 'created_date', 100),
    enabled: !!existingCreditNote,
  });

  const defaultTax = useMemo(
    () => taxRates.find(t => Math.abs((t.rate || 0) - 0.15) < 0.001) || taxRates[0] || null,
    [taxRates]
  );

  const [supplierCnNumber, setSupplierCnNumber] = useState(existingCreditNote?.supplier_credit_note_number || '');
  const [creditNoteDate, setCreditNoteDate] = useState(existingCreditNote?.credit_note_date || new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(existingCreditNote?.notes || '');
  const [capturedTotal, setCapturedTotal] = useState(existingCreditNote?.captured_total != null ? String(existingCreditNote.captured_total) : '');
  const [lines, setLines] = useState([]);
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Seed editable lines: a new CN seeds from the PO's open credit shortages; a draft
  // seeds from its saved lines.
  useEffect(() => {
    if (!editMode || seeded) return;
    if (isDraft) {
      if (!savedLines.length) return; // wait for load
      setLines(savedLines.map(l => ({
        key: l.id,
        shortage_id: l.shortage_id || null,
        return_id: l.return_id || null,
        product_id: l.product_id,
        product_name: l.product_name,
        product_sku: l.product_sku,
        credit_qty: String(l.credit_qty ?? ''),
        unit_cost_excl: String(l.unit_cost_excl ?? ''),
        tax_rate_id: l.tax_rate_id || null,
        tax_rule: l.tax_rule || '',
        tax_rate: parseFloat(l.tax_rate) || 0,
      })));
      setSeeded(true);
      return;
    }
    if (!defaultTax) return;
    const creditShortages = shortages.filter(s =>
      shortageKind(s.decision) === 'credit' && !RESOLVED.includes(s.status)
    );
    setLines(creditShortages.map(s => ({
      key: s.id,
      shortage_id: s.id,
      return_id: null,
      product_id: s.product_id,
      product_name: s.product_name,
      product_sku: s.product_sku,
      credit_qty: String(s.shortage_qty ?? ''),
      unit_cost_excl: String(s.unit_cost ?? ''),
      tax_rate_id: defaultTax.id,
      tax_rule: defaultTax.name,
      tax_rate: defaultTax.rate || 0,
    })));
    setSeeded(true);
  }, [editMode, isDraft, seeded, defaultTax, shortages, savedLines]);

  const update = (key, field, value) => setLines(prev => prev.map(l => l.key === key ? { ...l, [field]: value } : l));
  const removeLine = (key) => setLines(prev => prev.filter(l => l.key !== key));

  const setLineTax = (key, taxRateId) => {
    const tr = taxRates.find(t => t.id === taxRateId);
    setLines(prev => prev.map(l => l.key === key ? { ...l, tax_rate_id: taxRateId, tax_rule: tr?.name || '', tax_rate: tr?.rate || 0 } : l));
  };

  const addProduct = (sp) => {
    const tr = resolveTaxRateRecord(sp, supplier, taxRates) || defaultTax;
    setLines(prev => [...prev, {
      key: `sp-${sp.id}-${Date.now()}`,
      shortage_id: null,
      return_id: null,
      product_id: sp.product_id,
      product_name: sp.product_name,
      product_sku: sp.product_sku,
      credit_qty: '1',
      unit_cost_excl: String(sp.last_purchase_price || 0),
      tax_rate_id: tr?.id || null,
      tax_rule: tr?.name || '',
      tax_rate: tr?.rate || 0,
    }]);
    setShowPicker(false);
    setSearch('');
  };

  const filteredSPs = useMemo(() => {
    const existing = new Set(lines.map(l => l.product_id));
    let list = supplierProducts.filter(sp => !existing.has(sp.product_id));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(sp => (sp.product_name || '').toLowerCase().includes(q) || (sp.product_sku || '').toLowerCase().includes(q));
    }
    return list.slice(0, 20);
  }, [supplierProducts, lines, search]);

  // Compute per-line + totals
  const rows = useMemo(() => {
    const src = viewMode ? savedLines.map(l => ({
      key: l.id, ...l,
      credit_qty: l.credit_qty, unit_cost_excl: l.unit_cost_excl, tax_rate: l.tax_rate,
    })) : lines;
    return src.map(l => {
      const qty = parseFloat(l.credit_qty) || 0;
      const cost = parseFloat(l.unit_cost_excl) || 0;
      const rate = parseFloat(l.tax_rate) || 0;
      const excl = rnd2(qty * cost);
      const incl = rnd2(excl * (1 + rate));
      return { ...l, _excl: excl, _incl: incl };
    });
  }, [viewMode, savedLines, lines]);

  const subtotal = rnd2(rows.reduce((s, r) => s + r._excl, 0));
  const total = rnd2(rows.reduce((s, r) => s + r._incl, 0));
  const vat = rnd2(total - subtotal);

  // Per-line warnings vs the linked shortage: short quantity and/or price variance
  const shortageById = useMemo(() => Object.fromEntries(shortages.map(s => [s.id, s])), [shortages]);
  const warnings = useMemo(() => {
    if (viewMode) return [];
    const out = [];
    rows.forEach(r => {
      if (!r.shortage_id) return;
      const s = shortageById[r.shortage_id];
      if (!s) return;
      const expectedQty = parseFloat(s.shortage_qty) || 0;
      const expectedCost = parseFloat(s.unit_cost) || 0;
      const creditedQty = parseFloat(r.credit_qty) || 0;
      const creditedCost = parseFloat(r.unit_cost_excl) || 0;
      if (creditedQty < expectedQty - 0.001) {
        const shortUnits = rnd2(expectedQty - creditedQty);
        out.push({ type: 'qty', text: `Short quantity on ${r.product_name}: crediting ${creditedQty} of ${expectedQty} units (short ${shortUnits}) — the shortage will stay open.` });
      }
      if (Math.abs(creditedCost - expectedCost) > 0.001) {
        const perUnit = rnd2(creditedCost - expectedCost);
        out.push({ type: 'price', text: `Price variance on ${r.product_name}: credited R${creditedCost.toFixed(2)}/unit vs R${expectedCost.toFixed(2)}/unit expected (R${perUnit.toFixed(2)}/unit).` });
      }
    });
    return out;
  }, [viewMode, rows, shortageById]);

  const captured = viewMode ? existingCreditNote.captured_total : (capturedTotal === '' ? null : parseFloat(capturedTotal));
  const variance = (captured != null) ? rnd2(captured - (viewMode ? (existingCreditNote.total || 0) : total)) : null;

  const buildPayloadLines = () => rows.map(r => ({
    shortage_id: r.shortage_id || null,
    return_id: r.return_id || null,
    product_id: r.product_id,
    product_name: r.product_name,
    product_sku: r.product_sku,
    credit_qty: parseFloat(r.credit_qty) || 0,
    unit_cost_excl: parseFloat(r.unit_cost_excl) || 0,
    tax_rate_id: r.tax_rate_id || null,
    tax_rule: r.tax_rule || '',
    tax_rate: parseFloat(r.tax_rate) || 0,
    line_total_excl: r._excl,
    line_total_incl: r._incl,
  }));

  const buildHeader = (scnNumber) => ({
    scn_number: scnNumber,
    supplierCreditNoteNumber: supplierCnNumber.trim(),
    creditNoteDate,
    notes,
    capturedTotal: capturedTotal === '' ? null : parseFloat(capturedTotal),
  });

  // Save as draft — no matches, no shortage reconciliation
  const handleSaveDraft = async () => {
    if (lines.length === 0) { toast.error('Add at least one credit line'); return; }
    setSaving(true);
    try {
      const scnNumber = existingCreditNote?.scn_number || await nextDocNumber('SCN');
      await saveCreditNoteDraft({
        po,
        header: buildHeader(scnNumber),
        lines: buildPayloadLines(),
        existingId: existingCreditNote?.id || null,
        userName: user?.full_name || user?.email || 'System',
      });
      toast.success('Credit note saved as draft');
      onCreated();
    } catch (err) {
      toast.error('Failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  // Approve — runs reconciliation; updates the draft in place if approving one
  const handleSave = async () => {
    if (!supplierCnNumber.trim()) { toast.error('Enter the supplier credit note number'); return; }
    if (lines.length === 0) { toast.error('Add at least one credit line'); return; }
    setSaving(true);
    try {
      const scnNumber = existingCreditNote?.scn_number || await nextDocNumber('SCN');
      await createCreditNote({
        po,
        header: buildHeader(scnNumber),
        lines: buildPayloadLines(),
        userName: user?.full_name || user?.email || 'System',
        existingId: existingCreditNote?.id || null,
      });
      toast.success('Credit note recorded');
      onCreated();
    } catch (err) {
      toast.error('Failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0 bg-card">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-purple-600" />
            {viewMode
              ? `Credit Note ${existingCreditNote.supplier_credit_note_number || existingCreditNote.scn_number}`
              : isDraft ? 'Edit Credit Note (Draft)' : 'New Supplier Credit Note'}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{po.po_number} · {po.supplier_name}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
        {/* Header fields */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase">Supplier Credit Note Number *</label>
            {viewMode ? (
              <p className="text-sm font-mono mt-1">{existingCreditNote.supplier_credit_note_number || existingCreditNote.scn_number}</p>
            ) : (
              <Input value={supplierCnNumber} onChange={e => setSupplierCnNumber(e.target.value)} placeholder="e.g. SCN-001" className="mt-1" />
            )}
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase">Credit Note Date *</label>
            {viewMode ? (
              <p className="text-sm mt-1">{existingCreditNote.credit_note_date}</p>
            ) : (
              <Input type="date" value={creditNoteDate} onChange={e => setCreditNoteDate(e.target.value)} className="mt-1" />
            )}
          </div>
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase">Status</label>
            <p className="text-sm mt-1 capitalize">{viewMode ? (existingCreditNote.status || '').replace(/_/g, ' ') : 'new'}</p>
          </div>
          {!viewMode && (
            <div className="sm:col-span-4">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase">Notes</label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional..." className="mt-1" />
            </div>
          )}
        </div>

        {/* Lines */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase">Credit Note Lines</p>
            {!viewMode && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowPicker(true)}>
                <Plus className="w-3.5 h-3.5" /> Add Product
              </Button>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border text-[10px] uppercase text-muted-foreground">
                  <th className="text-left px-3 py-2 font-semibold">Product</th>
                  <th className="text-right px-3 py-2 font-semibold w-28">Credit Qty</th>
                  <th className="text-right px-3 py-2 font-semibold w-32">Unit Cost (excl)</th>
                  <th className="text-left px-3 py-2 font-semibold w-40">Tax Rule</th>
                  <th className="text-right px-3 py-2 font-semibold w-28">Total excl</th>
                  <th className="text-right px-3 py-2 font-semibold w-28">Total incl</th>
                  {!viewMode && <th className="w-8" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr><td colSpan={viewMode ? 6 : 7} className="px-3 py-6 text-center text-xs text-muted-foreground">No lines.</td></tr>
                ) : rows.map(r => (
                  <tr key={r.key}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{r.product_name}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">{r.product_sku}{r.shortage_id ? ' · vs shortage' : ''}</p>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {viewMode ? r.credit_qty : (
                        <Input type="number" min="0" step="any" value={r.credit_qty} onChange={e => update(r.key, 'credit_qty', e.target.value)} className="h-8 w-24 text-right text-sm ml-auto" />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {viewMode ? fmtR(r.unit_cost_excl) : (
                        <Input type="number" min="0" step="any" value={r.unit_cost_excl} onChange={e => update(r.key, 'unit_cost_excl', e.target.value)} className="h-8 w-28 text-right text-sm ml-auto" />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {viewMode ? <span className="text-xs">{r.tax_rule}</span> : (
                        <Select value={r.tax_rate_id || ''} onValueChange={v => setLineTax(r.key, v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Tax..." /></SelectTrigger>
                          <SelectContent className="z-[220]">
                            {taxRates.map(t => <SelectItem key={t.id} value={t.id}>{t.name} ({Math.round((t.rate || 0) * 100)}%)</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtR(r._excl)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtR(r._incl)}</td>
                    {!viewMode && (
                      <td className="px-2 py-2">
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-red-600" onClick={() => removeLine(r.key)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Product picker */}
          {showPicker && (
            <>
              <div className="fixed inset-0 bg-black/30 z-[210]" onClick={() => setShowPicker(false)} />
              <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
                <div className="bg-card rounded-xl shadow-2xl w-full max-w-md p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Search className="w-4 h-4 text-muted-foreground shrink-0" />
                    <Input placeholder="Search supplier products..." value={search} onChange={e => setSearch(e.target.value)} autoFocus className="h-8" />
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setShowPicker(false)}><X className="w-4 h-4" /></Button>
                  </div>
                  <div className="max-h-72 overflow-y-auto space-y-1">
                    {filteredSPs.length === 0 ? (
                      <p className="text-center text-sm text-muted-foreground py-4">No products found</p>
                    ) : filteredSPs.map(sp => (
                      <button key={sp.id} className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors" onClick={() => addProduct(sp)}>
                        <p className="text-sm font-medium">{sp.product_name}</p>
                        <p className="text-[10px] text-muted-foreground">{sp.product_sku}{sp.last_purchase_price ? ` · R${parseFloat(sp.last_purchase_price).toFixed(2)}` : ''}</p>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Warnings: short receival + price variance vs the linked shortage */}
        {warnings.length > 0 && (
          <div className="space-y-1.5">
            {warnings.map((w, i) => (
              <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{w.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* Totals + captured/variance */}
        <div className="flex justify-end">
          <div className="w-72 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal (excl)</span><span className="tabular-nums">{fmtR(subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">VAT</span><span className="tabular-nums">{fmtR(vat)}</span></div>
            <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1"><span>Recalculated Total (incl)</span><span className="tabular-nums">{fmtR(viewMode ? existingCreditNote.total : total)}</span></div>
            <div className="flex justify-between items-center pt-1.5">
              <span className="text-muted-foreground">Captured Total (incl)</span>
              {viewMode ? (
                <span className="tabular-nums">{existingCreditNote.captured_total != null ? fmtR(existingCreditNote.captured_total) : '—'}</span>
              ) : (
                <Input type="number" step="0.01" min="0" value={capturedTotal} onChange={e => setCapturedTotal(e.target.value)} placeholder="0.00" className="h-8 w-32 text-right text-sm" />
              )}
            </div>
            {variance != null && Math.abs(variance) > 0.001 && (
              <div className="flex justify-between text-amber-700 font-medium pt-1">
                <span className="flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Total variance</span>
                <span className="tabular-nums">{fmtR(variance)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      {!viewMode && (
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-4 flex gap-3 shrink-0">
          <Button variant="outline" onClick={onCancel} className="h-10">Cancel</Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={handleSaveDraft} disabled={saving || lines.length === 0} className="gap-2 h-10">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Draft
          </Button>
          <Button onClick={handleSave} disabled={saving || lines.length === 0} className="gap-2 h-10 bg-purple-600 hover:bg-purple-700">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            Record Credit Note
          </Button>
        </div>
      )}
    </div>
  );
}
