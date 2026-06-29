import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Star, ChevronRight, AlertTriangle, Sparkles } from 'lucide-react';

export default function SupplierProductRow({ sp, onClick, mismatch, aiEnriched }) {
  const cf = sp.conversion_factor || 1;
  const yf = sp.yield_factor || 1;
  const nomCost = sp.nominal_cost || 0;
  const pricePerStockUnit = sp.price_per_stock_unit
    ? sp.price_per_stock_unit
    : nomCost > 0 ? nomCost / (cf * yf) : null;

  return (
    <tr
      className="hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={() => onClick(sp)}
    >
      {/* 1. Internal Code */}
      <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground whitespace-nowrap">
        {sp.product_sku || '—'}
      </td>

      {/* 2. Internal Name + default-supplier star */}
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{sp.product_name || '—'}</span>
          {sp.is_default_supplier && (
            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" />
          )}
        </div>
      </td>

      {/* 3. Supplier */}
      <td className="px-4 py-2.5 text-sm text-muted-foreground whitespace-nowrap">
        {sp.supplier_name || '—'}
      </td>

      {/* 4. Supplier SKU */}
      <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">
        {sp.supplier_sku || '—'}
      </td>

      {/* 5. Supplier Description — truncated with full text on hover */}
      <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[160px]">
        <span
          className="block truncate"
          title={sp.supplier_description || ''}
        >
          {sp.supplier_description || '—'}
        </span>
      </td>

      {/* 6. Purchase UOM */}
      <td className="px-4 py-2.5 text-xs">
        {sp.purchase_uom_label || sp.purchase_uom || '—'}
      </td>

      {/* 7. Conversion: 1 [uom] = X [stock_uom] */}
      <td className="px-4 py-2.5 text-xs text-right tabular-nums whitespace-nowrap">
        1 {sp.purchase_uom || 'unit'} = {(cf * yf).toFixed(2)} {sp.conversion_uom || ''}
      </td>

      {/* 8. Nominal Cost */}
      <td className="px-4 py-2.5 text-sm text-right tabular-nums font-medium">
        {nomCost > 0 ? `R ${nomCost.toFixed(2)}` : '—'}
      </td>

      {/* 9. Last Purchase Price */}
      <td className="px-4 py-2.5 text-sm text-right tabular-nums font-medium">
        R {(sp.last_purchase_price || 0).toFixed(2)}
      </td>

      {/* 10. Price per Stock Unit */}
      <td className="px-4 py-2.5 text-sm text-right tabular-nums">
        {pricePerStockUnit != null ? `R ${pricePerStockUnit.toFixed(4)}` : '—'}
      </td>

      {/* 11. Status badges */}
      <td className="px-4 py-2.5 text-center">
        <div className="flex items-center justify-center gap-1.5 flex-wrap">
          {mismatch && (
            <Badge className="text-[10px] bg-orange-100 text-orange-700 gap-1">
              <AlertTriangle className="w-2.5 h-2.5" /> UoM
            </Badge>
          )}
          {aiEnriched && !mismatch && (
            <Badge className="text-[10px] bg-violet-100 text-violet-700 gap-1">
              <Sparkles className="w-2.5 h-2.5" /> AI
            </Badge>
          )}
          <Badge className={`text-[10px] ${sp.active !== false ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {sp.active !== false ? 'Active' : 'Inactive'}
          </Badge>
        </div>
      </td>

      {/* Arrow */}
      <td className="px-4 py-2.5">
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </td>
    </tr>
  );
}
