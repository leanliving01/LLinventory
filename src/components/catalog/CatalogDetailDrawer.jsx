import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, Package, Tag, MapPin, DollarSign, Barcode, Weight, Info } from 'lucide-react';

const TYPE_COLORS = {
  raw: 'bg-amber-100 text-amber-700',
  packaging: 'bg-gray-100 text-gray-700',
  wip_bulk: 'bg-orange-100 text-orange-700',
  finished_meal: 'bg-green-100 text-green-700',
  supplement: 'bg-purple-100 text-purple-700',
  package: 'bg-blue-100 text-blue-700',
  sauce: 'bg-red-100 text-red-700',
  solo_serve: 'bg-pink-100 text-pink-700',
  bundle: 'bg-indigo-100 text-indigo-700',
  service: 'bg-slate-100 text-slate-700',
};

function Field({ icon: Icon, label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

export default function CatalogDetailDrawer({ product, onClose }) {
  const p = product;

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-card border-l border-border z-50 overflow-y-auto shadow-xl">
        <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-bold">{p.name}</h2>
            <p className="text-sm font-mono text-muted-foreground">{p.sku}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {/* Status + Type */}
          <div className="flex gap-2">
            <Badge className={TYPE_COLORS[p.type] || 'bg-gray-100 text-gray-700'}>
              {p.type?.replace(/_/g, ' ')}
            </Badge>
            <Badge className={p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}>
              {p.status}
            </Badge>
          </div>

          {/* Core info */}
          <div className="divide-y divide-border">
            <Field icon={Tag} label="Category" value={p.category} />
            <Field icon={Barcode} label="Barcode" value={p.barcode} />
            <Field icon={Weight} label="Weight" value={p.weight_g ? `${p.weight_g} g` : null} />
            <Field icon={Package} label="Stock UoM" value={p.stock_uom} />
            <Field icon={Package} label="Purchase UoM" value={p.purchase_uom} />
            <Field icon={Info} label="Purchase → Stock Factor" value={p.purchase_to_stock_factor} />
            <Field icon={Package} label="Recipe UoM" value={p.recipe_uom} />
          </div>

          {/* Pricing */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Pricing</h3>
            <div className="divide-y divide-border">
              <Field icon={DollarSign} label="Average Cost" value={p.cost_avg ? `R ${p.cost_avg.toFixed(2)}` : null} />
              <Field icon={DollarSign} label="Selling Price" value={p.price ? `R ${p.price.toFixed(2)}` : null} />
            </div>
          </div>

          {/* Planning */}
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Planning</h3>
            <div className="divide-y divide-border">
              <Field icon={Info} label="Par Level" value={p.par_level || null} />
              <Field icon={Info} label="Reorder Point" value={p.min_before_reorder || null} />
              <Field icon={Info} label="Reorder Qty" value={p.reorder_qty || null} />
            </div>
          </div>

          {/* Shopify */}
          {(p.shopify_product_id || p.shopify_variant_id) && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Shopify</h3>
              <div className="divide-y divide-border">
                <Field icon={Info} label="Product ID" value={p.shopify_product_id} />
                <Field icon={Info} label="Variant ID" value={p.shopify_variant_id} />
              </div>
            </div>
          )}

          {/* Tags */}
          {p.tags && p.tags.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Tags</h3>
              <div className="flex flex-wrap gap-1">
                {p.tags.map((t, i) => (
                  <Badge key={i} variant="outline" className="text-xs">{t}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {p.description && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Description</h3>
              <p className="text-sm text-muted-foreground">{p.description}</p>
            </div>
          )}
          {p.internal_note && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Internal Notes</h3>
              <p className="text-sm text-muted-foreground">{p.internal_note}</p>
            </div>
          )}

          {/* Cin7 ID */}
          {p.cin7_id && (
            <p className="text-xs text-muted-foreground/50">Cin7 ID: {p.cin7_id}</p>
          )}
        </div>
      </div>
    </>
  );
}