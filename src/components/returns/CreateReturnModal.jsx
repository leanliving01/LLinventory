import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Loader2, RotateCcw, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { writeAuditLog } from '@/lib/auditLog';

const REASONS = [
  { value: 'damaged', label: 'Damaged' },
  { value: 'wrong_item', label: 'Wrong Item' },
  { value: 'quality_issue', label: 'Quality Issue' },
  { value: 'expired', label: 'Expired' },
  { value: 'other', label: 'Other' },
];

export default function CreateReturnModal({ onCreated, onCancel }) {
  const [saving, setSaving] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [grnId, setGrnId] = useState('');
  const [returnDate, setReturnDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState('');
  const [selectedLines, setSelectedLines] = useState([]);

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-active'],
    queryFn: () => base44.entities.Supplier.filter({ status: 'active' }, 'name', 200),
  });

  const { data: confirmedGRNs = [] } = useQuery({
    queryKey: ['confirmed-grns-for-return', supplierId],
    queryFn: () => supplierId
      ? base44.entities.GoodsReceivedNote.filter({ supplier_id: supplierId, status: 'confirmed' }, '-created_date', 50)
      : Promise.resolve([]),
    enabled: !!supplierId,
  });

  const { data: grnLines = [] } = useQuery({
    queryKey: ['grn-lines-for-return', grnId],
    queryFn: () => grnId
      ? base44.entities.GRNLine.filter({ grn_id: grnId }, 'product_name', 100)
      : Promise.resolve([]),
    enabled: !!grnId,
  });

  // Only show lines with items that could be returned (damaged/rejected or any line)
  const returnableLines = useMemo(() => grnLines, [grnLines]);

  const toggleLine = (line) => {
    setSelectedLines(prev => {
      const exists = prev.find(l => l.grn_line_id === line.id);
      if (exists) return prev.filter(l => l.grn_line_id !== line.id);
      return [...prev, {
        grn_line_id: line.id,
        supplier_product_id: line.supplier_product_id || null,
        product_id: line.product_id,
        product_name: line.product_name,
        product_sku: line.product_sku,
        return_qty: line.condition === 'rejected' || line.condition === 'damaged'
          ? (line.rejection_qty || line.received_qty || 1)
          : 1,
        return_value: 0,
        internal_qty_returned: 0,
        reason: line.condition === 'damaged' ? 'damaged' : line.condition === 'rejected' ? 'quality_issue' : 'other',
        reason_detail: line.rejection_reason || '',
        unit_cost: line.unit_cost || 0,
        conversion_factor: line.conversion_factor || 1,
        yield_factor: line.yield_factor || 1,
      }];
    });
  };

  const updateSelectedLine = (grnLineId, field, value) => {
    setSelectedLines(prev => prev.map(l =>
      l.grn_line_id === grnLineId ? { ...l, [field]: value } : l
    ));
  };

  const totalReturnValue = selectedLines.reduce((s, l) => {
    return s + (parseFloat(l.return_qty) || 0) * (parseFloat(l.unit_cost) || 0);
  }, 0);

  const handleCreate = async () => {
    if (!supplierId || !grnId || selectedLines.length === 0) {
      toast.error('Select supplier, GRN, and at least one line');
      return;
    }
    setSaving(true);

    const supplier = suppliers.find(s => s.id === supplierId);
    // Generate return number
    const existing = await base44.entities.SupplierReturn.list('-created_date', 1);
    const lastNum = existing.length > 0
      ? parseInt((existing[0].return_number || '').split('-').pop() || '0')
      : 0;
    const today = format(new Date(), 'yyyyMMdd');
    const returnNumber = `RET-${today}-${String(lastNum + 1).padStart(3, '0')}`;

    const ret = await base44.entities.SupplierReturn.create({
      return_number: returnNumber,
      grn_id: grnId,
      supplier_id: supplierId,
      supplier_name: supplier?.name || '',
      return_date: returnDate,
      status: 'pending_return',
      total_return_value: Math.round(totalReturnValue * 100) / 100,
      notes,
    });

    // Create return lines
    const returnLines = selectedLines.map(l => {
      const returnQty = parseFloat(l.return_qty) || 0;
      const cf = parseFloat(l.conversion_factor) || 1;
      const yf = parseFloat(l.yield_factor) || 1;
      return {
        return_id: ret.id,
        grn_line_id: l.grn_line_id,
        supplier_product_id: l.supplier_product_id,
        product_id: l.product_id,
        product_name: l.product_name,
        product_sku: l.product_sku,
        return_qty: returnQty,
        return_value: Math.round(returnQty * (parseFloat(l.unit_cost) || 0) * 100) / 100,
        internal_qty_returned: Math.round(returnQty * cf * yf * 1000) / 1000,
        reason: l.reason,
        reason_detail: l.reason_detail,
      };
    });
    await base44.entities.SupplierReturnLine.bulkCreate(returnLines);

    writeAuditLog({
      action: 'create',
      entity_type: 'SupplierReturn',
      entity_id: ret.id,
      description: `Created return ${returnNumber}: ${returnLines.length} lines, R ${totalReturnValue.toFixed(2)}`,
    });

    toast.success(`Return ${returnNumber} created`);
    setSaving(false);
    onCreated(ret);
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-lg shadow-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-red-600" />
            <h3 className="text-lg font-bold">New Supplier Return</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Supplier *</label>
            <Select value={supplierId} onValueChange={v => { setSupplierId(v); setGrnId(''); setSelectedLines([]); }}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select supplier" /></SelectTrigger>
              <SelectContent>
                {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {confirmedGRNs.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase">GRN *</label>
              <Select value={grnId} onValueChange={v => { setGrnId(v); setSelectedLines([]); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select GRN" /></SelectTrigger>
                <SelectContent>
                  {confirmedGRNs.map(g => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.grn_number} — {g.received_date} — R {(g.total_received_value || 0).toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {returnableLines.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase mb-2 block">Select Items to Return</label>
              <div className="space-y-2">
                {returnableLines.map(line => {
                  const isSelected = selectedLines.some(l => l.grn_line_id === line.id);
                  const selectedLine = selectedLines.find(l => l.grn_line_id === line.id);
                  return (
                    <div key={line.id} className={`border rounded-lg p-3 transition-all ${
                      isSelected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/30'
                    }`}>
                      <button onClick={() => toggleLine(line)} className="w-full text-left">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-sm font-medium">{line.product_name}</span>
                            <span className="text-xs text-muted-foreground ml-2">{line.product_sku}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            Received: {line.received_qty} {line.purchase_uom}
                            {line.condition !== 'accepted' && (
                              <span className="ml-1 text-red-600">({line.condition})</span>
                            )}
                          </span>
                        </div>
                      </button>
                      {isSelected && selectedLine && (
                        <div className="mt-2 flex items-center gap-3 pt-2 border-t border-border">
                          <div className="flex-1">
                            <label className="text-[10px] text-muted-foreground uppercase">Return Qty</label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={selectedLine.return_qty}
                              onChange={e => updateSelectedLine(line.id, 'return_qty', e.target.value)}
                              className="h-8 text-sm mt-0.5"
                            />
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] text-muted-foreground uppercase">Reason</label>
                            <Select value={selectedLine.reason} onValueChange={v => updateSelectedLine(line.id, 'reason', v)}>
                              <SelectTrigger className="h-8 text-sm mt-0.5"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Return Date</label>
            <Input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} className="mt-1" />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase">Notes</label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 h-16" placeholder="Return details..." />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-border">
          {totalReturnValue > 0 && (
            <p className="text-sm mb-3">
              <span className="text-muted-foreground">Total return value: </span>
              <span className="font-bold">R {totalReturnValue.toFixed(2)}</span>
            </p>
          )}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
            <Button className="flex-1 gap-2" onClick={handleCreate} disabled={saving || selectedLines.length === 0}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
              {saving ? 'Creating...' : `Create Return (${selectedLines.length})`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}