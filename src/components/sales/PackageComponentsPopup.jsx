import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, Package } from 'lucide-react';

export default function PackageComponentsPopup({ packageLine, components, onClose }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-card border border-border rounded-xl shadow-xl max-w-md w-full max-h-[70vh] overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" />
            <div>
              <p className="text-sm font-semibold">{packageLine.name || packageLine.sku}</p>
              <p className="text-[10px] text-muted-foreground font-mono">{packageLine.sku} · Qty: {packageLine.qty}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="overflow-y-auto max-h-[50vh]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground bg-muted/20">
                <th className="text-left px-4 py-2 font-medium">SKU</th>
                <th className="text-left px-4 py-2 font-medium">Component</th>
                <th className="text-right px-4 py-2 font-medium">Qty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {components.map(c => (
                <tr key={c.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{c.sku}</td>
                  <td className="px-4 py-2 text-sm">{c.name}</td>
                  <td className="px-4 py-2 text-right text-sm font-medium">{c.qty}</td>
                </tr>
              ))}
              {components.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground text-xs">No components found</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-2.5 border-t border-border bg-muted/20 text-xs text-muted-foreground">
          {components.length} component{components.length !== 1 ? 's' : ''} · {components.reduce((s, c) => s + (c.qty || 0), 0)} total units
        </div>
      </div>
    </>
  );
}