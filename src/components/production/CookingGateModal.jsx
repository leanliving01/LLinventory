import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CookingPot, ShieldAlert, X } from 'lucide-react';

/**
 * Blocking modal shown when pre-conditions for starting a production run are not met.
 * Used for both QC gate and cooking-complete gate.
 */
export default function CookingGateModal({ title, description, items, itemLabel, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border border-border w-full max-w-lg shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5 text-amber-600" />
            </div>
            <h3 className="text-lg font-bold">{title}</h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <p className="text-sm text-muted-foreground">{description}</p>
          {items.length > 0 && (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              <p className="text-xs font-semibold text-muted-foreground uppercase">{itemLabel}</p>
              {items.map((item, i) => (
                <div key={i} className="flex items-center justify-between bg-amber-50 dark:bg-amber-950/20 rounded-lg px-3 py-2 border border-amber-200 dark:border-amber-800">
                  <div>
                    <p className="text-sm font-medium">{item.name}</p>
                    {item.detail && <p className="text-[11px] text-muted-foreground">{item.detail}</p>}
                  </div>
                  {item.badge && (
                    <Badge className={item.badgeClass || 'bg-amber-100 text-amber-700'}>
                      {item.badge}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-border">
          <Button onClick={onClose} className="w-full h-11">
            Understood
          </Button>
        </div>
      </div>
    </div>
  );
}