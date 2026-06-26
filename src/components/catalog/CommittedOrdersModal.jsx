import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X, ClipboardList, ExternalLink, Loader2, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/api/supabaseClient';
import { orderRef } from '@/lib/salesOrderStatus';
import { formatDateTimeSAST } from '@/lib/dateUtils';

/**
 * Drill-down behind the "Committed" number on a product's Stock tab.
 *
 * Shows every paid_unfulfilled sales order that commits this SKU and the qty it
 * commits — counting both standalone lines (the SKU sold on its own) and lines
 * where the SKU is a meal inside a package. The per-order quantities sum to the
 * product's qty_committed.
 *
 * The math mirrors recalc_committed_stock() (migration 004) exactly so the total
 * reconciles with the displayed Committed value: package parent lines are
 * decomposed via the LIVE pack_boms (multiplier / sku_overrides / disabled_skus),
 * component_component lines are ignored, and bundle lines are skipped.
 */
export default function CommittedOrdersModal({ sku, productName, committedTotal, onClose }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['committed-orders', sku],
    enabled: !!sku,
    queryFn: async () => {
      // 1. Active pack BOMs — find which package SKUs contain this meal and at
      //    what per-package quantity (override beats multiplier; skip disabled).
      const { data: boms, error: bomErr } = await supabase
        .from('pack_boms')
        .select('package_sku, multiplier, component_skus, disabled_skus, sku_overrides')
        .eq('active', true);
      if (bomErr) throw bomErr;

      const qtyPerPackage = new Map(); // package_sku -> meals of `sku` per 1 package
      for (const b of boms || []) {
        const comps = b.component_skus || [];
        if (!comps.includes(sku)) continue;
        const disabled = new Set(b.disabled_skus || []);
        if (disabled.has(sku)) continue;
        let overrides = {};
        try { overrides = typeof b.sku_overrides === 'string' ? JSON.parse(b.sku_overrides || '{}') : (b.sku_overrides || {}); } catch { /* */ }
        const per = Number(overrides[sku] ?? b.multiplier) || 0;
        if (per > 0) qtyPerPackage.set(b.package_sku, per);
      }

      const wantedSkus = [sku, ...qtyPerPackage.keys()];

      // 2. Paid-unfulfilled orders (committed = reserved-but-not-yet-fulfilled).
      const { data: orders, error: ordErr } = await supabase
        .from('sales_orders')
        .select('id, order_number, internal_order_number, shopify_order_id, order_source, customer_name, order_date, status')
        .eq('lifecycle_state', 'paid_unfulfilled')
        .is('closed_at', null); // archived (closed) orders no longer commit stock
      if (ordErr) throw ordErr;

      const orderById = new Map((orders || []).map((o) => [o.id, o]));
      const orderIds = (orders || []).map((o) => o.id);
      if (orderIds.length === 0) return { rows: [], total: 0 };

      // 3. Only the top-level lines that carry this meal — either the meal sold
      //    standalone, or a package that contains it. is_package_component rows
      //    are excluded (recalc derives meals from the BOM, not stored children).
      const lines = [];
      const CHUNK = 50;
      for (let i = 0; i < orderIds.length; i += CHUNK) {
        const chunk = orderIds.slice(i, i + CHUNK);
        const { data: part, error: lineErr } = await supabase
          .from('sales_order_lines')
          .select('sales_order_id, sku, qty, is_package_parent, line_type')
          .in('sales_order_id', chunk)
          .in('sku', wantedSkus)
          .eq('is_package_component', false)
          .eq('status', 'active');
        if (lineErr) throw lineErr;
        lines.push(...(part || []));
      }

      // 4. Fold lines into a per-order committed quantity for this meal.
      const perOrder = new Map(); // order_id -> { qty, viaPackages:Set, direct:bool }
      for (const l of lines || []) {
        if (['bundle', 'bundle_child'].includes(l.line_type || '')) continue;
        const qty = Number(l.qty || 0);
        if (!qty) continue;
        let add = 0;
        let viaPackage = null;
        if (l.is_package_parent && qtyPerPackage.has(l.sku)) {
          add = qty * qtyPerPackage.get(l.sku);
          viaPackage = l.sku;
        } else if (l.sku === sku) {
          add = qty;
        }
        if (!add) continue;
        const cur = perOrder.get(l.sales_order_id) || { qty: 0, viaPackages: new Set(), direct: false };
        cur.qty += add;
        if (viaPackage) cur.viaPackages.add(viaPackage); else cur.direct = true;
        perOrder.set(l.sales_order_id, cur);
      }

      const rows = [...perOrder.entries()]
        .map(([oid, v]) => ({ order: orderById.get(oid), ...v }))
        .filter((r) => r.order && r.qty > 0)
        .sort((a, b) => new Date(a.order.order_date || 0) - new Date(b.order.order_date || 0));

      const total = rows.reduce((s, r) => s + r.qty, 0);
      return { rows, total };
    },
  });

  const rows = data?.rows || [];
  const total = data?.total || 0;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-xl shadow-xl max-w-2xl w-[92vw] max-h-[80vh] overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-muted/30 shrink-0">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-primary" />
            <div>
              <p className="text-sm font-semibold">Committed to Orders</p>
              <p className="text-[10px] text-muted-foreground font-mono">{sku}{productName ? ` · ${productName}` : ''}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading committed orders…
            </div>
          ) : error ? (
            <div className="px-5 py-10 text-center text-sm text-red-600">Could not load orders: {error.message}</div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-muted-foreground">
              No paid-unfulfilled orders currently commit this product.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/40 backdrop-blur">
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2.5 font-medium">Order</th>
                  <th className="text-left px-4 py-2.5 font-medium">Customer</th>
                  <th className="text-left px-4 py-2.5 font-medium">Ordered</th>
                  <th className="text-left px-4 py-2.5 font-medium">Source</th>
                  <th className="text-right px-4 py-2.5 font-medium">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.order.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/sales/orders/${r.order.id}`}
                        className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                        onClick={onClose}
                      >
                        {orderRef(r.order)}
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 truncate max-w-[14rem]">{r.order.customer_name || '—'}</td>
                    <td className="px-4 py-2.5 text-muted-foreground text-xs whitespace-nowrap">
                      {r.order.order_date ? formatDateTimeSAST(r.order.order_date) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {r.direct && <Badge variant="outline" className="text-[10px] py-0">standalone</Badge>}
                        {[...r.viaPackages].map((p) => (
                          <Badge key={p} variant="outline" className="text-[10px] py-0 gap-1">
                            <Package className="w-3 h-3" /> {p}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-amber-600">{r.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-border bg-muted/20 flex items-center justify-between text-xs shrink-0">
          <span className="text-muted-foreground">
            {rows.length} order{rows.length !== 1 ? 's' : ''} committing this product
          </span>
          <span className="font-semibold">
            Total committed: <span className="text-amber-600 tabular-nums">{total}</span>
            {Number.isFinite(committedTotal) && committedTotal !== total && (
              <span className="ml-2 text-rose-600">(stock record shows {committedTotal} — recalc needed)</span>
            )}
          </span>
        </div>
      </div>
    </>
  );
}
