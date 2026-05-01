import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Package, Plus, Star, ChevronRight, ArrowRightLeft } from 'lucide-react';
import CreateSupplierProductModal from './CreateSupplierProductModal';
import SupplierProductDrawer from './SupplierProductDrawer';

/**
 * Embedded tab for SupplierDetailDrawer showing SupplierProduct records
 * instead of legacy Product.supplier_id links.
 */
export default function SupplierProductsTab({ supplierId, canEdit }) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedSP, setSelectedSP] = useState(null);

  const { data: supplierProducts = [], isLoading } = useQuery({
    queryKey: ['supplier-products-tab', supplierId],
    queryFn: () => base44.entities.SupplierProduct.filter({ supplier_id: supplierId }, 'product_name', 100),
  });

  const handleUpdated = () => {
    queryClient.invalidateQueries({ queryKey: ['supplier-products-tab', supplierId] });
    if (selectedSP) {
      base44.entities.SupplierProduct.filter({ id: selectedSP.id }).then(res => {
        if (res[0]) setSelectedSP(res[0]); else setSelectedSP(null);
      });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Package className="w-4 h-4 text-primary" />
          Product Catalog ({supplierProducts.length})
        </h3>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setShowCreate(true)} className="gap-1.5 h-7 text-xs">
            <Plus className="w-3.5 h-3.5" /> Link Product
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : supplierProducts.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No products linked yet. {canEdit ? 'Click "Link Product" to add one.' : ''}
        </p>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Product</th>
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Purchase UoM</th>
                <th className="text-right px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase">Price</th>
                <th className="w-6"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {supplierProducts.slice(0, 15).map(sp => (
                <tr
                  key={sp.id}
                  className="hover:bg-muted/20 cursor-pointer"
                  onClick={() => setSelectedSP(sp)}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">{sp.product_name}</span>
                      {sp.is_default_supplier && <Star className="w-3 h-3 text-amber-500 fill-amber-500" />}
                    </div>
                    <span className="text-[11px] font-mono text-muted-foreground">{sp.product_sku}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div>{sp.purchase_uom_label || sp.purchase_uom || '—'}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <ArrowRightLeft className="w-3 h-3" />
                      {sp.conversion_factor || 1} {sp.conversion_uom || ''}
                      {(sp.yield_factor || 1) < 1 && ` × ${((sp.yield_factor || 1) * 100).toFixed(0)}%`}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-right font-medium tabular-nums">
                    R {(sp.last_purchase_price || 0).toFixed(2)}
                  </td>
                  <td className="px-3 py-2">
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {supplierProducts.length > 15 && (
            <div className="px-3 py-2 bg-muted/30 border-t border-border">
              <p className="text-xs text-muted-foreground">+{supplierProducts.length - 15} more</p>
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <CreateSupplierProductModal
          preselectedSupplierId={supplierId}
          onCreated={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['supplier-products-tab', supplierId] });
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {selectedSP && (
        <SupplierProductDrawer
          sp={selectedSP}
          onClose={() => setSelectedSP(null)}
          onUpdated={handleUpdated}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}