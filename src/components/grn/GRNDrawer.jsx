import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  X, PackageCheck, Truck, MapPin, Calendar, FileText,
  Plus, Loader2, CheckCircle2, AlertTriangle, ExternalLink, Unlock, Trash2
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import GRNLineRow from './GRNLineRow';
import AddGRNLineModal from './AddGRNLineModal';
import { confirmGRN, finaliseGRNWithDecisions } from './GRNConfirmLogic';
import ShortReceivalDecisionModal from './ShortReceivalDecisionModal';
import ErrorBoundary from '@/components/layout/ErrorBoundary';
import ManagerPinDialog from '@/components/purchasing/ManagerPinDialog';

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-600',
  confirmed: 'bg-green-100 text-green-700',
  disputed: 'bg-red-100 text-red-600',
};

export default function GRNDrawer({ grn, onClose, onUpdated }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showAddLine, setShowAddLine] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [localLines, setLocalLines] = useState(null);
  const [localDate, setLocalDate] = useState(grn.received_date || '');
  const [pendingDecision, setPendingDecision] = useState(null);
  const [showUnlockPin, setShowUnlockPin] = useState(false);
  const [showDeletePin, setShowDeletePin] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ['grn-lines', grn.id],
    queryFn: () => base44.entities.GRNLine.filter({ grn_id: grn.id }, 'product_name', 100),
  });

  const { data: linkedPOList = [] } = useQuery({
    queryKey: ['linked-po', grn.purchase_order_id],
    queryFn: () => base44.entities.PurchaseOrder.filter({ id: grn.purchase_order_id }),
    enabled: !!grn.purchase_order_id,
  });
  const linkedPO = linkedPOList[0] || null;

  const isDraft = grn.status === 'draft';
  const isConfirmed = grn.status === 'confirmed';
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
    Promise.all(withGrnId.map(l => base44.entities.GRNLine.create(l))).then(() => {
      queryClient.invalidateQueries({ queryKey: ['grn-lines', grn.id] });
      setLocalLines(null);
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
      received_date: localDate || grn.received_date,
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
    const grnWithDate = { ...grn, received_date: localDate || grn.received_date };
    let result;
    try {
      result = await confirmGRN(grnWithDate, linesToConfirm, user?.full_name || 'Unknown');
    } catch (err) {
      toast.error('Failed to confirm GRN: ' + (err?.message || 'Unknown error'));
      setConfirming(false);
      return;
    }

    if (result.requiresDecision) {
      setPendingDecision(result);
      setConfirming(false);
      return;
    }

    setConfirming(false);
    setLocalLines(null);
    queryClient.invalidateQueries({ queryKey: ['grn-lines', grn.id] });
    queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
    queryClient.invalidateQueries({ queryKey: ['active-products'] });
    const totalVal = typeof result.totalValue === 'number' ? result.totalValue : 0;
    const lineCount = result.lineCount ?? 0;
    toast.success(`GRN confirmed: ${lineCount} lines, R ${totalVal.toFixed(2)}`);
    if (result.hasShortages) toast.warning('Shortages detected — check the shortages queue');
    onUpdated?.();
  };

  const handleDecisionsConfirmed = async (decisions) => {
    try {
      const result = await finaliseGRNWithDecisions(
        pendingDecision.grn,
        pendingDecision.persistedLines,
        decisions,
        user?.full_name || 'Unknown'
      );
      setPendingDecision(null);
      setLocalLines(null);
      queryClient.invalidateQueries({ queryKey: ['grn-lines', grn.id] });
      queryClient.invalidateQueries({ queryKey: ['stock-on-hand'] });
      queryClient.invalidateQueries({ queryKey: ['active-products'] });
      queryClient.invalidateQueries({ queryKey: ['supplier-shortages'] });
      const totalVal = typeof result.totalValue === 'number' ? result.totalValue : 0;
      toast.success(`GRN confirmed: ${result.lineCount ?? 0} lines, R ${totalVal.toFixed(2)}`);
      if (result.hasShortages) toast.warning('Some items short-received — check Credits & Returns');
      onUpdated?.();
    } catch (err) {
      toast.error('Failed to finalise GRN: ' + (err?.message || 'Unknown error'));
    }
  };

  const handleUnlockConfirmed = async () => {
    setShowUnlockPin(false);
    await base44.entities.GoodsReceivedNote.update(grn.id, { status: 'draft' });
    toast.success('GRN unlocked for editing');
    queryClient.invalidateQueries({ queryKey: ['grn-lines', grn.id] });
    onUpdated?.();
    onClose();
  };

  const handleDeleteConfirmed = async () => {
    setShowDeletePin(false);
    setDeleting(true);
    try {
      await base44.entities.GoodsReceivedNote.delete(grn.id);
      toast.success('GRN deleted');
      onUpdated?.();
      onClose();
    } catch (err) {
      toast.error('Failed to delete: ' + err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteDraft = async () => {
    setDeleting(true);
    try {
      await base44.entities.GoodsReceivedNote.delete(grn.id);
      toast.success('GRN deleted');
      onUpdated?.();
      onClose();
    } catch (err) {
      toast.error('Failed to delete: ' + err.message);
    } finally {
      setDeleting(false);
    }
  };

  const safeLines = Array.isArray(editingLines) ? editingLines : [];
  const totalValue = safeLines.reduce((s, l) => s + (parseFloat(l.received_qty) || 0) * (parseFloat(l.unit_cost) || 0), 0);
  const shortLines = safeLines.filter(l => l.expected_qty != null && (parseFloat(l.received_qty) || 0) < parseFloat(l.expected_qty));
  const rejectedLines = safeLines.filter(l => l.condition === 'damaged' || l.condition === 'rejected');
  const existingProductIds = safeLines.map(l => l.product_id);

  return (
    <ErrorBoundary onReset={() => { setPendingDecision(null); setConfirming(false); }}>
    <>
    <div className="fixed inset-0 z-50 flex flex-col bg-card">
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
            <span className="flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {isDraft && localLines !== null ? (
                <Input
                  type="date"
                  value={localDate}
                  onChange={e => setLocalDate(e.target.value)}
                  className="h-6 w-36 text-xs border-border"
                />
              ) : (
                localDate || grn.received_date
              )}
            </span>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
      </div>

      {/* Linked PO info strip */}
      {linkedPO && (
        <div className="px-6 py-2 border-b border-border bg-muted/20 flex items-center justify-between text-xs">
          <div className="flex items-center gap-4 text-muted-foreground">
            <span>PO: <span className="font-mono font-medium text-foreground">{linkedPO.po_number}</span></span>
            <span>Ordered: {linkedPO.order_date || '—'}</span>
            <span>Supplier: {linkedPO.supplier_name}</span>
            {linkedPO.expected_delivery_date && <span>Expected: {linkedPO.expected_delivery_date}</span>}
          </div>
          <Button variant="ghost" size="sm" className="gap-1 text-xs h-7" onClick={() => navigate(`/purchasing/workspace/${linkedPO.id}`)}>
            View PO <ExternalLink className="w-3 h-3" />
          </Button>
        </div>
      )}

      {/* Summary strip */}
      <div className="px-6 py-3 border-b border-border flex items-center gap-6 text-sm bg-muted/30">
        <div><span className="text-muted-foreground">Lines: </span><span className="font-semibold">{editingLines.length}</span></div>
        <div><span className="text-muted-foreground">Total: </span><span className="font-semibold">R {totalValue.toFixed(2)}</span></div>
        {shortLines.length > 0 && <div className="text-amber-600 font-medium">{shortLines.length} short line{shortLines.length !== 1 ? 's' : ''}</div>}
        {rejectedLines.length > 0 && <div className="text-red-600 font-medium">{rejectedLines.length} rejected</div>}
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
                {safeLines.map((line, idx) => (
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

      {grn.notes && (
        <div className="px-6 py-2 border-t border-border">
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />{grn.notes}
          </p>
        </div>
      )}

      {/* Draft footer */}
      {isDraft && (
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 shrink-0 flex gap-3">
          {localLines === null ? (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowAddLine(true)}>
                <Plus className="w-4 h-4" /> Add Products
              </Button>
              <Button variant="outline" size="sm" onClick={startEditing}>Edit Quantities</Button>
              <Button
                variant="ghost" size="sm"
                className="text-red-600 hover:text-red-700 hover:bg-red-50 gap-1.5"
                onClick={handleDeleteDraft}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete
              </Button>
              <div className="flex-1" />
              <Button onClick={handleConfirm} disabled={confirming || editingLines.length === 0} className="gap-2">
                {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {confirming ? 'Confirming...' : 'Confirm Receipt'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowAddLine(true)}>
                <Plus className="w-4 h-4" /> Add Products
              </Button>
              <div className="flex-1" />
              <Button variant="outline" size="sm" onClick={() => setLocalLines(null)}>Cancel</Button>
              <Button variant="secondary" size="sm" onClick={handleSaveDraft}>Save Draft</Button>
              <Button
                onClick={handleConfirm}
                disabled={confirming || safeLines.filter(l => parseFloat(l.received_qty) > 0).length === 0}
                className="gap-2"
              >
                {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {confirming ? 'Confirming...' : 'Confirm Receipt'}
              </Button>
            </>
          )}
        </div>
      )}

      {/* Confirmed footer */}
      {isConfirmed && (
        <div className="sticky bottom-0 bg-card border-t border-border px-6 py-3 shrink-0 flex items-center gap-3">
          {grn.received_by_name && (
            <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
              Confirmed by {grn.received_by_name}
            </span>
          )}
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setShowUnlockPin(true)}
          >
            <Unlock className="w-4 h-4" /> Unlock for Editing
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:text-red-700 hover:bg-red-50 gap-1.5"
            onClick={() => setShowDeletePin(true)}
            disabled={deleting}
          >
            <Trash2 className="w-4 h-4" /> Delete
          </Button>
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

    {pendingDecision && (
      <ShortReceivalDecisionModal
        grn={pendingDecision.grn}
        shortLines={pendingDecision.shortLines}
        onConfirm={handleDecisionsConfirmed}
        onCancel={() => setPendingDecision(null)}
      />
    )}

    {showUnlockPin && (
      <ManagerPinDialog
        action="unlock this confirmed GRN for editing"
        onConfirmed={handleUnlockConfirmed}
        onCancel={() => setShowUnlockPin(false)}
      />
    )}

    {showDeletePin && (
      <ManagerPinDialog
        action="permanently delete this confirmed GRN"
        onConfirmed={handleDeleteConfirmed}
        onCancel={() => setShowDeletePin(false)}
      />
    )}
    </>
    </ErrorBoundary>
  );
}
