import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  X, FileText, Truck, Calendar, Package, PackageCheck, CreditCard, AlertTriangle, CheckCircle2, Plus, ShieldCheck, Paperclip
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import InvoiceLineMatchRow from './InvoiceLineMatchRow';
import CreditNoteModal from '@/components/purchasing/CreditNoteModal';
import ThreeWayMatchPanel from '@/components/purchasing/ThreeWayMatchPanel';
import PurchaseAttachmentsPanel from '@/components/purchasing/PurchaseAttachmentsPanel';
import MatchInvoiceToPOModal from './MatchInvoiceToPOModal';
import ReceiveInvoiceModal from './ReceiveInvoiceModal';
import { Link2, PackagePlus } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

const STATUS_STYLES = {
  pending_match: 'bg-amber-100 text-amber-700',
  matched: 'bg-green-100 text-green-700',
  approved: 'bg-blue-100 text-blue-700',
  disputed: 'bg-red-100 text-red-600',
  on_hold: 'bg-gray-100 text-gray-500',
};

const PAYMENT_STYLES = {
  unpaid: 'bg-red-50 text-red-600',
  partially_paid: 'bg-amber-50 text-amber-600',
  paid: 'bg-green-50 text-green-600',
  credit_applied: 'bg-blue-50 text-blue-600',
};

const MATCH_BADGE_STYLES = {
  matched: 'bg-green-100 text-green-700',
  price_variance: 'bg-amber-100 text-amber-700',
  qty_variance: 'bg-red-100 text-red-700',
  total_variance: 'bg-amber-100 text-amber-700',
  unmatched: 'bg-red-100 text-red-700',
  no_po: 'bg-blue-100 text-blue-700',
  no_grn: 'bg-blue-100 text-blue-700',
};

const TABS = [
  { key: 'invoice', label: 'Invoice Details', icon: FileText },
  { key: 'match', label: '3-Way Match', icon: ShieldCheck },
  { key: 'order', label: 'Order Details', icon: Package },
  { key: 'grn', label: 'GRN Details', icon: PackageCheck },
  { key: 'credit', label: 'Credit Notes', icon: CreditCard },
  { key: 'attachments', label: 'Attachments', icon: Paperclip },
];

export default function InvoiceDrawer({ invoice, onClose, onUpdated, canEdit }) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('invoice');
  const [showCreditNote, setShowCreditNote] = useState(false);
  const [showMatchPO, setShowMatchPO] = useState(false);
  const [showReceive, setShowReceive] = useState(false);

  // Invoice lines
  const { data: lines = [], isLoading: linesLoading } = useQuery({
    queryKey: ['invoice-lines', invoice.id],
    queryFn: () => base44.entities.PurchaseInvoiceLine.filter({ invoice_id: invoice.id }, 'product_name', 200),
  });

  // Supplier products for Xero matching
  const { data: supplierProducts = [] } = useQuery({
    queryKey: ['sp-for-invoice', invoice.supplier_id],
    queryFn: () => base44.entities.SupplierProduct.filter(
      { supplier_id: invoice.supplier_id, active: true }, 'product_name', 200
    ),
  });

  // Linked PO (Order Details tab)
  const { data: po = null } = useQuery({
    queryKey: ['po-for-invoice', invoice.purchase_order_id],
    queryFn: async () => {
      const list = await base44.entities.PurchaseOrder.filter({ id: invoice.purchase_order_id });
      return list[0] || null;
    },
    enabled: !!invoice.purchase_order_id && (activeTab === 'order' || activeTab === 'credit'),
  });

  const { data: poLines = [] } = useQuery({
    queryKey: ['po-lines', invoice.purchase_order_id],
    queryFn: () => base44.entities.PurchaseOrderLine.filter({ purchase_order_id: invoice.purchase_order_id }, 'product_name', 100),
    enabled: !!invoice.purchase_order_id && activeTab === 'order',
  });

  // Linked GRN (GRN Details tab)
  const { data: grn = null } = useQuery({
    queryKey: ['grn-for-invoice', invoice.grn_id],
    queryFn: async () => {
      const list = await base44.entities.GoodsReceivedNote.filter({ id: invoice.grn_id });
      return list[0] || null;
    },
    enabled: !!invoice.grn_id && activeTab === 'grn',
  });

  const { data: grnLines = [] } = useQuery({
    queryKey: ['grn-lines', invoice.grn_id],
    queryFn: () => base44.entities.GRNLine.filter({ grn_id: invoice.grn_id }, 'product_name', 200),
    enabled: !!invoice.grn_id && activeTab === 'grn',
  });

  // Credit notes + pending shortages (Credit Notes tab)
  const { data: creditNotes = [] } = useQuery({
    queryKey: ['credit-notes-for-invoice', invoice.id],
    queryFn: () => base44.entities.PurchaseInvoice.filter({ linked_invoice_id: invoice.id, is_credit_note: true }, '-invoice_date', 20),
    enabled: activeTab === 'credit',
  });

  const { data: shortages = [] } = useQuery({
    queryKey: ['shortages-for-po', invoice.purchase_order_id],
    queryFn: () => base44.entities.SupplierShortage.filter({ grn_id: invoice.grn_id }, '-created_date', 20),
    enabled: !!invoice.grn_id && activeTab === 'credit',
  });

  // Xero match handlers (for xero_sync invoices)
  const handleMatch = async (line, sp) => {
    await base44.entities.PurchaseInvoiceLine.update(line.id, {
      supplier_product_id: sp.id,
      product_id: sp.product_id,
      product_name: sp.product_name,
      product_sku: sp.product_sku,
      match_status: 'manually_matched',
    });
    const updatedLines = await base44.entities.PurchaseInvoiceLine.filter({ invoice_id: invoice.id }, 'product_name', 200);
    const unmatchedCount = updatedLines.filter(l => l.match_status === 'unmatched').length;
    await base44.entities.PurchaseInvoice.update(invoice.id, {
      unmatched_line_count: unmatchedCount,
      status: unmatchedCount === 0 ? 'matched' : 'pending_match',
    });
    queryClient.invalidateQueries({ queryKey: ['invoice-lines', invoice.id] });
    toast.success(`Matched: ${sp.product_name}`);
    onUpdated?.();
  };

  const handleUnmatch = async (line) => {
    await base44.entities.PurchaseInvoiceLine.update(line.id, {
      supplier_product_id: '',
      product_id: '',
      product_name: '',
      product_sku: '',
      match_status: 'unmatched',
    });
    const updatedLines = await base44.entities.PurchaseInvoiceLine.filter({ invoice_id: invoice.id }, 'product_name', 200);
    const unmatchedCount = updatedLines.filter(l => l.match_status === 'unmatched').length;
    await base44.entities.PurchaseInvoice.update(invoice.id, {
      unmatched_line_count: unmatchedCount,
      status: 'pending_match',
    });
    queryClient.invalidateQueries({ queryKey: ['invoice-lines', invoice.id] });
    toast.success('Match removed');
    onUpdated?.();
  };

  const handleCreditNoteCreated = async () => {
    setShowCreditNote(false);
    // Mark open shortages for this GRN as credit_received
    if (invoice.grn_id) {
      try {
        const relatedShortages = await base44.entities.SupplierShortage.filter({ grn_id: invoice.grn_id });
        for (const s of relatedShortages) {
          if (s.status !== 'credit_received' && s.status !== 'cancelled' && s.credit_follow_up_status !== 'cancelled') {
            await base44.entities.SupplierShortage.update(s.id, {
              status: 'credit_received',
              credit_follow_up_status: 'matched',
            });
          }
        }

        // If PO is linked and all its GRN shortages are resolved, set PO to invoiced
        if (invoice.purchase_order_id) {
          const allGrns = await base44.entities.GoodsReceivedNote.filter({ purchase_order_id: invoice.purchase_order_id });
          let hasOpenShortages = false;
          for (const g of allGrns) {
            const grnShortages = await base44.entities.SupplierShortage.filter({ grn_id: g.id });
            if (grnShortages.some(s => s.status !== 'credit_received' && s.status !== 'cancelled')) {
              hasOpenShortages = true;
              break;
            }
          }
          if (!hasOpenShortages) {
            await base44.entities.PurchaseOrder.update(invoice.purchase_order_id, { status: 'invoiced' });
          }
        }
      } catch (err) {
        console.warn('[InvoiceDrawer] Post-CN cleanup:', err?.message);
      }
    }
    queryClient.invalidateQueries({ queryKey: ['shortages-for-po', invoice.purchase_order_id] });
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] });
    queryClient.invalidateQueries({ queryKey: ['supplier-shortages'] });
    onUpdated?.();
  };

  const matchedCount = lines.filter(l => ['auto_matched', 'manually_matched'].includes(l.match_status)).length;
  const unmatchedCount = lines.filter(l => l.match_status === 'unmatched').length;
  const isXero = invoice.source === 'xero_sync';
  const isManual = invoice.source === 'manual';

  const pendingShortages = shortages.filter(s =>
    ['open', 'credit_required'].includes(s.credit_follow_up_status) ||
    ['open'].includes(s.status)
  );

  return (
    <>
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl bg-card shadow-xl flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-start justify-between z-10 shrink-0">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge className={`text-[10px] ${STATUS_STYLES[invoice.status] || ''}`}>
                {(invoice.status || '').replace(/_/g, ' ')}
              </Badge>
              <Badge className={`text-[10px] ${PAYMENT_STYLES[invoice.payment_status] || ''}`}>
                {(invoice.payment_status || '').replace(/_/g, ' ')}
              </Badge>
              {invoice.three_way_match_status && (
                <Badge className={`text-[10px] ${MATCH_BADGE_STYLES[invoice.three_way_match_status] || 'bg-gray-100 text-gray-600'}`}>
                  {(invoice.three_way_match_status === 'matched' ? '3-way matched' : `match: ${invoice.three_way_match_status.replace(/_/g, ' ')}`)}
                </Badge>
              )}
            </div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              {invoice.invoice_number}
            </h2>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
              <span className="flex items-center gap-1"><Truck className="w-3.5 h-3.5" />{invoice.supplier_name}</span>
              <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{invoice.invoice_date}</span>
              {invoice.due_date && <span className="flex items-center gap-1">Due: {invoice.due_date}</span>}
              {invoice.purchase_order_id && <span className="text-muted-foreground">PO linked</span>}
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="w-5 h-5" /></Button>
        </div>

        {/* Summary strip */}
        <div className="px-6 py-3 border-b border-border flex items-center gap-5 text-sm bg-muted/30 flex-wrap">
          <div>
            <span className="text-muted-foreground">Subtotal: </span>
            <span className="font-medium tabular-nums">R {(invoice.subtotal || 0).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">VAT: </span>
            <span className="font-medium tabular-nums">R {(invoice.tax_amount || 0).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Total: </span>
            <span className="font-bold tabular-nums">R {(invoice.total || 0).toFixed(2)}</span>
          </div>
          {isXero && (
            <div className="ml-auto flex gap-2">
              {matchedCount > 0 && <span className="text-green-600 font-medium">{matchedCount} matched</span>}
              {unmatchedCount > 0 && <span className="text-amber-600 font-medium">{unmatchedCount} unmatched</span>}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border bg-muted/20 px-6 shrink-0">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors',
                  activeTab === tab.key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
                {tab.key === 'credit' && pendingShortages.length > 0 && (
                  <span className="ml-1 text-[10px] bg-orange-100 text-orange-700 rounded-full px-1.5 py-0.5 font-bold">
                    {pendingShortages.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">

          {/* INVOICE DETAILS TAB */}
          {activeTab === 'invoice' && (
            <div>
              {linesLoading ? (
                <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
              ) : lines.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">No lines on this invoice.</div>
              ) : isManual ? (
                // Three-way match table for manually created invoices
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border">
                        <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Ordered</th>
                        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Received</th>
                        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Invoiced</th>
                        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Unit Cost</th>
                        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Variance</th>
                        <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map(line => (
                        <tr key={line.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                          <td className="px-3 py-2">
                            <div className="font-medium">{line.product_name}</div>
                            {line.product_sku && <div className="text-[10px] text-muted-foreground">{line.product_sku}</div>}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {line.ordered_qty != null ? line.ordered_qty : '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {line.received_qty != null ? (
                              <span className={line.received_qty < (line.ordered_qty || 0) ? 'text-amber-600 font-medium' : ''}>
                                {line.received_qty}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            <span className={line.qty > (line.received_qty || line.qty) ? 'text-amber-600 font-medium flex items-center justify-end gap-1' : ''}>
                              {line.qty > (line.received_qty != null ? line.received_qty : line.qty) && (
                                <AlertTriangle className="w-3.5 h-3.5" />
                              )}
                              {line.qty}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">R {(line.unit_cost || 0).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {line.price_variance_flagged ? (
                              <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-medium">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {line.price_variance_pct > 0 ? '+' : ''}{(line.price_variance_pct || 0).toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                {line.price_variance_pct != null ? `${line.price_variance_pct > 0 ? '+' : ''}${line.price_variance_pct.toFixed(1)}%` : '—'}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">
                            R {(line.line_total || line.qty * line.unit_cost || 0).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                // Xero match rows for xero_sync invoices
                lines.map(line => (
                  <InvoiceLineMatchRow
                    key={line.id}
                    line={line}
                    supplierProducts={supplierProducts}
                    onMatch={handleMatch}
                    onUnmatch={handleUnmatch}
                    editable={canEdit && invoice.status !== 'approved'}
                  />
                ))
              )}

              {isXero && (
                <div className="px-6 py-2 border-t border-border bg-muted/20 text-xs text-muted-foreground">
                  Synced from Xero · Bill ID: {invoice.xero_bill_id?.substring(0, 12)}...
                </div>
              )}
            </div>
          )}

          {/* THREE-WAY MATCH TAB */}
          {activeTab === 'match' && (
            linesLoading ? (
              <div className="text-center py-12 text-sm text-muted-foreground">Loading...</div>
            ) : (
              <ThreeWayMatchPanel
                invoice={invoice}
                invoiceLines={lines}
                userName={user?.full_name || user?.email || 'Unknown'}
                canApprove={canEdit}
                onUpdated={onUpdated}
              />
            )
          )}

          {/* ORDER DETAILS TAB */}
          {activeTab === 'order' && (
            <div className="p-6 space-y-4">
              {!invoice.purchase_order_id ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    No purchase order linked to this invoice. Link it to an existing PO, or receive it
                    directly as a blind receipt (creates a GRN, no PO).
                  </p>
                  {invoice.grn_id ? (
                    <p className="text-xs text-green-700">Already received — GRN linked.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowMatchPO(true)} disabled={!canEdit}>
                        <Link2 className="w-3.5 h-3.5" /> Match to Purchase Order
                      </Button>
                      <Button variant="outline" size="sm" className="gap-1.5 border-primary/30 text-primary" onClick={() => setShowReceive(true)} disabled={!canEdit}>
                        <PackagePlus className="w-3.5 h-3.5" /> Create Blind Receipt
                      </Button>
                    </div>
                  )}
                </div>
              ) : !po ? (
                <p className="text-sm text-muted-foreground">Loading order details...</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">PO Number</p>
                      <p className="font-medium font-mono">{po.po_number}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">Supplier</p>
                      <p className="font-medium">{po.supplier_name}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">Order Date</p>
                      <p>{po.order_date || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">Expected Delivery</p>
                      <p>{po.expected_date || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">PO Status</p>
                      <p className="capitalize">{(po.status || '').replace(/_/g, ' ')}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">Deliver To</p>
                      <p>{po.location_name || '—'}</p>
                    </div>
                  </div>

                  {poLines.length > 0 && (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 border-b border-border">
                            <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                            <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Ordered Qty</th>
                            <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Received Qty</th>
                            <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Expected Cost</th>
                            <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Line Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {poLines.map(l => (
                            <tr key={l.id} className="border-b border-border last:border-0">
                              <td className="px-3 py-2">
                                <div className="font-medium">{l.product_name}</div>
                                {l.product_sku && <div className="text-[10px] text-muted-foreground">{l.product_sku}</div>}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">{l.ordered_qty}</td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {(l.received_qty || 0) > 0 ? (
                                  <span className={(l.received_qty || 0) < l.ordered_qty ? 'text-amber-600' : 'text-green-600'}>
                                    {l.received_qty}
                                  </span>
                                ) : <span className="text-muted-foreground">0</span>}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">R {(l.unit_cost || 0).toFixed(2)}</td>
                              <td className="px-3 py-2 text-right tabular-nums">R {(l.line_total || 0).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* GRN DETAILS TAB */}
          {activeTab === 'grn' && (
            <div className="p-6 space-y-4">
              {!invoice.grn_id ? (
                <p className="text-sm text-muted-foreground">No goods received note linked to this invoice.</p>
              ) : !grn ? (
                <p className="text-sm text-muted-foreground">Loading GRN details...</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">GRN Number</p>
                      <p className="font-medium font-mono">{grn.grn_number}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">Actual Received Date</p>
                      <p className="font-medium">{grn.received_date || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">Received By</p>
                      <p>{grn.received_by_name || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase font-semibold">Location</p>
                      <p>{grn.location_name || '—'}</p>
                    </div>
                    {grn.has_shortages && (
                      <div className="col-span-2">
                        <Badge className="bg-amber-100 text-amber-700 text-[10px]">
                          <AlertTriangle className="w-3 h-3 mr-1" /> Shortages recorded
                        </Badge>
                      </div>
                    )}
                  </div>

                  {grnLines.length > 0 && (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 border-b border-border">
                            <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                            <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Expected</th>
                            <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Received</th>
                            <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Unit Cost</th>
                            <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Condition</th>
                          </tr>
                        </thead>
                        <tbody>
                          {grnLines.map(l => (
                            <tr key={l.id} className="border-b border-border last:border-0">
                              <td className="px-3 py-2">
                                <div className="font-medium">{l.product_name}</div>
                                {l.product_sku && <div className="text-[10px] text-muted-foreground">{l.product_sku}</div>}
                                {l.purchase_uom && <div className="text-[10px] text-muted-foreground">{l.purchase_uom}</div>}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                                {l.expected_qty != null ? l.expected_qty : '—'}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                <span className={
                                  l.expected_qty != null && l.received_qty < l.expected_qty
                                    ? 'text-amber-600 font-medium'
                                    : ''
                                }>
                                  {l.received_qty}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">R {(l.unit_cost || 0).toFixed(2)}</td>
                              <td className="px-3 py-2">
                                <span className={cn(
                                  'text-xs capitalize px-1.5 py-0.5 rounded',
                                  l.condition === 'accepted' ? 'bg-green-50 text-green-700' :
                                  l.condition === 'damaged' ? 'bg-amber-50 text-amber-700' :
                                  'bg-red-50 text-red-700'
                                )}>
                                  {l.condition}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* CREDIT NOTES TAB */}
          {activeTab === 'credit' && (
            <div className="p-6 space-y-4">
              {/* Add Credit Note button */}
              {invoice.purchase_order_id && po && (
                <div className="flex justify-end">
                  <Button
                    onClick={() => setShowCreditNote(true)}
                    variant="outline"
                    className="gap-2 text-sm border-orange-300 text-orange-700 hover:bg-orange-50"
                  >
                    <Plus className="w-4 h-4" /> Add Credit Note
                  </Button>
                </div>
              )}

              {pendingShortages.length > 0 && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-orange-600" />
                    <span className="text-sm font-semibold text-orange-700">Credit Note Pending</span>
                  </div>
                  <div className="space-y-2">
                    {pendingShortages.map(s => (
                      <div key={s.id} className="text-xs text-orange-700 flex justify-between">
                        <span>{s.product_name}</span>
                        <span>{s.shortage_qty} {s.purchase_uom} · R {(s.shortage_value || 0).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {creditNotes.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase">Matched Credit Notes</p>
                  {creditNotes.map(cn => (
                    <div key={cn.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                      <div>
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-green-600" />
                          <span className="font-medium font-mono">{cn.invoice_number}</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{cn.invoice_date}</div>
                      </div>
                      <span className="tabular-nums font-medium text-green-700">
                        R {Math.abs(cn.total || 0).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : pendingShortages.length === 0 ? (
                <p className="text-sm text-muted-foreground">No credit notes linked to this invoice.</p>
              ) : null}
            </div>
          )}

          {/* ATTACHMENTS TAB */}
          {activeTab === 'attachments' && (
            <div className="p-6">
              <PurchaseAttachmentsPanel
                purchaseOrderId={invoice.purchase_order_id || null}
                invoiceIds={[invoice.id]}
              />
            </div>
          )}

        </div>
      </div>
    </div>

    {showCreditNote && po && (
      <CreditNoteModal
        po={po}
        onCreated={handleCreditNoteCreated}
        onCancel={() => setShowCreditNote(false)}
      />
    )}

    {showMatchPO && (
      <MatchInvoiceToPOModal
        invoice={invoice}
        onMatched={() => {
          setShowMatchPO(false);
          queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] });
          queryClient.invalidateQueries({ queryKey: ['workspace-invoices'] });
          onUpdated?.();
        }}
        onCancel={() => setShowMatchPO(false)}
      />
    )}

    {showReceive && (
      <ReceiveInvoiceModal
        invoice={invoice}
        invoiceLines={lines}
        onDone={() => {
          setShowReceive(false);
          queryClient.invalidateQueries({ queryKey: ['purchase-invoices'] });
          queryClient.invalidateQueries({ queryKey: ['invoice-lines', invoice.id] });
          onUpdated?.();
        }}
        onCancel={() => setShowReceive(false)}
      />
    )}
    </>
  );
}
