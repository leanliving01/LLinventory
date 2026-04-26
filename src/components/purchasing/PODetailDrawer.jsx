import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Receipt, Truck, MapPin, Calendar, FileText, CheckCircle2, Loader2, Ban, Package, Pencil, Save, Plus, Trash2, Check } from 'lucide-react';
import { toast } from 'sonner';
import ReceiveAgainstPOModal from './ReceiveAgainstPOModal';
import POLineQtyEditor from './POLineQtyEditor';

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-blue-100 text-blue-700',
  partially_received: 'bg-amber-100 text-amber-700',
  received: 'bg-green-100 text-green-700',
  invoiced: 'bg-purple-100 text-purple-700',
  paid: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

export default function PODetailDrawer({ po, onClose, onUpdated }) {
  const queryClient = useQueryClient();
  const [updating, setUpdating] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState(po.supplier_invoice_number || '');
  const [editing, setEditing] = useState(false);
  const [editExpectedDate, setEditExpectedDate] = useState(po.expected_date || '');
  const [editNotes, setEditNotes] = useState(po.notes || '');
  const [editLocationId, setEditLocationId] = useState(po.location_id || '');
  const [editLines, setEditLines] = useState([]);
  const [search, setSearch] = useState('');

  const { data: lines = [] } = useQuery({
    queryKey: ['po-lines', po.id],
    queryFn: () => base44.entities.PurchaseOrderLine.filter({ purchase_order_id: po.id }, 'created_date', 100),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => base44.entities.Location.filter({ is_stock_bearing: true }, 'name', 50),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['active-products'],
    queryFn: () => base44.entities.Product.filter({ status: 'active' }, 'name', 500),
    enabled: editing,
  });

  const filteredProducts = useMemo(() => {
    if (!search) return products.slice(0, 15);
    const q = search.toLowerCase();
    return products.filter(p => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)).slice(0, 15);
  }, [products, search]);

  const location = useMemo(() => locations.find(l => l.id === po.location_id), [locations, po.location_id]);

  const [editingUom, setEditingUom] = useState(null); // { lineId, value }

  const UOM_OPTIONS = ['kg', 'g', 'L', 'ml', 'pcs', 'box', 'case', 'each'];

  const handleUomChange = async (lineId, newUom) => {
    await base44.entities.PurchaseOrderLine.update(lineId, { uom: newUom });
    queryClient.invalidateQueries({ queryKey: ['po-lines', po.id] });
    setEditingUom(null);
    toast.success('Unit updated');
  };

  const allReceived = lines.length > 0 && lines.every(l => (l.received_qty || 0) >= l.ordered_qty);
  const canEdit = ['draft', 'confirmed'].includes(po.status);

  const startEditing = () => {
    setEditLines(lines.map(l => ({
      id: l.id,
      product_id: l.product_id,
      product_name: l.product_name,
      product_sku: l.product_sku,
      ordered_qty: String(l.ordered_qty),
      unit_cost: String(l.unit_cost),
      uom: l.uom,
      _isNew: false,
    })));
    setEditExpectedDate(po.expected_date || '');
    setEditNotes(po.notes || '');
    setEditLocationId(po.location_id || '');
    setEditing(true);
  };

  const addEditLine = () => setEditLines(prev => [...prev, { id: null, product_id: '', product_name: '', product_sku: '', ordered_qty: '', unit_cost: '', uom: '', _isNew: true }]);
  const removeEditLine = (idx) => setEditLines(prev => prev.filter((_, i) => i !== idx));
  const updateEditLine = (idx, field, value) => setEditLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));

  const handleSaveEdit = async () => {
    setUpdating(true);

    const validEditLines = editLines.filter(l => l.product_id && Number(l.ordered_qty) > 0);
    const subtotal = validEditLines.reduce((s, l) => s + (Number(l.ordered_qty) * Number(l.unit_cost)), 0);
    const tax = Math.round(subtotal * 0.15 * 100) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;

    // Update PO header
    await base44.entities.PurchaseOrder.update(po.id, {
      expected_date: editExpectedDate || null,
      notes: editNotes || null,
      location_id: editLocationId || null,
      subtotal: Math.round(subtotal * 100) / 100,
      tax,
      total,
    });

    // Delete removed lines
    const editLineIds = editLines.filter(l => l.id).map(l => l.id);
    for (const existingLine of lines) {
      if (!editLineIds.includes(existingLine.id)) {
        await base44.entities.PurchaseOrderLine.delete(existingLine.id);
      }
    }

    // Update existing and create new lines
    for (const el of validEditLines) {
      const qty = Number(el.ordered_qty);
      const unitCost = Number(el.unit_cost);
      const lineTotal = Math.round(qty * unitCost * 100) / 100;
      const product = products.find(p => p.id === el.product_id);

      if (el.id && !el._isNew) {
        await base44.entities.PurchaseOrderLine.update(el.id, {
          product_id: el.product_id,
          product_name: product?.name || el.product_name,
          product_sku: product?.sku || el.product_sku,
          ordered_qty: qty,
          unit_cost: unitCost,
          uom: el.uom || product?.purchase_uom || product?.stock_uom || 'pcs',
          line_total: lineTotal,
        });
      } else {
        await base44.entities.PurchaseOrderLine.create({
          purchase_order_id: po.id,
          product_id: el.product_id,
          product_name: product?.name || '',
          product_sku: product?.sku || '',
          ordered_qty: qty,
          received_qty: 0,
          unit_cost: unitCost,
          uom: el.uom || product?.purchase_uom || product?.stock_uom || 'pcs',
          line_total: lineTotal,
        });
      }
    }

    toast.success('Purchase order updated');
    setEditing(false);
    setUpdating(false);
    queryClient.invalidateQueries({ queryKey: ['po-lines', po.id] });
    onUpdated();
  };

  const handleConfirm = async () => {
    setUpdating(true);
    await base44.entities.PurchaseOrder.update(po.id, { status: 'confirmed' });
    toast.success('PO confirmed');
    setUpdating(false);
    onUpdated();
  };

  const handleCancel = async () => {
    setUpdating(true);
    await base44.entities.PurchaseOrder.update(po.id, { status: 'cancelled' });
    toast.success('PO cancelled');
    setUpdating(false);
    onUpdated();
  };

  const handleMarkInvoiced = async () => {
    setUpdating(true);
    await base44.entities.PurchaseOrder.update(po.id, {
      status: 'invoiced',
      supplier_invoice_number: invoiceNumber || null,
    });
    toast.success('PO marked as invoiced');
    setUpdating(false);
    onUpdated();
  };

  const handleMarkPaid = async () => {
    setUpdating(true);
    await base44.entities.PurchaseOrder.update(po.id, { status: 'paid', payment_status: 'paid' });
    toast.success('PO marked as paid');
    setUpdating(false);
    onUpdated();
  };

  const handleReceived = () => {
    setShowReceive(false);
    queryClient.invalidateQueries({ queryKey: ['po-lines', po.id] });
    onUpdated();
  };

  // Actions available based on status
  const canConfirm = po.status === 'draft';
  const canReceive = ['confirmed', 'partially_received'].includes(po.status);
  const canInvoice = ['received', 'partially_received'].includes(po.status);
  const canPay = ['invoiced'].includes(po.status);
  const canCancel = ['draft', 'confirmed'].includes(po.status);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-4xl bg-card shadow-xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-start justify-between z-10 shrink-0">
          <div>
            <Badge className={`text-[10px] mb-1 ${STATUS_COLORS[po.status]}`}>{po.status?.replace('_', ' ')}</Badge>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Receipt className="w-5 h-5 text-primary" />
              {po.po_number}
            </h2>
            <p className="text-sm text-muted-foreground">{po.supplier_name}</p>
          </div>
          <div className="flex items-center gap-1">
            {canEdit && !editing && (
              <Button variant="ghost" size="icon" onClick={startEditing} title="Edit PO">
                <Pencil className="w-4 h-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Info row */}
          {editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Expected Delivery</label>
                  <Input type="date" value={editExpectedDate} onChange={e => setEditExpectedDate(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase">Deliver To</label>
                  <Select value={editLocationId} onValueChange={setEditLocationId}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select location..." /></SelectTrigger>
                    <SelectContent>
                      {locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase">Notes</label>
                <Input value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Internal notes..." className="mt-1" />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-start gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">Order Date</p>
                  <p className="text-sm">{po.order_date || '—'}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">Expected</p>
                  <p className="text-sm">{po.expected_date || '—'}</p>
                </div>
              </div>
              {location && (
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase font-semibold">Deliver To</p>
                    <p className="text-sm">{location.name}</p>
                  </div>
                </div>
              )}
              {po.notes && (
                <div className="flex items-start gap-2">
                  <FileText className="w-4 h-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase font-semibold">Notes</p>
                    <p className="text-sm">{po.notes}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Line items */}
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
              <Package className="w-4 h-4 text-primary" />
              Line Items ({editing ? editLines.length : lines.length})
              {editing && (
                <Button variant="outline" size="sm" onClick={addEditLine} className="gap-1 ml-auto"><Plus className="w-3.5 h-3.5" /> Add</Button>
              )}
            </h3>

            {editing ? (
              /* ===== EDIT MODE ===== */
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-20">UoM</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-24">Qty</th>
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">Unit Cost</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-24">Total</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {editLines.map((el, idx) => {
                      const lt = (Number(el.ordered_qty) || 0) * (Number(el.unit_cost) || 0);
                      return (
                        <tr key={el.id || `new-${idx}`}>
                          <td className="px-3 py-2">
                            {el._isNew ? (
                              <Select value={el.product_id} onValueChange={v => {
                                const p = products.find(pr => pr.id === v);
                                updateEditLine(idx, 'product_id', v);
                                if (p) {
                                  updateEditLine(idx, 'product_name', p.name);
                                  updateEditLine(idx, 'product_sku', p.sku);
                                  if (!el.unit_cost) updateEditLine(idx, 'unit_cost', String(p.cost_avg || 0));
                                }
                              }}>
                                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                                <SelectContent>
                                  <div className="px-2 pb-2">
                                    <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="h-7 text-xs" />
                                  </div>
                                  {filteredProducts.map(p => (
                                    <SelectItem key={p.id} value={p.id}>{p.sku} — {p.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <div>
                                <p className="text-xs font-medium">{el.product_name}</p>
                                <p className="text-[10px] font-mono text-muted-foreground">{el.product_sku}</p>
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <Select value={el.uom || 'pcs'} onValueChange={v => updateEditLine(idx, 'uom', v)}>
                              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {UOM_OPTIONS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2">
                            <Input type="number" value={el.ordered_qty} onChange={e => updateEditLine(idx, 'ordered_qty', e.target.value)} className="h-9 text-sm bg-background" min="0" />
                          </td>
                          <td className="px-3 py-2">
                            <Input type="number" value={el.unit_cost} onChange={e => updateEditLine(idx, 'unit_cost', e.target.value)} className="h-9 text-sm bg-background" min="0" step="0.01" />
                          </td>
                          <td className="px-3 py-2 text-right text-sm font-medium whitespace-nowrap">
                            {lt > 0 ? `R ${lt.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}` : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {editLines.length > 1 && (
                              <Button variant="ghost" size="icon" onClick={() => removeEditLine(idx)} className="h-7 w-7 text-muted-foreground hover:text-destructive">
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              /* ===== READ MODE ===== */
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border">
                      <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Ordered</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Received</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Cost</th>
                      <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase w-28">Total</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lines.map(l => {
                      const pct = l.ordered_qty > 0 ? Math.round((l.received_qty || 0) / l.ordered_qty * 100) : 0;
                      const isEditingThisUom = editingUom?.lineId === l.id;
                      return (
                        <tr key={l.id}>
                          <td className="px-3 py-2">
                            <p className="text-xs font-medium">{l.product_name}</p>
                            <div className="flex items-center gap-1 mt-0.5">
                              {l.product_sku && <span className="text-[10px] font-mono text-muted-foreground">{l.product_sku}</span>}
                              {l.product_sku && <span className="text-[10px] text-muted-foreground">·</span>}
                              {isEditingThisUom ? (
                                <Select value={editingUom.value} onValueChange={v => handleUomChange(l.id, v)}>
                                  <SelectTrigger className="h-5 w-16 text-[10px] px-1.5 py-0">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {UOM_OPTIONS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <button
                                  onClick={() => setEditingUom({ lineId: l.id, value: l.uom || 'pcs' })}
                                  className="text-[10px] font-mono text-primary/70 hover:text-primary underline decoration-dotted cursor-pointer"
                                  title="Click to change unit"
                                >
                                  {l.uom || 'pcs'}
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-xs">{l.ordered_qty}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={`text-xs font-medium ${pct >= 100 ? 'text-green-600' : pct > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                              {l.received_qty || 0}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-xs text-muted-foreground whitespace-nowrap">R {(l.unit_cost || 0).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right text-xs font-medium whitespace-nowrap">R {(l.line_total || 0).toFixed(2)}</td>
                          <td className="px-3 py-1">
                            <POLineQtyEditor line={l} onUpdated={onUpdated} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>R {(po.subtotal || 0).toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">VAT (15%)</span><span>R {(po.tax || 0).toFixed(2)}</span></div>
            <div className="flex justify-between font-bold text-base pt-1 border-t border-border"><span>Total</span><span>R {(po.total || 0).toFixed(2)}</span></div>
          </div>

          {/* Invoice number for invoiced/paid */}
          {(canInvoice || po.status === 'invoiced' || po.status === 'paid') && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier Invoice #</label>
              <Input
                value={invoiceNumber}
                onChange={e => setInvoiceNumber(e.target.value)}
                placeholder="INV-12345"
                className="mt-1"
                disabled={po.status === 'paid'}
              />
            </div>
          )}
        </div>

        {/* Action footer */}
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-4 shrink-0 flex gap-3 flex-wrap relative z-10">
          {editing ? (
            <>
              <Button variant="outline" onClick={() => setEditing(false)} className="h-10">Cancel Edit</Button>
              <div className="flex-1" />
              <Button onClick={handleSaveEdit} disabled={updating} className="gap-2 h-10">
                {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save Changes
              </Button>
            </>
          ) : (
            <>
              {canCancel && (
                <Button variant="outline" onClick={handleCancel} disabled={updating} className="gap-2 h-10 text-destructive hover:text-destructive">
                  <Ban className="w-4 h-4" /> Cancel PO
                </Button>
              )}
              <div className="flex-1" />
              {canConfirm && (
                <Button onClick={handleConfirm} disabled={updating} className="gap-2 h-10">
                  {updating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Confirm
                </Button>
              )}
              {canReceive && (
                <Button onClick={() => setShowReceive(true)} className="gap-2 h-10 bg-green-600 hover:bg-green-700">
                  <Truck className="w-4 h-4" /> Receive Stock
                </Button>
              )}
              {canInvoice && (
                <Button onClick={handleMarkInvoiced} disabled={updating} className="gap-2 h-10 bg-purple-600 hover:bg-purple-700">
                  <FileText className="w-4 h-4" /> Mark Invoiced
                </Button>
              )}
              {canPay && (
                <Button onClick={handleMarkPaid} disabled={updating} className="gap-2 h-10">
                  <CheckCircle2 className="w-4 h-4" /> Mark Paid
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {showReceive && (
        <ReceiveAgainstPOModal
          po={po}
          lines={lines}
          onReceived={handleReceived}
          onCancel={() => setShowReceive(false)}
        />
      )}
    </div>
  );
}