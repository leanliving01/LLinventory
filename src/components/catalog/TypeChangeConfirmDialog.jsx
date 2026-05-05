import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ArrowRight, X, ShieldCheck } from 'lucide-react';
import ManagerPinModal from '@/components/production/ManagerPinModal';

const TYPE_LABELS = {
  raw: 'Raw Material',
  packaging: 'Packaging',
  wip_bulk: 'Bulk Cooked',
  finished_meal: 'Finished Meal',
  supplement: 'Supplement',
  package: 'Package',
  sauce: 'Sauce',
  solo_serve: 'Solo Serve',
  bundle: 'Bundle',
  service: 'Service',
};

const IMPACT_WARNINGS = [
  'Existing recipes (BOMs) linked to this product remain intact but the product will no longer appear in type-filtered recipe views.',
  'Active or scheduled production runs referencing this product will still work, but it won\'t show up in planning filters for the old type.',
  'Shopify sync links are unaffected (linked by product ID, not type).',
  'The subcategory will be cleared and auto-detected based on the new type.',
  'Stock on hand, cost, price, and UoM are NOT changed — review these manually after the move.',
];

export default function TypeChangeConfirmDialog({ product, fromType, toType, onConfirm, onCancel }) {
  const [showPin, setShowPin] = useState(false);

  if (!product) return null;

  if (showPin) {
    return (
      <ManagerPinModal
        onVerified={(manager) => {
          onConfirm(manager);
        }}
        onCancel={() => setShowPin(false)}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-lg shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h3 className="text-lg font-bold">Change Product Type</h3>
              <p className="text-xs text-muted-foreground">This requires manager approval</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-6 space-y-5">
          {/* Product info */}
          <div className="bg-muted/30 border border-border rounded-xl p-4">
            <p className="text-sm font-bold">{product.name}</p>
            <p className="text-xs font-mono text-muted-foreground">{product.sku}</p>
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                {TYPE_LABELS[fromType] || fromType}
              </span>
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                {TYPE_LABELS[toType] || toType}
              </span>
            </div>
          </div>

          {/* Impact warnings */}
          <div>
            <p className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              What this will affect
            </p>
            <ul className="space-y-2">
              {IMPACT_WARNINGS.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          </div>

          {/* Action */}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
            <Button className="flex-1 gap-2 bg-amber-600 hover:bg-amber-700" onClick={() => setShowPin(true)}>
              <ShieldCheck className="w-4 h-4" />
              Continue with PIN
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}