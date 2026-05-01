import React from 'react';
import { Gauge } from 'lucide-react';

export default function YieldReview() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Gauge className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold">Yield Review</h1>
      </div>
      <p className="text-sm text-muted-foreground">Phase C — Production Manager yield record review and approval task list.</p>
    </div>
  );
}