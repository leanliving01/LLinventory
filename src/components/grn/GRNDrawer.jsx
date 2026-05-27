import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  X, PackageCheck, Truck, MapPin, Calendar, FileText,
  Plus, Loader2, CheckCircle2, AlertTriangle
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import GRNLineRow from './GRNLineRow';
import AddGRNLineModal from './AddGRNLineModal';
import { confirmGRN } from './GRNConfirmLogic';

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-green-100 text-green-700',
  disputed: 'bg-red-100 text-red-600',
};

export default function GRNDrawer({ grn, onClose, onUpdated }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showAddLine, setShowAddLine] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [localLines, setLocalLines] = useState(null); // null = not editing

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['grn-lines', grn.id],
    queryFn: () => base44.entities.GRNLine.filter({ grn_id: grn.id }, 'product_name', 100),
  });

  const isDraft = grn.status === 'draft';
  const editingLines = localLines || lines;

  const startEditing = () => setLocalLines([...lines]);

  const updateLine = (idx, field, value) => {
    setLocalLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const removeLine = (idx) => {
    const line = editingLines[idx];
    if (!line?.id) {
      setLocalLines(prev => prev.filter((_, i) => i !== idx));
      return;
    }
    base44.entities.GRNLine.delete(line.id);
    setLocalLines(prev => prev.filter((_, i) => i !== idx));
  };

  const handleAddLines = (newLines) => {
    const withGrnId = newLines.map(l => ({ ...l, grn_id: grn.id }));
    // Save new lines to DB immediately
    Promise.all(withGrnId.map(l => base44.entities.GRNLine.create(l))).then(() => {
      queryClient.invalidateQueries({ queryKey: ['grn-lines', grn.id] });
      setLocalLines(null); // refresh from server
    });
  };

  const handleSaveDraft = async () => {
    if (!localLines) return;
    for (const line of localLines) {
      if (!line.id) continue;
      const receivedQty = parseFloat(line.received_qty) || 0;
      const cf = parseFloat(line.conversion_factor) || 1;
      const yf = parseFloat(line.yield_factor) || 1;
      await base44.entities.GRNLine.update(line.id, {
        received_qty: receivedQty,
        unit_cost: parseFloat(line.unit_cost) || 0,
        condition: line.condition || 'accepted',
        variance_qty: line.expected_qty != null ? receivedQty - (parseFloat(line.expected_qty) || 0) : 0,
        internal_qty_received: Math.round(receivedQty * cf * yf * 1000) / 1000,
        line_total: Math.round(receivedQty * (parseFloat(line.unit_cost) || 0) * 100) / 100,
      });
    }
    const totalVal = localLines.reduce((s, l) => s + (parseFloat(l.received_qty) || 0) * (parseFloat(l.unit_cost) || 0), 0);
    await base44.entities.GoodsReceivedNote.update(grn.id, {
      total_lines: localLines.length,
      total_received_value: Math.round(totalVal * 100) / 100,
    });
    toast.success('Draft saved');
    setLocalLines(null);
    queryClient.invalidateQueries({ queryKey: ['grn-lines', grn.id] });
    onUpdated?.();
  };

  const handleConfirm = async () => {
    const linesToConfirm = localLines || lines;
    const validLines = linesToConfirm.filter(l => parseFloat(l.received_qty) > 0);
    if (validLines.length === 0) {
      toast.error('Enter received quantities before confirming');
      return;
    }
    setConfirming(true);
    let result;
    try {
      result = await confirmGRN(grn, linesToConfirm, user?.full_name || 'Unknown');
    } catch (err) {
      toast.error('Failed to confirm GRN: ' + (err?.message || 'Unknown error'));
      setConfirming(false);
      return;
    }
    setConfirming(false);
    setLocalLines(null);
    queryClient.invalidateQueries({ queryKey: ['grn-lines', grn.id] });
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    queryClient.invalidateQueries({ queryKey: ['active-products'] });
    toast.success(`GRN confirmed: ${result.lineCount} lines, R ${result.totalValue.toFixed(2)}`);
    if (result.hasShortages) {
      toast.warning('Shortages detected — check the shortages queue');
    }
    onUpdated?.();
  };

  // Summary stats
  const totalValue = editingLines.reduce((s, l) => {
    return s + (parseFloat(l.received_qty) || 0) * (parseFloat(l.unit_cost) || 0);
  }, 0);
  const shortLines = editingLines.filter(l => l.expected_qty != null && (parseFloat(l.received_qty) || 0) < parseFloat(l.expected_qty));
  const rejectedLines = editingLines.filter(l => l.condition === 'damaged' || l.condition === 'rejected');
  const existingProductIds = editingLines.map(l => l.product_id);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl bg-card shadow-xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-start justify-between z-10 shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge className={`text-[10px] ${STATUS_STYLES[grn.status] || ''}`}>{grn.status}</Badge>
              {grn.has_shortages && <Badge className="text-[10px] bg-amber-100 text-amber-700"><AlertTriangle className="w-3 h-3 mr-0.5" />Shortages</Badge>}
            </div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <PackageCheck className="w-5 h-5 text-primary" />
              {grn.grn_number}
            </h2>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
              <span className="flex items-center gap-1"><Truck className="w-3.5 h-3.5" />{grn.supplier_name}</span>
              <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{grn.location_name}</span>
              <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{grn.received_date}</span>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        {/* Summary strip */}
        <div className="px-6 py-3 border-b border-border flex items-center gap-6 text-sm bg-muted/30">
          <div>
            <span className="text-muted-foreground">Lines: </span>
            <span className="font-semibold">{editingLines.length}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Total: </span>
            <span className="font-semibold">R {totalValue.toFixed(2)}</span>
          </div>
          {shortLines.length > 0 && (
            <div className="text-amber-600 font-medium">
              {shortLines.length} short line{shortLines.length !== 1 ? 's' : ''}
            </div>
          )}
          {rejectedLines.length > 0 && (
            <div className="text-red-600 font-medium">
              {rejectedLines.length} rejected
            </div>
          )}
        </div>

        {/* Lines table */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Loading lines...</div>
          ) : editingLines.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              No lines yet. {isDraft ? 'Add products from the supplier catalog.' : ''}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">UoM</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Expected</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Received</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Variance</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Stock Qty</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Cost/Unit</th>
                    <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Line Total</th>
                    <th className="text-center px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Condition</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {editingLines.map((line, idx) => (
                    <GRNLineRow
                      key={line.id || idx}
                      line={line}
                      index={idx}
                      editable={isDraft && localLines !== null}
                      onUpdate={updateLine}
                      onRemove={isDraft && localLines !== null ? removeLine : null}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Notes */}
        {grn.notes && (
          <div className="px-6 py-2 border-t border-border">
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {grn.notes}
            </p>
          </div>
        )}

        {/* Actions footer */}
        {isDraft && (
          <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 shrink-0 flex gap-3">
            {localLines === null ? (
              <>
                <Button variant="outline" onClick={() => setShowAddLine(true)} className="gap-1.5">
                  <Plus className="w-4 h-4" /> Add Products
                </Button>
                <Button variant="outline" onClick={startEditing} className="gap-1.5">
                  Edit Quantities
                </Button>
                <div className="flex-1" />
                <Button
                  onClick={handleConfirm}
                  disabled={confirming || editingLines.length === 0}
                  className="gap-2"
                >
                  {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {confirming ? 'Confirming...' : 'Confirm Receipt'}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => setShowAddLine(true)} className="gap-1.5">
                  <Plus className="w-4 h-4" /> Add Products
                </Button>
                <div className="flex-1" />
                <Button variant="outline" onClick={() => setLocalLines(null)}>Cancel</Button>
                <Button variant="secondary" onClick={handleSaveDraft} className="gap-1.5">
                  Save Draft
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={confirming || editingLines.filter(l => parseFloat(l.received_qty) > 0).length === 0}
                  className="gap-2"
                >
                  {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {confirming ? 'Confirming...' : 'Confirm Receipt'}
                </Button>
              </>
            )}
          </div>
        )}

        {grn.status === 'confirmed' && grn.received_by_name && (
          <div className="px-6 py-2 border-t border-border bg-green-50 text-xs text-green-700">
            Confirmed by {grn.received_by_name}
          </div>
        )}

        {showAddLine && (
          <AddGRNLineModal
            supplierId={grn.supplier_id}
            existingProductIds={existingProductIds}
            onAdd={handleAddLines}
            onClose={() => setShowAddLine(false)}
          />
        )}
      </div>
    </div>
  );
}