import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Loader2, XCircle, Pencil, RotateCcw, Send, AlertTriangle, Ban,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabaseClient';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { formatDateTimeSAST } from '@/lib/dateUtils';
import { orderRef, channelLabels } from '@/lib/salesOrderStatus';
import OrderStatusBadges from '@/components/sales/OrderStatusBadges';
import { money } from '@/components/sales/order-shared/money';

import SummaryTab from '@/components/sales/order-tabs/SummaryTab';
import FinancialSummaryTab from '@/components/sales/order-tabs/FinancialSummaryTab';
import PaymentTab from '@/components/sales/order-tabs/PaymentTab';
import ShippingTab from '@/components/sales/order-tabs/ShippingTab';
import OrderEditsTab from '@/components/sales/order-tabs/OrderEditsTab';
import ReturnsResendsRefundsTab from '@/components/sales/order-tabs/ReturnsResendsRefundsTab';
import AdditionalCostsTab from '@/components/sales/order-tabs/AdditionalCostsTab';
import DocumentsTab from '@/components/sales/order-tabs/DocumentsTab';
import NotesTab from '@/components/sales/order-tabs/NotesTab';
import AuditHistoryTab from '@/components/sales/order-tabs/AuditHistoryTab';

const TABS = [
  { value: 'summary',       label: 'Summary' },
  { value: 'profitability', label: 'Profitability' },
  { value: 'payment',       label: 'Payment / Invoice' },
  { value: 'shipping',      label: 'Shipping & Fulfilment' },
  { value: 'edits',         label: 'Order Edits' },
  { value: 'returns',       label: 'Returns, Re-sends & Refunds' },
  { value: 'costs',         label: 'Additional Costs' },
  { value: 'documents',     label: 'Documents / References' },
  { value: 'notes',         label: 'Notes' },
  { value: 'audit',         label: 'Audit History' },
];

export default function SalesOrderDetail() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('summary');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

  const { data: order, isLoading } = useQuery({
    queryKey: ['salesOrder', orderId],
    queryFn: () => base44.entities.SalesOrder.get(orderId),
  });

  const { data: lines = [], isLoading: linesLoading } = useQuery({
    queryKey: ['salesOrderLines', orderId],
    queryFn: () => base44.entities.SalesOrderLine.filter({ sales_order_id: orderId }, 'name', 500),
  });

  const { data: financialLines = [] } = useQuery({
    queryKey: ['salesOrderFinancialLines', orderId],
    queryFn: () => base44.entities.SalesOrderFinancialLine.filter({ sales_order_id: orderId }, '-created_date', 200),
  });

  const { data: costs = [] } = useQuery({
    queryKey: ['salesOrderCosts', orderId],
    queryFn: () => base44.entities.SalesOrderCost.filter({ sales_order_id: orderId }, '-cost_date', 100),
  });

  const { data: returns = [] } = useQuery({
    queryKey: ['salesOrderReturns', orderId],
    queryFn: () => base44.entities.ShopifyReturn.filter({ sales_order_id: orderId }, '-created_date', 50),
  });

  const { data: resends = [] } = useQuery({
    queryKey: ['salesOrderResends', orderId],
    queryFn: () => base44.entities.SalesResend.filter({ sales_order_id: orderId }, '-created_date', 50),
  });

  const { data: events = [] } = useQuery({
    queryKey: ['salesOrderEvents', orderId],
    queryFn: () => base44.entities.SalesOrderEvent.filter({ sales_order_id: orderId }, '-created_date', 200),
  });

  const { data: notes = [] } = useQuery({
    queryKey: ['salesOrderNotes', orderId],
    queryFn: () => base44.entities.SalesOrderNote.filter({ sales_order_id: orderId }, '-created_date', 200),
  });

  const { data: documents = [] } = useQuery({
    queryKey: ['salesOrderDocuments', orderId],
    queryFn: () => base44.entities.SalesOrderDocument.filter({ sales_order_id: orderId }, '-created_date', 100),
  });

  const { data: profit } = useQuery({
    queryKey: ['salesOrderProfit', orderId, costs.length, financialLines.length],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('order_profitability', { p_order_id: orderId });
      if (error) {
        console.error('order_profitability:', error.message);
        return null;
      }
      return data;
    },
    enabled: !!orderId,
  });

  const refundLineCount = financialLines.filter((l) => l.category === 'refund').length;

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const { error } = await supabase.rpc('cancel_sales_order', {
        p_order_id: orderId,
        p_reason: cancelReason || null,
        p_user: 'manual',
      });
      if (error) throw new Error(error.message);
      toast.success('Order cancelled');
      setCancelOpen(false);
      setCancelReason('');
      queryClient.invalidateQueries({ queryKey: ['salesOrder', orderId] });
      queryClient.invalidateQueries({ queryKey: ['salesOrderEvents', orderId] });
    } catch (err) {
      toast.error(err.message || 'Could not cancel order');
    } finally {
      setCancelling(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading order...
      </div>
    );
  }

  if (!order) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <AlertTriangle className="w-8 h-8 mx-auto text-amber-500 mb-3" />
        <p className="text-lg font-semibold mb-1">Order not found</p>
        <p className="text-sm text-muted-foreground mb-4">No sales order matches this reference.</p>
        <Button variant="outline" onClick={() => navigate('/sales')} className="gap-1.5">
          <ArrowLeft className="w-4 h-4" /> Back to Sales
        </Button>
      </div>
    );
  }

  const isShopify = order.order_source === 'shopify';
  const primaryRef = orderRef(order);
  const secondaryRef = isShopify
    ? order.shopify_order_id
    : order.order_number && order.order_number !== order.internal_order_number
      ? order.order_number
      : null;

  const outstanding = (Number(order.total_amount) || 0) - (Number(order.amount_paid) || 0);
  const isCancelled = order.lifecycle_state === 'cancelled' || order.status === 'cancelled';
  const isFulfilled = order.lifecycle_state === 'fulfilled';
  const canCancel = !isFulfilled && !isCancelled && !order.stock_deducted;
  const hasEdits = events.some((e) => e.event_type === 'edited');

  const indicators = [
    hasEdits && { icon: Pencil, label: 'Edited', cls: 'text-amber-600 border-amber-200 bg-amber-50' },
    returns.length > 0 && { icon: RotateCcw, label: `${returns.length} return${returns.length > 1 ? 's' : ''}`, cls: 'text-rose-600 border-rose-200 bg-rose-50' },
    resends.length > 0 && { icon: Send, label: `${resends.length} re-send${resends.length > 1 ? 's' : ''}`, cls: 'text-blue-600 border-blue-200 bg-blue-50' },
    outstanding > 0 && { icon: AlertTriangle, label: `${money(outstanding)} outstanding`, cls: 'text-orange-600 border-orange-200 bg-orange-50' },
    isCancelled && { icon: Ban, label: 'Cancelled', cls: 'text-red-600 border-red-200 bg-red-50' },
  ].filter(Boolean);

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 space-y-4">
      {/* Back + actions */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => navigate('/sales')} className="gap-1.5 -ml-2">
          <ArrowLeft className="w-4 h-4" /> Back to Sales
        </Button>
        {canCancel && (
          <Button variant="outline" size="sm" className="gap-1.5 text-rose-600 border-rose-200 hover:bg-rose-50" onClick={() => setCancelOpen(true)}>
            <XCircle className="w-4 h-4" /> Cancel Order
          </Button>
        )}
      </div>

      {/* Header */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold">
                {isShopify ? `Shopify #${order.order_number}` : order.internal_order_number || primaryRef}
              </h1>
              <Badge variant="outline" className="text-[11px]">{channelLabels[order.order_source] || order.order_source}</Badge>
            </div>
            {secondaryRef && (
              <p className="text-xs text-muted-foreground mt-0.5">Ref: {secondaryRef}</p>
            )}
            <p className="text-sm text-slate-700 mt-1">{order.customer_name || '—'}</p>
            <p className="text-xs text-muted-foreground">
              {order.order_date ? formatDateTimeSAST(order.order_date) : '—'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">{money(order.total_amount)}</p>
            {outstanding > 0 && (
              <p className="text-xs text-orange-600">{money(outstanding)} outstanding</p>
            )}
          </div>
        </div>

        <div className="mt-3">
          <OrderStatusBadges order={order} showChannel returnsCount={returns.length} refundLineCount={refundLineCount} />
        </div>

        {indicators.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {indicators.map((ind, i) => {
              const Icon = ind.icon;
              return (
                <span key={i} className={`inline-flex items-center gap-1 text-[11px] border rounded-full px-2 py-0.5 ${ind.cls}`}>
                  <Icon className="w-3 h-3" /> {ind.label}
                </span>
              );
            })}
          </div>
        )}
      </Card>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto justify-start gap-1">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="text-xs">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-4">
          <TabsContent value="summary">
            <SummaryTab
              order={order}
              lines={lines}
              linesLoading={linesLoading}
              financialLines={financialLines}
              returnsCount={returns.length}
              refundLineCount={refundLineCount}
            />
          </TabsContent>
          <TabsContent value="profitability">
            <FinancialSummaryTab order={order} financialLines={financialLines} lines={lines} profit={profit} />
          </TabsContent>
          <TabsContent value="payment">
            <PaymentTab order={order} />
          </TabsContent>
          <TabsContent value="shipping">
            <ShippingTab order={order} />
          </TabsContent>
          <TabsContent value="edits">
            <OrderEditsTab events={events} />
          </TabsContent>
          <TabsContent value="returns">
            <ReturnsResendsRefundsTab
              order={order}
              returns={returns}
              resends={resends}
              financialLines={financialLines}
            />
          </TabsContent>
          <TabsContent value="costs">
            <AdditionalCostsTab order={order} costs={costs} />
          </TabsContent>
          <TabsContent value="documents">
            <DocumentsTab order={order} documents={documents} />
          </TabsContent>
          <TabsContent value="notes">
            <NotesTab order={order} notes={notes} />
          </TabsContent>
          <TabsContent value="audit">
            <AuditHistoryTab events={events} />
          </TabsContent>
        </div>
      </Tabs>

      {/* Cancel confirm */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this order?</DialogTitle>
            <DialogDescription>
              This marks the order cancelled. It cannot be undone here. Orders with deducted stock must use the returns flow.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Reason for cancellation (optional)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={cancelling}>
              Keep Order
            </Button>
            <Button
              className="bg-rose-600 hover:bg-rose-700 gap-1.5"
              onClick={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} Cancel Order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
