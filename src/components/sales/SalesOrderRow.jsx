import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Package, RotateCcw, Send, Loader2, Plus, Truck, Tag, Gift, TrendingUp, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import OrderStatusBadges from './OrderStatusBadges';
import { orderRef, channelLabels } from '@/lib/salesOrderStatus';
import { base44 } from '@/api/base44Client';
import { supabase } from '@/api/supabaseClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatDateTimeSAST } from '@/lib/dateUtils';
import { STATUS_LABELS as RETURN_STATUS_LABELS, STATUS_COLORS as RETURN_STATUS_COLORS } from '@/lib/shopifyReturns';
import { RESEND_STATUS_LABELS, RESEND_STATUS_COLORS } from '@/lib/salesResends';
import { createResendFromOrder } from '@/lib/createResend';
import PackageComponentsPopup from './PackageComponentsPopup';

const lifecycleColors = {
  pending_payment: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  paid_unfulfilled: 'bg-orange-100 text-orange-700 border-orange-200',
  fulfilled: 'bg-green-100 text-green-700 border-green-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
  refunded: 'bg-purple-100 text-purple-700 border-purple-200',
};

const lifecycleLabels = {
  pending_payment: 'Pending Payment',
  paid_unfulfilled: 'Awaiting Fulfilment',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

const packStatusColors = {
  pending: 'bg-slate-100 text-slate-600',
  picking: 'bg-blue-100 text-blue-700',
  packed: 'bg-indigo-100 text-indigo-700',
  shipped: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
  refunded: 'bg-red-100 text-red-600',
};

const packStatusLabels = {
  pending: 'Not Packed',
  picking: 'Busy Packing',
  packed: 'Packed',
  shipped: 'Shipped',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

const rand = () => (crypto?.randomUUID ? crypto.randomUUID() : String(Math.random()));
const money = (n) => `R${(Number(n) || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Display metadata for the non-inventory financial-line categories.
const FIN_SECTIONS = [
  { key: 'shipping',     label: 'Shipping / Delivery',     icon: Truck, categories: ['shipping'],                 border: 'border-sky-200',    bg: 'bg-sky-50/50',    text: 'text-sky-700' },
  { key: 'discount',     label: 'Discounts',               icon: Tag,   categories: ['discount'],                 border: 'border-amber-200',  bg: 'bg-amber-50/50',  text: 'text-amber-700' },
  { key: 'voucher',      label: 'Vouchers / Store Credit', icon: Gift,  categories: ['voucher', 'store_credit'],  border: 'border-violet-200', bg: 'bg-violet-50/50', text: 'text-violet-700' },
  { key: 'adjustment',   label: 'Adjustments / Other',     icon: Tag,   categories: ['payment_adjustment', 'tip', 'other'], border: 'border-slate-200', bg: 'bg-slate-50/50', text: 'text-slate-700' },
];

const COST_TYPES = [
  { value: 'courier_actual', label: 'Actual courier cost' },
  { value: 'packaging',      label: 'Extra packaging' },
  { value: 'resend',         label: 'Re-send cost' },
  { value: 'write_off',      label: 'Write-off' },
  { value: 'handling',       label: 'Handling' },
  { value: 'other',          label: 'Other' },
];

// Short per-section progress for split orders, e.g. "Supplements ✓ · Meals in progress".
function sectionProgress(order) {
  const part = (status, label) => status ? `${label} ${status === 'done' ? '✓' : 'in progress'}` : null;
  return [part(order.sup_status, 'Supplements'), part(order.mea_status, 'Meals')].filter(Boolean).join(' · ');
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function getPackLabel(order) {
  if (order.lifecycle_state !== 'paid_unfulfilled') {
    return lifecycleLabels[order.lifecycle_state] || order.lifecycle_state;
  }
  const base = packStatusLabels[order.status] || 'Awaiting Fulfilment';
  if (order.status === 'picking') {
    const secs = sectionProgress(order);
    const label = order.packing_paused ? 'Busy Packing (Paused)' : 'Busy Packing';
    return secs ? `${label} — ${secs}` : label;
  }
  if (order.status === 'packed') {
    const dur = formatDuration(order.packing_duration_seconds);
    return dur ? `${base} · ${dur}` : base;
  }
  return base;
}

function getPackColor(order) {
  if (order.lifecycle_state !== 'paid_unfulfilled' || order.status === 'pending') {
    return order.lifecycle_state === 'paid_unfulfilled'
      ? (packStatusColors[order.status] || lifecycleColors[order.lifecycle_state] || '')
      : (lifecycleColors[order.lifecycle_state] || '');
  }
  if (order.status === 'picking') {
    if (order.packing_paused) return 'bg-orange-100 text-orange-700';
    if (order.sup_status === 'done' || order.mea_status === 'done') return 'bg-amber-100 text-amber-700'; // one section done, one pending
    return 'bg-blue-100 text-blue-700';
  }
  return packStatusColors[order.status] || lifecycleColors[order.lifecycle_state] || '';
}

export default function SalesOrderRow({ order }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [popupPackage, setPopupPackage] = useState(null);
  const [creatingResend, setCreatingResend] = useState(false);

  const handleAddResend = async (e) => {
    e.stopPropagation();
    setCreatingResend(true);
    try {
      const id = await createResendFromOrder(order.id);
      toast.success('Draft re-send created');
      navigate(`/sales/resends/${id}`);
    } catch (err) {
      toast.error(err.message || 'Could not create re-send');
      setCreatingResend(false);
    }
  };

  const { data: lines = [] } = useQuery({
    queryKey: ['sales-order-lines', order.id],
    queryFn: () => base44.entities.SalesOrderLine.filter({ sales_order_id: order.id }),
    enabled: expanded, // only fetch when expanded
  });

  const { data: returns = [] } = useQuery({
    queryKey: ['order-returns', order.id],
    queryFn: () => base44.entities.ShopifyReturn.filter({ sales_order_id: order.id }, '-created_date', 50),
    enabled: expanded,
  });

  const { data: resends = [] } = useQuery({
    queryKey: ['order-resends', order.id],
    queryFn: () => base44.entities.SalesResend.filter({ sales_order_id: order.id }, '-created_date', 50),
    enabled: expanded,
  });

  const { data: financialLines = [] } = useQuery({
    queryKey: ['order-financial-lines', order.id],
    queryFn: () => base44.entities.SalesOrderFinancialLine.filter({ sales_order_id: order.id }, '-created_date', 100),
    enabled: expanded,
  });

  const { data: costs = [] } = useQuery({
    queryKey: ['order-costs', order.id],
    queryFn: () => base44.entities.SalesOrderCost.filter({ sales_order_id: order.id }, '-cost_date', 100),
    enabled: expanded,
  });

  const { data: profit } = useQuery({
    queryKey: ['order-profit', order.id, costs.length, financialLines.length],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('order_profitability', { p_order_id: order.id });
      if (error) { console.error('order_profitability:', error.message); return null; }
      return data;
    },
    enabled: expanded,
  });

  const orderDate = order.order_date ? new Date(order.order_date) : null;

  // Split lines into packages and standalone/BYO (non-component lines)
  const packageLines = lines.filter(l => l.is_package_parent);
  const standaloneLines = lines.filter(l => !l.is_package_parent && !l.is_package_component && l.status === 'active');
  const componentsByParent = {};
  lines.filter(l => l.is_package_component && l.status === 'active').forEach(l => {
    if (!componentsByParent[l.parent_line_id]) componentsByParent[l.parent_line_id] = [];
    componentsByParent[l.parent_line_id].push(l);
  });

  const handlePackageClick = (e, pkg) => {
    e.stopPropagation();
    setPopupPackage(pkg);
  };

  // Group non-inventory financial lines by display section.
  const finBySection = FIN_SECTIONS.map(s => ({
    ...s,
    lines: financialLines.filter(l => s.categories.includes(l.category) && l.category !== 'refund'),
  })).filter(s => s.lines.length > 0);

  // Add-cost form -----------------------------------------------------------
  const queryClient = useQueryClient();
  const [showCostForm, setShowCostForm] = useState(false);
  const [savingCost, setSavingCost] = useState(false);
  const [costForm, setCostForm] = useState({
    cost_type: 'courier_actual', description: '', reference: '',
    amount: '', cost_date: new Date().toISOString().slice(0, 10), notes: '',
  });

  const handleAddCost = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const amount = parseFloat(costForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) { toast.error('Enter a cost amount'); return; }
    setSavingCost(true);
    try {
      await base44.entities.SalesOrderCost.create({
        id: rand(),
        sales_order_id: order.id,
        shopify_order_id: order.shopify_order_id || null,
        order_number: order.order_number || null,
        cost_type: costForm.cost_type,
        description: costForm.description || null,
        reference: costForm.reference || null,
        amount,
        cost_date: costForm.cost_date,
        notes: costForm.notes || null,
      });
      toast.success('Cost added to order');
      setCostForm({ cost_type: 'courier_actual', description: '', reference: '', amount: '', cost_date: new Date().toISOString().slice(0, 10), notes: '' });
      setShowCostForm(false);
      queryClient.invalidateQueries({ queryKey: ['order-costs', order.id] });
      queryClient.invalidateQueries({ queryKey: ['order-profit', order.id] });
    } catch (err) {
      toast.error(err.message || 'Could not add cost');
    } finally {
      setSavingCost(false);
    }
  };

  return (
    <div className="border-b last:border-b-0">
      <div className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors">
        <button
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          className="text-muted-foreground shrink-0"
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {/* Desktop layout */}
        <Link
          to={`/sales/orders/${order.id}`}
          className="hidden md:inline font-semibold text-sm w-28 shrink-0 text-primary hover:underline truncate"
        >
          {orderRef(order)}
        </Link>
        <span className="hidden md:inline text-sm w-40 truncate shrink-0">{order.customer_name || '—'}</span>
        <span className="hidden md:inline text-sm text-muted-foreground w-32 shrink-0">
          {orderDate ? formatDateTimeSAST(orderDate) : '—'}
        </span>
        <span className="hidden md:inline shrink-0">
          <Badge variant="outline" className="text-[10px] py-0">{channelLabels[order.order_source] || order.order_source}</Badge>
        </span>
        <div className="hidden md:flex items-center gap-1.5 flex-1 min-w-[180px]">
          <OrderStatusBadges order={order} size="sm" />
        </div>
        <span className="hidden md:inline text-sm font-medium w-28 text-right shrink-0">
          R{(order.total_amount || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
        </span>
        <Link
          to={`/sales/orders/${order.id}`}
          aria-label="Open order"
          className="hidden md:inline-flex items-center justify-center shrink-0 text-muted-foreground hover:text-primary"
        >
          <ExternalLink className="w-4 h-4" />
        </Link>

        {/* Mobile layout */}
        <div className="flex md:hidden flex-1 min-w-0">
          <div className="flex-1 min-w-0">
            <Link to={`/sales/orders/${order.id}`} className="font-semibold text-sm text-primary hover:underline">
              {orderRef(order)}
            </Link>
            <p className="text-xs text-muted-foreground truncate">{order.customer_name || '—'}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-medium">R{(order.total_amount || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</p>
            <div className="flex items-center gap-1 justify-end mt-0.5">
              <OrderStatusBadges order={order} size="sm" />
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 bg-muted/30">
          {/* Packing proof photo(s) — per section, who packed it and when */}
          {(order.sup_proof_url || order.mea_proof_url) && (
            <div className="mb-3 rounded-lg border bg-card p-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Packing Proof</p>
              <div className="flex flex-wrap gap-4">
                {order.sup_proof_url && (
                  <div className="text-center">
                    <a href={order.sup_proof_url} target="_blank" rel="noreferrer">
                      <img src={order.sup_proof_url} alt="Supplements proof" className="w-28 h-28 object-cover rounded-lg border hover:opacity-90" />
                    </a>
                    <p className="text-[11px] mt-1 font-medium">Supplements</p>
                    <p className="text-[10px] text-muted-foreground">{order.sup_packer_name || '—'}{order.sup_packed_at ? ` · ${formatDateTimeSAST(order.sup_packed_at)}` : ''}</p>
                  </div>
                )}
                {order.mea_proof_url && (
                  <div className="text-center">
                    <a href={order.mea_proof_url} target="_blank" rel="noreferrer">
                      <img src={order.mea_proof_url} alt="Meals proof" className="w-28 h-28 object-cover rounded-lg border hover:opacity-90" />
                    </a>
                    <p className="text-[11px] mt-1 font-medium">Meals</p>
                    <p className="text-[10px] text-muted-foreground">{order.mea_packer_name || '—'}{order.mea_packed_at ? ` · ${formatDateTimeSAST(order.mea_packed_at)}` : ''}</p>
                  </div>
                )}
              </div>
            </div>
          )}
          <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5" /> Inventory Product Lines
            <Badge variant="outline" className="text-[10px] py-0 border-emerald-300 text-emerald-700">affects stock</Badge>
          </p>
          <div className="rounded-lg border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left px-3 py-2 font-medium">SKU</th>
                  <th className="text-left px-3 py-2 font-medium">Name</th>
                  <th className="text-right px-3 py-2 font-medium">Qty</th>
                  <th className="text-right px-3 py-2 font-medium">Unit Price</th>
                  <th className="text-right px-3 py-2 font-medium">Total</th>
                  <th className="text-left px-3 py-2 font-medium">Type</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground text-xs">Loading items...</td></tr>
                )}
                {/* Package lines — clickable to see components */}
                {packageLines.map(line => {
                  const compQty = (componentsByParent[line.id] || []).reduce((s, c) => s + (c.qty || 0), 0);
                  return (
                    <tr
                      key={line.id}
                      className="border-b last:border-b-0 hover:bg-muted/30 cursor-pointer"
                      onClick={(e) => handlePackageClick(e, line)}
                    >
                      <td className="px-3 py-2 font-mono text-xs">{line.sku}</td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          {line.name}
                          {line.variant_title && <span className="text-xs text-muted-foreground">— {line.variant_title}</span>}
                          <Badge variant="outline" className="text-[10px] py-0 gap-1 cursor-pointer hover:bg-primary/10">
                            <Package className="w-3 h-3" /> {compQty} meals
                          </Badge>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">{line.qty}</td>
                      <td className="px-3 py-2 text-right">
                        {line.unit_price ? `R${line.unit_price.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {line.line_total ? `R${line.line_total.toFixed(2)}` : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs text-muted-foreground capitalize">
                          {(line.line_type || 'package').replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {/* Standalone lines (BYO, individual meals) — NOT components */}
                {standaloneLines.map(line => (
                  <tr key={line.id} className="border-b last:border-b-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{line.sku}</td>
                    <td className="px-3 py-2">
                      {line.name}
                      {line.variant_title && <span className="text-xs text-muted-foreground ml-1">— {line.variant_title}</span>}
                    </td>
                    <td className="px-3 py-2 text-right">{line.qty}</td>
                    <td className="px-3 py-2 text-right">
                      {line.unit_price ? `R${line.unit_price.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {line.line_total ? `R${line.line_total.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs text-muted-foreground capitalize">
                        {(line.line_type || '').replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Non-inventory order-level lines — shipping / discount / voucher / adjustment */}
          {finBySection.map(section => {
            const Icon = section.icon;
            const total = section.lines.reduce((s, l) => s + (Number(l.amount) || 0) * (l.sign || 1), 0);
            return (
              <div key={section.key} className={`mt-2 rounded-lg border ${section.border} ${section.bg} p-3`}>
                <p className={`text-xs font-semibold ${section.text} mb-2 flex items-center gap-1.5`}>
                  <Icon className="w-3.5 h-3.5" /> {section.label}
                  <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground">no stock</Badge>
                </p>
                <div className="space-y-1">
                  {section.lines.map(l => (
                    <div key={l.id} className="flex items-center justify-between text-xs">
                      <span className="truncate">{l.label}</span>
                      <span className={`font-medium ${l.sign < 0 ? 'text-rose-600' : ''}`}>
                        {l.sign < 0 ? '−' : ''}{money(l.amount)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-xs font-semibold border-t pt-1 mt-1">
                    <span>Subtotal</span>
                    <span className={total < 0 ? 'text-rose-600' : ''}>{total < 0 ? '−' : ''}{money(Math.abs(total))}</span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Additional order-level costs (manual) */}
          <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50/50 p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-orange-700 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> Additional Order Costs
                <Badge variant="outline" className="text-[10px] py-0 text-muted-foreground">not product cost</Badge>
              </p>
              <button
                onClick={(e) => { e.stopPropagation(); setShowCostForm(v => !v); }}
                className="text-[11px] border rounded-md px-2 py-1 hover:bg-muted"
              >
                {showCostForm ? 'Cancel' : 'Add cost'}
              </button>
            </div>
            {costs.length > 0 && (
              <div className="space-y-1 mb-2">
                {costs.map(c => (
                  <div key={c.id} className="flex items-center justify-between text-xs">
                    <span className="truncate">
                      <span className="capitalize">{(c.cost_type || '').replace(/_/g, ' ')}</span>
                      {c.description ? ` — ${c.description}` : ''}
                      {c.cost_date ? <span className="text-muted-foreground"> · {c.cost_date}</span> : ''}
                    </span>
                    <span className="font-medium text-rose-600">−{money(c.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            {showCostForm && (
              <form onSubmit={handleAddCost} className="grid grid-cols-2 gap-2 mt-1" onClick={e => e.stopPropagation()}>
                <select
                  className="text-xs border rounded-md px-2 py-1 bg-background"
                  value={costForm.cost_type}
                  onChange={e => setCostForm(f => ({ ...f, cost_type: e.target.value }))}
                >
                  {COST_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <input
                  type="number" step="0.01" min="0" placeholder="Amount (R)"
                  className="text-xs border rounded-md px-2 py-1 bg-background"
                  value={costForm.amount}
                  onChange={e => setCostForm(f => ({ ...f, amount: e.target.value }))}
                />
                <input
                  type="text" placeholder="Description"
                  className="text-xs border rounded-md px-2 py-1 bg-background"
                  value={costForm.description}
                  onChange={e => setCostForm(f => ({ ...f, description: e.target.value }))}
                />
                <input
                  type="text" placeholder="Reference (optional)"
                  className="text-xs border rounded-md px-2 py-1 bg-background"
                  value={costForm.reference}
                  onChange={e => setCostForm(f => ({ ...f, reference: e.target.value }))}
                />
                <input
                  type="date"
                  className="text-xs border rounded-md px-2 py-1 bg-background"
                  value={costForm.cost_date}
                  onChange={e => setCostForm(f => ({ ...f, cost_date: e.target.value }))}
                />
                <button
                  type="submit" disabled={savingCost}
                  className="text-xs bg-orange-600 text-white rounded-md px-2 py-1 hover:bg-orange-700 disabled:opacity-60 inline-flex items-center justify-center gap-1"
                >
                  {savingCost ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Save cost
                </button>
              </form>
            )}
          </div>

          {/* Profitability summary */}
          {profit && (
            <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
              <p className="text-xs font-semibold text-emerald-800 mb-2 flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5" /> Order Profitability
              </p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                <Row label="Product revenue"        value={money(profit.product_revenue)} />
                <Row label="Discounts"              value={`−${money(profit.discounts)}`}            dim={!Number(profit.discounts)} />
                <Row label="Shipping charged"       value={money(profit.shipping_charged)}           dim={!Number(profit.shipping_charged)} />
                <Row label="Voucher / store credit" value={`−${money(profit.voucher_store_credit)}`} dim={!Number(profit.voucher_store_credit)} />
                <Row label="Refunds / returns"      value={`−${money(Number(profit.refunds_financial) + Number(profit.refunds_returns))}`} dim={!(Number(profit.refunds_financial) + Number(profit.refunds_returns))} />
                <Row label="Product cost (COGS)"    value={`−${money(profit.product_cogs)}`}          dim={!Number(profit.product_cogs)} />
                <Row label="Added order costs"      value={`−${money(profit.added_order_costs)}`}     dim={!Number(profit.added_order_costs)} />
              </div>
              <div className="flex items-center justify-between border-t mt-2 pt-2 text-sm font-bold">
                <span>Net profit</span>
                <span className={Number(profit.net_profit) < 0 ? 'text-rose-600' : 'text-emerald-700'}>
                  {Number(profit.net_profit) < 0 ? '−' : ''}{money(Math.abs(Number(profit.net_profit)))}
                </span>
              </div>
              {(profit.missing_cost_skus?.length > 0 || profit.missing_boms?.length > 0) && (
                <p className="text-[10px] text-amber-700 mt-1.5">
                  ⚠ Cost incomplete — missing cost/BOM for: {[...(profit.missing_cost_skus || []), ...(profit.missing_boms || [])].join(', ')}
                </p>
              )}
            </div>
          )}

          {/* Add Re-send action */}
          <div className="mt-3 flex justify-end">
            <button
              onClick={handleAddResend}
              disabled={creatingResend}
              className="inline-flex items-center gap-1.5 text-xs border rounded-md px-3 py-1.5 hover:bg-muted disabled:opacity-60"
            >
              {creatingResend ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Add Re-send
            </button>
          </div>

          {/* Returns on this order */}
          {returns.length > 0 && (
            <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50/50 p-3">
              <p className="text-xs font-semibold text-rose-700 mb-2 flex items-center gap-1.5">
                <RotateCcw className="w-3.5 h-3.5" /> {returns.length} Return{returns.length > 1 ? 's' : ''}
              </p>
              <div className="space-y-1.5">
                {returns.map(r => (
                  <Link
                    key={r.id}
                    to={`/sales/returns/${r.id}`}
                    className="flex flex-wrap items-center gap-2 text-xs hover:underline"
                    onClick={e => e.stopPropagation()}
                  >
                    <span className="font-mono">{r.return_number}</span>
                    <Badge className={`text-[10px] py-0 ${RETURN_STATUS_COLORS[r.status] || ''}`}>{RETURN_STATUS_LABELS[r.status] || r.status}</Badge>
                    <span className="text-muted-foreground">return R {(r.total_return_value || 0).toFixed(2)}</span>
                    {(r.refund_amount || 0) > 0 && <span className="text-purple-600">refund R {r.refund_amount.toFixed(2)}</span>}
                    {(r.total_write_off_value || 0) > 0 && <span className="text-rose-600">write-off R {r.total_write_off_value.toFixed(2)}</span>}
                    {r.courier_responsibility && <span className="text-muted-foreground">· {r.courier_responsibility === 'us' ? 'we book courier' : 'customer courier'}{r.courier_status ? ` (${r.courier_status})` : ''}</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Re-sends on this order */}
          {resends.length > 0 && (
            <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
              <p className="text-xs font-semibold text-blue-700 mb-2 flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5" /> {resends.length} Re-send{resends.length > 1 ? 's' : ''}
              </p>
              <div className="space-y-1.5">
                {resends.map(r => (
                  <Link
                    key={r.id}
                    to={`/sales/resends/${r.id}`}
                    className="flex flex-wrap items-center gap-2 text-xs hover:underline"
                    onClick={e => e.stopPropagation()}
                  >
                    <span className="font-mono">{r.resend_number}</span>
                    <Badge className={`text-[10px] py-0 ${RESEND_STATUS_COLORS[r.status] || ''}`}>{RESEND_STATUS_LABELS[r.status] || r.status}</Badge>
                    {r.stock_deducted && <span className="text-emerald-600">stock out</span>}
                    {r.courier_company && <span className="text-muted-foreground">· {r.courier_company}{r.courier_tracking_ref ? ` ${r.courier_tracking_ref}` : ''}</span>}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Order metadata */}
          <div className="flex flex-wrap gap-4 mt-3 text-xs text-muted-foreground">
            {order.customer_email && <span>Email: {order.customer_email}</span>}
            {order.customer_phone && <span>Phone: {order.customer_phone}</span>}
            {order.shipping_city && <span>City: {order.shipping_city}</span>}
            {order.tags && <span>Tags: {order.tags.replace(/\|/g, ', ')}</span>}
            {order.stock_deducted && order.stock_deducted_at && (
              <span className="text-emerald-600 font-medium">
                Stock deducted: {formatDateTimeSAST(order.stock_deducted_at)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Profitability popup is rendered inline above; nothing else here. */}
      {/* Package components popup */}
      {popupPackage && (
        <PackageComponentsPopup
          packageLine={popupPackage}
          components={componentsByParent[popupPackage.id] || []}
          onClose={() => setPopupPackage(null)}
        />
      )}
    </div>
  );
}

// One label/value row in the profitability summary grid.
function Row({ label, value, dim }) {
  return (
    <div className={`flex items-center justify-between ${dim ? 'text-muted-foreground' : ''}`}>
      <span>{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}