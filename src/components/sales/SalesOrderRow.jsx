import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
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
          {orderDate ? format(orderDate, 'dd MMM yyyy HH:mm') : '—'}
        </span>
        <div className="hidden md:flex items-center gap-1.5 flex-1 min-w-[180px]">
          <Badge className={`text-[11px] ${order.lifecycle_state === 'paid_unfulfilled' && order.status !== 'pending'
            ? (packStatusColors[order.status] || lifecycleColors[order.lifecycle_state] || '')
            : (lifecycleColors[order.lifecycle_state] || '')}`}>
            {order.lifecycle_state === 'paid_unfulfilled'
              ? (packStatusLabels[order.status] || 'Awaiting Fulfilment')
              : (lifecycleLabels[order.lifecycle_state] || order.lifecycle_state)}
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
              <Badge className={`text-[10px] py-0 ${order.lifecycle_state === 'paid_unfulfilled' && order.status !== 'pending'
                ? (packStatusColors[order.status] || lifecycleColors[order.lifecycle_state] || '')
                : (lifecycleColors[order.lifecycle_state] || '')}`}>
                {order.lifecycle_state === 'paid_unfulfilled'
                  ? (packStatusLabels[order.status] || 'Awaiting Fulfilment')
                  : (lifecycleLabels[order.lifecycle_state] || order.lifecycle_state)}
              </Badge>
            </div>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 bg-muted/30">
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
                  const compCount = (componentsByParent[line.id] || []).length;
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
                            <Package className="w-3 h-3" /> {compCount} meals
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