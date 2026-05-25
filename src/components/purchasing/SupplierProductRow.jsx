import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Star, ChevronRight, AlertTriangle, Sparkles } from 'lucide-react';

export default function SupplierProductRow({ sp, onClick, mismatch, aiEnriched }) {
  const effectiveQty = (sp.conversion_factor || 1) * (sp.yield_factor || 1);
  return (
    <tr
      className="hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={() => onClick(sp)}
    >
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{sp.product_name || '—'}</span>
          {sp.is_default_supplier && (
            <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
          )}
        </div>
        <span className="text-[11px] font-mono text-muted-foreground">{sp.product_sku || ''}</span>
      </td>
      <td className="px-4 py-2.5 text-sm text-muted-foreground">{sp.supplier_name || '—'}</td>
      <td className="px-4 py-2.5 text-xs font-mono text-muted-foreground">{sp.supplier_sku || '—'}</td>
      <td className="px-4 py-2.5 text-xs">
        {sp.purchase_uom_label || `${sp.purchase_uom || '—'}`}
      </td>
      <td className="px-4 py-2.5 text-sm text-right tabular-nums">
        {sp.conversion_factor || 1} {sp.conversion_uom || ''}
      </td>
      <td className="px-4 py-2.5 text-sm text-right tabular-nums">
        {(sp.yield_factor || 1) < 1 ? `${((sp.yield_factor || 1) * 100).toFixed(0)}%` : '100%'}
      </td>
      <td className="px-4 py-2.5 text-sm text-right tabular-nums font-medium">
        R {(sp.last_purchase_price || 0).toFixed(2)}
      </td>
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
      <td className="px-4 py-2.5">
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </td>
    </tr>
  );
}