import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';

/**
 * "Attributes" tab — shows product attributes: weight, UoM, category, tags, etc.
 */
export default function AttributesTab({ task }) {
  const { data: products = [] } = useQuery({
    queryKey: ['product-detail', task.product_id],
    queryFn: () => base44.entities.Product.filter({ id: task.product_id }),
    enabled: !!task.product_id,
  });

  const product = products[0] || null;

  if (!product) {
    return (
      <div className="text-center py-10">
        <p className="text-muted-foreground text-sm">No product details available.</p>
      </div>
    );
  }

  const rows = [
    { label: 'SKU', value: product.sku },
    { label: 'Type', value: product.type },
    { label: 'Category', value: product.category },
    { label: 'Stock UoM', value: product.stock_uom },
    { label: 'Recipe UoM', value: product.recipe_uom },
    { label: 'Weight', value: product.weight_g ? `${product.weight_g}g` : null },
    { label: 'Par Level', value: product.par_level },
  ].filter(r => r.value);

  return (
    <div className="space-y-3">
      <div className="bg-card border rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30">
          <h3 className="font-bold text-sm">{product.name}</h3>
        </div>
        <div className="divide-y">
          {rows.map(r => (
            <div key={r.label} className="px-4 py-3 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{r.label}</span>
              <span className="font-medium text-sm tabular-nums">{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tags */}
      {product.tags && product.tags.length > 0 && (
        <div className="bg-card border rounded-2xl p-4">
          <p className="text-sm text-muted-foreground mb-2">Tags</p>
          <div className="flex flex-wrap gap-1.5">
            {product.tags.map(tag => (
              <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Description / internal note */}
      {product.description && (
        <div className="bg-card border rounded-2xl p-4">
          <p className="text-sm text-muted-foreground mb-1">Description</p>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{product.description}</p>
        </div>
      )}
      {product.internal_note && (
        <div className="bg-card border rounded-2xl p-4">
          <p className="text-sm text-muted-foreground mb-1">Internal Note</p>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{product.internal_note}</p>
        </div>
      )}
    </div>
  );
}