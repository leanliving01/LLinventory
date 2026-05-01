import React from 'react';
import { CookingPot } from 'lucide-react';

export default function CookingRuns() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <CookingPot className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Cooking Runs</h1>
      </div>
      <p className="text-sm text-muted-foreground">Phase A — Coming next. Bulk product cooking execution with yield tracking.</p>
    </div>
  );
}