import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { formatDateTimeSAST } from '@/lib/dateUtils';
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
  picking: 'Picking',
  packed: 'Packed',
  shipped: 'Shipped',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

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
  if (order.status === 'picking' && order.packing_paused) {
    const dur = formatDuration(order.packing_duration_seconds);
    return dur ? `Picking (Paused) · ${dur}` : 'Picking (Paused)';
  }
  if (order.status === 'picking') {
    const dur = formatDuration(order.packing_duration_seconds);
    return dur ? `${base} · ${dur}` : base;
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
  if (order.status === 'picking' && order.packing_paused) return 'bg-orange-100 text-orange-700';
  return packStatusColors[order.status] || lifecycleColors[order.lifecycle_state] || '';
}

export default function SalesOrderRow({ order }) {
  const [expanded, setExpanded] = useState(false);
  const [popupPackage, setPopupPackage] = useState(null);

  const { data: lines = [] } = useQuery({
    queryKey: ['sales-order-lines', order.id],
    queryFn: () => base44.entities.SalesOrderLine.filter({ sales_order_id: order.id }),
    enabled: expanded, // only fetch when expanded
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

  return (
    <div className="border-b last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
      >
        <span className="text-muted-foreground shrink-0">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </span>
        {/* Desktop layout */}
        <span className="hidden md:inline font-semibold text-sm w-28 shrink-0">{order.order_number || order.shopify_order_id}</span>
        <span className="hidden md:inline text-sm w-40 truncate shrink-0">{order.customer_name || '—'}</span>
        <span className="hidden md:inline text-sm text-muted-foreground w-36 shrink-0">
          {orderDate ? formatDateTimeSAST(orderDate) : '—'}
        </span>
        <div className="hidden md:flex items-center gap-1.5 flex-1 min-w-[180px]">
          <Badge className={`text-[11px] ${getPackColor(order)}`}>
            {getPackLabel(order)}
          </Badge>
        </div>
        <span className="hidden md:inline text-sm font-medium w-28 text-right shrink-0">
          R{(order.total_amount || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
        </span>

        {/* Mobile layout */}
        <div className="flex md:hidden flex-1 min-w-0">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">{order.order_number || order.shopify_order_id}</p>
            <p className="text-xs text-muted-foreground truncate">{order.customer_name || '—'}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-medium">R{(order.total_amount || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}</p>
            <div className="flex items-center gap-1 justify-end mt-0.5">
              <Badge className={`text-[10px] py-0 ${getPackColor(order)}`}>
                {getPackLabel(order)}
              </Badge>
            </div>
          </div>
        </div>
      </button>

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
          {/* Order metadata */}
          <div className="flex flex-wrap gap-4 mt-3 text-xs text-muted-foreground">
            {order.customer_email && <span>Email: {order.customer_email}</span>}
            {order.customer_phone && <span>Phone: {order.customer_phone}</span>}
            {order.shipping_city && <span>City: {order.shipping_city}</span>}
            {order.tags && <span>Tags: {order.tags.replace(/\|/g, ', ')}</span>}
          </div>
        </div>
      )}

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