import React, { useState } from 'react';
import { Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { money } from './money';
import { bySku } from '@/lib/naturalSort';
import PackageComponentsPopup from '../PackageComponentsPopup';

/**
 * Shared inventory product-lines table. Package parents are clickable and open
 * the PackageComponentsPopup. Standalone lines render directly.
 * Pass the full set of order lines (active + components); this component splits them.
 */
export default function OrderLinesTable({ lines = [], loading = false }) {
  const [popupPackage, setPopupPackage] = useState(null);

  const packageLines = lines.filter((l) => l.is_package_parent).sort(bySku);
  const standaloneLines = lines
    .filter((l) => !l.is_package_parent && !l.is_package_component && l.status === 'active')
    .sort(bySku);
  const componentsByParent = {};
  lines
    .filter((l) => l.is_package_component && l.status === 'active')
    .forEach((l) => {
      if (!componentsByParent[l.parent_line_id]) componentsByParent[l.parent_line_id] = [];
      componentsByParent[l.parent_line_id].push(l);
    });
  // Natural-sort the meal components within each package (MLM1, MLM2 … MLM10).
  Object.keys(componentsByParent).forEach((k) => componentsByParent[k].sort(bySku));

  const unfulfilled = (l) => {
    const f = Number(l.fulfilled_qty || 0);
    const q = Number(l.qty || 0);
    return Math.max(0, q - f);
  };

  return (
    <>
      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="text-left px-3 py-2 font-medium">SKU</th>
              <th className="text-left px-3 py-2 font-medium">Name</th>
              <th className="text-right px-3 py-2 font-medium">Qty</th>
              <th className="text-right px-3 py-2 font-medium">Fulfilled</th>
              <th className="text-right px-3 py-2 font-medium">Unfulfilled</th>
              <th className="text-right px-3 py-2 font-medium">Unit Price</th>
              <th className="text-right px-3 py-2 font-medium">Total</th>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-center text-muted-foreground text-xs">
                  Loading items...
                </td>
              </tr>
            )}
            {!loading && packageLines.length === 0 && standaloneLines.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground text-xs">
                  No product lines on this order.
                </td>
              </tr>
            )}
            {packageLines.map((line) => {
              const comps = componentsByParent[line.id] || [];
              const compQty = comps.reduce((s, c) => s + (c.qty || 0), 0);
              return (
                <tr
                  key={line.id}
                  className="border-b last:border-b-0 hover:bg-muted/30 cursor-pointer"
                  onClick={() => setPopupPackage(line)}
                >
                  <td className="px-3 py-2 font-mono text-xs">{line.sku}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      {line.name}
                      {line.variant_title && (
                        <span className="text-xs text-muted-foreground">— {line.variant_title}</span>
                      )}
                      <Badge variant="outline" className="text-[10px] py-0 gap-1 cursor-pointer hover:bg-primary/10">
                        <Package className="w-3 h-3" /> {compQty} meals
                      </Badge>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">{line.qty}</td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{line.fulfilled_qty || 0}</td>
                  <td className="px-3 py-2 text-right">{unfulfilled(line)}</td>
                  <td className="px-3 py-2 text-right">{line.unit_price ? money(line.unit_price) : '—'}</td>
                  <td className="px-3 py-2 text-right font-medium">{line.line_total ? money(line.line_total) : '—'}</td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-muted-foreground capitalize">
                      {(line.line_type || 'package').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-muted-foreground capitalize">{line.status || '—'}</span>
                  </td>
                </tr>
              );
            })}
            {standaloneLines.map((line) => (
              <tr key={line.id} className="border-b last:border-b-0 hover:bg-muted/30">
                <td className="px-3 py-2 font-mono text-xs">{line.sku}</td>
                <td className="px-3 py-2">
                  {line.name}
                  {line.variant_title && (
                    <span className="text-xs text-muted-foreground ml-1">— {line.variant_title}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{line.qty}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{line.fulfilled_qty || 0}</td>
                <td className="px-3 py-2 text-right">{unfulfilled(line)}</td>
                <td className="px-3 py-2 text-right">{line.unit_price ? money(line.unit_price) : '—'}</td>
                <td className="px-3 py-2 text-right font-medium">{line.line_total ? money(line.line_total) : '—'}</td>
                <td className="px-3 py-2">
                  <span className="text-xs text-muted-foreground capitalize">
                    {(line.line_type || '').replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="text-xs text-muted-foreground capitalize">{line.status || '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {popupPackage && (
        <PackageComponentsPopup
          packageLine={popupPackage}
          components={componentsByParent[popupPackage.id] || []}
          onClose={() => setPopupPackage(null)}
        />
      )}
    </>
  );
}
