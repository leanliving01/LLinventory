import React from 'react';
import { AlertTriangle } from 'lucide-react';

export default function DemandWarnings({ warnings }) {
  if (!warnings || warnings.length === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 text-amber-600" />
        <h4 className="text-sm font-semibold text-amber-800">Warnings ({warnings.length})</h4>
      </div>
      <ul className="space-y-1 max-h-40 overflow-y-auto">
        {warnings.map((w, i) => (
          <li key={i} className="text-xs text-amber-700">• {w}</li>
        ))}
      </ul>
    </div>
  );
}