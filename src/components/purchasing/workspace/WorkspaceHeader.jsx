import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, RotateCcw, Trash2, Loader2, Pencil } from 'lucide-react';
import { dueDateColour, formatPaymentTerms } from '@/lib/utils';
import { cn } from '@/lib/utils';
import ManagerPinDialog from '@/components/purchasing/ManagerPinDialog';

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  awaiting_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-blue-100 text-blue-700',
  partially_received: 'bg-amber-100 text-amber-700',
  received: 'bg-green-100 text-green-700',
  invoiced: 'bg-purple-100 text-purple-700',
  paid: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
};

const INV_STATUS_COLORS = {
  pending_match: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  paid: 'bg-green-100 text-green-700',
  disputed: 'bg-red-100 text-red-600',
};

function DueDateBadge({ dateStr, overridden }) {
  if (!dateStr) return <span className="text-muted-foreground text-xs">—</span>;
  const colour = dueDateColour(dateStr);
  return (
    <span className={cn(
      'text-xs font-semibold',
      colour === 'red' ? 'text-red-600' : colour === 'amber' ? 'text-amber-600' : 'text-green-700'
    )}>
      {dateStr}{overridden && <span className="text-muted-foreground font-normal"> (override)</span>}
    </span>
  );
}

export default function WorkspaceHeader({ po, invoice, grns = [], perms = {}, onRevertToDraft, onDeletePO }) {
  // Hooks must run unconditionally, before the `!po` early return below.
  const [showDeletePin, setShowDeletePin] = useState(false);
  const [reverting, setReverting] = useState(false);
  const navigate = useNavigate();

  if (!po) return null;

  // PO lines/header stay editable until it progresses past confirmed (matches
  // POWorkspace's own editable statuses). The Edit button opens that editor.
  const canEditPO = ['draft', 'approved', 'confirmed'].includes(po.status)
    && (perms.po_create || perms.po_edit);

  const hasConfirmedGRN = grns.some(g => g.status === 'confirmed');
  const hasPriceVariance = grns.some(g => g.has_price_variance);
  const paymentTermsText = po.payment_term_type
    ? formatPaymentTerms(po.payment_term_type, po.payment_term_value)
    : null;

  const dueDate = invoice?.due_date_calculated || po.due_date_calculated;
  const dueDateOverridden = invoice?.due_date_overridden || po.due_date_overridden;

  const subtotal = po.subtotal || 0;
  const tax = po.tax_amount ?? po.tax ?? 0;
  const total = po.total || 0;

  // Revert to draft: only if approved/confirmed and no GRNs and no invoice
  const canRevertToDraft = ['approved', 'confirmed', 'awaiting_approval'].includes(po.status)
    && grns.length === 0
    && !invoice;

  // Cancel PO: gated on po_delete permission; not if already cancelled or has GRNs/invoice
  const canDelete = perms.po_delete
    && !['cancelled', 'paid'].includes(po.status)
    && !hasConfirmedGRN
    && !invoice;

  const handleRevert = async () => {
    if (!onRevertToDraft) return;
    setReverting(true);
    try {
      await onRevertToDraft();
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className="sticky top-0 z-40 bg-card border-b border-border shadow-sm">
      <div className="px-6 py-3 flex flex-wrap items-start gap-x-6 gap-y-2">
        {/* Identity */}
        <div className="min-w-0">
          <p className="text-[10px] uppercase font-semibold text-muted-foreground">Supplier</p>
          <p className="text-sm font-bold truncate">{po.supplier_name || '—'}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase font-semibold text-muted-foreground">PO #</p>
          <p className="text-sm font-mono font-bold">{po.po_number}</p>
        </div>
        {invoice && (
          <div>
            <p className="text-[10px] uppercase font-semibold text-muted-foreground">Invoice #</p>
            <p className="text-sm font-mono">{invoice.invoice_number || '—'}</p>
          </div>
        )}
        {invoice?.invoice_date && (
          <div>
            <p className="text-[10px] uppercase font-semibold text-muted-foreground">Invoice Date</p>
            <p className="text-sm">{invoice.invoice_date}</p>
          </div>
        )}
        <div>
          <p className="text-[10px] uppercase font-semibold text-muted-foreground">Due Date</p>
          <DueDateBadge dateStr={dueDate} overridden={dueDateOverridden} />
        </div>
        {paymentTermsText && (
          <div>
            <p className="text-[10px] uppercase font-semibold text-muted-foreground">Terms</p>
            <p className="text-xs text-muted-foreground">{paymentTermsText}</p>
          </div>
        )}

        {/* Status badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`text-[10px] ${STATUS_COLORS[po.status] || 'bg-gray-100 text-gray-600'}`}>
            PO: {po.status}
          </Badge>
          {invoice && (
            <Badge className={`text-[10px] ${INV_STATUS_COLORS[invoice.status] || 'bg-gray-100 text-gray-600'}`}>
              INV: {invoice.status}
            </Badge>
          )}
          {hasConfirmedGRN && (
            <Badge className="text-[10px] bg-green-100 text-green-700">GRN: confirmed</Badge>
          )}
        </div>

        {/* Financials + actions */}
        <div className="ml-auto flex items-center gap-5 shrink-0">
          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Excl. VAT</p>
              <p className="text-sm font-semibold tabular-nums mt-0.5">R {subtotal.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">VAT</p>
              <p className="text-sm font-semibold tabular-nums mt-0.5">R {tax.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Total</p>
              <p className="text-lg font-bold tabular-nums mt-0.5">R {total.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>

          {canEditPO && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs h-7"
              onClick={() => navigate(`/purchasing/purchase-orders/${po.id}`)}
              title="Edit this purchase order's lines and details"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </Button>
          )}

          {canRevertToDraft && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs h-7"
              onClick={handleRevert}
              disabled={reverting}
              title="Revert this PO to Draft — only available when no GRNs or invoices exist"
            >
              {reverting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Revert to Draft
            </Button>
          )}

          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs h-7 text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={() => setShowDeletePin(true)}
            >
              <Trash2 className="w-3.5 h-3.5" /> Cancel PO
            </Button>
          )}
        </div>
      </div>

      {hasPriceVariance && (
        <div className="px-6 pb-2 flex gap-3">
          <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
            <TrendingUp className="w-3 h-3" /> Price variance flagged on one or more lines
          </div>
        </div>
      )}

      {showDeletePin && (
        <ManagerPinDialog
          action="cancel this purchase order"
          onConfirmed={() => { setShowDeletePin(false); onDeletePO && onDeletePO(); }}
          onCancel={() => setShowDeletePin(false)}
        />
      )}
    </div>
  );
}
