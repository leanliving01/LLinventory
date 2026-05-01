import React from 'react';
import { UtensilsCrossed } from 'lucide-react';

export default function PortioningRuns() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <UtensilsCrossed className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Portioning Runs</h1>
      </div>
      <p className="text-sm text-muted-foreground">Phase D — Portioning bulk cooked WIP into individual meals.</p>
    </div>
  );
}